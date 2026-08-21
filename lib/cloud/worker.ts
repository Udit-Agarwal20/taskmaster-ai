import { eventRepository, EventRecord } from "@/db/repositories/event.repository";
import { workflowService } from "@/lib/services/workflow.service";
import { PubSubEventMessage } from "./pubsub";

export type WorkerProcessResult = {
  success: boolean;
  status: "processed" | "already_processed" | "failed" | "ignored";
  eventId: string;
  runId?: string | null;
  workflowState?: string | null;
  error?: string | null;
  durationMs: number;
};

/**
 * Core idempotent event processing logic for both Pull Subscriber and Cloud Run Push Subscriber.
 */
export async function processPubSubWorkerMessage(
  data: PubSubEventMessage | any
): Promise<WorkerProcessResult> {
  const start = Date.now();
  const eventId = data.eventId;

  if (!eventId) {
    throw new Error("Invalid Pub/Sub message: missing 'eventId'");
  }

  // 1. Fetch current event from PostgreSQL
  const event = await eventRepository.findById(eventId);
  if (!event) {
    throw new Error(`Event '${eventId}' not found in database`);
  }

  // 2. Idempotency Guard: if already processed, acknowledge safely without re-running workflow
  if (event.status === "processed") {
    return {
      success: true,
      status: "already_processed",
      eventId: event.id,
      runId: event.linkedRunId,
      durationMs: Date.now() - start,
    };
  }

  // 3. Mark event as 'processing' and increment attempt count
  await eventRepository.updateStatus(
    event.id,
    "processing",
    null,
    null,
    null,
    true
  );

  try {
    // 4. Dispatch to Taskmaster workflow service
    const workflowResult = await workflowService.processEvent({
      type: event.type,
      projectId: event.projectId,
      source: event.source,
      idempotencyKey: event.idempotencyKey,
      payload: event.payload,
    });

    const runId = workflowResult.run?.id ?? null;

    // 5. Mark event as 'processed'
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
    // 6. Record failure state in PostgreSQL
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
