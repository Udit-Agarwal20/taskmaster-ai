import { query } from "../client";

export type User = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  createdAt: string;
};

export type CreateUserInput = {
  id?: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
};

export class UserRepository {
  async findById(id: string): Promise<User | null> {
    const res = await query<User>(
      `SELECT id, name, email, avatar_url AS "avatarUrl", created_at AS "createdAt"
       FROM users WHERE id = $1`,
      [id]
    );
    return res.rows[0] ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const res = await query<User>(
      `SELECT id, name, email, avatar_url AS "avatarUrl", created_at AS "createdAt"
       FROM users WHERE email = $1`,
      [email]
    );
    return res.rows[0] ?? null;
  }

  async findByName(name: string): Promise<User | null> {
    const res = await query<User>(
      `SELECT id, name, email, avatar_url AS "avatarUrl", created_at AS "createdAt"
       FROM users WHERE LOWER(name) = LOWER($1)`,
      [name]
    );
    return res.rows[0] ?? null;
  }

  async create(input: CreateUserInput): Promise<User> {
    const id = input.id ?? crypto.randomUUID();
    const res = await query<User>(
      `INSERT INTO users (id, name, email, avatar_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, avatar_url AS "avatarUrl", created_at AS "createdAt"`,
      [id, input.name, input.email, input.avatarUrl ?? null]
    );
    return res.rows[0];
  }

  async upsert(input: CreateUserInput & { id: string }): Promise<User> {
    const res = await query<User>(
      `INSERT INTO users (id, name, email, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, email = EXCLUDED.email, avatar_url = EXCLUDED.avatar_url
       RETURNING id, name, email, avatar_url AS "avatarUrl", created_at AS "createdAt"`,
      [input.id, input.name, input.email, input.avatarUrl ?? null]
    );
    return res.rows[0];
  }

  async list(): Promise<User[]> {
    const res = await query<User>(
      `SELECT id, name, email, avatar_url AS "avatarUrl", created_at AS "createdAt"
       FROM users ORDER BY name ASC`
    );
    return res.rows;
  }
}

export const userRepository = new UserRepository();
