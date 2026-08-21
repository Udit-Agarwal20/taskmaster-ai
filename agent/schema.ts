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

export const ActionTypeSchema = z.enum([
  "create_task",
  "create_subtask",
  "update_task",
  "reassign_task",
  "change_deadline",
  "change_priority",
  "create_dependency",
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const PlanRiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type PlanRiskLevel = z.infer<typeof PlanRiskLevelSchema>;

export const ProposedActionSchema = z.object({
  actionType: ActionTypeSchema.describe("The type of mutation action recommended"),
  targetIds: z.array(z.string()).describe("Target task or user IDs affected by this action"),
  reason: z.string().describe("Justification for why this action resolves the issue"),
  riskLevel: PlanRiskLevelSchema.describe("Operational risk level of this proposed action"),
});
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

export const RecoveryPlanSchema = z.object({
  projectId: z.string().describe("Target project identifier"),
  summary: z.string().describe("High-level executive summary of project state and recovery plan"),
  riskLevel: PlanRiskLevelSchema.describe("Overall calculated project risk level"),
  findings: z.array(FindingSchema).describe("List of identified issues, blockers, and bottlenecks"),
  proposedActions: z.array(ProposedActionSchema).describe("Ordered list of non-executed proposed actions"),
  requiresApproval: z.boolean().describe("Whether any proposed action requires human confirmation"),
});
export type RecoveryPlan = z.infer<typeof RecoveryPlanSchema>;
