import { z } from "zod";

export const projectIdParamSchema = z.object({
  projectId: z.string().min(1, "Project ID is required").max(100, "Project ID is too long"),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(255, "Task title is too long"),
  description: z.string().max(2000, "Description is too long").optional().default(""),
  status: z.enum(["todo", "doing", "review", "done"]).optional().default("todo"),
  priority: z.enum(["low", "medium", "high"]).optional().default("medium"),
  assignee: z.string().max(100).optional(),
  assigneeId: z.string().max(100).optional().nullable(),
  dueDate: z.string().max(100).optional().nullable(),
  blocked: z.boolean().optional().default(false),
  parentTaskId: z.string().max(100).optional().nullable(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["todo", "doing", "review", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  assignee: z.string().max(100).optional(),
  assigneeId: z.string().max(100).optional().nullable(),
  dueDate: z.string().max(100).optional().nullable(),
  blocked: z.boolean().optional(),
  parentTaskId: z.string().max(100).optional().nullable(),
});

export const createDependencySchema = z.object({
  taskId: z.string().min(1, "taskId is required"),
  dependsOnTaskId: z.string().min(1, "dependsOnTaskId is required"),
  type: z.string().optional().default("blocks"),
}).refine((data) => data.taskId !== data.dependsOnTaskId, {
  message: "Task cannot depend on itself",
  path: ["dependsOnTaskId"],
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(255),
  description: z.string().max(2000).optional().default(""),
  deadline: z.string().max(100).optional().default(""),
  ownerId: z.string().min(1, "Owner ID is required"),
});
