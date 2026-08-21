import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

let pool: Pool | null = null;

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL environment variable is not configured. Please set DATABASE_URL in your .env file."
    );
  }
  return url;
}

export function setPool(customPool: Pool | null): void {
  pool = customPool;
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = getDatabaseUrl();
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      console.error("Unexpected error on idle PostgreSQL client", err.message);
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const p = getPool();
  try {
    return await p.query<T>(text, params);
  } catch (error: any) {
    const sanitizedMsg = error?.message || "Unknown database error";
    // Avoid leaking credentials in errors
    throw new Error(`Database query failed: ${sanitizedMsg}`);
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runSchemaMigration(): Promise<void> {
  const p: any = getPool();

  // Ensure additive columns exist on existing databases BEFORE schema indexes are evaluated
  const additiveSql = `
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'USER_GOAL';
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS trigger_id TEXT;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS current_step TEXT NOT NULL DEFAULT 'UNDERSTANDING';
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS plan JSONB;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS context_snapshot JSONB;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS waiting_reason TEXT;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS expected_event_type TEXT;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS expected_correlation_id TEXT;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS last_error TEXT;
    ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE events ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS last_error TEXT;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS processing_heartbeat_at TIMESTAMPTZ;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS processing_attempt_id TEXT;
  `;

  try {
    if (typeof p.exec === "function") {
      await p.exec(additiveSql);
    } else {
      await p.query(additiveSql);
    }
  } catch {
    // If agent_runs does not exist yet, schema.sql will create it with all columns
  }

  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");
  if (typeof p.exec === "function") {
    await p.exec(sql);
  } else {
    await p.query(sql);
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
