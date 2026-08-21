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
  processingStartedAt: string | null;
  processingHeartbeatAt: string | null;
  processingAttemptId: string | null;
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

export type LeaseResult =
  | { acquired: true; event: EventRecord; attemptId: string; isRecovery: boolean }
  | {
      acquired: false;
      reason: "already_processed" | "active_lease" | "not_found";
      event?: EventRecord;
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
      processingStartedAt: row.processingStartedAt ?? null,
      processingHeartbeatAt: row.processingHeartbeatAt ?? null,
      processingAttemptId: row.processingAttemptId ?? null,
      createdAt: row.createdAt,
      processedAt: row.processedAt ?? null,
    };
  }

  async findById(id: string): Promise<EventRecord | null> {
    const res = await query<any>(
      `SELECT id, type, project_id AS "projectId", payload, source,
              idempotency_key AS "idempotencyKey", status,
              linked_run_id AS "linkedRunId", attempt_count AS "attemptCount",
              last_error AS "lastError",
              processing_started_at AS "processingStartedAt",
              processing_heartbeat_at AS "processingHeartbeatAt",
              processing_attempt_id AS "processingAttemptId",
              created_at AS "createdAt",
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
              last_error AS "lastError",
              processing_started_at AS "processingStartedAt",
              processing_heartbeat_at AS "processingHeartbeatAt",
              processing_attempt_id AS "processingAttemptId",
              created_at AS "createdAt",
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
              last_error AS "lastError",
              processing_started_at AS "processingStartedAt",
              processing_heartbeat_at AS "processingHeartbeatAt",
              processing_attempt_id AS "processingAttemptId",
              created_at AS "createdAt",
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
                 last_error AS "lastError",
                 processing_started_at AS "processingStartedAt",
                 processing_heartbeat_at AS "processingHeartbeatAt",
                 processing_attempt_id AS "processingAttemptId",
                 created_at AS "createdAt",
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

  /**
   * Acquires a processing lease for an event with stale recovery protection.
   * If event is currently 'processing' but heartbeat is older than staleThresholdMs,
   * re-acquires the lease for worker crash recovery.
   */
  async acquireProcessingLease(
    id: string,
    staleThresholdMs: number = 60000
  ): Promise<LeaseResult> {
    const event = await this.findById(id);
    if (!event) {
      return { acquired: false, reason: "not_found" };
    }

    if (event.status === "processed") {
      return { acquired: false, reason: "already_processed", event };
    }

    const now = new Date();
    const attemptId = `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (event.status === "processing") {
      const lastHeartbeat = event.processingHeartbeatAt
        ? new Date(event.processingHeartbeatAt).getTime()
        : 0;
      const isStale = Date.now() - lastHeartbeat > staleThresholdMs;

      if (!isStale) {
        return { acquired: false, reason: "active_lease", event };
      }

      // Recover stale lease from crashed worker
      const res = await query<any>(
        `UPDATE events
         SET processing_started_at = $1,
             processing_heartbeat_at = $1,
             processing_attempt_id = $2,
             attempt_count = attempt_count + 1
         WHERE id = $3
         RETURNING id, type, project_id AS "projectId", payload, source,
                   idempotency_key AS "idempotencyKey", status,
                   linked_run_id AS "linkedRunId", attempt_count AS "attemptCount",
                   last_error AS "lastError",
                   processing_started_at AS "processingStartedAt",
                   processing_heartbeat_at AS "processingHeartbeatAt",
                   processing_attempt_id AS "processingAttemptId",
                   created_at AS "createdAt",
                   processed_at AS "processedAt"`,
        [now.toISOString(), attemptId, id]
      );
      return {
        acquired: true,
        event: this.mapRow(res.rows[0]),
        attemptId,
        isRecovery: true,
      };
    }

    // Acquire initial lease from 'queued' or 'received'
    const res = await query<any>(
      `UPDATE events
       SET status = 'processing',
           processing_started_at = $1,
           processing_heartbeat_at = $1,
           processing_attempt_id = $2,
           attempt_count = attempt_count + 1
       WHERE id = $3
       RETURNING id, type, project_id AS "projectId", payload, source,
                 idempotency_key AS "idempotencyKey", status,
                 linked_run_id AS "linkedRunId", attempt_count AS "attemptCount",
                 last_error AS "lastError",
                 processing_started_at AS "processingStartedAt",
                 processing_heartbeat_at AS "processingHeartbeatAt",
                 processing_attempt_id AS "processingAttemptId",
                 created_at AS "createdAt",
                 processed_at AS "processedAt"`,
      [now.toISOString(), attemptId, id]
    );

    return {
      acquired: true,
      event: this.mapRow(res.rows[0]),
      attemptId,
      isRecovery: false,
    };
  }

  async updateHeartbeat(id: string, attemptId: string): Promise<boolean> {
    const res = await query<any>(
      `UPDATE events
       SET processing_heartbeat_at = $1
       WHERE id = $2 AND processing_attempt_id = $3`,
      [new Date().toISOString(), id, attemptId]
    );
    return (res.rowCount ?? 0) > 0;
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
                 last_error AS "lastError",
                 processing_started_at AS "processingStartedAt",
                 processing_heartbeat_at AS "processingHeartbeatAt",
                 processing_attempt_id AS "processingAttemptId",
                 created_at AS "createdAt",
                 processed_at AS "processedAt"`,
      [status, pDate, linkedRunId ?? null, lastError ?? null, incrementAttempt, id]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }
}

export const eventRepository = new EventRepository();
