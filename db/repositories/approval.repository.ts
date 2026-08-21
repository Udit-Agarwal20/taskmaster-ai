import { query } from "../client";

export type Approval = {
  id: string;
  agentRunId: string;
  action: string;
  payload: any;
  riskLevel: string;
  status: "pending" | "approved" | "rejected";
  approvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type CreateApprovalInput = {
  id?: string;
  agentRunId: string;
  action: string;
  payload: any;
  riskLevel: string;
  status?: "pending" | "approved" | "rejected";
  approvedBy?: string | null;
};

export class ApprovalRepository {
  private mapRow(row: any): Approval {
    return {
      id: row.id,
      agentRunId: row.agentRunId,
      action: row.action,
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
      riskLevel: row.riskLevel,
      status: row.status,
      approvedBy: row.approvedBy ?? null,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt ?? null,
    };
  }

  async findById(id: string): Promise<Approval | null> {
    const res = await query<any>(
      `SELECT id, agent_run_id AS "agentRunId", action, payload,
              risk_level AS "riskLevel", status, approved_by AS "approvedBy",
              created_at AS "createdAt", resolved_at AS "resolvedAt"
       FROM approvals WHERE id = $1`,
      [id]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async listByRun(agentRunId: string): Promise<Approval[]> {
    const res = await query<any>(
      `SELECT id, agent_run_id AS "agentRunId", action, payload,
              risk_level AS "riskLevel", status, approved_by AS "approvedBy",
              created_at AS "createdAt", resolved_at AS "resolvedAt"
       FROM approvals
       WHERE agent_run_id = $1
       ORDER BY created_at ASC`,
      [agentRunId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  async listPendingByProject(projectId: string): Promise<Approval[]> {
    const res = await query<any>(
      `SELECT a.id, a.agent_run_id AS "agentRunId", a.action, a.payload,
              a.risk_level AS "riskLevel", a.status, a.approved_by AS "approvedBy",
              a.created_at AS "createdAt", a.resolved_at AS "resolvedAt"
       FROM approvals a
       JOIN agent_runs ar ON a.agent_run_id = ar.id
       WHERE ar.project_id = $1 AND a.status = 'pending'
       ORDER BY a.created_at ASC`,
      [projectId]
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  async create(input: CreateApprovalInput): Promise<Approval> {
    const id = input.id ?? crypto.randomUUID();
    const res = await query<any>(
      `INSERT INTO approvals (id, agent_run_id, action, payload, risk_level, status, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, agent_run_id AS "agentRunId", action, payload,
                 risk_level AS "riskLevel", status, approved_by AS "approvedBy",
                 created_at AS "createdAt", resolved_at AS "resolvedAt"`,
      [
        id,
        input.agentRunId,
        input.action,
        JSON.stringify(input.payload),
        input.riskLevel,
        input.status ?? "pending",
        input.approvedBy ?? null,
      ]
    );
    return this.mapRow(res.rows[0]);
  }

  async resolve(
    id: string,
    status: "approved" | "rejected",
    approvedBy?: string
  ): Promise<Approval | null> {
    let validUserId: string | null = null;
    if (approvedBy) {
      const userRes = await query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1 OR LOWER(name) = LOWER($1) LIMIT 1`,
        [approvedBy]
      );
      if (userRes.rows[0]) {
        validUserId = userRes.rows[0].id;
      }
    }

    const res = await query<any>(
      `UPDATE approvals
       SET status = $1,
           approved_by = COALESCE($2, approved_by),
           resolved_at = NOW()
       WHERE id = $3
       RETURNING id, agent_run_id AS "agentRunId", action, payload,
                 risk_level AS "riskLevel", status, approved_by AS "approvedBy",
                 created_at AS "createdAt", resolved_at AS "resolvedAt"`,
      [status, validUserId, id]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }
}

export const approvalRepository = new ApprovalRepository();
