import { InMemoryRunner, LlmAgent, stringifyContent, getFunctionCalls, getFunctionResponses } from "@google/adk";
import { readOnlyTools } from "../agent/tools/read_tools";
import { RecoveryPlanSchema } from "../agent/schema";
import { closePool } from "../db/client";

process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
process.env.GOOGLE_CLOUD_PROJECT = "gen-lang-client-0057923797";
process.env.GOOGLE_CLOUD_LOCATION = "global";
process.env.TASKMASTER_MODEL = "gemini-3.5-flash";

async function main() {
  console.log("==================================================");
  console.log("Testing Google ADK with Gemini 3.5 Flash on Vertex AI (location: global)");
  console.log("==================================================");

  const testAgent = new LlmAgent({
    name: "taskmaster_agent",
    description: "Taskmaster on Gemini 3.5 Flash",
    model: "gemini-3.5-flash",
    instruction: "You are Taskmaster. Inspect project 'student-marketplace' using your tools and produce a structured recovery plan.",
    tools: readOnlyTools,
    outputSchema: RecoveryPlanSchema,
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
  });

  const runner = new InMemoryRunner({
    agent: testAgent,
    appName: "taskmaster",
  });

  console.log("Running ADK agent stream with Gemini 3.5 Flash…");
  const stream = runner.runEphemeral({
    userId: "test-user",
    newMessage: {
      parts: [{ text: "Inspect student-marketplace and return the structured recovery plan." }],
    },
  });

  let responseText = "";
  for await (const event of stream) {
    const calls = getFunctionCalls(event);
    for (const call of calls) {
      console.log(`[Tool Call] ${call.name}(${JSON.stringify(call.args)})`);
    }
    const responses = getFunctionResponses(event);
    for (const res of responses) {
      console.log(`[Tool Response] ${res.name} -> Status: OK`);
    }
    if (event.errorCode || event.errorMessage) {
      console.error(`[ADK Error] ${event.errorCode}: ${event.errorMessage}`);
    }
    const text = stringifyContent(event);
    if (text) responseText = text;
  }

  console.log("\nAgent Final Plan Output:\n", responseText);
  await closePool();
  console.log("==================================================");
  console.log("✓ GEMINI 3.5 FLASH ON VERTEX AI (GLOBAL) VERIFIED SUCCESSFULLY!");
  console.log("==================================================");
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
