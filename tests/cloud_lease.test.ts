import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setPool, closePool, runSchemaMigration } from "../db/client";
import { seed, DEMO_PROJECT_ID } from "../db/seed";
import { eventRepository, agentRunRepository } from "../db/repositories";
import { processPubSubWorkerMessage } from "../lib/cloud/worker";
import * as pushWorkerRoute from "../app/api/workers/event-worker/route";
import { NextRequest } from "next/server";

describe("Milestone 4C: Processing Lease, Stale Recovery & Push Auth", () => {
  let pglite: PGlite;

  before(async () => {
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

  it("1. acquireProcessingLease acquires initial lease and records attempt ID", async () => {
    const event = await eventRepository.create({
      type: "GITHUB_PULL_REQUEST_MERGED",
      projectId: DEMO_PROJECT_ID,
      source: "github",
      idempotencyKey: "lease-test-1",
      status: "queued",
    });

    const lease = await eventRepository.acquireProcessingLease(event.id);
    assert.equal(lease.acquired, true);
    if (lease.acquired) {
      assert.ok(lease.attemptId);
      assert.equal(lease.isRecovery, false);
      assert.equal(lease.event.status, "processing");
      assert.ok(lease.event.processingStartedAt);
      assert.ok(lease.event.processingHeartbeatAt);
      assert.equal(lease.event.attemptCount, 1);
    }
  });

  it("2. Active lease collision: second concurrent attempt is rejected while heartbeat is fresh", async () => {
    const event = await eventRepository.create({
      type: "GITHUB_PULL_REQUEST_MERGED",
      projectId: DEMO_PROJECT_ID,
      source: "github",
      idempotencyKey: "lease-collision-1",
      status: "queued",
    });

    // Worker 1 acquires lease
    const lease1 = await eventRepository.acquireProcessingLease(event.id);
    assert.equal(lease1.acquired, true);

    // Worker 2 attempts to acquire lease while Worker 1 is fresh
    const lease2 = await eventRepository.acquireProcessingLease(event.id, 60000);
    assert.equal(lease2.acquired, false);
    assert.equal(lease2.reason, "active_lease");
  });

  it("3. Stale lease recovery: crashed worker with expired heartbeat (> threshold) is recovered", async () => {
    const event = await eventRepository.create({
      type: "GITHUB_PULL_REQUEST_MERGED",
      projectId: DEMO_PROJECT_ID,
      source: "github",
      idempotencyKey: "lease-stale-1",
      status: "queued",
    });

    // Acquire lease
    const lease1 = await eventRepository.acquireProcessingLease(event.id);
    assert.equal(lease1.acquired, true);

    // Simulate crash by passing a 0ms stale threshold (so current timestamp is considered stale)
    const recoveryLease = await eventRepository.acquireProcessingLease(event.id, -1);
    assert.equal(recoveryLease.acquired, true);
    if (recoveryLease.acquired) {
      assert.equal(recoveryLease.isRecovery, true);
      assert.notEqual(recoveryLease.attemptId, (lease1 as any).attemptId);
      assert.equal(recoveryLease.event.attemptCount, 2);
    }
  });

  it("4. Heartbeat update updates processing_heartbeat_at", async () => {
    const event = await eventRepository.create({
      type: "GITHUB_PULL_REQUEST_MERGED",
      projectId: DEMO_PROJECT_ID,
      source: "github",
      idempotencyKey: "heartbeat-test-1",
      status: "queued",
    });

    const lease = await eventRepository.acquireProcessingLease(event.id);
    assert.equal(lease.acquired, true);
    if (lease.acquired) {
      const ok = await eventRepository.updateHeartbeat(event.id, lease.attemptId);
      assert.equal(ok, true);

      const invalidAttempt = await eventRepository.updateHeartbeat(event.id, "wrong-attempt-id");
      assert.equal(invalidAttempt, false);
    }
  });

  it("5. Already processed event rejects lease acquisition", async () => {
    const event = await eventRepository.create({
      type: "GITHUB_PULL_REQUEST_MERGED",
      projectId: DEMO_PROJECT_ID,
      source: "github",
      idempotencyKey: "lease-processed-1",
      status: "processed",
    });

    const lease = await eventRepository.acquireProcessingLease(event.id);
    assert.equal(lease.acquired, false);
    assert.equal(lease.reason, "already_processed");
  });

  it("6. Push Authentication: worker validates token and rejects unauthorized callers", async () => {
    process.env.PUBSUB_VERIFICATION_TOKEN = "secret-token-xyz-123";

    const event = await eventRepository.create({
      type: "GITHUB_PULL_REQUEST_MERGED",
      projectId: DEMO_PROJECT_ID,
      source: "github",
      idempotencyKey: "push-auth-test-1",
      status: "queued",
    });

    // 1. Missing / invalid auth token -> 401
    const reqUnauthorized = new NextRequest("http://localhost:3000/api/workers/event-worker", {
      method: "POST",
      body: JSON.stringify({ eventId: event.id }),
      headers: { authorization: "Bearer wrong-token" },
    });
    const resUnauthorized = await pushWorkerRoute.POST(reqUnauthorized);
    assert.equal(resUnauthorized.status, 401);

    // 2. Valid token -> 200 OK
    const reqAuthorized = new NextRequest("http://localhost:3000/api/workers/event-worker", {
      method: "POST",
      body: JSON.stringify({ eventId: event.id }),
      headers: { authorization: "Bearer secret-token-xyz-123" },
    });
    const resAuthorized = await pushWorkerRoute.POST(reqAuthorized);
    assert.equal(resAuthorized.status, 200);
    const data = await resAuthorized.json();
    assert.equal(data.success, true);
    assert.equal(data.status, "processed");

    delete process.env.PUBSUB_VERIFICATION_TOKEN;
  });

  it("7. Duplicate run prevention: existing linked workflow run is resumed rather than duplicated", async () => {
    const event = await eventRepository.create({
      type: "GITHUB_PULL_REQUEST_MERGED",
      projectId: DEMO_PROJECT_ID,
      source: "github",
      idempotencyKey: "dup-run-safety-1",
      payload: { pullRequestNumber: 123, title: "Dup Run Safety PR" },
      status: "queued",
    });

    // Worker 1 runs and finishes
    const res1 = await processPubSubWorkerMessage({ eventId: event.id });
    assert.equal(res1.status, "processed");
    const originalRunId = res1.runId;

    // Worker 2 (e.g. redelivery)
    const res2 = await processPubSubWorkerMessage({ eventId: event.id });
    assert.equal(res2.status, "already_processed");
    assert.equal(res2.runId, originalRunId);
  });
});
