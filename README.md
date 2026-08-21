# Taskmaster — AI Project Operator

Taskmaster is an AI Project Operator that understands project state, plans work, executes controlled actions, asks for approval on consequential actions, and verifies results.

---

## Milestones Overview

- **Milestone 1**: PostgreSQL Persistence Layer & Repository Pattern (Completed)
- **Milestone 2**: Google ADK + Gemini 3.5 Flash Agent Foundation (Completed)
- **Milestone 3A**: Durable Event-Driven Workflow Runtime (Completed)
- **Milestone 3B**: Controlled Mutation, Policy and Verification (Completed)
- **Milestone 3C**: End-to-End Execution & Approval Hardening (Completed)
- **Milestone 4A**: GitHub Event-Driven Integration (Completed)
- **Milestone 4B**: Async GitHub Events with Pub/Sub + Cloud Run (Completed)

---

## Prerequisites

- **Node.js**: v20+ (v24 recommended)
- **PostgreSQL**: v14+ (Local instance, Docker, Neon, Cloud SQL, or embedded PGlite for tests)
- **npm**: v10+
- **Google Cloud Platform (Optional for local dev, Required for production Pub/Sub & Cloud Run)**:
  - Enabled APIs: `run.googleapis.com`, `pubsub.googleapis.com`

---

## Environment Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Configure environment variables:

```env
# PostgreSQL connection string
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/taskmaster

# Google Gemini API Key
GEMINI_API_KEY=your_gemini_api_key_here

# GitHub Integration Webhook (Milestone 4A & 4B)
GITHUB_WEBHOOK_SECRET=your_github_webhook_secret_here
GITHUB_REPOSITORY=your-org/your-repo
GITHUB_PROJECT_ID=student-marketplace

# Google Cloud Platform & Pub/Sub (Milestone 4B)
GOOGLE_CLOUD_PROJECT_ID=your-gcp-project-id
TASKMASTER_EVENT_TOPIC=taskmaster-events
TASKMASTER_EVENT_SUBSCRIPTION=taskmaster-event-worker

# Server-Controlled Demo Operator Identity & Guardrails
DEMO_OPERATOR_ID=user-udit
MAX_AUTO_ACTIONS_PER_RUN=5
```

---

## Asynchronous Event Architecture (Milestone 4B)

```
GitHub (PR Merged)
       ↓
POST /api/integrations/github/webhook (Fast Synchronous < 50ms)
       ↓
HMAC-SHA256 Timing-Safe Verification (`X-Hub-Signature-256`)
       ↓
Event Normalization & Idempotency Check (`idempotencyKey: github:<delivery-id>`)
       ↓
Persist Event (`status: "queued"`) in PostgreSQL
       ↓
Publish Event Message to Google Cloud Pub/Sub (`taskmaster-events`)
       ↓
HTTP 200 OK (`{ status: "queued", eventId, deliveryId, webhookDurationMs }`)

==================================================
SEPARATE ASYNCHRONOUS EXECUTION PATH:
==================================================

Google Cloud Pub/Sub (`taskmaster-event-worker`)
       ↓
Cloud Run Worker / Push Subscriber (`POST /api/workers/event-worker` or `workers/event-worker.ts`)
       ↓
Idempotency Guard (Acknowledge and skip if already processed)
       ↓
Mark Event `status: "processing"` in PostgreSQL
       ↓
Taskmaster Root Agent Execution (Gemini 3.5 Flash)
       ↓
Deterministic Policy Engine (`create_subtask` -> AUTO / `reassign_task` -> REVIEW)
       ↓
PostgreSQL Mutation & Double Verification
       ↓
Audit Logging (`events`, `agent_steps`, `activity_logs`)
       ↓
Mark Event `status: "processed"` with `linkedRunId`
       ↓
Acknowledge Pub/Sub Message
```

---

## Cloud Run & Pub/Sub Deployment

### 1. Create Pub/Sub Topic and Push Subscription

```bash
# Set your GCP Project
gcloud config set project YOUR_GCP_PROJECT_ID

# Create Topic
gcloud pubsub topics create taskmaster-events

# Create Push Subscription pointing to your Cloud Run Worker endpoint
gcloud pubsub subscriptions create taskmaster-event-worker \
  --topic=taskmaster-events \
  --push-endpoint=https://YOUR_CLOUD_RUN_SERVICE_URL/api/workers/event-worker \
  --ack-deadline=60
```

### 2. Deploy Webhook & Worker Service to Cloud Run

```bash
gcloud run deploy taskmaster \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars DATABASE_URL=...,GEMINI_API_KEY=...,GITHUB_WEBHOOK_SECRET=...,GOOGLE_CLOUD_PROJECT_ID=YOUR_GCP_PROJECT_ID
```

### 3. Configure GitHub Webhook

In your GitHub repository settings:
- **Payload URL**: `https://YOUR_CLOUD_RUN_SERVICE_URL/api/integrations/github/webhook`
- **Content type**: `application/json`
- **Secret**: matching `GITHUB_WEBHOOK_SECRET`
- **Events**: Select `Pull requests` (triggers on `action: closed` and `merged: true`)

---

## Local Development & Testing

### 1. Database Setup & Migration
```bash
npm run db:setup
```

### 2. Run Local Web Server
```bash
npm run dev
```

### 3. Run Local Asynchronous Worker Daemon (Optional for Local Pull Loop)
```bash
npm run worker
```

### 4. Run Test Suites
```bash
npm test
npm run typecheck
npm run build
```

---

## API Endpoints

- `POST /api/integrations/github/webhook`: Fast synchronous GitHub webhook ingestion (publishes to Pub/Sub).
- `POST /api/workers/event-worker`: Cloud Run Pub/Sub Push subscription worker endpoint.
- `POST /api/events`: Internal event ingestion endpoint.
- `POST /api/approvals/:approvalId/resolve`: Resolves pending action approvals with server-controlled operator identity.
- `GET /api/projects/:projectId/tasks`: Retrieves project tasks.
- `GET /api/projects/:projectId/analysis`: Computes real-time project risks, blockers, and bottlenecks.
- `POST /api/projects/:projectId/agent`: Triggers direct agent planning runs.
