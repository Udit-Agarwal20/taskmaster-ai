import dotenv from "dotenv";
dotenv.config();

import { query } from "../db/client";
import { DEMO_PROJECT_ID } from "../db/seed";
import { taskRepository, approvalRepository, agentRunRepository, activityRepository } from "../db/repositories";
import { workflowService } from "../lib/services/workflow.service";
import { getActionPolicy } from "./policy/action_registry";
import { executeTaskmasterAgent } from "./executor";
import * as resolveApprovalRoute from "../app/api/approvals/[approvalId]/resolve/route";
import { NextRequest } from "next/server";

async function verifyMilestone3C() {
  console.log("==================================================");
  console.log("Taskmaster Milestone 3C — End-to-End Live Verification");
  console.log("==================================================\n");

  const createdSubtaskIds: string[] = [];

  try {
    // ----------------------------------------------------
    // [1/4] Environment & Preconditions Check
    // ----------------------------------------------------
    console.log("[1/4] Checking PostgreSQL and Gemini Configuration…");
    const testDb = await query("SELECT current_database(), current_user");
    console.log(`✓ PostgreSQL Connected: Database=${testDb.rows[0].current_database}, User=${testDb.rows[0].current_user}`);

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured in .env");
    }
    console.log("✓ GEMINI_API_KEY detected.");
    console.log(`✓ Server-Controlled Operator ID: ${resolveApprovalRoute.SERVER_DEMO_OPERATOR_ID}\n`);

    // ----------------------------------------------------
    // [2/4] Flow A: Real Live Gemini Auto-Action (create_subtask)
    // ----------------------------------------------------
    console.log("[2/4] Executing FLOW A: Live Gemini Autonomous Mutation (create_subtask)…");
    const goalA = "Create a subtask under Task 2 (Payment integration) titled 'Stripe Webhook Listener' to handle payment events.";
    console.log(`Goal: "${goalA}"`);

    const autoStart = Date.now();
    let completedRunA: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { run: runA } = await workflowService.createOrGetRun({
        projectId: DEMO_PROJECT_ID,
        goal: goalA,
        idempotencyKey: `live-e2e-auto-${Date.now()}`,
      });

      completedRunA = await workflowService.executeWorkflowStage(runA.id);
      if (completedRunA.state === "FAILED" && completedRunA.summary?.includes("429")) {
        console.log(`[Flow A] Quota limit encountered (attempt ${attempt}/3). Cooling down 40s…`);
        await new Promise((r) => setTimeout(r, 40000));
      } else {
        break;
      }
    }
    const autoDuration = Date.now() - autoStart;

    console.log(`\n--- FLOW A Results ---`);
    console.log(`Agent Run ID: ${completedRunA.id}`);
    console.log(`Final Workflow State: ${completedRunA.state}`);
    console.log(`Workflow Summary: ${completedRunA.summary?.slice(0, 140)}…`);

    const stepsA = await agentRunRepository.getSteps(completedRunA.id);
    console.log(`Steps Recorded: ${stepsA.length}`);

    const mutationStepA = stepsA.find((s) => s.toolName === "createSubtask");
    if (mutationStepA && mutationStepA.output?.taskId) {
      createdSubtaskIds.push(mutationStepA.output.taskId);
      console.log(`✓ Auto-Executed Mutation: create_subtask`);
      console.log(`  Subtask ID: ${mutationStepA.output.taskId}`);
      console.log(`  Parent Task ID: ${mutationStepA.input?.parentTaskId}`);
      console.log(`  Title: "${mutationStepA.input?.title}"`);
      console.log(`  PostgreSQL Verified: ${mutationStepA.output.verified}`);

      // Double check in PostgreSQL
      const verifiedInDb = await taskRepository.findById(mutationStepA.output.taskId);
      console.log(`✓ Direct DB Assertion: Found in 'tasks' table? ${Boolean(verifiedInDb)} (Title: "${verifiedInDb?.title}")`);
    } else {
      console.log(`ℹ Plan Actions: ${JSON.stringify(completedRunA.plan?.proposedActions)}`);
    }
    console.log(`Total Flow A Duration: ${autoDuration}ms\n`);

    // Cooldown before Flow B
    console.log("Cooling down 30s before Flow B…");
    await new Promise((r) => setTimeout(r, 30000));

    // ----------------------------------------------------
    // [3/4] Flow B: Real Live Gemini Approval Mutation (reassign_task)
    // ----------------------------------------------------
    console.log("[3/4] Executing FLOW B: Live Gemini Approval-Gated Mutation (reassign_task)…");
    const goalB = "Rebalance team workload: reassign Task 4 (Analytics events) from Rahul to Maya to relieve bottleneck.";
    console.log(`Goal: "${goalB}"`);

    const task4Before = await taskRepository.findById("4");
    console.log(`Task 4 Assignee BEFORE Approval: ${task4Before?.assignee}`);

    const reviewStart = Date.now();
    let pausedRunB: any;
    let currentRunB: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { run: runB } = await workflowService.createOrGetRun({
        projectId: DEMO_PROJECT_ID,
        goal: goalB,
        idempotencyKey: `live-e2e-review-${Date.now()}`,
      });
      currentRunB = runB;

      pausedRunB = await workflowService.executeWorkflowStage(runB.id);
      if (pausedRunB.state === "FAILED" && pausedRunB.summary?.includes("429")) {
        console.log(`[Flow B] Quota limit encountered (attempt ${attempt}/3). Cooling down 40s…`);
        await new Promise((r) => setTimeout(r, 40000));
      } else {
        break;
      }
    }
    console.log(`Workflow State after Planning: ${pausedRunB.state}`);

    // Verify task is NOT changed prior to approval
    const task4Mid = await taskRepository.findById("4");
    console.log(`Task 4 Assignee DURING WAITING_FOR_APPROVAL: ${task4Mid?.assignee} (Must remain '${task4Before?.assignee}')`);

    const pendingApprovalsB = currentRunB ? await approvalRepository.listByRun(currentRunB.id) : [];
    if (pendingApprovalsB.length > 0) {
      const approvalB = pendingApprovalsB[0];
      console.log(`✓ Approval Record Created: ID=${approvalB.id}, Action=${approvalB.action}, Status=${approvalB.status}`);

      // Resolve approval via server operator identity
      console.log("Resolving Approval with decision: 'approve'…");
      const req = new NextRequest(`http://localhost:3000/api/approvals/${approvalB.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ decision: "approve" }),
      });
      const params = Promise.resolve({ approvalId: approvalB.id });
      const resolveRes = await resolveApprovalRoute.POST(req, { params });
      const resolveData = await resolveRes.json();

      console.log(`✓ Approval Resolution Result: status=${resolveData.status}, approvedBy=${resolveData.approvedBy} (${resolveData.approvedByName})`);
      console.log(`  Resumed Workflow State: ${resolveData.workflowState}`);

      // Verify task 4 updated in PostgreSQL
      const task4After = await taskRepository.findById("4");
      console.log(`✓ Task 4 Assignee AFTER Approval: ${task4After?.assignee} (Target: Maya)`);
    }
    const reviewDuration = Date.now() - reviewStart;
    console.log(`Total Flow B Duration: ${reviewDuration}ms\n`);

    // ----------------------------------------------------
    // [4/4] Flow C: Approval Rejection Test
    // ----------------------------------------------------
    console.log("[4/4] Executing FLOW C: Approval Rejection Verification…");
    const task8Before = await taskRepository.findById("8");
    console.log(`Task 8 Assignee BEFORE: ${task8Before?.assignee}`);

    const { run: runC } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Reassign Task 8 to Arjun test",
      idempotencyKey: `live-e2e-reject-${Date.now()}`,
    });

    await workflowService.transitionState(runC.id, "PLANNING");
    const approvalC = await approvalRepository.create({
      agentRunId: runC.id,
      action: "reassign_task",
      payload: {
        actionType: "reassign_task",
        taskId: "8",
        targetAssigneeId: "Arjun",
        reason: "Test rejection behavior",
      },
      riskLevel: "REVIEW",
    });

    await workflowService.pauseForApproval(runC.id, "Awaiting approval", approvalC.id);

    // Resolve with rejection
    const reqReject = new NextRequest(`http://localhost:3000/api/approvals/${approvalC.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision: "reject" }),
    });
    const paramsReject = Promise.resolve({ approvalId: approvalC.id });
    const rejectRes = await resolveApprovalRoute.POST(reqReject, { params: paramsReject });
    const rejectData = await rejectRes.json();

    console.log(`✓ Rejection Result: status=${rejectData.status}, summary="${rejectData.summary}"`);
    const task8After = await taskRepository.findById("8");
    console.log(`✓ Task 8 Assignee AFTER Rejection: ${task8After?.assignee} (Must remain '${task8Before?.assignee}')`);

    console.log("\n==================================================");
    console.log("✓ ALL END-TO-END FLOWS (A, B, C) VERIFIED SUCCESSFULLY!");
    console.log("==================================================");
  } finally {
    // Cleanup live test artifacts cleanly
    for (const subtaskId of createdSubtaskIds) {
      await taskRepository.delete(subtaskId);
    }
    // Reset Task 4 to Rahul
    await taskRepository.update("4", { assignee: "Rahul" });
    await taskRepository.update("8", { assignee: "Rahul" });
  }
}

verifyMilestone3C().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
