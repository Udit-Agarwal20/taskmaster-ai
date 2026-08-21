import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { setPool, closePool, runSchemaMigration } from "../db/client";
import { seed, DEMO_PROJECT_ID } from "../db/seed";
import { workflowService } from "../lib/services/workflow.service";
import { agentRunRepository, eventRepository, approvalRepository } from "../db/repositories";
import * as eventApiRoute from "../app/api/events/route";
import * as resumeApiRoute from "../app/api/workflows/[runId]/resume/route";
import { NextRequest } from "next/server";

describe("Milestone 3A: Durable Event-Driven Workflow Runtime", () => {
  let pglite: PGlite;

  before(async () => {
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

  // Scenario A: User goal creates one workflow
  it("Scenario A: User goal creates one workflow", async () => {
    const { run, isDuplicate } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Scenario A test goal",
      triggerType: "USER_GOAL",
      idempotencyKey: "test-idem-a-1",
    });

    assert.ok(run.id);
    assert.equal(isDuplicate, false);
    assert.equal(run.projectId, DEMO_PROJECT_ID);
    assert.equal(run.state, "UNDERSTANDING");
    assert.equal(run.triggerType, "USER_GOAL");

    const fetched = await agentRunRepository.findById(run.id);
    assert.ok(fetched);
    assert.equal(fetched?.id, run.id);
  });

  // Scenario B: Same user goal repeated twice -> only one workflow created
  it("Scenario B: Same user goal repeated twice results in idempotent duplicate return", async () => {
    const key = "test-idem-b-unique";
    const res1 = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Idempotency test goal",
      idempotencyKey: key,
    });

    assert.equal(res1.isDuplicate, false);
    const firstRunId = res1.run.id;

    const res2 = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Idempotency test goal",
      idempotencyKey: key,
    });

    assert.equal(res2.isDuplicate, true);
    assert.equal(res2.run.id, firstRunId, "Duplicate delivery must return the exact same run ID");
  });

  // Scenario C: Workflow enters WAITING_FOR_EVENT
  it("Scenario C: Workflow enters WAITING_FOR_EVENT state", async () => {
    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Wait for event test",
      idempotencyKey: "test-idem-c",
    });

    await workflowService.transitionState(run.id, "PLANNING");
    const paused = await workflowService.pauseForEvent(
      run.id,
      "Waiting for pricing approval resolution event",
      "APPROVAL_RESOLVED",
      "approval-123"
    );

    assert.equal(paused.state, "WAITING_FOR_EVENT");
    assert.equal(paused.waitingReason, "Waiting for pricing approval resolution event");
    assert.equal(paused.expectedEventType, "APPROVAL_RESOLVED");
    assert.equal(paused.expectedCorrelationId, "approval-123");

    const persisted = await agentRunRepository.findById(run.id);
    assert.equal(persisted?.state, "WAITING_FOR_EVENT");
  });

  // Scenario D: Matching event arrives -> workflow resumes
  it("Scenario D: Matching event arrives and resumes the waiting workflow", async () => {
    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Wait and resume test",
      idempotencyKey: "test-idem-d",
    });

    await workflowService.transitionState(run.id, "PLANNING");
    await workflowService.pauseForEvent(
      run.id,
      "Wait for payment gateway webhook",
      "EXTERNAL_EVENT",
      "webhook-task-42"
    );

    // Matching event arrives
    const eventResult = await workflowService.processEvent({
      type: "EXTERNAL_EVENT",
      projectId: DEMO_PROJECT_ID,
      source: "stripe-webhook",
      idempotencyKey: "event-d-1",
      payload: { correlationId: "webhook-task-42", status: "success" },
    });

    assert.equal(eventResult.status, "resumed");
    assert.ok(eventResult.run);
    assert.equal(eventResult.run?.id, run.id, "Must resume the same run ID");
    assert.ok(
      eventResult.run?.state === "RESUMING" ||
        eventResult.run?.state === "PLANNING" ||
        eventResult.run?.state === "COMPLETED" ||
        eventResult.run?.state === "WAITING_FOR_APPROVAL" ||
        eventResult.run?.state === "FAILED",
      "Run should have transitioned out of WAITING_FOR_EVENT"
    );
  });

  // Scenario E: Wrong event arrives -> workflow remains waiting
  it("Scenario E: Non-matching event leaves waiting workflow untouched", async () => {
    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Wait for specific event",
      idempotencyKey: "test-idem-e",
    });

    await workflowService.transitionState(run.id, "PLANNING");
    await workflowService.pauseForEvent(
      run.id,
      "Wait for deployment event",
      "TASK_COMPLETED",
      "task-deploy-99"
    );

    // Non-matching event arrives
    const eventResult = await workflowService.processEvent({
      type: "TASK_UPDATED",
      projectId: DEMO_PROJECT_ID,
      source: "user-ui",
      idempotencyKey: "event-e-mismatch",
      payload: { taskId: "task-different-1" },
    });

    assert.equal(eventResult.status, "processed");
    assert.equal(eventResult.run, null);

    const runStillWaiting = await agentRunRepository.findById(run.id);
    assert.equal(runStillWaiting?.state, "WAITING_FOR_EVENT");
  });

  // Scenario F: Process restart: workflow state survives in DB
  it("Scenario F: Workflow state survives process crash and restarts from DB", async () => {
    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Crash recovery test",
      idempotencyKey: "test-idem-f",
    });

    await workflowService.transitionState(run.id, "PLANNING", {
      currentStep: "PLANNING_STAGE_1",
      plan: { test: "persisted_plan_data" },
    });

    await agentRunRepository.addStep({
      agentRunId: run.id,
      stepNumber: 1,
      stepType: "TOOL_CALL",
      toolName: "getProjectState",
      status: "COMPLETED",
    });

    // Simulate process termination by losing in-memory reference and reloading directly from DB
    const freshDbRun = await agentRunRepository.findById(run.id);
    assert.ok(freshDbRun);
    assert.equal(freshDbRun?.state, "PLANNING");
    assert.equal(freshDbRun?.currentStep, "PLANNING_STAGE_1");
    assert.deepEqual(freshDbRun?.plan, { test: "persisted_plan_data" });

    const steps = await agentRunRepository.getSteps(run.id);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].toolName, "getProjectState");
  });

  // Scenario G: Retryable failure: retry count increments
  it("Scenario G: Retryable failure increments retry count and sets lastError", async () => {
    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Retry test goal",
      idempotencyKey: "test-idem-g",
    });

    const retried = await workflowService.recordRetry(run.id, "Transient rate limit error");
    assert.equal(retried.retryCount, 1);
    assert.equal(retried.lastError, "Transient rate limit error");
    assert.equal(retried.state, "PLANNING");
  });

  // Scenario H: Max retries exceeded: workflow transitions to FAILED
  it("Scenario H: Exceeding maxRetries transitions workflow to FAILED", async () => {
    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Max retries test",
      idempotencyKey: "test-idem-h",
    });

    await workflowService.recordRetry(run.id, "Error 1");
    await workflowService.recordRetry(run.id, "Error 2");
    await workflowService.recordRetry(run.id, "Error 3");
    const failedRun = await workflowService.recordRetry(run.id, "Error 4 (Terminal)");

    assert.equal(failedRun.state, "FAILED");
    assert.ok(failedRun.lastError?.includes("Max retries"));
    assert.ok(failedRun.completedAt);
  });

  // Scenario I: Illegal state transition is rejected
  it("Scenario I: Illegal state transitions are rejected with Error", async () => {
    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Illegal transition test",
      idempotencyKey: "test-idem-i",
    });

    // Cannot transition directly from UNDERSTANDING to EXECUTING
    await assert.rejects(
      async () => {
        await workflowService.transitionState(run.id, "EXECUTING");
      },
      /Illegal workflow state transition/
    );

    // Complete workflow then attempt transition to EXECUTING
    await workflowService.transitionState(run.id, "PLANNING");
    await workflowService.transitionState(run.id, "COMPLETED");

    await assert.rejects(
      async () => {
        await workflowService.transitionState(run.id, "EXECUTING");
      },
      /Illegal workflow state transition from 'COMPLETED'/
    );
  });

  // Scenario J: Approval waiting state persists and resumes preserving run ID
  it("Scenario J: Approval waiting state persists and resumes via API with same run ID", async () => {
    const { run } = await workflowService.createOrGetRun({
      projectId: DEMO_PROJECT_ID,
      goal: "Approval workflow scenario",
      idempotencyKey: "test-idem-j",
    });

    await workflowService.transitionState(run.id, "PLANNING");
    const approval = await approvalRepository.create({
      agentRunId: run.id,
      action: "REASSIGN_TASKS",
      payload: { reassign: ["task-4"] },
      riskLevel: "medium",
    });

    const paused = await workflowService.pauseForApproval(
      run.id,
      "Awaiting human operator approval for task reassignment",
      approval.id,
      { test: "plan_ready" }
    );

    assert.equal(paused.state, "WAITING_FOR_APPROVAL");
    assert.equal(paused.expectedEventType, "APPROVAL_RESOLVED");

    // Resume via resume API endpoint
    const req = new NextRequest(`http://localhost:3000/api/workflows/${run.id}/resume`, {
      method: "POST",
      body: JSON.stringify({ reason: "Lead engineer approved reassignment" }),
    });
    const params = Promise.resolve({ runId: run.id });

    const res = await resumeApiRoute.POST(req, { params });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.runId, run.id, "Resumed workflow must preserve exact same run ID");
  });

  // Event Ingestion API Endpoint test
  it("Internal Event Ingestion API POST /api/events deduplicates and processes events", async () => {
    const req1 = new NextRequest("http://localhost:3000/api/events", {
      method: "POST",
      body: JSON.stringify({
        type: "TASK_UPDATED",
        projectId: DEMO_PROJECT_ID,
        source: "github-webhook",
        idempotencyKey: "api-event-test-1",
        payload: { taskId: "task-1", status: "doing" },
      }),
    });

    const res1 = await eventApiRoute.POST(req1);
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.status, "processed");
    assert.ok(body1.eventId);

    // Duplicate event delivery
    const req2 = new NextRequest("http://localhost:3000/api/events", {
      method: "POST",
      body: JSON.stringify({
        type: "TASK_UPDATED",
        projectId: DEMO_PROJECT_ID,
        source: "github-webhook",
        idempotencyKey: "api-event-test-1",
        payload: { taskId: "task-1", status: "doing" },
      }),
    });

    const res2 = await eventApiRoute.POST(req2);
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.status, "ignored", "Duplicate event delivery must be ignored");
  });
});
