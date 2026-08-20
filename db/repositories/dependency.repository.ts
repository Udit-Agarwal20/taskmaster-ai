import { query } from "../client";

export type Dependency = {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
  from: string; // Alias for API compatibility
  to: string;   // Alias for API compatibility
  type: string;
  createdAt: string;
};

export class DependencyRepository {
  async listByProject(projectId: string): Promise<Dependency[]> {
    const res = await query<Dependency>(
      `SELECT d.id,
              d.task_id AS "taskId",
              d.depends_on_task_id AS "dependsOnTaskId",
              d.task_id AS "from",
              d.depends_on_task_id AS "to",
              d.type,
              d.created_at AS "createdAt"
       FROM dependencies d
       JOIN tasks t1 ON d.task_id = t1.id
       JOIN tasks t2 ON d.depends_on_task_id = t2.id
       WHERE t1.project_id = $1 AND t2.project_id = $1
       ORDER BY d.created_at ASC`,
      [projectId]
    );
    return res.rows;
  }

  async create(
    taskId: string,
    dependsOnTaskId: string,
    type = "blocks",
    id?: string
  ): Promise<Dependency> {
    if (taskId === dependsOnTaskId) {
      throw new Error("Task cannot depend on itself");
    }

    const depId = id ?? crypto.randomUUID();
    const res = await query<Dependency>(
      `INSERT INTO dependencies (id, task_id, depends_on_task_id, type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_id, depends_on_task_id) DO UPDATE SET type = EXCLUDED.type
       RETURNING id,
                 task_id AS "taskId",
                 depends_on_task_id AS "dependsOnTaskId",
                 task_id AS "from",
                 depends_on_task_id AS "to",
                 type,
                 created_at AS "createdAt"`,
      [depId, taskId, dependsOnTaskId, type]
    );
    return res.rows[0];
  }

  async delete(id: string): Promise<boolean> {
    const res = await query(`DELETE FROM dependencies WHERE id = $1`, [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async deleteEdge(taskId: string, dependsOnTaskId: string): Promise<boolean> {
    const res = await query(
      `DELETE FROM dependencies WHERE task_id = $1 AND depends_on_task_id = $2`,
      [taskId, dependsOnTaskId]
    );
    return (res.rowCount ?? 0) > 0;
  }
}

export const dependencyRepository = new DependencyRepository();
