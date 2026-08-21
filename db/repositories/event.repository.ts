import { query } from "../client";
import { WorkflowEventType } from "../../agent/state";

export type EventRecord = {
  id: string;
  type: WorkflowEventType | string;
  projectId: string;
  payload: any;
  source: string;
  idempotencyKey: string | null;
  status: "received" | "processed" | "ignored" | "failed";
  linkedRunId: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type CreateEventInput = {
  id?: string;
  type: WorkflowEventType | string;
  projectId: string;
  payload?: any;
  source: string;
  idempotencyKey?: string | null;
  status?: "received" | "processed" | "ignored" | "failed";
  linkedRunId?: string | null;
};

export class EventRepository {
  async findById(id: string): Promise<EventRecord | null> {
    const res = await query<EventRecord>(
      `SELECT id, type, project_id AS "projectId", payload, source,
              idempotency_key AS "idempotencyKey", status,
              linked_run_id AS "linkedRunId", created_at AS "createdAt",
              processed_at AS "processedAt"
       FROM events
       WHERE id = $1`,
      [id]
    );
    return res.rows[0] ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<EventRecord | null> {
    const res = await query<EventRecord>(
      `SELECT id, type, project_id AS "projectId", payload, source,
              idempotency_key AS "idempotencyKey", status,
              linked_run_id AS "linkedRunId", created_at AS "createdAt",
              processed_at AS "processedAt"
       FROM events
       WHERE idempotency_key = $1`,
      [key]
    );
    return res.rows[0] ?? null;
  }

  async listByProject(projectId: string, limit: number = 50): Promise<EventRecord[]> {
    const res = await query<EventRecord>(
      `SELECT id, type, project_id AS "projectId", payload, source,
              idempotency_key AS "idempotencyKey", status,
              linked_run_id AS "linkedRunId", created_at AS "createdAt",
              processed_at AS "processedAt"
       FROM events
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [projectId, limit]
    );
    return res.rows;
  }

  async create(input: CreateEventInput): Promise<EventRecord> {
    const id = input.id ?? crypto.randomUUID();
    const res = await query<EventRecord>(
      `INSERT INTO events (id, type, project_id, payload, source, idempotency_key, status, linked_run_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, type, project_id AS "projectId", payload, source,
                 idempotency_key AS "idempotencyKey", status,
                 linked_run_id AS "linkedRunId", created_at AS "createdAt",
                 processed_at AS "processedAt"`,
      [
        id,
        input.type,
        input.projectId,
        JSON.stringify(input.payload ?? {}),
        input.source,
        input.idempotencyKey ?? null,
        input.status ?? "received",
        input.linkedRunId ?? null,
      ]
    );
    return res.rows[0];
  }

  async updateStatus(
    id: string,
    status: "received" | "processed" | "ignored" | "failed",
    processedAt?: Date | string | null,
    linkedRunId?: string | null
  ): Promise<EventRecord | null> {
    const pDate = processedAt === undefined ? new Date().toISOString() : processedAt;
    const res = await query<EventRecord>(
      `UPDATE events
       SET status = $1,
           processed_at = $2,
           linked_run_id = COALESCE($3, linked_run_id)
       WHERE id = $4
       RETURNING id, type, project_id AS "projectId", payload, source,
                 idempotency_key AS "idempotencyKey", status,
                 linked_run_id AS "linkedRunId", created_at AS "createdAt",
                 processed_at AS "processedAt"`,
      [status, pDate, linkedRunId ?? null, id]
    );
    return res.rows[0] ?? null;
  }
}

export const eventRepository = new EventRepository();
