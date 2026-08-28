import { sendSlackMessage } from "../lib/integrations/slack/client";

async function main() {
  console.log("==================================================");
  console.log("Taskmaster: Verifying Controlled Slack Sink Failure");
  console.log("==================================================");

  // Temporarily override token to verify honest failure reporting
  const originalToken = process.env.SLACK_BOT_TOKEN;
  process.env.SLACK_BOT_TOKEN = "xoxb-invalid-fake-token";

  const result = await sendSlackMessage({
    channelId: "C12345678",
    text: "Testing honest Slack error reporting",
    idempotencyKey: "test-failure-" + Date.now(),
  });

  process.env.SLACK_BOT_TOKEN = originalToken;

  console.log("Execution Result:", result);

  if (result.ok !== false) {
    throw new Error("Slack action should have failed but reported success");
  }
  if (!result.error || result.error.includes("xoxb-invalid-fake-token")) {
    throw new Error("Error must be present and must not leak the raw token");
  }

  console.log("✓ Slack action failed honestly with error:", result.error);
  console.log("✓ Secrets remained hidden.");
  console.log("==================================================");
  console.log("✓ CONTROLLED FAILURE TEST PASSED!");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("✗ Failure test failed:", err.message);
  process.exit(1);
});

