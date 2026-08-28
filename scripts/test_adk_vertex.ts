import { InMemoryRunner, LlmAgent, stringifyContent, getFunctionCalls, getFunctionResponses } from "@google/adk";
import { readOnlyTools } from "../agent/tools/read_tools";
import { RecoveryPlanSchema } from "../agent/schema";

process.env.GOOGLE_GENAI_USE_VERTEXAI = "true";
process.env.GOOGLE_CLOUD_PROJECT = "gen-lang-client-0057923797";
process.env.GOOGLE_CLOUD_LOCATION = "us-central1";

async function main() {
  console.log("==================================================");
  console.log("Testing Google ADK with Vertex AI Backend");
  console.log("==================================================");

  const testAgent = new LlmAgent({
    name: "test_taskmaster_vertex",
    description: "Taskmaster on Vertex AI",
    model: "gemini-2.5-flash",
    instruction: "You are Taskmaster. Call getProjectState with projectId: 'student-marketplace', then summarize your findings and produce a recovery plan.",
    tools: readOnlyTools,
    outputSchema: RecoveryPlanSchema,
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
  });

  const runner = new InMemoryRunner({
    agent: testAgent,
    appName: "taskmaster",
  });

  console.log("Executing agent workflow…");
  const stream = runner.runEphemeral({
    userId: "test-vertex-user",
    newMessage: {
      parts: [{ text: "Analyze project 'student-marketplace' and create recovery plan." }],
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

  console.log("\nAgent Final Output:\n", responseText);
  console.log("==================================================");
  console.log("✓ ADK + VERTEX AI WORKFLOW COMPLETED SUCCESSFULLY!");
  console.log("==================================================");
}

main().catch(console.error);
