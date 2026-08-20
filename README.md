# Taskmaster — AI Project Operator

Taskmaster is an AI Project Operator that understands project state, plans work, executes controlled actions, asks for approval on consequential actions, and verifies results.

---

## Milestone 1: PostgreSQL Persistence Layer

Milestone 1 replaces the temporary in-memory data store with a robust, production-ready PostgreSQL persistence layer, complete repository data access layer, deterministic demo fixture seed script, and database-backed Next.js API endpoints.

---

## Prerequisites

- **Node.js**: v20+ (v24 recommended)
- **PostgreSQL**: v14+ (Local instance, Docker, Neon, Supabase, Cloud SQL, etc.)
- **npm**: v10+

---

## Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Configure `DATABASE_URL` in `.env`:

```env
# PostgreSQL connection string
DATABASE_URL=literal:postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require

# Google Gemini API Key (Optional for Milestone 1 - used in subsequent agent milestones)
GEMINI_API_KEY=
```

---

## Database Setup & Migration

Run the full database setup (runs migrations and seeds the demo fixture):

```bash
npm run db:setup
```

Or run steps individually:

### 1. Run Schema Migration
Creates all tables, constraints, foreign keys, and indexes if not already present:
```bash
npm run db:migrate
```

### 2. Seed Deterministic Demo Data
Populates the "Student Marketplace Launch" scenario (17 tasks, 8 dependencies, 4 blockers, 3 deadline risks, and overloaded team member Rahul with 11 tasks):
```bash
npm run db:seed
```

---

## Local Development

Start the Next.js development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Running Tests

Run the automated test suite (verifies database persistence, repositories, API route contracts, constraints, and analysis logic):

```bash
npm test
```

Run TypeScript compilation check:

```bash
npm run typecheck
```

---

## Database Architecture & Domain Model

The database access layer follows a strict layered architecture:

```
Next.js UI / API Routes
         ↓
  Service Layer (`lib/services/`)
         ↓
  Repository Layer (`db/repositories/`)
         ↓
  PostgreSQL Client (`db/client.ts` with Connection Pooling)
         ↓
  PostgreSQL Database (`db/schema.sql`)
```

### Tables

1. **`users`**: Team member profiles and identity records.
2. **`projects`**: Project metadata, deadline, and owner references.
3. **`project_members`**: Many-to-many project membership with roles (`owner`, `member`, `lead`).
4. **`tasks`**: Tasks with statuses (`todo`, `doing`, `review`, `done`), priorities (`low`, `medium`, `high`), assignees, due dates, blocked flags, and parent task references.
5. **`dependencies`**: Directed dependency edges between tasks (`blocks`), enforcing no self-dependencies and uniqueness.
6. **`agent_runs`**: Execution log of AI Agent goals, lifecycle states (`PLANNING`, `WAITING_FOR_APPROVAL`, `COMPLETED`), and operational summaries.
7. **`agent_steps`**: Fine-grained audit log of every step, tool call, input payload, and execution output.
8. **`approvals`**: Human-in-the-loop approval records for high-risk and consequential agent mutations.
9. **`activity_logs`**: Chronological event logs for project timeline and audit trail.

---

## API Endpoints

- `GET /api/projects`: List all active projects.
- `GET /api/projects/:projectId/tasks`: List all tasks for a given project from PostgreSQL.
- `POST /api/projects/:projectId/tasks`: Create a new task in PostgreSQL with typed Zod validation.
- `GET /api/projects/:projectId/analysis`: Computes real-time project risk, blocker count, deadline risks, and bottleneck metrics from PostgreSQL.
