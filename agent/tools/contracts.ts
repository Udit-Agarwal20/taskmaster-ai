export type RiskLevel = "AUTO" | "REVIEW" | "CONFIRM";

export type ToolContract = {
  name: string;
  description: string;
  risk: RiskLevel;
  mutates: boolean;
  requiredPermission?: string;
  postcondition: string;
};

export const toolContracts: ToolContract[] = [
  { name: "getProjectState", description: "Read the current project state.", risk: "AUTO", mutates: false, postcondition: "A current project snapshot is returned." },
  { name: "getTasks", description: "Read tasks for a project with optional filters.", risk: "AUTO", mutates: false, postcondition: "Current matching tasks are returned." },
  { name: "getDependencies", description: "Read project task dependencies.", risk: "AUTO", mutates: false, postcondition: "Current dependency edges are returned." },
  { name: "getTeamWorkload", description: "Read workload metrics for project members.", risk: "AUTO", mutates: false, postcondition: "Current workload metrics are returned." },
  { name: "analyzeProject", description: "Analyze project health, blockers, risks, dependencies and workload.", risk: "AUTO", mutates: false, postcondition: "An explainable project analysis is returned." },
  { name: "findBlockers", description: "Identify tasks and dependencies blocking progress.", risk: "AUTO", mutates: false, postcondition: "A blocker set with evidence is returned." },
  { name: "analyzeDependencies", description: "Analyze dependency chains and critical blockers.", risk: "AUTO", mutates: false, postcondition: "Dependency risks are returned." },
  { name: "analyzeWorkload", description: "Identify overloaded and under-utilized team members.", risk: "AUTO", mutates: false, postcondition: "Workload risks are returned." },
  { name: "findDeadlineRisks", description: "Identify tasks whose current state puts deadlines at risk.", risk: "AUTO", mutates: false, postcondition: "Deadline risks are returned with reasons." },
  { name: "createTask", description: "Create a new project task.", risk: "AUTO", mutates: true, requiredPermission: "task.create", postcondition: "The task exists with the requested fields." },
  { name: "createSubtask", description: "Create a subtask under an existing task.", risk: "AUTO", mutates: true, requiredPermission: "task.create", postcondition: "The subtask exists and references its parent." },
  { name: "updateTask", description: "Update allowed task metadata.", risk: "AUTO", mutates: true, requiredPermission: "task.edit", postcondition: "The task contains the requested updated fields." },
  { name: "reassignTask", description: "Change the assignee of a task.", risk: "REVIEW", mutates: true, requiredPermission: "task.assign", postcondition: "The task assignee equals the requested user." },
  { name: "changeDeadline", description: "Change a task deadline.", risk: "REVIEW", mutates: true, requiredPermission: "task.edit", postcondition: "The task deadline equals the requested date." },
  { name: "changePriority", description: "Change a task priority.", risk: "REVIEW", mutates: true, requiredPermission: "task.edit", postcondition: "The task priority equals the requested priority." },
  { name: "createDependency", description: "Create a dependency between two tasks.", risk: "REVIEW", mutates: true, requiredPermission: "task.edit", postcondition: "The dependency edge exists and does not introduce an invalid cycle." },
  { name: "removeDependency", description: "Remove an existing dependency.", risk: "REVIEW", mutates: true, requiredPermission: "task.edit", postcondition: "The dependency edge no longer exists." },
  { name: "requestApproval", description: "Pause execution and request human approval for a consequential action.", risk: "CONFIRM", mutates: false, postcondition: "An approval record exists in pending state." },
  { name: "verifyChange", description: "Verify a previously executed mutation against its expected postcondition.", risk: "AUTO", mutates: false, postcondition: "Verification returns pass or fail with evidence." },
  { name: "verifyProjectState", description: "Re-read project state and verify the recovery plan outcome.", risk: "AUTO", mutates: false, postcondition: "The resulting project state is returned with verification evidence." },
];
