import {
  projectRepository,
  taskRepository,
  dependencyRepository,
  Project,
  Task,
  TaskStatus,
  Priority,
  CreateTaskInput,
  UpdateTaskInput,
} from "../db/repositories";
import { projectAnalysisService, ProjectAnalysis } from "./services/project-analysis.service";

export type { TaskStatus, Priority, Task, Project, ProjectAnalysis };

export async function getProject(id: string): Promise<Project | null> {
  return await projectRepository.findById(id);
}

export async function listProjects(): Promise<Project[]> {
  return await projectRepository.list();
}

export async function listTasks(projectId: string): Promise<Task[]> {
  return await taskRepository.listByProject(projectId);
}

export async function getDependencies(
  projectId: string
): Promise<Array<{ from: string; to: string }>> {
  const deps = await dependencyRepository.listByProject(projectId);
  return deps.map((d) => ({ from: d.from, to: d.to }));
}

export async function createTask(
  input: Partial<Task> & Pick<Task, "projectId" | "title">
): Promise<Task> {
  return await taskRepository.create({
    id: input.id,
    projectId: input.projectId,
    title: input.title,
    description: input.description ?? "",
    status: input.status ?? "todo",
    priority: input.priority ?? "medium",
    assignee: input.assignee ?? "",
    assigneeId: input.assigneeId ?? null,
    dueDate: input.dueDate ?? null,
    blocked: input.blocked ?? false,
    parentTaskId: input.parentTaskId ?? null,
  });
}

export async function updateTask(
  id: string,
  changes: Partial<Task>
): Promise<Task | null> {
  return await taskRepository.update(id, changes as UpdateTaskInput);
}

export async function analyzeProject(
  projectId: string
): Promise<ProjectAnalysis> {
  return await projectAnalysisService.analyze(projectId);
}
