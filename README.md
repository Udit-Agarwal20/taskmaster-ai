# Taskmaster — Event-Driven AI Project Operator

Taskmaster turns real project events into verified follow-through.

After a GitHub change lands, Taskmaster inspects the live project state, reasons over blockers, dependencies, deadlines, and workload, executes safe follow-up actions automatically, pauses consequential actions for human approval, verifies database changes, and communicates the result through Slack.

---

## Live Demo & Production Architecture

- **Live Demo:** [https://taskmaster-service-137377771269.us-central1.run.app](https://taskmaster-service-137377771269.us-central1.run.app)
- **Production Architecture:** Google Cloud Run + Google Cloud Pub/Sub + Vertex AI (`gemini-3.5-flash`) + Neon PostgreSQL + GitHub Webhooks + Slack Web API + Google Secret Manager

---

## Problem

Engineering project boards often drift from real development events. After a pull request is merged, someone still has to manually determine what follow-up work is required, identify downstream blockers, flag overloaded teammates, create safe follow-up tasks, communicate status, and decide whether consequential changes need human approval.

Taskmaster turns that manual coordination step into a durable background workflow.

---

## Core Asynchronous Workflow

```
GitHub (PR Merged)
       ↓
Cloud Run Webhook (POST /api/integrations/github/webhook)
       ↓
HMAC-SHA256 Signature Verification & Idempotency Check
       ↓
Neon PostgreSQL (Event persisted as 'queued')
       ↓
Google Cloud Pub/Sub (taskmaster-events topic)
       ↓
Cloud Run Push Worker (POST /api/workers/event-worker via IAM OIDC)
       ↓
Gemini 3.5 Flash on Vertex AI (Root Agent Reasoning)
       ↓
Project Graph Inspection (Tasks, Dependencies, Workload, Activity)
       ↓
Deterministic Policy Engine
       ├── AUTO Action → Execute in PostgreSQL → Double Verify DB → Post to Slack
       └── REVIEW Action → Pause in WAITING_FOR_APPROVAL → Human Approval → Execute → Verify DB → Post to Slack
       ↓
Audit Trail & Proof of Work Record Committed
```

GitHub webhook ingestion is asynchronous: the webhook endpoint verifies the payload, commits the queued event, publishes a message to Google Cloud Pub/Sub, and immediately responds with HTTP 200 OK without blocking for Gemini planning or execution.

---

## Architecture Diagram

```
+-----------------------------------------------------------------------------+
|                                GitHub PR Merged                             |
+-----------------------------------------------------------------------------+
                                       |
                                       v
+-----------------------------------------------------------------------------+
|                 Cloud Run Webhook (HMAC-SHA256 Verification)                 |
+-----------------------------------------------------------------------------+
                                       |
                                       v
+-----------------------------------------------------------------------------+
|                 Neon PostgreSQL (Event Persisted & Deduped)                  |
+-----------------------------------------------------------------------------+
                                       |
                                       v
+-----------------------------------------------------------------------------+
|                    Google Cloud Pub/Sub (Event Buffer)                      |
+-----------------------------------------------------------------------------+
                                       | (Authenticated IAM OIDC Push)
                                       v
+-----------------------------------------------------------------------------+
|               Cloud Run Worker (Durable Event-Driven Runtime)               |
+-----------------------------------------------------------------------------+
                                       |
                                       v
+-----------------------------------------------------------------------------+
|                   Vertex AI — Gemini 3.5 Flash (@google/adk)                 |
+-----------------------------------------------------------------------------+
                                       |
                                       v
+-----------------------------------------------------------------------------+
|                         Deterministic Policy Engine                         |
+-----------------------------------------------------------------------------+
              |                                               |
     [Policy: AUTO]                                  [Policy: REVIEW]
              |                                               |
              v                                               v
+---------------------------+                   +---------------------------+
|  Autonomous Execution     |                   |  WAITING_FOR_APPROVAL     |
|  (create_subtask)         |                   |  (reassign_task)          |
+---------------------------+                   +---------------------------+
              |                                               |
              |                                               v
              |                                 +---------------------------+
              |                                 |   Human Operator Decision |
              |                                 |   (Command Center UI)     |
              |                                 +---------------------------+
              |                                               |
              +-----------------------+-----------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                 PostgreSQL Mutation & Double State Verification              |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                   Slack Web API Notification (#taskmaster-demo)             |
+-----------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------+
|                   Proof of Work Audit Record & Execution Log                |
+-----------------------------------------------------------------------------+
```

---

## What Gemini Does

During execution, Gemini 3.5 Flash acts through the `@google/adk` framework with read-only access to live project inspection tools:

- `getProjectState`: Fetches project metadata, active sprint status, and risk level.
- `getTasks`: Inspects live project tasks, completion states, assignees, priorities, and blockers.
- `getDependencies`: Analyzes graph dependency links (e.g. Task A blocks Task B).
- `getTeamWorkload`: Evaluates team member task distribution and identifies capacity bottlenecks.
- `getProjectActivity`: Reads recent system, user, and agent activity logs.
- `analyzeProject`: Computes critical path blockers and deadline risks.

Gemini reasons over the live PostgreSQL project graph to diagnose bottlenecks and formulate structured recovery actions. Operational decisions are summarized in structured Proof of Work records; raw model chain-of-thought is never exposed.

---

## Action Policy & Governance

Taskmaster enforces an application-level deterministic policy engine. The model does not have permission to execute unconstrained database mutations.

| Action Type | Policy Level | Requires Approval | Execution Rule |
| :--- | :--- | :--- | :--- |
| `create_subtask` | **AUTO** | No | Safe, non-destructive subtasks execute automatically within the run action cap. |
| `send_slack_message` | **AUTO** | No | Notification sink allowed automatically only after database mutation is verified. |
| `reassign_task` | **REVIEW** | **Yes** | Reassigning task ownership pauses the workflow in `WAITING_FOR_APPROVAL` for human review. |

The application code, not Gemini, authoritatively classifies policies and enforces approval gates. Rejection cleanly aborts the proposed change with zero database mutation.

---

## Proof of Work Layer

Taskmaster makes every operational decision verifiable via a structured Proof of Work model:

$$\text{EVENT} \longrightarrow \text{UNDERSTAND} \longrightarrow \text{DECIDE} \longrightarrow \text{ACT} \longrightarrow \text{VERIFY} \longrightarrow \text{COMMUNICATE}$$

Each Proof of Work record captures 7 operational dimensions:
1. **TRIGGER**: The exact event and source (e.g., GitHub PR merged, user request, workload scan).
2. **WHY**: The concise project graph finding justifying the action.
3. **ACTION**: The exact action type, title, and target parameters.
4. **POLICY**: Authoritative gate classification (`AUTO` vs `REVIEW`).
5. **STATUS**: Real-time lifecycle state (`COMPLETED`, `WAITING_FOR_APPROVAL`, `PENDING`).
6. **VERIFICATION**: Direct PostgreSQL query proof confirming the row was written and state invariants hold.
7. **OUTCOME**: Verified external delivery receipt (e.g., Slack Web API confirmation) or approval pending notice.

---

## Reliability & Safety

- **GitHub Delivery Idempotency**: Normalized delivery keys (`github:<delivery-id>`) prevent duplicate processing of re-sent webhooks.
- **Pub/Sub Worker Idempotency**: Processed event IDs are tracked in PostgreSQL before invoking the agent.
- **Workflow / Run Idempotency**: Identical goals or events return existing active runs without spawning redundant executions.
- **Approval Idempotency**: Resolving an already-resolved approval returns the existing record safely.
- **Lease Recovery & Retries**: Worker leases are timestamped; transient failures retry up to 3 times before transitioning to `FAILED`.
- **Deterministic State Machine**: Strict lifecycle transitions (`UNDERSTANDING` $\rightarrow$ `PLANNING` $\rightarrow$ `WAITING_FOR_APPROVAL` $\rightarrow$ `EXECUTING` $\rightarrow$ `VERIFYING` $\rightarrow$ `COMPLETED`).
- **Post-Mutation Verification**: Direct SQL double-check queries verify database changes before marking steps succeeded.
- **Concurrency Guard**: A strict limit of `MAX_AUTO_ACTIONS_PER_RUN=5` prevents run-away agent loops.
- **Mutation-Guarded Slack Sink**: Slack success messages are blocked if the underlying database mutation failed or remains unverified.

---

## Production Security

- **GitHub Ingestion**: Validated using cryptographic timing-safe HMAC-SHA256 signature verification (`X-Hub-Signature-256`).
- **Pub/Sub Push Delivery**: Authenticated via Google Cloud IAM OIDC bearer tokens verified against Google's public certificates.
- **Vertex AI Authentication**: Uses Google Cloud Application Default Credentials (ADC) attached to the Cloud Run service account with `roles/aiplatform.user`.
- **Secret Management**: Database credentials, Slack tokens, webhook secrets, and verification tokens are stored in **Google Secret Manager** and mounted via `secretKeyRef`. No secrets are committed to Git or baked into container images.

---

## Current Production Stack

| Layer | Technology |
| :--- | :--- |
| **AI model** | Gemini 3.5 Flash |
| **Agent framework** | Google ADK 1.6.0 |
| **AI runtime** | Vertex AI |
| **Compute** | Google Cloud Run |
| **Async messaging** | Google Cloud Pub/Sub |
| **Database** | Neon PostgreSQL |
| **Event source** | GitHub Webhooks |
| **Action sink** | Slack Web API |
| **Secret management** | Google Secret Manager |
| **Validation** | Zod + TypeScript |

---

## Local Development & Setup

### Prerequisites
- Node.js 20+ (v24 recommended)
- npm 10+
- PostgreSQL / Neon-compatible PostgreSQL database

### 1. Installation & Environment Configuration
```bash
cp .env.example .env
npm install
```

Configure your `.env` file with your database connection string and credentials.

### 2. Database Migration & Baseline Setup
```bash
npm run db:setup
```

### 3. Run Development Web Server
```bash
npm run dev
```

### 4. Run Optional Local Worker (For Local Event Pulling)
```bash
npm run worker
```

### 5. Run Test Suite & Build Verification
```bash
npm test
npm run typecheck
npm run build
```

### 6. Reset & Verify Canonical Demo Baseline
```bash
npm run db:demo-reset
npm run demo:verify
npm run demo:evaluate
```

---

## Local Gemini vs Production Vertex AI

Taskmaster supports dual AI runtime configurations:

- **Local Development Fallback:** Set `GEMINI_API_KEY` in `.env` to run the agent locally using the Gemini API.
- **Production Environment (Google Cloud):**
  ```env
  GOOGLE_GENAI_USE_VERTEXAI=true
  GOOGLE_CLOUD_PROJECT=gen-lang-client-0057923797
  GOOGLE_CLOUD_LOCATION=global
  TASKMASTER_MODEL=gemini-3.5-flash
  ```
  Production utilizes Vertex AI with Google Cloud Application Default Credentials (ADC) attached to the Cloud Run runtime service account, eliminating reliance on individual API keys.

---

## Environment Variables

| Variable | Description | Location |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string (`?sslmode=require`) | Secret Manager / `.env` |
| `GEMINI_API_KEY` | Optional local fallback for Gemini API-key authentication; production uses Vertex AI + ADC. | Secret Manager / `.env` |
| `GOOGLE_GENAI_USE_VERTEXAI` | Set to `true` to route inference through Vertex AI | Cloud Run Environment |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud Project ID for Vertex AI | Cloud Run Environment |
| `GOOGLE_CLOUD_LOCATION` | Region for Vertex AI (`global` or `us-central1`) | Cloud Run Environment |
| `TASKMASTER_MODEL` | Production Gemini model identifier (`gemini-3.5-flash`) | Cloud Run Environment |
| `GITHUB_WEBHOOK_SECRET` | HMAC-SHA256 secret for validating GitHub webhooks | Secret Manager / `.env` |
| `GITHUB_REPOSITORY` | Target repository (e.g. `Udit-Agarwal20/taskmaster-ai`) | Cloud Run Environment |
| `GITHUB_PROJECT_ID` | Project identifier for event correlation (`student-marketplace`) | Cloud Run Environment |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-...`) | Secret Manager / `.env` |
| `SLACK_CHANNEL_ID` | Target Slack notification channel ID | Secret Manager / `.env` |
| `TASKMASTER_EVENT_TOPIC` | Pub/Sub topic name (`taskmaster-events`) | Cloud Run Environment |
| `TASKMASTER_EVENT_SUBSCRIPTION` | Pub/Sub subscription name | Cloud Run Environment |
| `PUBSUB_INVOKER_SERVICE_ACCOUNT`| Service account email authorized for OIDC push | Cloud Run Environment |
| `PUBSUB_VERIFICATION_TOKEN` | Local/legacy verification token; production worker authentication uses Google IAM/OIDC. | Secret Manager / `.env` |
| `DEMO_OPERATOR_ID` | Server-controlled default operator identity | Cloud Run Environment |
| `MAX_AUTO_ACTIONS_PER_RUN` | Maximum number of AUTO actions permitted per workflow run. | Cloud Run Environment |

---

## GitHub Webhook Integration

- **Endpoint:** `POST /api/integrations/github/webhook`
- **Supported Events:** `pull_request` (specifically `action: "closed"` with `merged: true`)
- **Security:** Verifies `X-Hub-Signature-256` using timing-safe HMAC validation.
- **Deduplication:** Evaluates `X-GitHub-Delivery` to discard duplicate webhook deliveries.

---

## API Endpoints Catalog

- `GET /api/projects/:projectId/tasks` — Retrieves live project tasks from PostgreSQL.
- `GET /api/projects/:projectId/analysis` — Returns live project risk analysis, blockers, bottlenecks, and action explanations.
- `POST /api/projects/:projectId/agent` — Triggers an on-demand agent planning run.
- `POST /api/integrations/github/webhook` — Fast asynchronous GitHub webhook ingestion endpoint.
- `POST /api/workers/event-worker` — Authenticated Cloud Run worker endpoint for Pub/Sub push messages.
- `POST /api/events` — Internal event ingestion and deduplication endpoint.
- `GET /api/workflows` — Fetches durable workflow execution history and lifecycle progressions.
- `POST /api/workflows/:runId/resume` — Resumes an event-waiting or paused workflow run.
- `POST /api/approvals/:approvalId/resolve` — Resolves pending action approvals (`approve` or `reject`).
- `GET /api/integrations/status` — Reports real-time connection status for GitHub, Vertex AI, Pub/Sub, Neon DB, and Slack.

---

## Controlled Demo Dataset

Taskmaster demonstrates its operational follow-through on the **Student Marketplace Launch** demo environment:

- **17 Tasks**: Realistically modeled engineering deliverables.
- **8 Dependencies**: Cross-task blocking relationships (e.g. pricing blocks payment integration).
- **4 Blockers**: Critical path blocks threatening the release.
- **3 Deadline Risks**: Immediate deliverable risks due for Friday launch.
- **Primary Bottleneck**: Developer **Rahul** assigned 11 active tasks (68.75% of active project load).
- **Overall Project Risk**: `HIGH`.

Running `npm run db:demo-reset` deterministically restores this dataset.

---

## Demonstration Scenarios

### Scenario A: Autonomous Hero Flow (Zero Human Intervention)
1. A pull request (e.g. PR #8 "Complete payment webhook integration") is merged on GitHub.
2. Cloud Run Webhook receives the event and queues it in Pub/Sub.
3. Cloud Run Push Worker invokes Gemini 3.5 Flash on Vertex AI.
4. Agent diagnoses that the merged webhook implementation requires staging validation.
5. Deterministic Policy Engine classifies `create_subtask` as `AUTO`.
6. Subtask "Verify payment webhook in staging" is created in PostgreSQL and double-verified.
7. Slack notification is delivered to `#taskmaster-demo` with the audit receipt.
8. Workflow transitions to `COMPLETED`.

### Scenario B: Governed Approval Flow (Human-in-the-Loop)
1. Project workload analysis detects Rahul's 11-task bottleneck stalling launch progress.
2. Gemini 3.5 Flash proposes `reassign_task` to transfer Task #9 from Rahul to Arjun to relieve the workload bottleneck.
3. Deterministic Policy Engine flags reassignment as `REVIEW` (`requiresApproval: true`).
4. Workflow pauses in `WAITING_FOR_APPROVAL` and renders the pending approval in the Command Center.
5. Lead Engineer reviews the proposed reassignment and clicks **✓ Approve & Execute**.
6. Cloud Run executes the mutation in PostgreSQL and confirms row update via direct query.
7. Slack notification is delivered to `#taskmaster-demo`.
8. Workflow completes with full audit receipts.

---

## Verification & Testing Suite

```bash
npm test && npm run typecheck && npm run build && npm run demo:verify && npm run demo:evaluate
```

- **96 / 96 automated tests passing** across 12 test suites.
- **0 TypeScript errors** (`tsc --noEmit`).
- **Production Next.js build succeeds** cleanly in Turbopack.
- **100% deterministic safety assertions pass** in `agent/evaluate_demo.ts`.

---

## Repository Structure

```
taskmaster/
├── agent/            # ADK agent definition, executor, tools, and policy engine
├── app/              # Next.js App Router (Command Center, Tasks, Workflows, Integrations, APIs)
├── components/       # UI components (AppShell, ActionExplanationPanel, TaskBoard)
├── db/               # PostgreSQL schema migrations, client, repositories, and demo seeder
├── lib/              # Integrations (GitHub, Slack, Pub/Sub), models, and utilities
├── scripts/          # Evaluation, verification, and live test automation scripts
├── tests/            # 12 unit and integration test suites (96 tests)
└── workers/          # Pub/Sub background event worker daemon
```

---

## Production Google Cloud Deployment Overview

Production deployments utilize secure infrastructure practices via Google Cloud CLI:

1. **Enable Google Cloud APIs:**
   ```bash
   gcloud services enable run.googleapis.com pubsub.googleapis.com secretmanager.googleapis.com aiplatform.googleapis.com
   ```
2. **Create Secrets in Google Secret Manager:**
   Store `DATABASE_URL`, `GEMINI_API_KEY`, `GITHUB_WEBHOOK_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`, and `PUBSUB_VERIFICATION_TOKEN` in Secret Manager.
3. **Build & Deploy Cloud Run Service:**
   Deploy the application container with secrets mounted via `secretKeyRef` and Vertex AI enabled.
4. **Create Google Cloud Pub/Sub Topic & Push Subscription:**
   Configure `taskmaster-events` topic and push subscription pointing to `/api/workers/event-worker` with IAM OIDC authentication.
5. **Configure GitHub Webhook:**
   Set the repository webhook payload URL to `https://<YOUR-SERVICE-URL>/api/integrations/github/webhook`.

---

## Final Notes

Taskmaster demonstrates a focused, single-project autonomous coordination workflow using the Student Marketplace Launch demo project. The architecture is engineered as a decoupled event-driven daemon designed to turn real development lifecycle events into verified operational follow-through.
