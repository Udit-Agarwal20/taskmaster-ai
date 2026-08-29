import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setPool, closePool } from "../db/client";
import { seed, DEMO_PROJECT_ID } from "../db/seed";
import { buildActionExplanations } from "../lib/models/action-explanation";
import * as analysisRoute from "../app/api/projects/[projectId]/analysis/route";
import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

describe("Milestone 4H: Action Explanation & Proof of Work Layer", () => {
  let pglite: PGlite;

  before(async () => {
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

    const schemaPath = path.join(process.cwd(), "db", "schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf-8");
    await pglite.exec(sql);
    await seed();
  });

  after(async () => {
    await closePool();
  });

  it("1. buildActionExplanations generates structured model for AUTO create_subtask action", () => {
    const explanations = buildActionExplanations({
      run: {
        id: "run-auto-123",
        state: "COMPLETED",
        triggerType: "GITHUB_PULL_REQUEST_MERGED",
        startedAt: "2026-08-28T10:00:00Z",
        completedAt: "2026-08-28T10:00:05Z",
      },
      plan: {
        findings: [
          {
            type: "blocker",
            title: "Payment webhook needs QA validation",
            explanation: "Payment webhook implementation requires staging validation",
            relatedTaskIds: ["4"],
          },
        ],
        proposedActions: [
          {
            actionType: "create_subtask",
            parentTaskId: "4",
            title: "Verify payment webhook in staging",
            reason: "Payment webhook implementation requires staging validation",
          },
        ],
      },
      activities: [
        {
          id: "act-1",
          eventType: "GITHUB_PR_MERGED",
          metadata: { pullRequestNumber: 7, title: "Payment webhook" },
          createdAt: "2026-08-28T10:00:00Z",
        },
        {
          id: "act-2",
          eventType: "SUBTASK_CREATED",
          actorId: "run-auto-123",
          metadata: { title: "Verify payment webhook in staging", parentTaskId: "4", verified: true },
          createdAt: "2026-08-28T10:00:03Z",
        },
        {
          id: "act-3",
          eventType: "SLACK_MESSAGE_SENT",
          metadata: { channelId: "taskmaster-demo", messagePreview: "Created subtask" },
          createdAt: "2026-08-28T10:00:04Z",
        },
      ],
    });

    assert.equal(explanations.length, 1);
    const exp = explanations[0];

    // Trigger
    assert.equal(exp.trigger.source, "github");
    assert.equal(exp.trigger.type, "GITHUB_PULL_REQUEST_MERGED");
    assert.ok(exp.trigger.summary.includes("PR #7"));

    // Why & Action
    assert.ok(exp.why.includes("staging validation"));
    assert.equal(exp.action.actionType, "create_subtask");
    assert.equal(exp.action.parentTaskId, "4");

    // Policy
    assert.equal(exp.policy.level, "AUTO");
    assert.equal(exp.policy.requiresApproval, false);

    // Status & Verification
    assert.equal(exp.status, "COMPLETED");
    assert.equal(exp.verification.verified, true);
    assert.ok(exp.verification.details?.includes("PostgreSQL"));

    // Outcome
    assert.equal(exp.outcome.deliveredToExternalSink, true);
    assert.equal(exp.outcome.externalNotification?.channel, "#taskmaster-demo");
    assert.equal(exp.outcome.externalNotification?.status, "DELIVERED");
  });

  it("2. buildActionExplanations generates structured model for REVIEW reassign_task action awaiting approval", () => {
    const explanations = buildActionExplanations({
      run: {
        id: "run-review-456",
        state: "WAITING_FOR_APPROVAL",
        triggerType: "USER_GOAL",
        goal: "Get project back on track",
      },
      plan: {
        findings: [
          {
            type: "workload",
            title: "Bottleneck on Rahul (11 tasks)",
            explanation: "Rahul has 11 tasks creating a critical launch bottleneck",
            relatedTaskIds: ["9"],
          },
        ],
        proposedActions: [
          {
            actionType: "reassign_task",
            taskId: "9",
            targetAssigneeId: "Arjun",
            reason: "Workload rebalancing to unblock launch path",
          },
        ],
      },
      approvals: [
        {
          id: "appr-789",
          agentRunId: "run-review-456",
          action: "reassign_task",
          status: "pending",
          payload: { taskId: "9", targetAssigneeId: "Arjun", reason: "Workload rebalancing" },
          riskLevel: "REVIEW",
          createdAt: "2026-08-28T10:05:00Z",
        },
      ],
      tasks: [{ id: "9", title: "Design Token System", assignee: "Rahul" }],
    });

    assert.equal(explanations.length, 1);
    const exp = explanations[0];

    // Policy Gate
    assert.equal(exp.policy.level, "REVIEW");
    assert.equal(exp.policy.requiresApproval, true);
    assert.ok(exp.policy.ruleDescription.includes("without human operator approval"));

    // Status & Verification
    assert.equal(exp.status, "WAITING_FOR_APPROVAL");
    assert.equal(exp.verification.verified, false);
    assert.equal(exp.verification.method, "Pending");

    // Governance
    assert.equal(exp.governance?.currentAssignee, "Rahul");
    assert.equal(exp.governance?.proposedAssignee, "Arjun");
    assert.equal(exp.governance?.status, "pending");
  });

  it("3. buildActionExplanations handles approved & verified reassignments correctly", () => {
    const explanations = buildActionExplanations({
      run: {
        id: "run-approved-111",
        state: "COMPLETED",
        triggerType: "USER_GOAL",
      },
      plan: {
        proposedActions: [
          {
            actionType: "reassign_task",
            taskId: "9",
            targetAssigneeId: "Arjun",
            reason: "Workload rebalancing",
          },
        ],
      },
      approvals: [
        {
          id: "appr-111",
          agentRunId: "run-approved-111",
          action: "reassign_task",
          status: "approved",
          approvedBy: "Udit",
          resolvedAt: "2026-08-28T10:10:00Z",
          payload: { taskId: "9", targetAssigneeId: "Arjun" },
        },
      ],
      activities: [
        {
          id: "act-reassign-1",
          eventType: "TASK_REASSIGNED",
          actorId: "run-approved-111",
          metadata: { taskId: "9", previousAssignee: "Rahul", newAssignee: "Arjun", approvedBy: "Udit", verified: true },
          createdAt: "2026-08-28T10:10:01Z",
        },
        {
          id: "act-reassign-2",
          eventType: "SLACK_MESSAGE_SENT",
          metadata: { channelId: "taskmaster-demo", action: "reassign_task", verified: true },
          createdAt: "2026-08-28T10:10:02Z",
        },
      ],
    });

    assert.equal(explanations.length, 1);
    const exp = explanations[0];
    assert.equal(exp.status, "COMPLETED");
    assert.equal(exp.verification.verified, true);
    assert.ok(exp.verification.details?.includes("approved by Udit"));
    assert.equal(exp.outcome.deliveredToExternalSink, true);
  });

  it("4. GET /api/projects/[projectId]/analysis returns actionExplanations from PostgreSQL", async () => {
    const req = new NextRequest(`http://localhost:3000/api/projects/${DEMO_PROJECT_ID}/analysis`);
    const res = await analysisRoute.GET(req, {
      params: Promise.resolve({ projectId: DEMO_PROJECT_ID }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.ok(Array.isArray(data.actionExplanations));
    assert.ok(data.actionExplanations.length > 0);

    const first = data.actionExplanations[0];
    assert.ok(first.trigger);
    assert.ok(first.why);
    assert.ok(first.action);
    assert.ok(first.policy);
    assert.ok(first.verification);
    assert.ok(first.outcome);
  });
});
