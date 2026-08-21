import { RecoveryPlan, RecoveryPlanSchema } from "./schema";
import { projectRepository, taskRepository, dependencyRepository } from "../db/repositories";

export type GroundingValidationResult = {
  isValid: boolean;
  errors: string[];
  checkedEntities: {
    projectExists: boolean;
    referencedTaskIds: string[];
    validTaskIds: string[];
    missingTaskIds: string[];
    referencedMemberIds: string[];
    validMemberIds: string[];
    missingMemberIds: string[];
  };
};

/**
 * Validates a generated RecoveryPlan against the actual database source of truth.
 * Checks that referenced task IDs, member names, and project IDs actually exist in PostgreSQL.
 */
export async function validatePlanGrounding(
  plan: RecoveryPlan
): Promise<GroundingValidationResult> {
  const errors: string[] = [];

  // 1. Schema check
  const schemaResult = RecoveryPlanSchema.safeParse(plan);
  if (!schemaResult.success) {
    errors.push(`Schema validation failed: ${JSON.stringify(schemaResult.error.format())}`);
  }

  // 2. Project check
  const project = await projectRepository.findById(plan.projectId);
  if (!project) {
    errors.push(`Project '${plan.projectId}' does not exist in database`);
  }

  const allTasks = await taskRepository.listByProject(plan.projectId);
  const existingTaskIdSet = new Set(allTasks.map((t) => t.id));
  const existingMemberSet = new Set(
    (project?.members ?? []).map((m) => m.toLowerCase())
  );

  const referencedTaskIds: string[] = [];
  const validTaskIds: string[] = [];
  const missingTaskIds: string[] = [];

  const referencedMemberIds: string[] = [];
  const validMemberIds: string[] = [];
  const missingMemberIds: string[] = [];

  // 3. Check findings task references
  for (const finding of plan.findings) {
    for (const taskId of finding.relatedTaskIds) {
      referencedTaskIds.push(taskId);
      if (existingTaskIdSet.has(taskId)) {
        validTaskIds.push(taskId);
      } else {
        missingTaskIds.push(taskId);
        errors.push(`Finding '${finding.title}' references non-existent taskId '${taskId}'`);
      }
    }
  }

  // 4. Check proposed actions references
  for (const action of plan.proposedActions) {
    if (action.actionType === "create_subtask") {
      referencedTaskIds.push(action.parentTaskId);
      if (existingTaskIdSet.has(action.parentTaskId)) {
        validTaskIds.push(action.parentTaskId);
      } else {
        missingTaskIds.push(action.parentTaskId);
        errors.push(`create_subtask references non-existent parentTaskId '${action.parentTaskId}'`);
      }
    } else if (action.actionType === "reassign_task") {
      referencedTaskIds.push(action.taskId);
      if (existingTaskIdSet.has(action.taskId)) {
        validTaskIds.push(action.taskId);
      } else {
        missingTaskIds.push(action.taskId);
        errors.push(`reassign_task references non-existent taskId '${action.taskId}'`);
      }

      referencedMemberIds.push(action.targetAssigneeId);
      if (existingMemberSet.has(action.targetAssigneeId.toLowerCase())) {
        validMemberIds.push(action.targetAssigneeId);
      } else {
        missingMemberIds.push(action.targetAssigneeId);
        errors.push(`reassign_task references non-member assignee '${action.targetAssigneeId}'`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    checkedEntities: {
      projectExists: Boolean(project),
      referencedTaskIds: Array.from(new Set(referencedTaskIds)),
      validTaskIds: Array.from(new Set(validTaskIds)),
      missingTaskIds: Array.from(new Set(missingTaskIds)),
      referencedMemberIds: Array.from(new Set(referencedMemberIds)),
      validMemberIds: Array.from(new Set(validMemberIds)),
      missingMemberIds: Array.from(new Set(missingMemberIds)),
    },
  };
}

/**
 * Takes a snapshot of project state, tasks, and dependencies to verify read-only behavior.
 */
export async function captureProjectSnapshot(projectId: string) {
  const [project, tasks, deps] = await Promise.all([
    projectRepository.findById(projectId),
    taskRepository.listByProject(projectId),
    dependencyRepository.listByProject(projectId),
  ]);

  return {
    projectId,
    projectUpdatedAt: project?.updatedAt,
    tasksCount: tasks.length,
    tasksJson: JSON.stringify(tasks),
    depsCount: deps.length,
    depsJson: JSON.stringify(deps),
  };
}
