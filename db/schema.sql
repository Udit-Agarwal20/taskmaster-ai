-- Taskmaster PostgreSQL Schema
-- Milestone 1: Core Domain & Agent Persistence
-- Milestone 3A: Durable Event-Driven Workflow Runtime

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  assignee_name TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dependencies (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'blocks',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT no_self_dependency CHECK (task_id <> depends_on_task_id),
  CONSTRAINT unique_dependency UNIQUE (task_id, depends_on_task_id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'USER_GOAL',
  trigger_id TEXT,
  state TEXT NOT NULL,
  current_step TEXT NOT NULL DEFAULT 'UNDERSTANDING',
  plan JSONB,
  context_snapshot JSONB,
  waiting_reason TEXT,
  expected_event_type TEXT,
  expected_correlation_id TEXT,
  idempotency_key TEXT UNIQUE,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  tool_name TEXT,
  input JSONB,
  output JSONB,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  payload JSONB NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}',
  source TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'received',
  linked_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Indexes for performant lookups
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_due_date_idx ON tasks(due_date);
CREATE INDEX IF NOT EXISTS dependencies_task_idx ON dependencies(task_id);
CREATE INDEX IF NOT EXISTS dependencies_depends_idx ON dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS agent_runs_project_idx ON agent_runs(project_id);
CREATE INDEX IF NOT EXISTS agent_runs_state_idx ON agent_runs(state);
CREATE INDEX IF NOT EXISTS agent_runs_idempotency_idx ON agent_runs(idempotency_key);
CREATE INDEX IF NOT EXISTS agent_steps_run_idx ON agent_steps(agent_run_id);
CREATE INDEX IF NOT EXISTS approvals_run_idx ON approvals(agent_run_id);
CREATE INDEX IF NOT EXISTS activity_project_idx ON activity_logs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_project_idx ON events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS events_idempotency_idx ON events(idempotency_key);
CREATE INDEX IF NOT EXISTS events_type_idx ON events(type);
CREATE INDEX IF NOT EXISTS events_linked_run_idx ON events(linked_run_id);
