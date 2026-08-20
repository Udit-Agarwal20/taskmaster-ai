import { query } from "../client";

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
  assigneeId?: string | null;
  dueDate: string | null;
  blocked: boolean;
  parentTaskId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateTaskInput = {
  id?: string;
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: Priority;
  assignee?: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  blocked?: boolean;
  parentTaskId?: string | null;
};

export type UpdateTaskInput = Partial<{
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assignee: string;
  assigneeId: string | null;
  dueDate: string | null;
  blocked: boolean;
  parentTaskId: string | null;
}>;

type TaskRow = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  assignee: string;
  assigneeId: string | null;
  dueDate: string | null;
  blocked: boolean;
  parentTaskId: string | null;
  createdAt: string;
  updatedAt: string;
};

export class TaskRepository {
  async findById(id: string): Promise<Task | null> {
    const res = await query<TaskRow>(
      `SELECT t.id, t.project_id AS "projectId", t.title, t.description,
              t.status, t.priority,
              COALESCE(NULLIF(t.assignee_name, ''), u.name, 'Unassigned') AS assignee,
              t.assignee_id AS "assigneeId",
              t.due_date AS "dueDate", t.blocked,
              t.parent_task_id AS "parentTaskId",
              t.created_at AS "createdAt", t.updated_at AS "updatedAt"
       FROM tasks t
       LEFT JOIN users u ON t.assignee_id = u.id
       WHERE t.id = $1`,
      [id]
    );
    return res.rows[0] ?? null;
  }

  async listByProject(projectId: string): Promise<Task[]> {
    const res = await query<TaskRow>(
      `SELECT t.id, t.project_id AS "projectId", t.title, t.description,
              t.status, t.priority,
              COALESCE(NULLIF(t.assignee_name, ''), u.name, 'Unassigned') AS assignee,
              t.assignee_id AS "assigneeId",
              t.due_date AS "dueDate", t.blocked,
              t.parent_task_id AS "parentTaskId",
              t.created_at AS "createdAt", t.updated_at AS "updatedAt"
       FROM tasks t
       LEFT JOIN users u ON t.assignee_id = u.id
       WHERE t.project_id = $1
       ORDER BY t.created_at ASC`,
      [projectId]
    );
    return res.rows;
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const id = input.id ?? crypto.randomUUID();
    const assigneeName = input.assignee ?? "";

    let assigneeId = input.assigneeId ?? null;
    if (!assigneeId && assigneeName) {
      const userRes = await query<{ id: string }>(
        `SELECT id FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [assigneeName]
      );
      if (userRes.rows[0]) {
        assigneeId = userRes.rows[0].id;
      }
    }

    const res = await query<TaskRow>(
      `INSERT INTO tasks (id, project_id, title, description, status, priority,
                          assignee_id, assignee_name, due_date, blocked, parent_task_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, project_id AS "projectId", title, description, status, priority,
                 assignee_name AS assignee, assignee_id AS "assigneeId",
                 due_date AS "dueDate", blocked, parent_task_id AS "parentTaskId",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        input.projectId,
        input.title,
        input.description ?? "",
        input.status ?? "todo",
        input.priority ?? "medium",
        assigneeId,
        assigneeName,
        input.dueDate ?? null,
        input.blocked ?? false,
        input.parentTaskId ?? null,
      ]
    );

    const task = res.rows[0];
    return {
      ...task,
      assignee: task.assignee || "Unassigned",
    };
  }

  async upsert(input: CreateTaskInput & { id: string }): Promise<Task> {
    const assigneeName = input.assignee ?? "";
    let assigneeId = input.assigneeId ?? null;
    if (!assigneeId && assigneeName) {
      const userRes = await query<{ id: string }>(
        `SELECT id FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [assigneeName]
      );
      if (userRes.rows[0]) {
        assigneeId = userRes.rows[0].id;
      }
    }

    const res = await query<TaskRow>(
      `INSERT INTO tasks (id, project_id, title, description, status, priority,
                          assignee_id, assignee_name, due_date, blocked, parent_task_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE
       SET title = EXCLUDED.title,
           description = EXCLUDED.description,
           status = EXCLUDED.status,
           priority = EXCLUDED.priority,
           assignee_id = EXCLUDED.assignee_id,
           assignee_name = EXCLUDED.assignee_name,
           due_date = EXCLUDED.due_date,
           blocked = EXCLUDED.blocked,
           parent_task_id = EXCLUDED.parent_task_id,
           updated_at = NOW()
       RETURNING id, project_id AS "projectId", title, description, status, priority,
                 assignee_name AS assignee, assignee_id AS "assigneeId",
                 due_date AS "dueDate", blocked, parent_task_id AS "parentTaskId",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        input.id,
        input.projectId,
        input.title,
        input.description ?? "",
        input.status ?? "todo",
        input.priority ?? "medium",
        assigneeId,
        assigneeName,
        input.dueDate ?? null,
        input.blocked ?? false,
        input.parentTaskId ?? null,
      ]
    );

    const task = res.rows[0];
    return {
      ...task,
      assignee: task.assignee || "Unassigned",
    };
  }

  async update(id: string, changes: UpdateTaskInput): Promise<Task | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (changes.title !== undefined) {
      fields.push(`title = $${idx++}`);
      values.push(changes.title);
    }
    if (changes.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(changes.description);
    }
    if (changes.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(changes.status);
    }
    if (changes.priority !== undefined) {
      fields.push(`priority = $${idx++}`);
      values.push(changes.priority);
    }
    if (changes.assignee !== undefined) {
      fields.push(`assignee_name = $${idx++}`);
      values.push(changes.assignee);
    }
    if (changes.assigneeId !== undefined) {
      fields.push(`assignee_id = $${idx++}`);
      values.push(changes.assigneeId);
    }
    if (changes.dueDate !== undefined) {
      fields.push(`due_date = $${idx++}`);
      values.push(changes.dueDate);
    }
    if (changes.blocked !== undefined) {
      fields.push(`blocked = $${idx++}`);
      values.push(changes.blocked);
    }
    if (changes.parentTaskId !== undefined) {
      fields.push(`parent_task_id = $${idx++}`);
      values.push(changes.parentTaskId);
    }

    if (fields.length === 0) return existing;

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const res = await query<TaskRow>(
      `UPDATE tasks
       SET ${fields.join(", ")}
       WHERE id = $${idx}
       RETURNING id, project_id AS "projectId", title, description, status, priority,
                 assignee_name AS assignee, assignee_id AS "assigneeId",
                 due_date AS "dueDate", blocked, parent_task_id AS "parentTaskId",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      values
    );

    return res.rows[0] ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const res = await query(`DELETE FROM tasks WHERE id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }
}

export const taskRepository = new TaskRepository();
