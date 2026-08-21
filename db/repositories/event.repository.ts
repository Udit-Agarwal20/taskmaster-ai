import { query } from "../client";
import { WorkflowEventType } from "../../agent/state";

export type EventStatus =
  | "received"
  | "queued"
  | "processing"
  | "processed"
  | "ignored"
  | "failed";

export type EventRecord = {
  id: string;
  type: WorkflowEventType | string;
  projectId: string;
  payload: any;
  source: string;
  idempotencyKey: string | null;
  status: EventStatus;
  linkedRunId: string | null;
  attemptCount: number;
  lastError: string | null;
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
  status?: EventStatus;
  linkedRunId?: string | null;
  attemptCount?: number;
  lastError?: string | null;
};

export class EventRepository {
  private mapRow(row: any): EventRecord {
    return {
      id: row.id,
      type: row.type,
      projectId: row.projectId,
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
      source: row.source,
      idempotencyKey: row.idempotencyKey ?? null,
      status: row.status,
      linkedRunId: row.linkedRunId ?? null,
      attemptCount: Number(row.attemptCount ?? 0),
      lastError: row.lastError ?? null,
      createdAt: row.createdAt,
      processedAt: row.processedAt ?? null,
    };
  }

  async findById(id: string): Promise<EventRecord | null> {
    const res = await query<any>(
      `SELECT id, type, project_id AS "projectId", payload, source,
              idempotency_key AS "idempotencyKey", status,
              linked_run_id AS "linkedRunId", attempt_count AS "attemptCount",
              last_error AS "lastError", created_at AS "createdAt",
              processed_at AS "processedAt"
       FROM events
       WHERE id = $1`,
      [id]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async findByIdempotencyKey(key: string): Promise<EventRecord | null> {
    const res = await query<any>(
      `SELECT id, type, project_id AS "projectId", payload, source,
              idempotency_key AS "idempotencyKey", status,
              linked_run_id AS "linkedRunId", attempt_count AS "attemptCount",
              last_error AS "lastError", created_at AS "createdAt",
              processed_at AS "processedAt"
       FROM events
       WHERE idempotency_key = $1`,
      [key]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async listByProject(projectId: string, limit: number = 50): Promise<EventRecord[]> {
    const res = await query<any>(
      `SELECT id, type, project_id AS "projectId", payload, source,
              idempotency_key AS "idempotencyKey", status,
              linked_run_id AS "linkedRunId", attempt_count AS "attemptCount",
              last_error AS "lastError", created_at AS "createdAt",
              processed_at AS "processedAt"
       FROM events
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [projectId, limit]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  async create(input: CreateEventInput): Promise<EventRecord> {
    const id = input.id ?? crypto.randomUUID();
    const res = await query<any>(
      `INSERT INTO events (id, type, project_id, payload, source, idempotency_key, status, linked_run_id, attempt_count, last_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, type, project_id AS "projectId", payload, source,
                 idempotency_key AS "idempotencyKey", status,
                 linked_run_id AS "linkedRunId", attempt_count AS "attemptCount",
                 last_error AS "lastError", created_at AS "createdAt",
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
        input.attemptCount ?? 0,
        input.lastError ?? null,
      ]
    );
    return this.mapRow(res.rows[0]);
  }

  async updateStatus(
    id: string,
    status: EventStatus,
    processedAt?: Date | string | null,
    linkedRunId?: string | null,
    lastError?: string | null,
    incrementAttempt = false
  ): Promise<EventRecord | null> {
    const pDate = processedAt === undefined ? null : processedAt;
    const res = await query<any>(
      `UPDATE events
       SET status = $1,
           processed_at = COALESCE($2, processed_at),
           linked_run_id = COALESCE($3, linked_run_id),
           last_error = COALESCE($4, last_error),
           attempt_count = attempt_count + (CASE WHEN $5::boolean THEN 1 ELSE 0 END)
       WHERE id = $6
       RETURNING id, type, project_id AS "projectId", payload, source,
                 idempotency_key AS "idempotencyKey", status,
                 linked_run_id AS "linkedRunId", attempt_count AS "attemptCount",
                 last_error AS "lastError", created_at AS "createdAt",
                 processed_at AS "processedAt"`,
      [status, pDate, linkedRunId ?? null, lastError ?? null, incrementAttempt, id]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }
}

export const eventRepository = new EventRepository();
