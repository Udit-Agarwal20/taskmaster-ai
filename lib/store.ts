export type TaskStatus = "todo" | "doing" | "review" | "done";
export type Priority = "low" | "medium" | "high";

export type Task = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assignee: string;
  dueDate: string | null;
  blocked: boolean;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  deadline: string;
  members: string[];
};

const project: Project = {
  id: "student-marketplace",
  name: "Student Marketplace Launch",
  description: "Launch the student marketplace product by Friday.",
  deadline: "Friday",
  members: ["Udit", "Rahul", "Maya", "Alex", "Sara", "Arjun"],
};

let tasks: Task[] = [
  { id: "1", projectId: project.id, title: "Finalize pricing approval", description: "Get final pricing sign-off.", status: "todo", priority: "high", assignee: "Alex", dueDate: "Today", blocked: true },
  { id: "2", projectId: project.id, title: "Payment integration", description: "Implement checkout and payment webhooks.", status: "doing", priority: "high", assignee: "Rahul", dueDate: "Friday", blocked: true },
  { id: "3", projectId: project.id, title: "Landing page", description: "Finish launch landing page.", status: "doing", priority: "high", assignee: "Maya", dueDate: "Thursday", blocked: false },
  { id: "4", projectId: project.id, title: "Analytics events", description: "Instrument launch analytics.", status: "review", priority: "medium", assignee: "Rahul", dueDate: "Thursday", blocked: false },
  { id: "5", projectId: project.id, title: "Launch QA", description: "Run final regression and release checks.", status: "todo", priority: "medium", assignee: "Sara", dueDate: "Friday", blocked: true },
  { id: "6", projectId: project.id, title: "Production deployment", description: "Prepare and deploy production release.", status: "done", priority: "medium", assignee: "Arjun", dueDate: "Friday", blocked: false },
];

const deps = [
  { from: "2", to: "1" },
  { from: "5", to: "2" },
  { from: "6", to: "5" },
];

export function getProject(id: string) {
  return id === project.id ? project : null;
}

export function listTasks(projectId: string) {
  return tasks.filter((t) => t.projectId === projectId);
}

export function getDependencies(projectId: string) {
  const valid = new Set(listTasks(projectId).map((t) => t.id));
  return deps.filter((d) => valid.has(d.from) && valid.has(d.to));
}

export function createTask(input: Partial<Task> & Pick<Task, "projectId" | "title">) {
  const task: Task = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    title: input.title,
    description: input.description ?? "",
    status: input.status ?? "todo",
    priority: input.priority ?? "medium",
    assignee: input.assignee ?? project.members[0],
    dueDate: input.dueDate ?? null,
    blocked: input.blocked ?? false,
  };
  tasks = [task, ...tasks];
  return task;
}

export function updateTask(id: string, changes: Partial<Task>) {
  const index = tasks.findIndex((t) => t.id === id);
  if (index < 0) return null;
  tasks[index] = { ...tasks[index], ...changes };
  return tasks[index];
}

export function analyzeProject(projectId: string) {
  const current = listTasks(projectId);
  const blockers = current.filter((t) => t.blocked);
  const overdue = current.filter((t) => t.dueDate === "Today" && t.status !== "done");
  const workload = current.reduce<Record<string, number>>((acc, t) => {
    acc[t.assignee] = (acc[t.assignee] ?? 0) + 1;
    return acc;
  }, {});
  const bottleneck = Object.entries(workload).sort((a, b) => b[1] - a[1])[0] ?? ["Unknown", 0];
  const risk = blockers.length >= 3 || Number(bottleneck[1]) >= 4 ? "HIGH" : blockers.length ? "MEDIUM" : "LOW";
  return {
    risk,
    blockers: blockers.length,
    deadlineRisks: overdue.length,
    bottleneck: { name: bottleneck[0], count: bottleneck[1] },
    workload,
    dependencies: getDependencies(projectId),
  };
}
