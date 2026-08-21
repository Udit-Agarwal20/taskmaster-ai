import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setPool, closePool, runSchemaMigration } from "../db/client";
import { seed, DEMO_PROJECT_ID } from "../db/seed";
import { executeCreateSubtask, executeReassignTask } from "../agent/tools/mutation_tools";
import {
  getActionPolicy,
  categorizeProposedActions,
  DEFAULT_MAX_AUTO_ACTIONS_PER_RUN,
} from "../agent/policy/action_registry";
import {
  taskRepository,
  approvalRepository,
  agentRunRepository,
  activityRepository,
} from "../db/repositories";
import { workflowService } from "../lib/services/workflow.service";
import * as resolveApprovalRoute from "../app/api/approvals/[approvalId]/resolve/route";
import { NextRequest } from "next/server";

describe("Milestone 3C: End-to-End Agent Execution & Approval Hardening", () => {
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
    await runSchemaMigration();
    await seed();
  });

  after(async () => {
    await closePool();
  });

  it("1. Real create_subtask workflow path creates and verifies subtask", async () => {
    const tasksBefore = await taskRepository.listByProject(DEMO_PROJECT_ID);

    const subtaskResult = await executeCreateSubtask({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "create_subtask",
        parentTaskId: "2",
        title: "Setup Stripe Webhook Listener",
        reason: "Handle Stripe payment success and failure webhooks",
      },
    });

    assert.equal(subtaskResult.status, "COMPLETED");
    assert.equal(subtaskResult.verified, true);
    assert.ok(subtaskResult.taskId);
    assert.equal(subtaskResult.parentTaskId, "2");

    const tasksAfter = await taskRepository.listByProject(DEMO_PROJECT_ID);
    assert.equal(tasksAfter.length, tasksBefore.length + 1);

    const createdInDb = await taskRepository.findById(subtaskResult.taskId!);
    assert.ok(createdInDb);
    assert.equal(createdInDb?.parentTaskId, "2");
    assert.equal(createdInDb?.title, "Setup Stripe Webhook Listener");
  });

  it("2 & 3. Real reassign_task approval path: task is unchanged before approval", async () => {
    const taskBefore = await taskRepository.findById("4");
    assert.equal(taskBefore?.assignee, "Rahul");

    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Reassign task 4 for workload balance",
      idempotencyKey: "e2e-reassign-goal",
    });

    await workflowService.transitionState(run.id, "PLANNING");

    const approval = await approvalRepository.create({
      agentRunId: run.id,
      action: "reassign_task",
      payload: {
        actionType: "reassign_task",
        taskId: "4",
        targetAssigneeId: "Maya",
        reason: "Rahul has 11 tasks, Maya has capacity",
      },
      riskLevel: "REVIEW",
    });

    const paused = await workflowService.pauseForApproval(
      run.id,
      "Awaiting operator approval",
      approval.id
    );

    assert.equal(paused.state, "WAITING_FOR_APPROVAL");

    // Assert task in DB is completely unchanged before approval
    const taskStillBefore = await taskRepository.findById("4");
    assert.equal(taskStillBefore?.assignee, "Rahul");
  });

  it("4. Approval execution updates task and passes double verification", async () => {
    const pendingApprovals = await approvalRepository.listPendingByProject(DEMO_PROJECT_ID);
    assert.ok(pendingApprovals.length > 0);
    const approval = pendingApprovals[0];

    const req = new NextRequest(
      `http://localhost:3000/api/approvals/${approval.id}/resolve`,
      {
        method: "POST",
        body: JSON.stringify({ decision: "approve" }),
      }
    );
    const params = Promise.resolve({ approvalId: approval.id });

    const res = await resolveApprovalRoute.POST(req, { params });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "approved");
    assert.equal(data.workflowState, "COMPLETED");

    // Verify task updated to Maya in DB
    const taskAfter = await taskRepository.findById("4");
    assert.equal(taskAfter?.assignee, "Maya");
  });

  it("5. Approval rejection leaves task unchanged and logs rejection", async () => {
    // Reset task 10 to Rahul
    await taskRepository.update("10", { assignee: "Rahul" });

    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Reassign task 10 test",
      idempotencyKey: "e2e-reject-goal",
    });

    await workflowService.transitionState(run.id, "PLANNING");

    const approval = await approvalRepository.create({
      agentRunId: run.id,
      action: "reassign_task",
      payload: {
        actionType: "reassign_task",
        taskId: "10",
        targetAssigneeId: "Arjun",
        reason: "Test rejection behavior",
      },
      riskLevel: "REVIEW",
    });

    await workflowService.pauseForApproval(run.id, "Awaiting approval", approval.id);

    const req = new NextRequest(
      `http://localhost:3000/api/approvals/${approval.id}/resolve`,
      {
        method: "POST",
        body: JSON.stringify({ decision: "reject" }),
      }
    );
    const params = Promise.resolve({ approvalId: approval.id });

    const res = await resolveApprovalRoute.POST(req, { params });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "rejected");

    // Task must remain Rahul
    const taskAfter = await taskRepository.findById("10");
    assert.equal(taskAfter?.assignee, "Rahul");

    // Activity log must record rejection
    const logs = await activityRepository.listByProject(DEMO_PROJECT_ID);
    const rejectLog = logs.find((l) => l.eventType === "APPROVAL_REJECTED");
    assert.ok(rejectLog);
  });

  it("6 & 7. Server-side operator identity enforcement: client spoofed approvedBy is ignored", async () => {
    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Identity hardening test",
      idempotencyKey: "e2e-identity-goal",
    });

    await workflowService.transitionState(run.id, "PLANNING");

    const approval = await approvalRepository.create({
      agentRunId: run.id,
      action: "reassign_task",
      payload: {
        actionType: "reassign_task",
        taskId: "12",
        targetAssigneeId: "Sara",
        reason: "Test approver identity",
      },
      riskLevel: "REVIEW",
    });

    await workflowService.pauseForApproval(run.id, "Awaiting approval", approval.id);

    // Client attempts to spoof approver as "AttackerUser"
    const req = new NextRequest(
      `http://localhost:3000/api/approvals/${approval.id}/resolve`,
      {
        method: "POST",
        body: JSON.stringify({
          decision: "approve",
          approvedBy: "AttackerUserSpoofedName",
        }),
      }
    );
    const params = Promise.resolve({ approvalId: approval.id });

    const res = await resolveApprovalRoute.POST(req, { params });
    assert.equal(res.status, 200);
    const data = await res.json();

    // Must be resolved to server-controlled demo operator (Udit / user-udit), NOT AttackerUserSpoofedName
    assert.equal(data.approvedBy, "user-udit");
    assert.equal(data.approvedByName, "Udit");

    const resolvedApprovalInDb = await approvalRepository.findById(approval.id);
    assert.equal(resolvedApprovalInDb?.approvedBy, "user-udit");
  });

  it("8. MAX_AUTO_ACTIONS_PER_RUN = 5 is strictly enforced", () => {
    // Propose 8 create_subtask actions
    const rawActions = Array.from({ length: 8 }).map((_, i) => ({
      actionType: "create_subtask",
      parentTaskId: "2",
      title: `Auto subtask ${i + 1}`,
      reason: `Auto reason ${i + 1}`,
    }));

    const result = categorizeProposedActions(rawActions, 5);

    assert.equal(result.proposedActions.length, 8);
    assert.equal(result.allowedAutoActions.length, 5, "Allowed auto actions must be capped at 5");
    assert.equal(result.cappedToReviewActions.length, 3, "Excess 3 actions must be converted to review");
    assert.equal(result.blockedActions.length, 0);
  });

  it("9. Proposed vs Allowed vs Executed vs Blocked states are distinct", () => {
    const mixedActions = [
      { actionType: "create_subtask", parentTaskId: "1", title: "Valid subtask", reason: "Valid" },
      { actionType: "reassign_task", taskId: "2", targetAssigneeId: "Arjun", reason: "Valid" },
      { actionType: "unsupported_mutation", payload: "invalid" },
    ];

    const result = categorizeProposedActions(mixedActions, 5);

    assert.equal(result.proposedActions.length, 2);
    assert.equal(result.allowedAutoActions.length, 1);
    assert.equal(result.reviewRequiredActions.length, 1);
    assert.equal(result.blockedActions.length, 1);
    assert.ok(result.blockedActions[0].reason.includes("Schema validation failed"));
  });

  it("10. Live mutation double verification verifies accurate properties", async () => {
    const res = await executeCreateSubtask({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "create_subtask",
        parentTaskId: "3",
        title: "Verify responsive CSS typography",
        reason: "Quality assurance",
      },
    });

    assert.equal(res.status, "COMPLETED");
    assert.equal(res.verified, true);
    assert.ok(res.timings?.verificationMs !== undefined);
  });

  it("11. Duplicate approval resolution remains idempotent", async () => {
    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Duplicate approval test",
      idempotencyKey: "e2e-dup-approval",
    });

    await workflowService.transitionState(run.id, "PLANNING");

    const approval = await approvalRepository.create({
      agentRunId: run.id,
      action: "reassign_task",
      payload: {
        actionType: "reassign_task",
        taskId: "14",
        targetAssigneeId: "Arjun",
        reason: "Test duplicate approval",
      },
      riskLevel: "REVIEW",
    });

    await workflowService.pauseForApproval(run.id, "Awaiting approval", approval.id);

    const params = Promise.resolve({ approvalId: approval.id });

    // First resolution
    const req1 = new NextRequest(
      `http://localhost:3000/api/approvals/${approval.id}/resolve`,
      {
        method: "POST",
        body: JSON.stringify({ decision: "approve" }),
      }
    );
    const res1 = await resolveApprovalRoute.POST(req1, { params });
    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.equal(data1.status, "approved");

    // Second duplicate resolution
    const req2 = new NextRequest(
      `http://localhost:3000/api/approvals/${approval.id}/resolve`,
      {
        method: "POST",
        body: JSON.stringify({ decision: "approve" }),
      }
    );
    const res2 = await resolveApprovalRoute.POST(req2, { params });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.status, "already_resolved");
  });

  it("12. Duplicate mutation execution is idempotent", async () => {
    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Duplicate mutation execution test",
      idempotencyKey: "e2e-dup-mutation",
    });

    const res1 = await executeCreateSubtask({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "create_subtask",
        parentTaskId: "15",
        title: "Setup redis caching layer",
        reason: "Optimize performance",
      },
      agentRunId: run.id,
    });

    assert.equal(res1.status, "COMPLETED");

    const res2 = await executeCreateSubtask({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "create_subtask",
        parentTaskId: "15",
        title: "Setup redis caching layer",
        reason: "Optimize performance",
      },
      agentRunId: run.id,
    });

    assert.equal(res2.status, "COMPLETED");
    assert.equal(res1.taskId, res2.taskId, "Idempotent mutation must return same taskId");
  });
});
