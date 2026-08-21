import { z } from "zod";

export const WorkflowStateSchema = z.enum([
  "IDLE",
  "UNDERSTANDING",
  "PLANNING",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_EVENT",
  "RESUMING",
  "EXECUTING",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type AgentState = z.infer<typeof WorkflowStateSchema>;
export type WorkflowState = AgentState;

export const WorkflowEventTypeSchema = z.enum([
  "USER_GOAL",
  "TASK_UPDATED",
  "TASK_COMPLETED",
  "TASK_BLOCKED",
  "DEADLINE_RISK",
  "APPROVAL_RESOLVED",
  "EXTERNAL_EVENT",
  "GITHUB_PULL_REQUEST_MERGED",
]);
export type WorkflowEventType = z.infer<typeof WorkflowEventTypeSchema>;

export type AgentRun = {
  id: string;
  projectId: string;
  goal: string;
  triggerType: WorkflowEventType | string;
  triggerId?: string | null;
  state: WorkflowState;
  currentStep: string;
  plan?: any;
  contextSnapshot?: any;
  waitingReason?: string | null;
  expectedEventType?: string | null;
  expectedCorrelationId?: string | null;
  idempotencyKey?: string | null;
  retryCount: number;
  maxRetries: number;
  lastError?: string | null;
  summary?: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt?: string | null;
};
