import { query } from "../client";
import { WorkflowState } from "../../agent/state";

export type AgentRun = {
  id: string;
  projectId: string;
  goal: string;
  triggerType: string;
  triggerId: string | null;
  state: WorkflowState;
  currentStep: string;
  plan: any;
  contextSnapshot: any;
  waitingReason: string | null;
  expectedEventType: string | null;
  expectedCorrelationId: string | null;
  idempotencyKey: string | null;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  summary: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type AgentStep = {
  id: string;
  agentRunId: string;
  stepNumber: number;
  stepType: string;
  toolName: string | null;
  input: any;
  output: any;
  status: string;
  createdAt: string;
};

export type CreateAgentRunInput = {
  id?: string;
  projectId: string;
  goal: string;
  triggerType?: string;
  triggerId?: string | null;
  state?: WorkflowState;
  currentStep?: string;
  plan?: any;
  contextSnapshot?: any;
  waitingReason?: string | null;
  expectedEventType?: string | null;
  expectedCorrelationId?: string | null;
  idempotencyKey?: string | null;
  retryCount?: number;
  maxRetries?: number;
  lastError?: string | null;
  summary?: string | null;
};

export type CreateAgentStepInput = {
  id?: string;
  agentRunId: string;
  stepNumber: number;
  stepType: string;
  toolName?: string;
  input?: any;
  output?: any;
  status: string;
};

export class AgentRunRepository {
  private mapRow(row: any): AgentRun {
    return {
      id: row.id,
      projectId: row.projectId,
      goal: row.goal,
      triggerType: row.triggerType ?? "USER_GOAL",
      triggerId: row.triggerId ?? null,
      state: row.state,
      currentStep: row.currentStep ?? "UNDERSTANDING",
      plan: row.plan ?? null,
      contextSnapshot: row.contextSnapshot ?? null,
      waitingReason: row.waitingReason ?? null,
      expectedEventType: row.expectedEventType ?? null,
      expectedCorrelationId: row.expectedCorrelationId ?? null,
      idempotencyKey: row.idempotencyKey ?? null,
      retryCount: row.retryCount ?? 0,
      maxRetries: row.maxRetries ?? 3,
      lastError: row.lastError ?? null,
      summary: row.summary ?? null,
      startedAt: row.startedAt,
      updatedAt: row.updatedAt ?? row.startedAt,
      completedAt: row.completedAt ?? null,
    };
  }

  async findById(id: string): Promise<AgentRun | null> {
    const res = await query<any>(
      `SELECT id, project_id AS "projectId", goal, trigger_type AS "triggerType",
              trigger_id AS "triggerId", state, current_step AS "currentStep",
              plan, context_snapshot AS "contextSnapshot",
              waiting_reason AS "waitingReason",
              expected_event_type AS "expectedEventType",
              expected_correlation_id AS "expectedCorrelationId",
              idempotency_key AS "idempotencyKey",
              retry_count AS "retryCount", max_retries AS "maxRetries",
              last_error AS "lastError", summary,
              started_at AS "startedAt", updated_at AS "updatedAt",
              completed_at AS "completedAt"
       FROM agent_runs WHERE id = $1`,
      [id]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async findByIdempotencyKey(key: string): Promise<AgentRun | null> {
    const res = await query<any>(
      `SELECT id, project_id AS "projectId", goal, trigger_type AS "triggerType",
              trigger_id AS "triggerId", state, current_step AS "currentStep",
              plan, context_snapshot AS "contextSnapshot",
              waiting_reason AS "waitingReason",
              expected_event_type AS "expectedEventType",
              expected_correlation_id AS "expectedCorrelationId",
              idempotency_key AS "idempotencyKey",
              retry_count AS "retryCount", max_retries AS "maxRetries",
              last_error AS "lastError", summary,
              started_at AS "startedAt", updated_at AS "updatedAt",
              completed_at AS "completedAt"
       FROM agent_runs WHERE idempotency_key = $1`,
      [key]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async findWaitingRun(
    projectId: string,
    eventType: string,
    correlationId?: string
  ): Promise<AgentRun | null> {
    const queryStr = correlationId
      ? `SELECT id, project_id AS "projectId", goal, trigger_type AS "triggerType",
                trigger_id AS "triggerId", state, current_step AS "currentStep",
                plan, context_snapshot AS "contextSnapshot",
                waiting_reason AS "waitingReason",
                expected_event_type AS "expectedEventType",
                expected_correlation_id AS "expectedCorrelationId",
                idempotency_key AS "idempotencyKey",
                retry_count AS "retryCount", max_retries AS "maxRetries",
                last_error AS "lastError", summary,
                started_at AS "startedAt", updated_at AS "updatedAt",
                completed_at AS "completedAt"
         FROM agent_runs
         WHERE project_id = $1
           AND state IN ('WAITING_FOR_EVENT', 'WAITING_FOR_APPROVAL')
           AND expected_event_type = $2
           AND (expected_correlation_id IS NULL OR expected_correlation_id = $3)
         ORDER BY updated_at DESC
         LIMIT 1`
      : `SELECT id, project_id AS "projectId", goal, trigger_type AS "triggerType",
                trigger_id AS "triggerId", state, current_step AS "currentStep",
                plan, context_snapshot AS "contextSnapshot",
                waiting_reason AS "waitingReason",
                expected_event_type AS "expectedEventType",
                expected_correlation_id AS "expectedCorrelationId",
                idempotency_key AS "idempotencyKey",
                retry_count AS "retryCount", max_retries AS "maxRetries",
                last_error AS "lastError", summary,
                started_at AS "startedAt", updated_at AS "updatedAt",
                completed_at AS "completedAt"
         FROM agent_runs
         WHERE project_id = $1
           AND state IN ('WAITING_FOR_EVENT', 'WAITING_FOR_APPROVAL')
           AND expected_event_type = $2
         ORDER BY updated_at DESC
         LIMIT 1`;

    const params = correlationId ? [projectId, eventType, correlationId] : [projectId, eventType];
    const res = await query<any>(queryStr, params);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async listByProject(projectId: string): Promise<AgentRun[]> {
    const res = await query<any>(
      `SELECT id, project_id AS "projectId", goal, trigger_type AS "triggerType",
              trigger_id AS "triggerId", state, current_step AS "currentStep",
              plan, context_snapshot AS "contextSnapshot",
              waiting_reason AS "waitingReason",
              expected_event_type AS "expectedEventType",
              expected_correlation_id AS "expectedCorrelationId",
              idempotency_key AS "idempotencyKey",
              retry_count AS "retryCount", max_retries AS "maxRetries",
              last_error AS "lastError", summary,
              started_at AS "startedAt", updated_at AS "updatedAt",
              completed_at AS "completedAt"
       FROM agent_runs
       WHERE project_id = $1
       ORDER BY started_at DESC`,
      [projectId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  async create(input: CreateAgentRunInput): Promise<AgentRun> {
    const id = input.id ?? crypto.randomUUID();
    const res = await query<any>(
      `INSERT INTO agent_runs (
         id, project_id, goal, trigger_type, trigger_id, state, current_step,
         plan, context_snapshot, waiting_reason, expected_event_type, expected_correlation_id,
         idempotency_key, retry_count, max_retries, last_error, summary
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id, project_id AS "projectId", goal, trigger_type AS "triggerType",
                 trigger_id AS "triggerId", state, current_step AS "currentStep",
                 plan, context_snapshot AS "contextSnapshot",
                 waiting_reason AS "waitingReason",
                 expected_event_type AS "expectedEventType",
                 expected_correlation_id AS "expectedCorrelationId",
                 idempotency_key AS "idempotencyKey",
                 retry_count AS "retryCount", max_retries AS "maxRetries",
                 last_error AS "lastError", summary,
                 started_at AS "startedAt", updated_at AS "updatedAt",
                 completed_at AS "completedAt"`,
      [
        id,
        input.projectId,
        input.goal,
        input.triggerType ?? "USER_GOAL",
        input.triggerId ?? null,
        input.state ?? "UNDERSTANDING",
        input.currentStep ?? "UNDERSTANDING",
        JSON.stringify(input.plan ?? null),
        JSON.stringify(input.contextSnapshot ?? {}),
        input.waitingReason ?? null,
        input.expectedEventType ?? null,
        input.expectedCorrelationId ?? null,
        input.idempotencyKey ?? null,
        input.retryCount ?? 0,
        input.maxRetries ?? 3,
        input.lastError ?? null,
        input.summary ?? null,
      ]
    );
    return this.mapRow(res.rows[0]);
  }

  async updateState(
    id: string,
    state: WorkflowState | string,
    summary?: string | null,
    completedAt?: Date | string | null
  ): Promise<AgentRun | null> {
    let completedTimestamp = completedAt;
    if (
      completedAt === undefined &&
      (state === "COMPLETED" || state === "FAILED" || state === "CANCELLED")
    ) {
      completedTimestamp = new Date().toISOString();
    }

    const res = await query<any>(
      `UPDATE agent_runs
       SET state = $1,
           summary = COALESCE($2, summary),
           completed_at = COALESCE($3, completed_at),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, project_id AS "projectId", goal, trigger_type AS "triggerType",
                 trigger_id AS "triggerId", state, current_step AS "currentStep",
                 plan, context_snapshot AS "contextSnapshot",
                 waiting_reason AS "waitingReason",
                 expected_event_type AS "expectedEventType",
                 expected_correlation_id AS "expectedCorrelationId",
                 idempotency_key AS "idempotencyKey",
                 retry_count AS "retryCount", max_retries AS "maxRetries",
                 last_error AS "lastError", summary,
                 started_at AS "startedAt", updated_at AS "updatedAt",
                 completed_at AS "completedAt"`,
      [state, summary ?? null, completedTimestamp ?? null, id]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async updateWorkflowState(
    id: string,
    updates: Partial<{
      state: WorkflowState | string;
      currentStep: string;
      plan: any;
      contextSnapshot: any;
      waitingReason: string | null;
      expectedEventType: string | null;
      expectedCorrelationId: string | null;
      retryCount: number;
      lastError: string | null;
      summary: string | null;
      completedAt: Date | string | null;
    }>
  ): Promise<AgentRun | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const state = updates.state ?? existing.state;
    let completedTimestamp = updates.completedAt ?? existing.completedAt;
    if (
      updates.completedAt === undefined &&
      (state === "COMPLETED" || state === "FAILED" || state === "CANCELLED") &&
      !existing.completedAt
    ) {
      completedTimestamp = new Date().toISOString();
    }

    const res = await query<any>(
      `UPDATE agent_runs
       SET state = $1,
           current_step = COALESCE($2, current_step),
           plan = COALESCE($3, plan),
           context_snapshot = COALESCE($4, context_snapshot),
           waiting_reason = $5,
           expected_event_type = $6,
           expected_correlation_id = $7,
           retry_count = COALESCE($8, retry_count),
           last_error = $9,
           summary = COALESCE($10, summary),
           completed_at = $11,
           updated_at = NOW()
       WHERE id = $12
       RETURNING id, project_id AS "projectId", goal, trigger_type AS "triggerType",
                 trigger_id AS "triggerId", state, current_step AS "currentStep",
                 plan, context_snapshot AS "contextSnapshot",
                 waiting_reason AS "waitingReason",
                 expected_event_type AS "expectedEventType",
                 expected_correlation_id AS "expectedCorrelationId",
                 idempotency_key AS "idempotencyKey",
                 retry_count AS "retryCount", max_retries AS "maxRetries",
                 last_error AS "lastError", summary,
                 started_at AS "startedAt", updated_at AS "updatedAt",
                 completed_at AS "completedAt"`,
      [
        state,
        updates.currentStep ?? null,
        updates.plan ? JSON.stringify(updates.plan) : null,
        updates.contextSnapshot ? JSON.stringify(updates.contextSnapshot) : null,
        updates.waitingReason !== undefined ? updates.waitingReason : existing.waitingReason,
        updates.expectedEventType !== undefined ? updates.expectedEventType : existing.expectedEventType,
        updates.expectedCorrelationId !== undefined ? updates.expectedCorrelationId : existing.expectedCorrelationId,
        updates.retryCount !== undefined ? updates.retryCount : null,
        updates.lastError !== undefined ? updates.lastError : existing.lastError,
        updates.summary ?? null,
        completedTimestamp ?? null,
        id,
      ]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async addStep(input: CreateAgentStepInput): Promise<AgentStep> {
    const id = input.id ?? crypto.randomUUID();
    const res = await query<AgentStep>(
      `INSERT INTO agent_steps (id, agent_run_id, step_number, step_type, tool_name, input, output, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, agent_run_id AS "agentRunId", step_number AS "stepNumber",
                 step_type AS "stepType", tool_name AS "toolName", input, output, status,
                 created_at AS "createdAt"`,
      [
        id,
        input.agentRunId,
        input.stepNumber,
        input.stepType,
        input.toolName ?? null,
        JSON.stringify(input.input ?? {}),
        JSON.stringify(input.output ?? {}),
        input.status,
      ]
    );
    return res.rows[0];
  }

  async getSteps(agentRunId: string): Promise<AgentStep[]> {
    const res = await query<AgentStep>(
      `SELECT id, agent_run_id AS "agentRunId", step_number AS "stepNumber",
              step_type AS "stepType", tool_name AS "toolName", input, output, status,
              created_at AS "createdAt"
       FROM agent_steps
       WHERE agent_run_id = $1
       ORDER BY step_number ASC`,
      [agentRunId]
    );
    return res.rows;
  }
}

export const agentRunRepository = new AgentRunRepository();
