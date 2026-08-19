export type AgentState =
  | "IDLE"
  | "UNDERSTANDING"
  | "PLANNING"
  | "EXECUTING"
  | "WAITING_FOR_APPROVAL"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "REPLANNING";

export type AgentRun = {
  id: string;
  projectId: string;
  goal: string;
  state: AgentState;
  stepCount: number;
  approvalIds: string[];
  executedToolCalls: string[];
};
