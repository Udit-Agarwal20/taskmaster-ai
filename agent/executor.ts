import { InMemoryRunner, getFunctionCalls, getFunctionResponses, stringifyContent } from "@google/adk";
import { taskmasterAgent, createTaskmasterAgent } from "./taskmaster_agent";
import { RecoveryPlan, RecoveryPlanSchema } from "./schema";
import { agentRunRepository, projectRepository } from "../db/repositories";
import { AgentState } from "./state";

export type ExecuteAgentParams = {
  projectId: string;
  goal: string;
  userId?: string;
  runId?: string;
};

export type ExecuteAgentResult = {
  agentRunId: string;
  state: AgentState;
  plan: RecoveryPlan | null;
  summary: string;
  stepsCount: number;
};

/**
 * Extracts and cleans JSON from a model output string.
 */
export function extractJsonFromText(text: string): any {
  const trimmed = text.trim();
  // Strip markdown code fences if present (e.g. ```json ... ```)
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const rawJson = jsonMatch ? jsonMatch[1] : trimmed;
  return JSON.parse(rawJson);
}

/**
 * Executes the Taskmaster Google ADK agent against a specific project goal.
 * Handles lifecycle state transitions and persists run/steps to PostgreSQL.
 */
export async function executeTaskmasterAgent(
  params: ExecuteAgentParams
): Promise<ExecuteAgentResult> {
  const { projectId, goal, userId, runId } = params;

  // 1. Verify project exists
  const project = await projectRepository.findById(projectId);
  if (!project) {
    throw new Error(`Project '${projectId}' not found`);
  }

  // 2. Load existing run or initialize and persist new agent run record
  let run = runId ? await agentRunRepository.findById(runId) : null;
  if (!run) {
    run = await agentRunRepository.create({
      id: runId,
      projectId,
      goal,
      state: "UNDERSTANDING",
    });
  }

  // 3. Verify Gemini / Vertex AI authentication is available
  const isVertexAi =
    process.env.GOOGLE_GENAI_USE_VERTEXAI === "true" ||
    process.env.USE_VERTEX_AI === "true";
  const hasApiKey = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY);

  if (!isVertexAi && !hasApiKey) {
    const errorSummary =
      "Neither Vertex AI (GOOGLE_GENAI_USE_VERTEXAI=true) nor GEMINI_API_KEY is configured. Please configure Google Cloud Vertex AI or set GEMINI_API_KEY.";
    await agentRunRepository.updateWorkflowState(run.id, {
      state: "FAILED",
      summary: errorSummary,
      lastError: errorSummary,
    });
    return {
      agentRunId: run.id,
      state: "FAILED",
      plan: null,
      summary: errorSummary,
      stepsCount: 0,
    };
  }

  const existingSteps = await agentRunRepository.getSteps(run.id);
  let stepNumber = existingSteps.length;
  let responseText = "";

  try {
    // 4. Instantiate ADK InMemoryRunner with current agent config
    const agent = createTaskmasterAgent();
    const runner = new InMemoryRunner({
      agent,
      appName: "taskmaster",
    });

    const userPrompt = `Project ID: ${projectId}\nGoal: ${goal}\nProject Name: ${project.name}\nDeadline: ${project.deadline}\n\nPlease inspect the live project state, identify blockers and workload bottlenecks, and produce a structured recovery plan conforming to the required schema.`;

    // 5. Execute agent workflow and stream events
    const stream = runner.runEphemeral({
      userId: userId || "user-udit",
      newMessage: {
        parts: [{ text: userPrompt }],
      },
    });

    for await (const event of stream) {
      // Record Tool Calls
      const calls = getFunctionCalls(event);
      for (const call of calls) {
        stepNumber++;
        await agentRunRepository.addStep({
          agentRunId: run.id,
          stepNumber,
          stepType: "TOOL_CALL",
          toolName: call.name,
          input: call.args,
          status: "COMPLETED",
        });

        // Transition state to PLANNING once inspection begins
        await agentRunRepository.updateWorkflowState(run.id, {
          state: "PLANNING",
          currentStep: "PLANNING",
        });
      }

      // Record Tool Responses
      const responses = getFunctionResponses(event);
      for (const res of responses) {
        stepNumber++;
        await agentRunRepository.addStep({
          agentRunId: run.id,
          stepNumber,
          stepType: "TOOL_RESPONSE",
          toolName: res.name,
          output: res.response,
          status: "COMPLETED",
        });
      }

      // Check for ADK / Gemini API error
      if (event.errorCode || event.errorMessage) {
        throw new Error(`Gemini API error (${event.errorCode || 'UNKNOWN'}): ${event.errorMessage || 'No message'}`);
      }

      // Capture final text response
      const text = stringifyContent(event);
      if (text) {
        responseText = text;
      }
    }

    if (!responseText) {
      throw new Error("Agent finished execution without returning a recovery plan.");
    }

    // 6. Parse and validate structured recovery plan
    const parsedJson = extractJsonFromText(responseText);
    const validatedPlan = RecoveryPlanSchema.parse({
      ...parsedJson,
      projectId: parsedJson.projectId || projectId,
    });

    // 7. Persist plan and summary to agent_runs
    await agentRunRepository.updateWorkflowState(run.id, {
      plan: validatedPlan,
      summary: validatedPlan.summary,
    });

    return {
      agentRunId: run.id,
      state: "PLANNING",
      plan: validatedPlan,
      summary: validatedPlan.summary,
      stepsCount: stepNumber,
    };
  } catch (error: any) {
    const errorMsg = error?.message || "Unknown error during agent execution";
    console.error("Agent execution failed:", errorMsg);

    // Mark run as FAILED in database
    await agentRunRepository.updateWorkflowState(run.id, {
      state: "FAILED",
      summary: `Agent execution failed: ${errorMsg}`,
      lastError: errorMsg,
    });

    return {
      agentRunId: run.id,
      state: "FAILED",
      plan: null,
      summary: `Agent execution failed: ${errorMsg}`,
      stepsCount: stepNumber,
    };
  }
}
