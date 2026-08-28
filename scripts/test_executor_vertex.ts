import { executeTaskmasterAgent } from "../agent/executor";
import { agentRunRepository } from "../db/repositories";
import { closePool } from "../db/client";

process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
process.env.GOOGLE_CLOUD_PROJECT = "gen-lang-client-0057923797";
process.env.GOOGLE_CLOUD_LOCATION = "global";
process.env.TASKMASTER_MODEL = "gemini-3.5-flash";

async function main() {
  console.log("==================================================");
  console.log("Testing executeTaskmasterAgent with Gemini 3.5 Flash on Vertex AI (global)");
  console.log("==================================================");

  const result = await executeTaskmasterAgent({
    projectId: "student-marketplace",
    goal: "Test Gemini 3.5 Flash execution with tools on Vertex AI.",
  });

  console.log("\nExecution Result:", {
    agentRunId: result.agentRunId,
    state: result.state,
    stepsCount: result.stepsCount,
    summary: result.summary,
    planProposedActions: result.plan?.proposedActions,
  });

  if (result.state !== "PLANNING" || !result.plan) {
    throw new Error(`Agent execution failed or state is ${result.state}`);
  }

  const steps = await agentRunRepository.getSteps(result.agentRunId);
  console.log(`\nPersisted ${steps.length} steps in PostgreSQL:`);
  steps.forEach((s) => {
    console.log(`  [Step ${s.stepNumber}] ${s.stepType}: ${s.toolName || "(plan)"}`);
  });

  await closePool();
  console.log("\n==================================================");
  console.log("✓ GEMINI 3.5 FLASH EXECUTOR VERIFIED ON VERTEX AI!");
  console.log("==================================================");
}

main().catch(async (err) => {
  console.error("✗ Test failed:", err);
  await closePool();
  process.exit(1);
});
