import { query } from "../client";

export type ActivityLog = {
  id: string;
  projectId: string;
  actorType: string;
  actorId: string | null;
  eventType: string;
  metadata: any;
  createdAt: string;
};

export type CreateActivityInput = {
  id?: string;
  projectId: string;
  actorType: "user" | "agent" | "system";
  actorId?: string | null;
  eventType: string;
  metadata?: any;
};

export class ActivityRepository {
  async listByProject(projectId: string, limit = 50): Promise<ActivityLog[]> {
    const res = await query<ActivityLog>(
      `SELECT id, project_id AS "projectId", actor_type AS "actorType",
              actor_id AS "actorId", event_type AS "eventType", metadata,
              created_at AS "createdAt"
       FROM activity_logs
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [projectId, limit]
    );
    return res.rows;
  }

  async log(input: CreateActivityInput): Promise<ActivityLog> {
    const id = input.id ?? crypto.randomUUID();
    const res = await query<ActivityLog>(
      `INSERT INTO activity_logs (id, project_id, actor_type, actor_id, event_type, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, project_id AS "projectId", actor_type AS "actorType",
                 actor_id AS "actorId", event_type AS "eventType", metadata,
                 created_at AS "createdAt"`,
      [
        id,
        input.projectId,
        input.actorType,
        input.actorId ?? null,
        input.eventType,
        JSON.stringify(input.metadata ?? {}),
      ]
    );
    return res.rows[0];
  }

  async create(input: CreateActivityInput): Promise<ActivityLog> {
    return this.log(input);
  }
}

export const activityRepository = new ActivityRepository();
