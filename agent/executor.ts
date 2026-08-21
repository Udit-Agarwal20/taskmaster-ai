import { InMemoryRunner, getFunctionCalls, getFunctionResponses, stringifyContent } from "@google/adk";
import { taskmasterAgent } from "./taskmaster_agent";
import { RecoveryPlan, RecoveryPlanSchema } from "./schema";
import { agentRunRepository, projectRepository } from "../db/repositories";
import { AgentState } from "./state";

export type ExecuteAgentParams = {
  projectId: string;
  goal: string;
  userId?: string;
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
  const { projectId, goal, userId } = params;

  // 1. Verify project exists
  const project = await projectRepository.findById(projectId);
  if (!project) {
    throw new Error(`Project '${projectId}' not found`);
  }

  // 2. Initialize and persist agent run record (IDLE -> UNDERSTANDING)
  const run = await agentRunRepository.create({
    projectId,
    goal,
    state: "UNDERSTANDING",
  });

  // 3. Verify GEMINI_API_KEY is available
  if (!process.env.GEMINI_API_KEY) {
    const errorSummary =
      "GEMINI_API_KEY environment variable is not configured. Please set GEMINI_API_KEY in your .env file to enable live agent planning.";
    await agentRunRepository.updateState(run.id, "FAILED", errorSummary);
    return {
      agentRunId: run.id,
      state: "FAILED",
      plan: null,
      summary: errorSummary,
      stepsCount: 0,
    };
  }

  let stepNumber = 0;
  let responseText = "";

  try {
    // 4. Instantiate ADK InMemoryRunner
    const runner = new InMemoryRunner({
      agent: taskmasterAgent,
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
        await agentRunRepository.updateState(run.id, "PLANNING");
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

    // 7. Mark run as COMPLETED in database
    await agentRunRepository.updateState(
      run.id,
      "COMPLETED",
      validatedPlan.summary
    );

    return {
      agentRunId: run.id,
      state: "COMPLETED",
      plan: validatedPlan,
      summary: validatedPlan.summary,
      stepsCount: stepNumber,
    };
  } catch (error: any) {
    const errorMsg = error?.message || "Unknown error during agent execution";
    console.error("Agent execution failed:", errorMsg);

    // Mark run as FAILED in database
    await agentRunRepository.updateState(run.id, "FAILED", errorMsg);

    return {
      agentRunId: run.id,
      state: "FAILED",
      plan: null,
      summary: `Agent execution failed: ${errorMsg}`,
      stepsCount: stepNumber,
    };
  }
}
