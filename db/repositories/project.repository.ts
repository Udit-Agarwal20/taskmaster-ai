import { query } from "../client";

export type Project = {
  id: string;
  name: string;
  description: string;
  deadline: string;
  status: string;
  ownerId: string;
  members: string[];
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectInput = {
  id?: string;
  name: string;
  description?: string;
  deadline?: string;
  status?: string;
  ownerId: string;
  members?: string[];
};

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  deadline: string | null;
  status: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

export class ProjectRepository {
  async findById(id: string): Promise<Project | null> {
    const projectRes = await query<ProjectRow>(
      `SELECT id, name, description, deadline, status,
              owner_id AS "ownerId", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM projects WHERE id = $1`,
      [id]
    );

    const row = projectRes.rows[0];
    if (!row) return null;

    const membersRes = await query<{ name: string }>(
      `SELECT u.name
       FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = $1
       ORDER BY pm.role DESC, u.name ASC`,
      [id]
    );

    const members = membersRes.rows.map((r) => r.name);
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      deadline: row.deadline ?? "",
      status: row.status,
      ownerId: row.ownerId,
      members,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async list(): Promise<Project[]> {
    const projectsRes = await query<ProjectRow>(
      `SELECT id, name, description, deadline, status,
              owner_id AS "ownerId", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM projects ORDER BY created_at ASC`
    );

    const projects: Project[] = [];
    for (const row of projectsRes.rows) {
      const membersRes = await query<{ name: string }>(
        `SELECT u.name
         FROM project_members pm
         JOIN users u ON pm.user_id = u.id
         WHERE pm.project_id = $1
         ORDER BY pm.role DESC, u.name ASC`,
        [row.id]
      );
      projects.push({
        id: row.id,
        name: row.name,
        description: row.description ?? "",
        deadline: row.deadline ?? "",
        status: row.status,
        ownerId: row.ownerId,
        members: membersRes.rows.map((r) => r.name),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }

    return projects;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const id = input.id ?? crypto.randomUUID();
    const res = await query<ProjectRow>(
      `INSERT INTO projects (id, name, description, deadline, status, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, deadline, status,
                 owner_id AS "ownerId", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        input.name,
        input.description ?? "",
        input.deadline ?? "",
        input.status ?? "active",
        input.ownerId,
      ]
    );

    // Add owner as a member if not already
    await query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (project_id, user_id) DO NOTHING`,
      [id, input.ownerId]
    );

    const row = res.rows[0];
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      deadline: row.deadline ?? "",
      status: row.status,
      ownerId: row.ownerId,
      members: input.members ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async upsert(input: CreateProjectInput & { id: string }): Promise<Project> {
    const res = await query<ProjectRow>(
      `INSERT INTO projects (id, name, description, deadline, status, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           deadline = EXCLUDED.deadline,
           status = EXCLUDED.status,
           owner_id = EXCLUDED.owner_id,
           updated_at = NOW()
       RETURNING id, name, description, deadline, status,
                 owner_id AS "ownerId", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        input.id,
        input.name,
        input.description ?? "",
        input.deadline ?? "",
        input.status ?? "active",
        input.ownerId,
      ]
    );

    await query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (project_id, user_id) DO NOTHING`,
      [input.id, input.ownerId]
    );

    const row = res.rows[0];
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      deadline: row.deadline ?? "",
      status: row.status,
      ownerId: row.ownerId,
      members: input.members ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async addMember(projectId: string, userId: string, role = "member"): Promise<void> {
    await query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [projectId, userId, role]
    );
  }

  async getMembers(
    projectId: string
  ): Promise<Array<{ id: string; name: string; email: string; role: string }>> {
    const res = await query<{ id: string; name: string; email: string; role: string }>(
      `SELECT u.id, u.name, u.email, pm.role
       FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = $1
       ORDER BY pm.role DESC, u.name ASC`,
      [projectId]
    );
    return res.rows;
  }
}

export const projectRepository = new ProjectRepository();
