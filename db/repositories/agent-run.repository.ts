import { query } from "../client";

export type AgentRun = {
  id: string;
  projectId: string;
  goal: string;
  state: string;
  summary: string | null;
  startedAt: string;
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
  state?: string;
  summary?: string;
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
  async findById(id: string): Promise<AgentRun | null> {
    const res = await query<AgentRun>(
      `SELECT id, project_id AS "projectId", goal, state, summary,
              started_at AS "startedAt", completed_at AS "completedAt"
       FROM agent_runs WHERE id = $1`,
      [id]
    );
    return res.rows[0] ?? null;
  }

  async listByProject(projectId: string): Promise<AgentRun[]> {
    const res = await query<AgentRun>(
      `SELECT id, project_id AS "projectId", goal, state, summary,
              started_at AS "startedAt", completed_at AS "completedAt"
       FROM agent_runs
       WHERE project_id = $1
       ORDER BY started_at DESC`,
      [projectId]
    );
    return res.rows;
  }

  async create(input: CreateAgentRunInput): Promise<AgentRun> {
    const id = input.id ?? crypto.randomUUID();
    const res = await query<AgentRun>(
      `INSERT INTO agent_runs (id, project_id, goal, state, summary)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, project_id AS "projectId", goal, state, summary,
                 started_at AS "startedAt", completed_at AS "completedAt"`,
      [id, input.projectId, input.goal, input.state ?? "PLANNING", input.summary ?? null]
    );
    return res.rows[0];
  }

  async updateState(
    id: string,
    state: string,
    summary?: string,
    completedAt?: Date | string | null
  ): Promise<AgentRun | null> {
    let completedTimestamp = completedAt;
    if (completedAt === undefined && (state === "COMPLETED" || state === "FAILED")) {
      completedTimestamp = new Date().toISOString();
    }

    const res = await query<AgentRun>(
      `UPDATE agent_runs
       SET state = $1,
           summary = COALESCE($2, summary),
           completed_at = COALESCE($3, completed_at)
       WHERE id = $4
       RETURNING id, project_id AS "projectId", goal, state, summary,
                 started_at AS "startedAt", completed_at AS "completedAt"`,
      [state, summary ?? null, completedTimestamp ?? null, id]
    );
    return res.rows[0] ?? null;
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
