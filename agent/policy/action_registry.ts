import { ProposedAction, ProposedActionSchema } from "../schema";

export type ActionRiskLevel = "AUTO" | "REVIEW" | "CRITICAL";

export type ActionRegistryEntry = {
  actionType: string;
  targetEntity: string;
  mutation: boolean;
  enforcedRiskLevel: ActionRiskLevel;
  requiresApproval: boolean;
  requiredPermission: string;
  description: string;
};

export const DEFAULT_MAX_AUTO_ACTIONS_PER_RUN = 5;

export function getMaxAutoActionsPerRun(): number {
  const envVal = process.env.MAX_AUTO_ACTIONS_PER_RUN;
  if (envVal && !isNaN(Number(envVal))) {
    return Number(envVal);
  }
  return DEFAULT_MAX_AUTO_ACTIONS_PER_RUN;
}

/**
 * Authoritative system registry for all supported mutation actions.
 * Application policy deterministically governs risk level and approval requirements.
 */
export const ACTION_REGISTRY: Record<string, ActionRegistryEntry> = {
  create_subtask: {
    actionType: "create_subtask",
    targetEntity: "task",
    mutation: true,
    enforcedRiskLevel: "AUTO",
    requiresApproval: false,
    requiredPermission: "tasks:create_subtask",
    description: "Creates a new subtask under an existing parent task to organize work.",
  },
  reassign_task: {
    actionType: "reassign_task",
    targetEntity: "task",
    mutation: true,
    enforcedRiskLevel: "REVIEW",
    requiresApproval: true,
    requiredPermission: "tasks:reassign",
    description: "Reassigns an existing task from one team member to another.",
  },
};

export type ActionPolicyResult = {
  riskLevel: ActionRiskLevel;
  requiresApproval: boolean;
  permission: string;
  targetEntity: string;
  mutation: boolean;
};

/**
 * Deterministically evaluates the operational policy and approval requirements for an action.
 * Never derives authorization or approval requirements from model output.
 */
export function getActionPolicy(action: ProposedAction): ActionPolicyResult {
  const entry = ACTION_REGISTRY[action.actionType];
  if (!entry) {
    throw new Error(`Unsupported action type '${(action as any).actionType}' in action policy engine`);
  }

  return {
    riskLevel: entry.enforcedRiskLevel,
    requiresApproval: entry.requiresApproval,
    permission: entry.requiredPermission,
    targetEntity: entry.targetEntity,
    mutation: entry.mutation,
  };
}

export type ActionCategorization = {
  proposedActions: ProposedAction[];
  allowedAutoActions: ProposedAction[];
  cappedToReviewActions: ProposedAction[];
  reviewRequiredActions: ProposedAction[];
  blockedActions: { action: any; reason: string }[];
};

/**
 * Categorizes and enforces automatic-action concurrency limits on proposed actions.
 * If more than MAX_AUTO_ACTIONS_PER_RUN are proposed, only the first N are executed automatically,
 * and excess AUTO actions are safely converted into approval-required actions.
 */
export function categorizeProposedActions(
  rawActions: any[],
  maxAuto = getMaxAutoActionsPerRun()
): ActionCategorization {
  const proposedActions: ProposedAction[] = [];
  const allowedAutoActions: ProposedAction[] = [];
  const cappedToReviewActions: ProposedAction[] = [];
  const reviewRequiredActions: ProposedAction[] = [];
  const blockedActions: { action: any; reason: string }[] = [];

  let autoCount = 0;

  for (const raw of rawActions) {
    const parsed = ProposedActionSchema.safeParse(raw);
    if (!parsed.success) {
      blockedActions.push({
        action: raw,
        reason: `Schema validation failed: ${parsed.error.message}`,
      });
      continue;
    }

    const action = parsed.data;
    proposedActions.push(action);

    const policy = getActionPolicy(action);

    if (policy.riskLevel === "AUTO") {
      if (autoCount < maxAuto) {
        allowedAutoActions.push(action);
        autoCount++;
      } else {
        // Enforce MAX_AUTO_ACTIONS_PER_RUN: convert excess auto actions into review-required actions
        cappedToReviewActions.push(action);
      }
    } else {
      reviewRequiredActions.push(action);
    }
  }

  return {
    proposedActions,
    allowedAutoActions,
    cappedToReviewActions,
    reviewRequiredActions,
    blockedActions,
  };
}
