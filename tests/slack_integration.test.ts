import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setPool, closePool, runSchemaMigration } from "../db/client";
import { seed, DEMO_PROJECT_ID } from "../db/seed";
import {
  SendSlackMessageActionSchema,
  ProposedActionSchema,
} from "../agent/schema";
import { getActionPolicy } from "../agent/policy/action_registry";
import {
  sendSlackMessage,
  setMockSlackHandler,
} from "../lib/integrations/slack/client";
import { formatTaskmasterSlackUpdate } from "../lib/integrations/slack/formatter";
import { executeSendSlackMessage } from "../agent/tools/mutation_tools";
import {
  agentRunRepository,
  activityRepository,
  taskRepository,
} from "../db/repositories";
import { workflowService } from "../lib/services/workflow.service";

describe("Milestone 4D: Slack App Integration as a Verified Action Sink", () => {
  let pglite: PGlite;

  before(async () => {
    process.env.GITHUB_PROJECT_ID = DEMO_PROJECT_ID;

    pglite = new PGlite();
    await pglite.waitReady;

    const pgAdapter: any = {
      query: async (text: string, params?: any[]) => {
        const res = await pglite.query(text, params);
        return {
          rows: res.rows,
          rowCount: res.affectedRows ?? res.rows.length,
          command: "",
          oid: 0,
          fields: res.fields,
        };
      },
      exec: async (sql: string) => {
        await pglite.exec(sql);
      },
      connect: async () => ({
        query: async (text: string, params?: any[]) => {
          const res = await pglite.query(text, params);
          return {
            rows: res.rows,
            rowCount: res.affectedRows ?? res.rows.length,
            command: "",
            oid: 0,
            fields: res.fields,
          };
        },
        release: () => {},
      }),
      end: async () => {
        await pglite.close();
      },
      on: () => {},
    };

    setPool(pgAdapter);
    await runSchemaMigration();
    await seed();
  });

  after(async () => {
    setMockSlackHandler(null);
    await closePool();
  });

  beforeEach(() => {
    setMockSlackHandler(null);
  });

  // 1. Schema Validation
  it("1. SendSlackMessageActionSchema validates valid and invalid payloads", () => {
    const valid = {
      actionType: "send_slack_message",
      channelId: "C12345678",
      message: "Payment integration is ready for testing.",
      reason: "Notify team of unblocked payment workflow.",
    };
    const parsed = SendSlackMessageActionSchema.safeParse(valid);
    assert.equal(parsed.success, true);

    const unionParsed = ProposedActionSchema.safeParse(valid);
    assert.equal(unionParsed.success, true);

    const invalid = {
      actionType: "send_slack_message",
      message: "", // Empty message invalid
      reason: "some reason",
    };
    const invalidParsed = SendSlackMessageActionSchema.safeParse(invalid);
    assert.equal(invalidParsed.success, false);
  });

  // 2. Missing Configuration Handling
  it("2. Missing SLACK_BOT_TOKEN or channel is safely handled without crash", async () => {
    const originalToken = process.env.SLACK_BOT_TOKEN;
    const originalChannel = process.env.SLACK_CHANNEL_ID;

    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_CHANNEL_ID;

    const res = await sendSlackMessage({
      text: "Hello team",
      idempotencyKey: "test-missing-cfg",
    });

    assert.equal(res.ok, false);
    assert.ok(res.error?.includes("SLACK_BOT_TOKEN"));

    process.env.SLACK_BOT_TOKEN = originalToken;
    process.env.SLACK_CHANNEL_ID = originalChannel;
  });

  // 3. Policy Classification
  it("3. Policy classification for send_slack_message is AUTO with requiresApproval=false", () => {
    const action = {
      actionType: "send_slack_message" as const,
      channelId: "C12345678",
      message: "Test message",
      reason: "Test reason",
    };
    const policy = getActionPolicy(action);

    assert.equal(policy.riskLevel, "AUTO");
    assert.equal(policy.requiresApproval, false);
    assert.equal(policy.permission, "slack:post_message");
    assert.equal(policy.targetEntity, "slack_channel");
    assert.equal(policy.mutation, true);
  });

  // 4. Message Formatter
  it("9. formatTaskmasterSlackUpdate formats structured, human-readable notification", () => {
    const formatted = formatTaskmasterSlackUpdate({
      projectTitle: "Student Marketplace Launch",
      triggerDescription: "GitHub PR #42 merged — Payment Webhook Integration",
      actionDescription: "Created QA subtask under Payment Integration",
      statusText: "Verified ✓",
      reason: "Payment integration is now ready for validation.",
    });

    assert.ok(formatted.includes("*Taskmaster completed a project action*"));
    assert.ok(formatted.includes("*Project:* Student Marketplace Launch"));
    assert.ok(formatted.includes("*Trigger:* GitHub PR #42 merged"));
    assert.ok(formatted.includes("*Action:* Created QA subtask"));
    assert.ok(formatted.includes("*Status:* Verified ✓"));
    assert.ok(formatted.includes("*Reason:* Payment integration is now ready for validation."));
  });

  // 5. Precondition Guard: Primary mutation failure prevents success Slack message
  it("6. Primary project mutation failure prevents sending a success Slack message", async () => {
    let mockCalled = false;
    setMockSlackHandler(async () => {
      mockCalled = true;
      return { ok: true, messageId: "msg-123", ts: "123.456" };
    });

    const res = await executeSendSlackMessage({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "send_slack_message",
        channelId: "C_DEV_TEAM",
        message: "Payment subtask created!",
        reason: "Team update",
      },
      projectMutationVerified: false, // Primary mutation failed!
    });

    assert.equal(res.status, "FAILED");
    assert.equal(res.verified, false);
    assert.equal(mockCalled, false, "Slack API must NOT be called when primary mutation fails");
    assert.ok(res.error?.includes("primary project mutation failed"));
  });

  // 6. Slack API Success & Audit Logging
  it("7 & 10. Slack API success records message metadata and audit logs", async () => {
    let sentPayload: any = null;
    setMockSlackHandler(async (params) => {
      sentPayload = params;
      return {
        ok: true,
        messageId: "1724450000.123456",
        channelId: "C_PROJECT_ALERTS",
        ts: "1724450000.123456",
      };
    });

    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Send Slack update test",
      idempotencyKey: `slack-audit-test-${Date.now()}`,
    });

    const res = await executeSendSlackMessage({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "send_slack_message",
        channelId: "C_PROJECT_ALERTS",
        message: "Taskmaster verified payment webhook integration.",
        reason: "Unblocked team",
      },
      agentRunId: run.id,
      projectMutationVerified: true,
    });

    assert.equal(res.status, "COMPLETED");
    assert.equal(res.verified, true);
    assert.equal(res.messageId, "1724450000.123456");
    assert.equal(res.channelId, "C_PROJECT_ALERTS");
    assert.ok(sentPayload);
    assert.equal(sentPayload.channelId, "C_PROJECT_ALERTS");

    // Verify step logged in agent_steps
    const steps = await agentRunRepository.getSteps(run.id);
    const slackStep = steps.find((s) => s.toolName === "sendSlackMessage");
    assert.ok(slackStep);
    assert.equal(slackStep?.status, "COMPLETED");
    assert.equal(slackStep?.output?.messageId, "1724450000.123456");

    // Verify activity logged in activity_logs
    const activities = await activityRepository.listByProject(DEMO_PROJECT_ID);
    const slackActivity = activities.find((a) => a.eventType === "SLACK_MESSAGE_SENT");
    assert.ok(slackActivity);
    assert.equal(slackActivity?.metadata?.channelId, "C_PROJECT_ALERTS");
    assert.equal(slackActivity?.metadata?.messageId, "1724450000.123456");
  });

  // 7. Duplicate Slack Action Idempotency
  it("5. Duplicate Slack action execution returns existing messageId without sending a second message", async () => {
    let callCount = 0;
    setMockSlackHandler(async () => {
      callCount++;
      return {
        ok: true,
        messageId: "msg-idempotent-101",
        channelId: "C_DEV",
        ts: "101.202",
      };
    });

    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Idempotent Slack action test",
      idempotencyKey: `slack-idem-test-${Date.now()}`,
    });

    const action = {
      actionType: "send_slack_message" as const,
      channelId: "C_DEV",
      message: "Idempotent notification text",
      reason: "Test idempotency",
    };

    // First execution
    const res1 = await executeSendSlackMessage({
      projectId: DEMO_PROJECT_ID,
      action,
      agentRunId: run.id,
      projectMutationVerified: true,
    });
    assert.equal(res1.status, "COMPLETED");
    assert.equal(res1.messageId, "msg-idempotent-101");
    assert.equal(callCount, 1);

    // Second execution with same run and message
    const res2 = await executeSendSlackMessage({
      projectId: DEMO_PROJECT_ID,
      action,
      agentRunId: run.id,
      projectMutationVerified: true,
    });
    assert.equal(res2.status, "COMPLETED");
    assert.equal(res2.messageId, "msg-idempotent-101");
    assert.equal(callCount, 1, "Must NOT call Slack API a second time for duplicate action");
  });

  // 8. Slack API Failure Handling
  it("8. Slack API failure is normalized and recorded as FAILED without false success", async () => {
    setMockSlackHandler(async () => {
      return {
        ok: false,
        error: "channel_not_found",
        channelId: "C_INVALID",
      };
    });

    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Slack failure test",
      idempotencyKey: `slack-fail-test-${Date.now()}`,
    });

    const res = await executeSendSlackMessage({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "send_slack_message",
        channelId: "C_INVALID",
        message: "This should fail",
        reason: "Test failure handling",
      },
      agentRunId: run.id,
      projectMutationVerified: true,
    });

    assert.equal(res.status, "FAILED");
    assert.equal(res.verified, false);
    assert.equal(res.error, "channel_not_found");

    const steps = await agentRunRepository.getSteps(run.id);
    const failedStep = steps.find((s) => s.toolName === "sendSlackMessage");
    assert.ok(failedStep);
    assert.equal(failedStep?.status, "FAILED");
  });
});
