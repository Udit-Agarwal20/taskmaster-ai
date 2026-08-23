import {
  taskRepository,
  projectRepository,
  userRepository,
  agentRunRepository,
  activityRepository,
  Task,
} from "../../db/repositories";
import { CreateSubtaskAction, ReassignTaskAction, SendSlackMessageAction } from "../schema";
import { getActionPolicy } from "../policy/action_registry";
import { sendSlackMessage } from "../../lib/integrations/slack/client";

export type MutationExecutionResult = {
  status: "COMPLETED" | "FAILED" | "SKIPPED";
  actionType: "create_subtask" | "reassign_task" | "send_slack_message";
  taskId?: string;
  parentTaskId?: string;
  title?: string;
  previousAssignee?: string;
  newAssignee?: string;
  messageId?: string;
  channelId?: string;
  verified: boolean;
  error?: string;
  durationMs: number;
  timings?: {
    preconditionMs: number;
    mutationMs: number;
    verificationMs: number;
    totalMs: number;
  };
};

/**
 * 1. executeCreateSubtask (Automatic execution, low-risk)
 * Validates preconditions -> Creates DB subtask -> Double verifies in PostgreSQL -> Audits step & activity.
 */
export async function executeCreateSubtask(params: {
  projectId: string;
  action: CreateSubtaskAction;
  agentRunId?: string;
  idempotencyKey?: string;
}): Promise<MutationExecutionResult> {
  const startTime = Date.now();
  const { projectId, action, agentRunId, idempotencyKey } = params;

  // 1. Policy & Precondition Validation
  const policyStart = Date.now();
  const policy = getActionPolicy(action);
  if (policy.requiresApproval) {
    throw new Error("create_subtask unexpectedly flagged as requiring approval");
  }

  const project = await projectRepository.findById(projectId);
  if (!project) {
    return {
      status: "FAILED",
      actionType: "create_subtask",
      verified: false,
      error: `Project '${projectId}' not found`,
      durationMs: Date.now() - startTime,
    };
  }

  const parentTask = await taskRepository.findById(action.parentTaskId);
  if (!parentTask) {
    return {
      status: "FAILED",
      actionType: "create_subtask",
      parentTaskId: action.parentTaskId,
      verified: false,
      error: `Parent task '${action.parentTaskId}' not found`,
      durationMs: Date.now() - startTime,
    };
  }

  if (parentTask.projectId !== projectId) {
    return {
      status: "FAILED",
      actionType: "create_subtask",
      parentTaskId: action.parentTaskId,
      verified: false,
      error: `Parent task '${action.parentTaskId}' does not belong to project '${projectId}'`,
      durationMs: Date.now() - startTime,
    };
  }

  if (!action.title || action.title.trim().length === 0) {
    return {
      status: "FAILED",
      actionType: "create_subtask",
      parentTaskId: action.parentTaskId,
      verified: false,
      error: `Subtask title cannot be empty`,
      durationMs: Date.now() - startTime,
    };
  }
  const preconditionMs = Date.now() - policyStart;

  // 2. Idempotency Check (Check if exact subtask was already created for this run)
  if (agentRunId) {
    const existingSteps = await agentRunRepository.getSteps(agentRunId);
    const alreadyExecuted = existingSteps.find(
      (s) =>
        s.toolName === "createSubtask" &&
        s.input?.parentTaskId === action.parentTaskId &&
        s.input?.title === action.title
    );
    if (alreadyExecuted && alreadyExecuted.output?.taskId) {
      return {
        status: "COMPLETED",
        actionType: "create_subtask",
        taskId: alreadyExecuted.output.taskId,
        parentTaskId: action.parentTaskId,
        title: action.title,
        verified: true,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // 3. Database Mutation Execution
  const mutationStart = Date.now();
  const subtaskId = `subtask-${action.parentTaskId}-${Date.now().toString().slice(-4)}`;
  const created = await taskRepository.create({
    id: subtaskId,
    projectId,
    title: action.title,
    description: `Subtask created by Taskmaster AI Project Operator. Reason: ${action.reason}`,
    parentTaskId: action.parentTaskId,
    priority: parentTask.priority,
    status: "todo",
    assignee: parentTask.assignee || "Unassigned",
  });
  const mutationMs = Date.now() - mutationStart;

  // 4. Double Verification against PostgreSQL
  const verifyStart = Date.now();
  const verifiedTask = await taskRepository.findById(created.id);
  const isVerified =
    Boolean(verifiedTask) &&
    verifiedTask?.parentTaskId === action.parentTaskId &&
    verifiedTask?.projectId === projectId &&
    verifiedTask?.title === action.title;

  const verificationMs = Date.now() - verifyStart;

  if (!isVerified) {
    return {
      status: "FAILED",
      actionType: "create_subtask",
      taskId: created.id,
      parentTaskId: action.parentTaskId,
      verified: false,
      error: "Post-mutation verification check failed: subtask not found or corrupted in database",
      durationMs: Date.now() - startTime,
    };
  }

  // 5. Audit Logging (agent_steps and activity_logs)
  if (agentRunId) {
    const steps = await agentRunRepository.getSteps(agentRunId);
    await agentRunRepository.addStep({
      agentRunId,
      stepNumber: steps.length + 1,
      stepType: "MUTATION_EXECUTION",
      toolName: "createSubtask",
      input: { parentTaskId: action.parentTaskId, title: action.title, reason: action.reason },
      output: { taskId: created.id, status: "COMPLETED", verified: true },
      status: "COMPLETED",
    });
  }

  await activityRepository.log({
    projectId,
    actorType: "agent",
    actorId: agentRunId ?? null,
    eventType: "SUBTASK_CREATED",
    metadata: {
      subtaskId: created.id,
      parentTaskId: action.parentTaskId,
      title: action.title,
      parentTitle: parentTask.title,
      reason: action.reason,
      verified: true,
    },
  });

  const totalMs = Date.now() - startTime;
  return {
    status: "COMPLETED",
    actionType: "create_subtask",
    taskId: created.id,
    parentTaskId: action.parentTaskId,
    title: action.title,
    verified: true,
    durationMs: totalMs,
    timings: { preconditionMs, mutationMs, verificationMs, totalMs },
  };
}

/**
 * 2. executeReassignTask (Approval-required execution)
 * Validates preconditions -> Updates task assignee -> Verifies in PostgreSQL -> Audits step & activity.
 */
export async function executeReassignTask(params: {
  projectId: string;
  action: ReassignTaskAction;
  approvedBy: string;
  agentRunId?: string;
  idempotencyKey?: string;
}): Promise<MutationExecutionResult> {
  const startTime = Date.now();
  const { projectId, action, approvedBy, agentRunId, idempotencyKey } = params;

  // 1. Policy & Precondition Validation
  const policyStart = Date.now();
  const policy = getActionPolicy(action);
  if (!policy.requiresApproval) {
    throw new Error("reassign_task must require approval");
  }

  const project = await projectRepository.findById(projectId);
  if (!project) {
    return {
      status: "FAILED",
      actionType: "reassign_task",
      taskId: action.taskId,
      verified: false,
      error: `Project '${projectId}' not found`,
      durationMs: Date.now() - startTime,
    };
  }

  const task = await taskRepository.findById(action.taskId);
  if (!task) {
    return {
      status: "FAILED",
      actionType: "reassign_task",
      taskId: action.taskId,
      verified: false,
      error: `Task '${action.taskId}' not found`,
      durationMs: Date.now() - startTime,
    };
  }

  if (task.projectId !== projectId) {
    return {
      status: "FAILED",
      actionType: "reassign_task",
      taskId: action.taskId,
      verified: false,
      error: `Task '${action.taskId}' does not belong to project '${projectId}'`,
      durationMs: Date.now() - startTime,
    };
  }

  // Validate target user is a project member
  const isMember = project.members.some(
    (m) => m.toLowerCase() === action.targetAssigneeId.toLowerCase()
  );
  if (!isMember) {
    return {
      status: "FAILED",
      actionType: "reassign_task",
      taskId: action.taskId,
      verified: false,
      error: `Target assignee '${action.targetAssigneeId}' is not a member of project '${projectId}'`,
      durationMs: Date.now() - startTime,
    };
  }
  const preconditionMs = Date.now() - policyStart;

  // 2. Idempotency Check (Check if already reassigned to target assignee)
  if (task.assignee.toLowerCase() === action.targetAssigneeId.toLowerCase()) {
    return {
      status: "COMPLETED",
      actionType: "reassign_task",
      taskId: task.id,
      previousAssignee: task.assignee,
      newAssignee: action.targetAssigneeId,
      verified: true,
      durationMs: Date.now() - startTime,
    };
  }

  // 3. Database Mutation Execution
  const mutationStart = Date.now();
  const previousAssignee = task.assignee;
  const updated = await taskRepository.update(task.id, {
    assignee: action.targetAssigneeId,
  });
  const mutationMs = Date.now() - mutationStart;

  // 4. Double Verification against PostgreSQL
  const verifyStart = Date.now();
  const verifiedTask = await taskRepository.findById(task.id);
  const isVerified =
    Boolean(verifiedTask) &&
    verifiedTask?.assignee.toLowerCase() === action.targetAssigneeId.toLowerCase();
  const verificationMs = Date.now() - verifyStart;

  if (!isVerified) {
    return {
      status: "FAILED",
      actionType: "reassign_task",
      taskId: task.id,
      verified: false,
      error: "Post-mutation verification check failed: assignee was not updated in database",
      durationMs: Date.now() - startTime,
    };
  }

  // 5. Audit Logging (agent_steps and activity_logs)
  if (agentRunId) {
    const steps = await agentRunRepository.getSteps(agentRunId);
    await agentRunRepository.addStep({
      agentRunId,
      stepNumber: steps.length + 1,
      stepType: "MUTATION_EXECUTION",
      toolName: "reassignTask",
      input: { taskId: task.id, targetAssigneeId: action.targetAssigneeId, reason: action.reason, approvedBy },
      output: { taskId: task.id, previousAssignee, newAssignee: action.targetAssigneeId, status: "COMPLETED", verified: true },
      status: "COMPLETED",
    });
  }

  await activityRepository.log({
    projectId,
    actorType: "agent",
    actorId: agentRunId ?? null,
    eventType: "TASK_REASSIGNED",
    metadata: {
      taskId: task.id,
      taskTitle: task.title,
      previousAssignee,
      newAssignee: action.targetAssigneeId,
      reason: action.reason,
      approvedBy,
      verified: true,
    },
  });

  const totalMs = Date.now() - startTime;
  return {
    status: "COMPLETED",
    actionType: "reassign_task",
    taskId: task.id,
    previousAssignee,
    newAssignee: action.targetAssigneeId,
    verified: true,
    durationMs: totalMs,
    timings: { preconditionMs, mutationMs, verificationMs, totalMs },
  };
}

/**
 * 3. executeSendSlackMessage (External action sink, automatic execution)
 * Validates preconditions -> Enforces primary mutation verification -> Posts to Slack Web API -> Audits step & activity.
 */
export async function executeSendSlackMessage(params: {
  projectId: string;
  action: SendSlackMessageAction;
  agentRunId?: string;
  idempotencyKey?: string;
  projectMutationVerified?: boolean;
}): Promise<MutationExecutionResult> {
  const startTime = Date.now();
  const { projectId, action, agentRunId, idempotencyKey, projectMutationVerified } = params;

  // 1. Policy & Precondition Validation
  const policyStart = Date.now();
  const policy = getActionPolicy(action);
  if (policy.requiresApproval) {
    throw new Error("send_slack_message unexpectedly flagged as requiring approval");
  }

  // Precondition: Must not send a successful Slack notification if primary project mutation failed
  if (projectMutationVerified === false) {
    return {
      status: "FAILED",
      actionType: "send_slack_message",
      verified: false,
      error: "Cannot post success update to Slack: primary project mutation failed or was not verified",
      durationMs: Date.now() - startTime,
    };
  }

  const preconditionMs = Date.now() - policyStart;

  // 2. Idempotency Check (Check if exact message was already sent for this run)
  const effectiveIdempotencyKey = idempotencyKey || (agentRunId ? `${agentRunId}:slack:${action.channelId || "default"}` : `slack-${Date.now()}`);

  if (agentRunId) {
    const existingSteps = await agentRunRepository.getSteps(agentRunId);
    const alreadyExecuted = existingSteps.find(
      (s) =>
        s.toolName === "sendSlackMessage" &&
        s.input?.message === action.message &&
        s.status === "COMPLETED"
    );
    if (alreadyExecuted && alreadyExecuted.output?.messageId) {
      return {
        status: "COMPLETED",
        actionType: "send_slack_message",
        messageId: alreadyExecuted.output.messageId,
        channelId: alreadyExecuted.output.channelId,
        verified: true,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // 3. Post to Slack Web API
  const mutationStart = Date.now();
  const sendResult = await sendSlackMessage({
    channelId: action.channelId,
    text: action.message,
    idempotencyKey: effectiveIdempotencyKey,
  });
  const mutationMs = Date.now() - mutationStart;

  // 4. Verify Delivery via API Response
  const verifyStart = Date.now();
  const isVerified = sendResult.ok && Boolean(sendResult.messageId || sendResult.ts);
  const verificationMs = Date.now() - verifyStart;

  if (!isVerified) {
    // Record FAILED step
    if (agentRunId) {
      const steps = await agentRunRepository.getSteps(agentRunId);
      await agentRunRepository.addStep({
        agentRunId,
        stepNumber: steps.length + 1,
        stepType: "MUTATION_EXECUTION",
        toolName: "sendSlackMessage",
        input: { channelId: action.channelId, message: action.message, reason: action.reason },
        output: { status: "FAILED", error: sendResult.error, channelId: sendResult.channelId },
        status: "FAILED",
      });
    }

    return {
      status: "FAILED",
      actionType: "send_slack_message",
      channelId: sendResult.channelId,
      verified: false,
      error: sendResult.error || "Slack API delivery verification failed",
      durationMs: Date.now() - startTime,
    };
  }

  // 5. Audit Logging (agent_steps and activity_logs)
  if (agentRunId) {
    const steps = await agentRunRepository.getSteps(agentRunId);
    await agentRunRepository.addStep({
      agentRunId,
      stepNumber: steps.length + 1,
      stepType: "MUTATION_EXECUTION",
      toolName: "sendSlackMessage",
      input: { channelId: action.channelId, message: action.message, reason: action.reason },
      output: {
        messageId: sendResult.messageId,
        channelId: sendResult.channelId,
        status: "COMPLETED",
        verified: true,
      },
      status: "COMPLETED",
    });
  }

  await activityRepository.log({
    projectId,
    actorType: "agent",
    actorId: agentRunId ?? null,
    eventType: "SLACK_MESSAGE_SENT",
    metadata: {
      channelId: sendResult.channelId,
      messageId: sendResult.messageId,
      messagePreview: action.message.slice(0, 100),
      reason: action.reason,
      verified: true,
    },
  });

  const totalMs = Date.now() - startTime;
  return {
    status: "COMPLETED",
    actionType: "send_slack_message",
    messageId: sendResult.messageId,
    channelId: sendResult.channelId,
    verified: true,
    durationMs: totalMs,
    timings: { preconditionMs, mutationMs, verificationMs, totalMs },
  };
}

