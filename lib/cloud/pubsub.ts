import { EventRecord } from "@/db/repositories/event.repository";

export type PubSubEventMessage = {
  eventId: string;
  eventType: string;
  projectId: string;
  source: string;
  idempotencyKey: string | null;
  payload: any;
  publishedAt: string;
};

export type PublishResult = {
  success: boolean;
  messageId: string;
  topic: string;
  publishedAt: string;
};

export const TASKMASTER_EVENT_TOPIC =
  process.env.TASKMASTER_EVENT_TOPIC || "taskmaster-events";
export const TASKMASTER_EVENT_SUBSCRIPTION =
  process.env.TASKMASTER_EVENT_SUBSCRIPTION || "taskmaster-event-worker";

// In-memory test/local subscribers for deterministic testing and local daemon
type LocalMessageSubscriber = (msg: PubSubEventMessage) => Promise<void>;
const localSubscribers: LocalMessageSubscriber[] = [];

export function subscribeLocalPubSub(handler: LocalMessageSubscriber): () => void {
  localSubscribers.push(handler);
  return () => {
    const idx = localSubscribers.indexOf(handler);
    if (idx !== -1) localSubscribers.splice(idx, 1);
  };
}

let cachedPubSubClient: any = null;

async function getPubSubClient() {
  if (cachedPubSubClient) return cachedPubSubClient;
  const { PubSub } = await import("@google-cloud/pubsub");
  cachedPubSubClient = new PubSub({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  });
  return cachedPubSubClient;
}

/**
 * Publishes a normalized Taskmaster event to Google Cloud Pub/Sub.
 * In local/test mode without GCP credentials, routes safely to registered local subscribers.
 */
export async function publishTaskmasterEvent(
  event: EventRecord
): Promise<PublishResult> {
  const publishedAt = new Date().toISOString();
  const messageData: PubSubEventMessage = {
    eventId: event.id,
    eventType: event.type,
    projectId: event.projectId,
    source: event.source,
    idempotencyKey: event.idempotencyKey,
    payload: event.payload,
    publishedAt,
  };

  let messageId = `msg-${event.id}-${Date.now()}`;

  // 1. If Google Cloud Project is configured, publish to real Cloud Pub/Sub
  if (process.env.GOOGLE_CLOUD_PROJECT_ID && process.env.NODE_ENV !== "test") {
    try {
      const pubsub = await getPubSubClient();
      const topic = pubsub.topic(TASKMASTER_EVENT_TOPIC);
      const dataBuffer = Buffer.from(JSON.stringify(messageData));
      const gcpMessageId = await topic.publishMessage({ data: dataBuffer });
      if (gcpMessageId) messageId = gcpMessageId;
    } catch (err: any) {
      console.warn(`[PubSub] Cloud Pub/Sub publish warning: ${err.message}. Routing to local bus.`);
    }
  }

  // 2. Dispatch to local subscribers (for local dev / unit tests)
  for (const subscriber of localSubscribers) {
    try {
      // Execute asynchronously in background
      Promise.resolve().then(() => subscriber(messageData)).catch((e) => {
        console.error(`[PubSub] Local subscriber error: ${e.message}`);
      });
    } catch (err: any) {
      console.error(`[PubSub] Local subscriber dispatch error: ${err.message}`);
    }
  }

  return {
    success: true,
    messageId,
    topic: TASKMASTER_EVENT_TOPIC,
    publishedAt,
  };
}
