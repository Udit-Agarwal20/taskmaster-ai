export type RiskLevel = "AUTO" | "REVIEW" | "CONFIRM";

export function effectiveRisk(toolName: string, bulk = false): RiskLevel {
  if (bulk && ["reassignTask", "changeDeadline", "changePriority", "createDependency", "removeDependency"].includes(toolName)) return "CONFIRM";
  if (["reassignTask", "changeDeadline", "changePriority", "createDependency", "removeDependency"].includes(toolName)) return "REVIEW";
  if (["createTask", "createSubtask", "updateTask"].includes(toolName)) return "AUTO";
  return "AUTO";
}

export function needsApproval(risk: RiskLevel): boolean {
  return risk === "REVIEW" || risk === "CONFIRM";
}
