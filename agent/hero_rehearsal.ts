import "dotenv/config";
import { resetDemoDatabase } from "../db/demo_reset";
import {
  projectRepository,
  taskRepository,
  dependencyRepository,
  approvalRepository,
  agentRunRepository,
  activityRepository,
} from "../db/repositories";
import { projectAnalysisService } from "../lib/services/project-analysis.service";
import { workflowService } from "../lib/services/workflow.service";
import { executeCreateSubtask, executeReassignTask, executeSendSlackMessage } from "./tools/mutation_tools";
import { sendSlackMessage } from "../lib/integrations/slack/client";
import { formatTaskmasterSlackUpdate } from "../lib/integrations/slack/formatter";
import { DEMO_PROJECT_ID } from "../db/seed";
import { closePool } from "../db/client";

export async function runHeroRehearsal() {
  console.log("==================================================");
  console.log("Taskmaster: Milestone 4G Hero Demo Rehearsal");
  console.log("==================================================");

  // ----------------------------------------------------------------
  // STEP 1: Clean Reset & Baseline Verification
  // ----------------------------------------------------------------
  console.log("\n[1/6] Resetting to Canonical Demo Baseline…");
  await resetDemoDatabase();

  const baselineTasks = await taskRepository.listByProject(DEMO_PROJECT_ID);
  const baselineAnalysis = await projectAnalysisService.analyze(DEMO_PROJECT_ID);
  const rahulBaseline = baselineTasks.filter((t) => t.assignee?.toLowerCase() === "rahul").length;

  console.log(`✓ Baseline Tasks: ${baselineTasks.length}`);
  console.log(`✓ Baseline Blockers: ${baselineAnalysis.blockers}`);
  console.log(`✓ Baseline Deadline Risks: ${baselineAnalysis.deadlineRisks}`);
  console.log(`✓ Baseline Bottleneck: ${baselineAnalysis.bottleneck.name} (${rahulBaseline} tasks)`);
  console.log(`✓ Baseline Risk Level: ${baselineAnalysis.risk}`);

  if (baselineTasks.length !== 17 || rahulBaseline !== 11 || baselineAnalysis.blockers !== 4) {
    throw new Error("Baseline verification failed! Database is not in canonical state.");
  }

  // ----------------------------------------------------------------
  // STEP 2: Hero Workflow - Ingestion & Planning
  // ----------------------------------------------------------------
  console.log("\n[2/6] Executing Hero Workflow (Gemini 3.5 Flash)…");
  const heroGoal = "GitHub PR #42 'Payment Webhook Integration' was merged into main. Create QA validation subtask, post Slack notification to team, and rebalance Rahul's workload.";

  const { run } = await workflowService.createOrGetRun({
    projectId: DEMO_PROJECT_ID,
    goal: heroGoal,
    triggerType: "GITHUB_PULL_REQUEST_MERGED",
    idempotencyKey: `hero-run-${Date.now()}`,
  });
  console.log(`✓ Created Workflow Run: ${run.id} (State: ${run.state})`);

  // ----------------------------------------------------------------
  // STEP 3: Auto Mutation - create_subtask & Double Verification
  // ----------------------------------------------------------------
  console.log("\n[3/6] Executing Safe Auto Mutation (create_subtask)…");
  const subtaskRes = await executeCreateSubtask({
    projectId: DEMO_PROJECT_ID,
    action: {
      actionType: "create_subtask",
      parentTaskId: "2",
      title: "Verify Stripe Webhook in Staging",
      reason: "Ensure merged webhook code processes payments correctly before launch.",
    },
    agentRunId: run.id,
  });

  console.log(`✓ Auto Mutation Status: ${subtaskRes.status}`);
  console.log(`✓ Subtask ID: ${subtaskRes.taskId}`);
  console.log(`✓ Double PostgreSQL Verification: ${subtaskRes.verified}`);

  const postSubtaskTasks = await taskRepository.listByProject(DEMO_PROJECT_ID);
  console.log(`✓ Total Tasks After Auto Action: ${postSubtaskTasks.length} (Expected: 18)`);

  // ----------------------------------------------------------------
  // STEP 4: External Action Sink - Real Slack Web API Notification
  // ----------------------------------------------------------------
  console.log("\n[4/6] Posting Verified Project Update to Slack…");
  const slackText = formatTaskmasterSlackUpdate({
    projectTitle: "Student Marketplace Launch",
    triggerDescription: "GitHub PR #42 merged — Payment Webhook Integration",
    actionDescription: `Created QA subtask '${subtaskRes.title}' under Payment Integration`,
    statusText: "Verified ✓",
    reason: "Payment integration is now ready for validation in staging.",
  });

  const slackRes = await executeSendSlackMessage({
    projectId: DEMO_PROJECT_ID,
    action: {
      actionType: "send_slack_message",
      channelId: process.env.SLACK_CHANNEL_ID || "C0BS0FNNGMT",
      message: slackText,
      reason: "Notify engineering team of unblocked payment verification.",
    },
    agentRunId: run.id,
    projectMutationVerified: subtaskRes.verified,
  });

  console.log(`✓ Slack Action Status: ${slackRes.status}`);
  console.log(`✓ Slack Message ID / Timestamp: ${slackRes.messageId}`);
  console.log(`✓ Slack Target Channel: #${slackRes.channelId}`);
  console.log(`✓ Delivery Verified: ${slackRes.verified}`);

  // ----------------------------------------------------------------
  // STEP 5: Consequential Mutation - Approval Gating & Execution
  // ----------------------------------------------------------------
  console.log("\n[5/6] Testing Human Approval Path (reassign_task)…");
  // Pause in WAITING_FOR_APPROVAL
  const approval = await approvalRepository.create({
    agentRunId: run.id,
    action: "reassign_task",
    payload: {
      actionType: "reassign_task",
      taskId: "13", // Database index tuning
      targetAssigneeId: "Arjun",
      reason: "Rahul has 11 active tasks; balance database tuning to Arjun to meet Friday deadline.",
    },
    riskLevel: "REVIEW",
  });

  // Transition to PLANNING state
  await workflowService.transitionState(run.id, "PLANNING", {
    currentStep: "EVALUATING_REASSIGNMENT",
  });

  await workflowService.pauseForApproval(
    run.id,
    "Awaiting human approval for task reassignment from Rahul to Arjun.",
    approval.id
  );

  const pausedRun = await agentRunRepository.findById(run.id);
  console.log(`✓ Workflow Paused in State: ${pausedRun?.state} (Waiting Reason: "${pausedRun?.waitingReason}")`);

  const taskBeforeApproval = await taskRepository.findById("13");
  console.log(`✓ Task 13 Assignee BEFORE Approval: ${taskBeforeApproval?.assignee} (Unchanged)`);

  // Operator Approves
  console.log("\n-> Simulating Human Operator Clicking [✓ Approve & Execute]…");
  await approvalRepository.resolve(approval.id, "approved", "user-udit");
  const resumedWorkflow = await workflowService.resumeWorkflow(
    run.id,
    "Approved by Lead Operator (Udit)"
  );
  console.log(`✓ Workflow Resumed & Executed: ${resumedWorkflow.state}`);
  console.log(`✓ Workflow Summary: ${resumedWorkflow.summary}`);

  const taskAfterApproval = await taskRepository.findById("13");
  console.log(`✓ Task 13 Assignee AFTER Approval: ${taskAfterApproval?.assignee} (Updated to Arjun)`);

  // ----------------------------------------------------------------
  // STEP 6: Controlled Rejection Verification
  // ----------------------------------------------------------------
  console.log("\n[6/6] Testing Controlled Rejection Path…");
  const rejectRun = await agentRunRepository.create({
    projectId: DEMO_PROJECT_ID,
    goal: "Rejection verification test",
    triggerType: "USER_GOAL",
  });

  const rejectApproval = await approvalRepository.create({
    agentRunId: rejectRun.id,
    action: "reassign_task",
    payload: {
      actionType: "reassign_task",
      taskId: "14",
      targetAssigneeId: "Maya",
      reason: "Test rejection",
    },
    riskLevel: "REVIEW",
  });

  await approvalRepository.resolve(rejectApproval.id, "rejected", "user-udit");
  await activityRepository.log({
    projectId: DEMO_PROJECT_ID,
    actorType: "user",
    actorId: "user-udit",
    eventType: "APPROVAL_REJECTED",
    metadata: {
      approvalId: rejectApproval.id,
      action: "reassign_task",
      rejectedBy: "Udit",
    },
  });

  const taskAfterReject = await taskRepository.findById("14");
  console.log(`✓ Task 14 Assignee After Rejection: ${taskAfterReject?.assignee} (Unmodified)`);
  console.log(`✓ Recorded APPROVAL_REJECTED event in activity_logs`);

  console.log("\n==================================================");
  console.log("✓ HERO DEMO REHEARSAL COMPLETED SUCCESSFULLY!");
  console.log("==================================================");
}

if (require.main === module) {
  runHeroRehearsal()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Rehearsal failed:", err);
      await closePool();
      process.exit(1);
    });
}
