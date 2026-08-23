import { z } from "zod";

export const FindingTypeSchema = z.enum([
  "blocker",
  "deadline_risk",
  "workload",
  "dependency",
]);
export type FindingType = z.infer<typeof FindingTypeSchema>;

export const FindingSchema = z.object({
  type: FindingTypeSchema,
  title: z.string().describe("Short descriptive title of the finding"),
  explanation: z.string().describe("Detailed explanation with evidence from project state"),
  relatedTaskIds: z.array(z.string()).describe("IDs of relevant tasks involved in this finding"),
});
export type Finding = z.infer<typeof FindingSchema>;

export const PlanRiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type PlanRiskLevel = z.infer<typeof PlanRiskLevelSchema>;

/**
 * 1. create_subtask action schema (Automatic execution, low-risk)
 */
export const CreateSubtaskActionSchema = z.object({
  actionType: z.literal("create_subtask").describe("Action to create a subtask under an existing parent task"),
  parentTaskId: z.string().min(1).describe("ID of the parent task under which to create the subtask"),
  title: z.string().min(1).describe("Title for the new subtask"),
  reason: z.string().min(1).describe("Justification for why this subtask is needed to unblock or organize work"),
});
export type CreateSubtaskAction = z.infer<typeof CreateSubtaskActionSchema>;

/**
 * 2. reassign_task action schema (Human approval required, review-risk)
 */
export const ReassignTaskActionSchema = z.object({
  actionType: z.literal("reassign_task").describe("Action to reassign an existing task to another team member"),
  taskId: z.string().min(1).describe("ID of the task to be reassigned"),
  targetAssigneeId: z.string().min(1).describe("Name or user ID of the target team member receiving the task"),
  reason: z.string().min(1).describe("Justification for why reassigning this task balances workload or unblocks progress"),
});
export type ReassignTaskAction = z.infer<typeof ReassignTaskActionSchema>;

/**
 * 3. send_slack_message action schema (Automatic external action sink)
 */
export const SendSlackMessageActionSchema = z.object({
  actionType: z.literal("send_slack_message").describe("Action to post a verified project update into Slack"),
  channelId: z.string().optional().describe("Optional target Slack channel ID or name (defaults to configured channel)"),
  message: z.string().min(1).describe("The formatted notification text to send to the team in Slack"),
  reason: z.string().min(1).describe("Justification for why this Slack notification should be sent"),
});
export type SendSlackMessageAction = z.infer<typeof SendSlackMessageActionSchema>;

/**
 * Authoritative discriminated union for proposed actions in Taskmaster.
 */
export const ProposedActionSchema = z.discriminatedUnion("actionType", [
  CreateSubtaskActionSchema,
  ReassignTaskActionSchema,
  SendSlackMessageActionSchema,
]);
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

export const RecoveryPlanSchema = z.object({
  projectId: z.string().describe("Target project identifier"),
  summary: z.string().describe("High-level executive summary of project state and recovery plan"),
  riskLevel: PlanRiskLevelSchema.describe("Overall calculated project risk level"),
  findings: z.array(FindingSchema).describe("List of identified issues, blockers, and bottlenecks"),
  proposedActions: z.array(ProposedActionSchema).describe("Ordered list of proposed mutation actions"),
  requiresApproval: z.boolean().describe("Whether any proposed action requires human confirmation"),
});
export type RecoveryPlan = z.infer<typeof RecoveryPlanSchema>;
