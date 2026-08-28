import { eventRepository, EventRecord } from "@/db/repositories/event.repository";
import { agentRunRepository } from "@/db/repositories/agent-run.repository";
import { workflowService } from "@/lib/services/workflow.service";
import { PubSubEventMessage } from "./pubsub";

export type WorkerProcessResult = {
  success: boolean;
  status: "processed" | "already_processed" | "active_lease" | "waiting_approval" | "failed" | "ignored";
  eventId: string;
  runId?: string | null;
  workflowState?: string | null;
  error?: string | null;
  durationMs: number;
};

/**
 * Core hardened event processing logic with processing lease & stale run recovery.
 */
export async function processPubSubWorkerMessage(
  data: PubSubEventMessage | any,
  staleThresholdMs: number = 60000
): Promise<WorkerProcessResult> {
  const start = Date.now();
  const eventId = data.eventId;

  if (!eventId) {
    throw new Error("Invalid Pub/Sub message: missing 'eventId'");
  }

  // 1. Acquire processing lease with stale heartbeat recovery
  const lease = await eventRepository.acquireProcessingLease(eventId, staleThresholdMs);

  if (!lease.acquired) {
    if (lease.reason === "already_processed") {
      return {
        success: true,
        status: "already_processed",
        eventId,
        runId: lease.event?.linkedRunId ?? null,
        durationMs: Date.now() - start,
      };
    }
    if (lease.reason === "active_lease") {
      return {
        success: true,
        status: "active_lease",
        eventId,
        durationMs: Date.now() - start,
      };
    }
    return {
      success: true,
      status: "ignored",
      eventId,
      error: `Event '${eventId}' not found in database`,
      durationMs: Date.now() - start,
    };
  }

  const { event, attemptId, isRecovery } = lease;

  try {
    // 2. Check for existing linked run to prevent duplicate workflows on redeliveries
    if (event.linkedRunId) {
      const existingRun = await agentRunRepository.findById(event.linkedRunId);
      if (existingRun) {
        if (existingRun.state === "COMPLETED") {
          await eventRepository.updateStatus(
            event.id,
            "processed",
            new Date().toISOString(),
            existingRun.id
          );
          return {
            success: true,
            status: "already_processed",
            eventId: event.id,
            runId: existingRun.id,
            workflowState: "COMPLETED",
            durationMs: Date.now() - start,
          };
        }

        if (existingRun.state === "WAITING_FOR_APPROVAL") {
          return {
            success: true,
            status: "waiting_approval",
            eventId: event.id,
            runId: existingRun.id,
            workflowState: "WAITING_FOR_APPROVAL",
            durationMs: Date.now() - start,
          };
        }

        // Resume existing run if interrupted
        const resumedRun = await workflowService.executeWorkflowStage(existingRun.id);
        await eventRepository.updateStatus(
          event.id,
          "processed",
          new Date().toISOString(),
          resumedRun.id
        );
        return {
          success: true,
          status: "processed",
          eventId: event.id,
          runId: resumedRun.id,
          workflowState: resumedRun.state,
          durationMs: Date.now() - start,
        };
      }
    }

    // 3. Dispatch to Taskmaster workflow service
    const workflowResult = await workflowService.processEvent({
      type: event.type,
      projectId: event.projectId,
      source: event.source,
      idempotencyKey: event.idempotencyKey,
      payload: event.payload,
    });

    const runId = workflowResult.run?.id ?? null;

    // 4. Mark event as 'processed'
    await eventRepository.updateStatus(
      event.id,
      "processed",
      new Date().toISOString(),
      runId,
      null,
      false
    );

    return {
      success: true,
      status: "processed",
      eventId: event.id,
      runId,
      workflowState: workflowResult.run?.state ?? null,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    // 5. Record failure state in PostgreSQL
    await eventRepository.updateStatus(
      event.id,
      "failed",
      null,
      null,
      err.message,
      false
    );

    return {
      success: false,
      status: "failed",
      eventId: event.id,
      error: err.message,
      durationMs: Date.now() - start,
    };
  }
}
