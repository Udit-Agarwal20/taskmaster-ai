# Taskmaster — AI Project Operator

Taskmaster is an AI Project Operator that understands project state, plans work, executes controlled actions, asks for approval on consequential actions, and verifies results.

---

## Milestones Overview

- **Milestone 1**: PostgreSQL Persistence Layer & Repository Pattern (Completed)
- **Milestone 2**: Google ADK + Gemini 3.5 Flash Agent Foundation (Completed)

---

## Prerequisites

- **Node.js**: v20+ (v24 recommended)
- **PostgreSQL**: v14+ (Local instance, Docker, Neon, Supabase, Cloud SQL, or embedded PGlite for tests)
- **npm**: v10+

---

## Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Configure environment variables:

```env
# PostgreSQL connection string (Required for Taskmaster persistence)
DATABASE_URL=literal:postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require

# Google Gemini API Key (Required for Milestone 2 - Gemini 3.5 Flash Agent Foundation)
GEMINI_API_KEY=your_gemini_api_key_here
```

---

## Database Setup & Migration

Run the full database setup (runs migrations and seeds the demo fixture):

```bash
npm run db:setup
```

Or run steps individually:

### 1. Run Schema Migration
Creates all tables, constraints, foreign keys, and indexes:
```bash
npm run db:migrate
```

### 2. Seed Deterministic Demo Data
Populates the "Student Marketplace Launch" scenario (17 tasks, 8 dependencies, 4 blockers, 3 deadline risks, and overloaded team member Rahul with 11 tasks):
```bash
npm run db:seed
```

---

## Agent Architecture (Milestone 2)

Milestone 2 establishes the **Taskmaster Root Agent** using the official Google Agent Development Kit (`@google/adk`) and Gemini 3.5 Flash (`gemini-3.5-flash`):

```
User Request ("Get this project back on track.")
       ↓
Next.js Agent Endpoint (`POST /api/projects/:projectId/agent`)
       ↓
Taskmaster Agent Executor (`agent/executor.ts`)
       ↓ [State: UNDERSTANDING]
Google ADK Runner (`InMemoryRunner`) + Root Agent (`LlmAgent`)
       ↓
Gemini 3.5 Flash (`gemini-3.5-flash`)
       ↓
ADK Read-Only Function Tools
  ├── getProjectState
  ├── getTasks
  ├── getDependencies
  ├── getTeamWorkload
  ├── getProjectActivity
  └── analyzeProject (Deterministic Service)
       ↓
Repository Layer (`db/repositories/`)
       ↓
PostgreSQL Database (`tasks`, `dependencies`, etc.)
       ↓ [State: PLANNING]
Step Logging (`agent_steps` in PostgreSQL)
       ↓
Structured Output: RecoveryPlan JSON Schema
       ↓ [State: COMPLETED]
Save Result to `agent_runs` & Return to UI
```

### Read-Only Tools (No Mutations in Milestone 2)

1. **`getProjectState`**: Reads project metadata, status, deadline, owner, and team members.
2. **`getTasks`**: Reads tasks for a project with optional filtering by status and assignee.
3. **`getDependencies`**: Reads task dependency edges (`blocks`) and critical path relationships.
4. **`getTeamWorkload`**: Aggregates active task count and workload distribution across all team members.
5. **`getProjectActivity`**: Retrieves recent audit events from `activity_logs`.
6. **`analyzeProject`**: Exposes deterministic facts (risk level, blockers, deadline risks, workload bottleneck).

### Structured Recovery Plan Schema

The agent returns a strongly-typed recovery plan adhering to `RecoveryPlanSchema`:

```json
{
  "projectId": "student-marketplace",
  "summary": "High-level summary of findings and proposed remedy",
  "riskLevel": "high",
  "findings": [
    {
      "type": "blocker",
      "title": "Pricing approval blocks payment integration",
      "explanation": "Task 1 (Pricing approval) is blocking Task 2 (Payment integration).",
      "relatedTaskIds": ["1", "2"]
    }
  ],
  "proposedActions": [
    {
      "actionType": "reassign_task",
      "targetIds": ["4"],
      "reason": "Reassign Analytics events from Rahul to Maya to relieve bottleneck.",
      "riskLevel": "medium"
    }
  ],
  "requiresApproval": true
}
```

---

## Local Agent Verification

Verify read-only tools, deterministic analysis, and Gemini agent planning from the terminal:

```bash
npm run agent:verify
```

---

## Development & Testing

Start the Next.js development server:

```bash
npm run dev
```

Run the automated test suite (25 tests covering repositories, database persistence, API contracts, ADK tools, schemas, and agent execution):

```bash
npm test
```

Run TypeScript compilation check:

```bash
npm run typecheck
```

Build for production:

```bash
npm run build
```

---

## API Endpoints

- `GET /api/projects`: List all active projects.
- `GET /api/projects/:projectId/tasks`: List all tasks for a given project from PostgreSQL.
- `POST /api/projects/:projectId/tasks`: Create a new task in PostgreSQL with typed Zod validation.
- `GET /api/projects/:projectId/analysis`: Computes real-time project risk, blocker count, deadline risks, and bottleneck metrics from PostgreSQL.
- `POST /api/projects/:projectId/agent`: Executes the Taskmaster Google ADK agent for a specific project goal and records the agent run in PostgreSQL.
- `POST /api/agent`: Global endpoint routing to the demo project's agent executor.
