import { FunctionTool } from "@google/adk";
import { z } from "zod";
import {
  projectRepository,
  taskRepository,
  dependencyRepository,
  activityRepository,
} from "../../db/repositories";
import { projectAnalysisService } from "../../lib/services/project-analysis.service";

/**
 * 1. getProjectState: Reads project metadata, deadline, status, and members.
 */
export const getProjectStateTool = new FunctionTool({
  name: "getProjectState",
  description: "Read the current project metadata, status, deadline, owner, and team member list.",
  parameters: z.object({
    projectId: z.string().describe("The ID of the project to inspect"),
  }),
  execute: async ({ projectId }: { projectId: string }) => {
    const project = await projectRepository.findById(projectId);
    if (!project) {
      return { error: `Project '${projectId}' not found` };
    }
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      deadline: project.deadline,
      status: project.status,
      ownerId: project.ownerId,
      members: project.members,
    };
  },
});

/**
 * 2. getTasks: Reads tasks for a project with optional filters.
 */
export const getTasksTool = new FunctionTool({
  name: "getTasks",
  description: "Read tasks for a project, with optional filtering by status or assignee.",
  parameters: z.object({
    projectId: z.string().describe("The ID of the project whose tasks to retrieve"),
    status: z.enum(["todo", "doing", "review", "done"]).optional().describe("Optional filter by task status"),
    assignee: z.string().optional().describe("Optional filter by assignee name"),
  }),
  execute: async ({
    projectId,
    status,
    assignee,
  }: {
    projectId: string;
    status?: "todo" | "doing" | "review" | "done";
    assignee?: string;
  }) => {
    let tasks = await taskRepository.listByProject(projectId);
    if (status) {
      tasks = tasks.filter((t) => t.status === status);
    }
    if (assignee) {
      tasks = tasks.filter((t) => t.assignee.toLowerCase() === assignee.toLowerCase());
    }
    return {
      count: tasks.length,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assignee: t.assignee,
        dueDate: t.dueDate,
        blocked: t.blocked,
        parentTaskId: t.parentTaskId,
      })),
    };
  },
});

/**
 * 3. getDependencies: Reads project task dependencies.
 */
export const getDependenciesTool = new FunctionTool({
  name: "getDependencies",
  description: "Read all dependency relationships between tasks for a given project.",
  parameters: z.object({
    projectId: z.string().describe("The ID of the project"),
  }),
  execute: async ({ projectId }: { projectId: string }) => {
    const deps = await dependencyRepository.listByProject(projectId);
    return {
      count: deps.length,
      dependencies: deps.map((d) => ({
        id: d.id,
        taskId: d.taskId,
        dependsOnTaskId: d.dependsOnTaskId,
        from: d.from,
        to: d.to,
        type: d.type,
      })),
    };
  },
});

/**
 * 4. getTeamWorkload: Reads workload metrics and active tasks per team member.
 */
export const getTeamWorkloadTool = new FunctionTool({
  name: "getTeamWorkload",
  description: "Read the active task count and workload distribution across all project team members.",
  parameters: z.object({
    projectId: z.string().describe("The ID of the project"),
  }),
  execute: async ({ projectId }: { projectId: string }) => {
    const tasks = await taskRepository.listByProject(projectId);
    const activeTasks = tasks.filter((t) => t.status !== "done");

    const workload: Record<string, { total: number; active: number; blocked: number }> = {};
    for (const task of tasks) {
      const assignee = task.assignee || "Unassigned";
      if (!workload[assignee]) {
        workload[assignee] = { total: 0, active: 0, blocked: 0 };
      }
      workload[assignee].total += 1;
      if (task.status !== "done") workload[assignee].active += 1;
      if (task.blocked) workload[assignee].blocked += 1;
    }

    return {
      totalActiveTasks: activeTasks.length,
      workload,
    };
  },
});

/**
 * 5. getProjectActivity: Reads recent activity audit logs.
 */
export const getProjectActivityTool = new FunctionTool({
  name: "getProjectActivity",
  description: "Read recent project activity and audit log events.",
  parameters: z.object({
    projectId: z.string().describe("The ID of the project"),
    limit: z.number().optional().default(20).describe("Maximum number of activity records to return"),
  }),
  execute: async ({ projectId, limit }: { projectId: string; limit?: number }) => {
    const logs = await activityRepository.listByProject(projectId, limit ?? 20);
    return {
      count: logs.length,
      activity: logs.map((l) => ({
        id: l.id,
        actorType: l.actorType,
        eventType: l.eventType,
        metadata: l.metadata,
        createdAt: l.createdAt,
      })),
    };
  },
});

/**
 * 6. analyzeProject: Exposes deterministic analysis service facts.
 */
export const analyzeProjectTool = new FunctionTool({
  name: "analyzeProject",
  description: "Run deterministic project analysis: health risk level, blocker count, deadline risks, workload bottleneck, and dependency chains.",
  parameters: z.object({
    projectId: z.string().describe("The ID of the project to analyze"),
  }),
  execute: async ({ projectId }: { projectId: string }) => {
    const analysis = await projectAnalysisService.analyze(projectId);
    return analysis;
  },
});

export const readOnlyTools = [
  getProjectStateTool,
  getTasksTool,
  getDependenciesTool,
  getTeamWorkloadTool,
  getProjectActivityTool,
  analyzeProjectTool,
];
