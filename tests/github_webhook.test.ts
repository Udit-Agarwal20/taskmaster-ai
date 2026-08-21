import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { PGlite } from "@electric-sql/pglite";
import { setPool, closePool, runSchemaMigration } from "../db/client";
import { seed, DEMO_PROJECT_ID } from "../db/seed";
import {
  verifyGitHubWebhookSignature,
  normalizeGitHubWebhook,
  getGitHubProjectMapping,
} from "../lib/integrations/github/webhook";
import { eventRepository, taskRepository, agentRunRepository } from "../db/repositories";
import * as webhookRoute from "../app/api/integrations/github/webhook/route";
import { NextRequest } from "next/server";

describe("Milestone 4A: GitHub Event-Driven Integration", () => {
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

  // --- Signature Verification Tests ---
  it("2 & 3. Missing or invalid signature is rejected with 401", async () => {
    const body = JSON.stringify({ action: "closed" });

    // Missing signature
    const reqMissing = new NextRequest("http://localhost:3000/api/integrations/github/webhook", {
      method: "POST",
      body,
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "del-missing-sig",
      },
    });
    const resMissing = await webhookRoute.POST(reqMissing);
    assert.equal(resMissing.status, 401);
    const bodyMissing = await resMissing.json();
    assert.ok(bodyMissing.error.includes("Invalid or missing"));

    // Invalid signature
    const reqInvalid = new NextRequest("http://localhost:3000/api/integrations/github/webhook", {
      method: "POST",
      body,
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "del-invalid-sig",
        "x-hub-signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      },
    });
    const resInvalid = await webhookRoute.POST(reqInvalid);
    assert.equal(resInvalid.status, 401);
  });

  it("4. Correct HMAC-SHA256 signature is accepted with timing-safe comparison", () => {
    const rawBody = JSON.stringify({ test: "data", pr: 42 });
    const validSignature = signPayload(rawBody, TEST_SECRET);

    assert.equal(verifyGitHubWebhookSignature(rawBody, validSignature, TEST_SECRET), true);
    assert.equal(verifyGitHubWebhookSignature(rawBody, "sha256=invalid", TEST_SECRET), false);
    assert.equal(verifyGitHubWebhookSignature(rawBody, null, TEST_SECRET), false);
  });

  // --- Event Filtering & Normalization Tests ---
  it("5. pull_request with merged = false is safely ignored", async () => {
    const payload = {
      action: "closed",
      pull_request: {
        number: 101,
        title: "Closed without merge",
        merged: false,
      },
      repository: { full_name: "test-org/student-marketplace" },
    };
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody);

    const req = new NextRequest("http://localhost:3000/api/integrations/github/webhook", {
      method: "POST",
      body: rawBody,
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "del-unmerged-pr",
        "x-hub-signature-256": signature,
      },
    });

    const res = await webhookRoute.POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "ignored");
    assert.ok(data.reason.includes("merged=false"));
  });

  it("6. Non-closed pull_request action (opened) is safely ignored", async () => {
    const payload = {
      action: "opened",
      pull_request: {
        number: 102,
        title: "Newly opened PR",
        merged: false,
      },
      repository: { full_name: "test-org/student-marketplace" },
    };
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody);

    const req = new NextRequest("http://localhost:3000/api/integrations/github/webhook", {
      method: "POST",
      body: rawBody,
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "del-opened-pr",
        "x-hub-signature-256": signature,
      },
    });

    const res = await webhookRoute.POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "ignored");
  });

  it("14. Non-pull_request GitHub event (e.g. issues, push) is safely ignored", async () => {
    const payload = { action: "opened", issue: { number: 5 } };
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody);

    const req = new NextRequest("http://localhost:3000/api/integrations/github/webhook", {
      method: "POST",
      body: rawBody,
      headers: {
        "x-github-event": "issues",
        "x-github-delivery": "del-issues-event",
        "x-hub-signature-256": signature,
      },
    });

    const res = await webhookRoute.POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "ignored");
  });

  // --- End-to-End Ingestion & Processing Tests ---
  it("1, 8, 9, 10, 11. Valid GitHub PR merged webhook normalizes, persists, and creates workflow", async () => {
    const payload = {
      action: "closed",
      pull_request: {
        number: 42,
        title: "Payment Webhook Integration",
        merged: true,
        head: { ref: "feature/payment-webhook" },
        base: { ref: "main" },
        merged_by: { login: "octocat" },
        merged_at: "2026-08-21T10:00:00Z",
      },
      repository: { full_name: "taskmaster-org/student-marketplace" },
    };
    const rawBody = JSON.stringify(payload);
    const deliveryId = "delivery-pr-merged-42";
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
    assert.ok(data.deliveryId);

    // 8. Verify normalized event persisted in events table with status 'queued'
    const persistedEvent = await eventRepository.findById(data.eventId);
    assert.ok(persistedEvent);
    assert.equal(persistedEvent?.type, "GITHUB_PULL_REQUEST_MERGED");
    assert.equal(persistedEvent?.source, "github");
    assert.equal(persistedEvent?.idempotencyKey, `github:${deliveryId}`);
    assert.equal(persistedEvent?.projectId, DEMO_PROJECT_ID);
    assert.equal(persistedEvent?.status, "queued");

    // Execute async worker to process the queued event
    const { processPubSubWorkerMessage } = await import("../lib/cloud/worker");
    const workerRes = await processPubSubWorkerMessage({
      eventId: data.eventId,
      eventType: persistedEvent.type,
      projectId: persistedEvent.projectId,
      source: persistedEvent.source,
      idempotencyKey: persistedEvent.idempotencyKey,
      payload: persistedEvent.payload,
    });

    assert.equal(workerRes.success, true);
    assert.equal(workerRes.status, "processed");
    assert.ok(workerRes.runId);

    // 10 & 11. Verify workflow run created with GitHub context
    const run = await agentRunRepository.findById(workerRes.runId!);
    assert.ok(run);
    assert.equal(run?.triggerType, "GITHUB_PULL_REQUEST_MERGED");
    assert.ok(run?.goal.includes("PR #42"));
    assert.ok(run?.goal.includes("Payment Webhook Integration"));
  });

  it("7. Duplicate X-GitHub-Delivery is recognized and ignored idempotently", async () => {
    const payload = {
      action: "closed",
      pull_request: {
        number: 42,
        title: "Payment Webhook Integration",
        merged: true,
      },
      repository: { full_name: "taskmaster-org/student-marketplace" },
    };
    const rawBody = JSON.stringify(payload);
    const deliveryId = "delivery-pr-merged-42"; // Same delivery ID as previous test
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
    assert.equal(data.status, "duplicate");
  });

  it("15. Secrets never leak in responses or error logs", async () => {
    const req = new NextRequest("http://localhost:3000/api/integrations/github/webhook", {
      method: "POST",
      body: "malformed-json",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "del-leak-test",
        "x-hub-signature-256": signPayload("malformed-json"),
      },
    });

    const res = await webhookRoute.POST(req);
    const text = await res.text();
    assert.ok(!text.includes(TEST_SECRET), "Response must never leak GITHUB_WEBHOOK_SECRET");
  });
});
