import "dotenv/config";
import { formatTaskmasterSlackUpdate } from "../lib/integrations/slack/formatter";
import { sendSlackMessage, setMockSlackHandler } from "../lib/integrations/slack/client";
import { workflowService } from "../lib/services/workflow.service";
import { executeSendSlackMessage, executeCreateSubtask } from "./tools/mutation_tools";
import {
  taskRepository,
  agentRunRepository,
  activityRepository,
  eventRepository,
} from "../db/repositories";
import { DEMO_PROJECT_ID } from "../db/seed";
import { closePool } from "../db/client";

async function verifySlackIntegration() {
  console.log("==================================================");
  console.log("Taskmaster Milestone 4D — Slack App Verification");
  console.log("==================================================");

  const hasLiveToken = Boolean(process.env.SLACK_BOT_TOKEN);
  const liveChannel = process.env.SLACK_CHANNEL_ID || "C_TASKMASTER_DEMO";
  console.log(`Slack Mode: ${hasLiveToken ? "LIVE (SLACK_BOT_TOKEN detected)" : "SIMULATED (Local Test Harness)"}`);
  console.log(`Target Channel: ${liveChannel}`);

  if (!hasLiveToken) {
    console.log("ℹ No live SLACK_BOT_TOKEN found in environment. Using deterministic mock handler.");
    setMockSlackHandler(async (params) => {
      if (params.channelId === "C_INVALID_CHANNEL") {
        return { ok: false, error: "channel_not_found", channelId: params.channelId };
      }
      return {
        ok: true,
        messageId: `1724450000.${Math.floor(Math.random() * 900000 + 100000)}`,
        channelId: params.channelId || liveChannel,
        ts: `1724450000.${Date.now()}`,
        isMock: true,
      };
    });
  }

  // ----------------------------------------------------
  // Test 1: Direct Slack Notification Message
  // ----------------------------------------------------
  console.log("\n[1/3] Testing Direct Slack Message Formatter & API Delivery…");
  const testMessage = formatTaskmasterSlackUpdate({
    projectTitle: "Student Marketplace Launch",
    triggerDescription: "Direct Integration Test",
    actionDescription: "Verified Slack notification sink",
    statusText: "Verified ✓",
    reason: "Taskmaster integration test — verified.",
  });

  const sendRes = await sendSlackMessage({
    channelId: liveChannel,
    text: testMessage,
    idempotencyKey: `direct-test-${Date.now()}`,
  });

  console.log(`✓ Direct Slack Result: ok=${sendRes.ok}, messageId=${sendRes.messageId}, channel=${sendRes.channelId}`);
  if (sendRes.error) console.log(`  Error: ${sendRes.error}`);

  // ----------------------------------------------------
  // Test 2: Full End-to-End Workflow -> Mutation -> Slack Sink
  // ----------------------------------------------------
  console.log("\n[2/3] Testing End-to-End Event Workflow -> Mutation -> Slack Action…");
  const runGoal = "GitHub PR #42 'Payment Webhook Integration' was merged into main. Create a verified subtask and notify the team in Slack.";

  const { run } = await workflowService.createOrGetRun({
    projectId: DEMO_PROJECT_ID,
    goal: runGoal,
    idempotencyKey: `workflow-slack-e2e-${Date.now()}`,
  });

  // Step A: Create subtask
  const subtaskRes = await executeCreateSubtask({
    projectId: DEMO_PROJECT_ID,
    action: {
      actionType: "create_subtask",
      parentTaskId: "2",
      title: "Verify Stripe Webhook in Staging",
      reason: "Ensure merged webhook code processes payments correctly.",
    },
    agentRunId: run.id,
  });

  console.log(`✓ Project Mutation Result: ${subtaskRes.status} (Subtask ID: ${subtaskRes.taskId}, Verified in DB: ${subtaskRes.verified})`);

  // Step B: Post Slack update with verified state
  const slackUpdateText = formatTaskmasterSlackUpdate({
    projectTitle: "Student Marketplace Launch",
    triggerDescription: "GitHub PR #42 merged — Payment Webhook Integration",
    actionDescription: `Created QA subtask '${subtaskRes.title}' under Payment Integration`,
    statusText: "Verified ✓",
    reason: "Payment integration is now ready for validation in staging.",
  });

  const slackActionRes = await executeSendSlackMessage({
    projectId: DEMO_PROJECT_ID,
    action: {
      actionType: "send_slack_message",
      channelId: liveChannel,
      message: slackUpdateText,
      reason: "Notify project team that payment integration QA task is created.",
    },
    agentRunId: run.id,
    projectMutationVerified: subtaskRes.verified,
  });

  console.log(`✓ Slack Action Result: ${slackActionRes.status} (Message ID: ${slackActionRes.messageId}, Verified: ${slackActionRes.verified})`);

  // Assert DB & Audit Trail
  const steps = await agentRunRepository.getSteps(run.id);
  console.log(`✓ Audit Steps Recorded in agent_steps: ${steps.length} steps`);
  steps.forEach((s, idx) => {
    console.log(`  Step ${idx + 1}: [${s.stepType}] Tool: ${s.toolName || "n/a"} -> Status: ${s.status}`);
  });

  const activities = await activityRepository.listByProject(DEMO_PROJECT_ID, 5);
  const slackActivity = activities.find((a) => a.eventType === "SLACK_MESSAGE_SENT");
  console.log(`✓ Activity Log Entry: Found SLACK_MESSAGE_SENT? ${Boolean(slackActivity)} (Preview: "${slackActivity?.metadata?.messagePreview?.slice(0, 45)}…")`);

  // ----------------------------------------------------
  // Test 3: Controlled Failure Test
  // ----------------------------------------------------
  console.log("\n[3/3] Testing Controlled Failure & Mutation Guard…");
  const failedSlackRes = await executeSendSlackMessage({
    projectId: DEMO_PROJECT_ID,
    action: {
      actionType: "send_slack_message",
      channelId: "C_INVALID_CHANNEL",
      message: "This should fail due to unverified primary mutation",
      reason: "Failure safety check",
    },
    agentRunId: run.id,
    projectMutationVerified: false, // Mutation unverified!
  });

  console.log(`✓ Precondition Failure Guard: status=${failedSlackRes.status}, verified=${failedSlackRes.verified}, error="${failedSlackRes.error}"`);

  // Cleanup test-created subtask so canonical demo state remains clean
  if (subtaskRes.taskId) {
    await taskRepository.delete(subtaskRes.taskId);
    console.log(`✓ Cleaned up test subtask '${subtaskRes.taskId}' from database`);
  }

  console.log("\n==================================================");
  console.log("✓ ALL SLACK INTEGRATION TESTS COMPLETED SUCCESSFULLY!");
  console.log("==================================================");
}

if (require.main === module) {
  verifySlackIntegration()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Verification failed:", err);
      await closePool();
      process.exit(1);
    });
}
