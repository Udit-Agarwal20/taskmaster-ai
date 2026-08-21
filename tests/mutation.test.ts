import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setPool, closePool, runSchemaMigration } from "../db/client";
import { seed, DEMO_PROJECT_ID } from "../db/seed";
import { executeCreateSubtask, executeReassignTask } from "../agent/tools/mutation_tools";
import { getActionPolicy } from "../agent/policy/action_registry";
import { taskRepository, approvalRepository, agentRunRepository } from "../db/repositories";
import { workflowService } from "../lib/services/workflow.service";
import * as resolveApprovalRoute from "../app/api/approvals/[approvalId]/resolve/route";
import { NextRequest } from "next/server";

describe("Milestone 3B: Controlled Mutation, Policy and Verification", () => {
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

  // --- Policy Tests ---
  it("14. Policy test: create_subtask = AUTO, requiresApproval: false", () => {
    const policy = getActionPolicy({
      actionType: "create_subtask",
      parentTaskId: "1",
      title: "Test Subtask",
      reason: "Unblock work",
    });

    assert.equal(policy.riskLevel, "AUTO");
    assert.equal(policy.requiresApproval, false);
    assert.equal(policy.permission, "tasks:create_subtask");
    assert.equal(policy.mutation, true);
  });

  it("15. Policy test: reassign_task = REVIEW, requiresApproval: true", () => {
    const policy = getActionPolicy({
      actionType: "reassign_task",
      taskId: "4",
      targetAssigneeId: "Maya",
      reason: "Workload balance",
    });

    assert.equal(policy.riskLevel, "REVIEW");
    assert.equal(policy.requiresApproval, true);
    assert.equal(policy.permission, "tasks:reassign");
    assert.equal(policy.mutation, true);
  });

  // --- create_subtask Tests ---
  it("1. create_subtask: valid creation creates subtask in DB with parentTaskId", async () => {
    const result = await executeCreateSubtask({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "create_subtask",
        parentTaskId: "2", // Payment integration
        title: "Stripe webhook integration",
        reason: "Break down large payment integration task",
      },
    });

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.verified, true);
    assert.ok(result.taskId);
    assert.equal(result.parentTaskId, "2");

    const createdInDb = await taskRepository.findById(result.taskId!);
    assert.ok(createdInDb);
    assert.equal(createdInDb?.parentTaskId, "2");
    assert.equal(createdInDb?.title, "Stripe webhook integration");
    assert.equal(createdInDb?.projectId, DEMO_PROJECT_ID);
  });

  it("2. create_subtask: invalid parent task is rejected", async () => {
    const result = await executeCreateSubtask({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "create_subtask",
        parentTaskId: "non-existent-task-id",
        title: "Test subtask",
        reason: "Test invalid parent",
      },
    });

    assert.equal(result.status, "FAILED");
    assert.equal(result.verified, false);
    assert.ok(result.error?.includes("Parent task 'non-existent-task-id' not found"));
  });

  it("3. create_subtask: invalid project is rejected", async () => {
    const result = await executeCreateSubtask({
      projectId: "unknown-project-999",
      action: {
        actionType: "create_subtask",
        parentTaskId: "2",
        title: "Test subtask",
        reason: "Test invalid project",
      },
    });

    assert.equal(result.status, "FAILED");
    assert.equal(result.verified, false);
    assert.ok(result.error?.includes("Project 'unknown-project-999' not found"));
  });

  it("4. create_subtask: duplicate execution with same runId and input is idempotent", async () => {
    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Idempotent subtask creation test",
      idempotencyKey: "idem-subtask-run",
    });

    const res1 = await executeCreateSubtask({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "create_subtask",
        parentTaskId: "1",
        title: "Pricing matrix validation",
        reason: "Verify pricing tier before approval",
      },
      agentRunId: run.id,
    });

    assert.equal(res1.status, "COMPLETED");
    const firstTaskId = res1.taskId;

    // Second execution with identical params in the same run
    const res2 = await executeCreateSubtask({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "create_subtask",
        parentTaskId: "1",
        title: "Pricing matrix validation",
        reason: "Verify pricing tier before approval",
      },
      agentRunId: run.id,
    });

    assert.equal(res2.status, "COMPLETED");
    assert.equal(res2.taskId, firstTaskId, "Duplicate subtask execution must return existing taskId without recreating");
  });

  it("5. create_subtask: verification confirms post-mutation DB state", async () => {
    const result = await executeCreateSubtask({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "create_subtask",
        parentTaskId: "3", // Landing page
        title: "Mobile viewport check",
        reason: "Check mobile responsiveness",
      },
    });

    assert.equal(result.verified, true);
    assert.ok(result.timings?.verificationMs !== undefined);
  });

  // --- reassign_task Tests ---
  it("6. reassign_task: valid proposed action creates approval and task is NOT changed before approval", async () => {
    const taskBefore = await taskRepository.findById("4"); // Analytics events (assigned to Rahul)
    assert.equal(taskBefore?.assignee, "Rahul");

    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Reassign task 4 to Maya",
      idempotencyKey: "reassign-approval-test",
    });

    await workflowService.transitionState(run.id, "PLANNING");

    const approval = await approvalRepository.create({
      agentRunId: run.id,
      action: "reassign_task",
      payload: {
        actionType: "reassign_task",
        taskId: "4",
        targetAssigneeId: "Maya",
        reason: "Rahul has 11 active tasks, Maya has capacity",
      },
      riskLevel: "REVIEW",
    });

    const paused = await workflowService.pauseForApproval(
      run.id,
      "Awaiting human approval for reassign_task",
      approval.id
    );

    assert.equal(paused.state, "WAITING_FOR_APPROVAL");
    assert.equal(paused.expectedEventType, "APPROVAL_RESOLVED");

    // 7. Task is NOT modified before approval
    const taskStillBefore = await taskRepository.findById("4");
    assert.equal(taskStillBefore?.assignee, "Rahul", "Task must remain assigned to Rahul prior to explicit approval");
  });

  it("8. reassign_task: approval accepted -> task assignee updated & verified in DB", async () => {
    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Approve reassignment test",
      idempotencyKey: "reassign-exec-test",
    });

    await workflowService.transitionState(run.id, "PLANNING");

    const approval = await approvalRepository.create({
      agentRunId: run.id,
      action: "reassign_task",
      payload: {
        actionType: "reassign_task",
        taskId: "4",
        targetAssigneeId: "Maya",
        reason: "Relieve Rahul bottleneck",
      },
      riskLevel: "REVIEW",
    });

    await workflowService.pauseForApproval(
      run.id,
      "Awaiting approval",
      approval.id
    );

    // Call resolve API with decision: "approve"
    const req = new NextRequest(`http://localhost:3000/api/approvals/${approval.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve", approvedBy: "Udit" }),
    });
    const params = Promise.resolve({ approvalId: approval.id });

    const res = await resolveApprovalRoute.POST(req, { params });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.status, "approved");

    // Verify task in DB was updated to Maya
    const taskAfter = await taskRepository.findById("4");
    assert.equal(taskAfter?.assignee, "Maya", "Task 4 assignee must be updated to Maya");

    // 10. Duplicate approval resolution is idempotent
    const duplicateReq = new NextRequest(`http://localhost:3000/api/approvals/${approval.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve", approvedBy: "Udit" }),
    });
    const duplicateRes = await resolveApprovalRoute.POST(duplicateReq, { params });
    assert.equal(duplicateRes.status, 200);
    const dupBody = await duplicateRes.json();
    assert.equal(dupBody.status, "already_resolved");
  });

  it("9. reassign_task: approval rejected -> task assignee remains unchanged", async () => {
    // Reset task 7 to Rahul
    await taskRepository.update("7", { assignee: "Rahul" });

    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Reject reassignment test",
      idempotencyKey: "reassign-reject-test",
    });

    await workflowService.transitionState(run.id, "PLANNING");

    const approval = await approvalRepository.create({
      agentRunId: run.id,
      action: "reassign_task",
      payload: {
        actionType: "reassign_task",
        taskId: "7",
        targetAssigneeId: "Arjun",
        reason: "Test rejection",
      },
      riskLevel: "REVIEW",
    });

    await workflowService.pauseForApproval(
      run.id,
      "Awaiting approval",
      approval.id
    );

    // Call resolve API with decision: "reject"
    const req = new NextRequest(`http://localhost:3000/api/approvals/${approval.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision: "reject", approvedBy: "Udit" }),
    });
    const params = Promise.resolve({ approvalId: approval.id });

    const res = await resolveApprovalRoute.POST(req, { params });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.status, "rejected");

    // Task in DB must remain Rahul
    const taskAfter = await taskRepository.findById("7");
    assert.equal(taskAfter?.assignee, "Rahul", "Rejected reassignment must NOT modify task assignee");
  });

  it("11. reassign_task: non-existent task is rejected", async () => {
    const result = await executeReassignTask({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "reassign_task",
        taskId: "task-non-existent-99",
        targetAssigneeId: "Maya",
        reason: "Test invalid task",
      },
      approvedBy: "Udit",
    });

    assert.equal(result.status, "FAILED");
    assert.equal(result.verified, false);
    assert.ok(result.error?.includes("Task 'task-non-existent-99' not found"));
  });

  it("12. reassign_task: non-project member is rejected", async () => {
    const result = await executeReassignTask({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "reassign_task",
        taskId: "2",
        targetAssigneeId: "NonExistentPerson",
        reason: "Test invalid assignee",
      },
      approvedBy: "Udit",
    });

    assert.equal(result.status, "FAILED");
    assert.equal(result.verified, false);
    assert.ok(result.error?.includes("is not a member of project"));
  });

  it("13. reassign_task: verification confirms new assignee in database", async () => {
    const result = await executeReassignTask({
      projectId: DEMO_PROJECT_ID,
      action: {
        actionType: "reassign_task",
        taskId: "8",
        targetAssigneeId: "Arjun",
        reason: "Balance workload",
      },
      approvedBy: "Udit",
    });

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.verified, true);
    assert.equal(result.newAssignee, "Arjun");

    const inDb = await taskRepository.findById("8");
    assert.equal(inDb?.assignee, "Arjun");
  });
});
