import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { PGlite } from "@electric-sql/pglite";
import { setPool, closePool, runSchemaMigration } from "../db/client";
import { seed, DEMO_PROJECT_ID } from "../db/seed";
import { eventRepository, agentRunRepository } from "../db/repositories";
import { publishTaskmasterEvent, subscribeLocalPubSub, PubSubEventMessage } from "../lib/cloud/pubsub";
import { processPubSubWorkerMessage } from "../lib/cloud/worker";
import * as webhookRoute from "../app/api/integrations/github/webhook/route";
import * as pushWorkerRoute from "../app/api/workers/event-worker/route";
import { NextRequest } from "next/server";

describe("Milestone 4B: Async GitHub Events with Pub/Sub + Cloud Run", () => {
  let pglite: PGlite;
  const TEST_SECRET = "test-github-secret-key-12345";

  before(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = TEST_SECRET;
    process.env.GITHUB_PROJECT_ID = DEMO_PROJECT_ID;

    pglite = new PGlite();
    await pglite.waitReady;

    const pgAdapter: any = {
      query: async (text: string, params?: any[]) => {
        const res = await pglite.query(text, params);
        return {
          rows: res.rows,
          rowCount: res.affectedRows ?? res.rows.length,
          command: "",
          oid: 0,
          fields: res.fields,
        };
      },
      exec: async (sql: string) => {
        await pglite.exec(sql);
      },
      connect: async () => ({
        query: async (text: string, params?: any[]) => {
          const res = await pglite.query(text, params);
          return {
            rows: res.rows,
            rowCount: res.affectedRows ?? res.rows.length,
            command: "",
            oid: 0,
            fields: res.fields,
          };
        },
        release: () => {},
      }),
      end: async () => {
        await pglite.close();
      },
      on: () => {},
    };

    setPool(pgAdapter);
    await runSchemaMigration();
    await seed();
  });

  after(async () => {
    await closePool();
  });

  function signPayload(payload: string, secret = TEST_SECRET): string {
    const hmac = crypto.createHmac("sha256", secret);
    return "sha256=" + hmac.update(payload).digest("hex");
  }

  it("1. Webhook returns fast synchronous 'queued' response without blocking for Gemini", async () => {
    const payload = {
      action: "closed",
      pull_request: {
        number: 88,
        title: "Fast Webhook PR",
        merged: true,
        head: { ref: "feature/fast-ingest" },
        base: { ref: "main" },
      },
      repository: { full_name: "test-org/student-marketplace" },
    };
    const rawBody = JSON.stringify(payload);
    const deliveryId = "del-fast-ingest-88";
    const signature = signPayload(rawBody);

    const req = new NextRequest("http://localhost:3000/api/integrations/github/webhook", {
      method: "POST",
      body: rawBody,
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": deliveryId,
        "x-hub-signature-256": signature,
      },
    });

    const res = await webhookRoute.POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.status, "queued");
    assert.ok(data.eventId);
    assert.equal(data.deliveryId, deliveryId);
    assert.ok(typeof data.webhookDurationMs === "number");
    assert.ok(data.webhookDurationMs < 200, `Webhook duration was ${data.webhookDurationMs}ms (must be fast)`);

    // Verify persisted event has status 'queued' initially
    const persisted = await eventRepository.findById(data.eventId);
    assert.ok(persisted);
    assert.equal(persisted?.status, "queued");
    assert.equal(persisted?.idempotencyKey, `github:${deliveryId}`);
  });

  it("2 & 3. Pub/Sub publisher produces message and worker consumes it asynchronously", async () => {
    const event = await eventRepository.create({
      type: "GITHUB_PULL_REQUEST_MERGED",
      projectId: DEMO_PROJECT_ID,
      source: "github",
      idempotencyKey: "test-pubsub-event-1",
      payload: {
        pullRequestNumber: 99,
        title: "Async Worker Test PR",
        targetBranch: "main",
      },
      status: "queued",
    });

    let receivedMsg: PubSubEventMessage | null = null;
    const unsubscribe = subscribeLocalPubSub(async (msg) => {
      receivedMsg = msg;
    });

    const pubResult = await publishTaskmasterEvent(event);
    assert.equal(pubResult.success, true);
    assert.ok(pubResult.messageId);

    // Wait for in-memory dispatch
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(receivedMsg);
    assert.equal((receivedMsg as any)?.eventId, event.id);
    assert.equal((receivedMsg as any)?.eventType, "GITHUB_PULL_REQUEST_MERGED");

    unsubscribe();
  });

  it("4. Worker processes event, marks status 'processed', and links workflow run", async () => {
    const event = await eventRepository.create({
      type: "GITHUB_PULL_REQUEST_MERGED",
      projectId: DEMO_PROJECT_ID,
      source: "github",
      idempotencyKey: "test-worker-exec-1",
      payload: {
        pullRequestNumber: 77,
        title: "Worker Processing PR",
        targetBranch: "main",
      },
      status: "queued",
    });

    const workerResult = await processPubSubWorkerMessage({
      eventId: event.id,
      eventType: event.type,
      projectId: event.projectId,
      source: event.source,
      idempotencyKey: event.idempotencyKey,
      payload: event.payload,
      publishedAt: new Date().toISOString(),
    });

    assert.equal(workerResult.success, true);
    assert.equal(workerResult.status, "processed");
    assert.ok(workerResult.runId);

    // Verify DB state updated
    const updatedEvent = await eventRepository.findById(event.id);
    assert.equal(updatedEvent?.status, "processed");
    assert.ok(updatedEvent?.processedAt);
    assert.equal(updatedEvent?.linkedRunId, workerResult.runId);
  });

  it("5. Worker is idempotent: redelivered message for processed event is safely acknowledged without duplicate run", async () => {
    // 1. Ingest event
    const event = await eventRepository.create({
      type: "GITHUB_PULL_REQUEST_MERGED",
      projectId: DEMO_PROJECT_ID,
      source: "github",
      idempotencyKey: "test-redelivery-1",
      payload: {
        pullRequestNumber: 66,
        title: "Redelivery Test PR",
        targetBranch: "main",
      },
      status: "queued",
    });

    // 2. First worker execution
    const firstResult = await processPubSubWorkerMessage({
      eventId: event.id,
      eventType: event.type,
      projectId: event.projectId,
    });
    assert.equal(firstResult.status, "processed");
    const originalRunId = firstResult.runId;

    // 3. Second worker execution (Pub/Sub redelivery)
    const secondResult = await processPubSubWorkerMessage({
      eventId: event.id,
      eventType: event.type,
      projectId: event.projectId,
    });
    assert.equal(secondResult.status, "already_processed");
    assert.equal(secondResult.runId, originalRunId);
  });

  it("6. Cloud Run Push Subscriber endpoint (POST /api/workers/event-worker) decodes base64 and processes event", async () => {
    const event = await eventRepository.create({
      type: "GITHUB_PULL_REQUEST_MERGED",
      projectId: DEMO_PROJECT_ID,
      source: "github",
      idempotencyKey: "test-cloud-run-push-1",
      payload: {
        pullRequestNumber: 55,
        title: "Cloud Run Push PR",
        targetBranch: "main",
      },
      status: "queued",
    });

    const pubsubMessageData = {
      eventId: event.id,
      eventType: event.type,
      projectId: event.projectId,
    };
    const base64Data = Buffer.from(JSON.stringify(pubsubMessageData)).toString("base64");

    const pushEnvelope = {
      message: {
        data: base64Data,
        messageId: "msg-push-123",
        publishTime: new Date().toISOString(),
      },
      subscription: "projects/test/subscriptions/taskmaster-event-worker",
    };

    const req = new NextRequest("http://localhost:3000/api/workers/event-worker", {
      method: "POST",
      body: JSON.stringify(pushEnvelope),
    });

    const res = await pushWorkerRoute.POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.status, "processed");
    assert.ok(data.runId);

    const updatedEvent = await eventRepository.findById(event.id);
    assert.equal(updatedEvent?.status, "processed");
  });
});
