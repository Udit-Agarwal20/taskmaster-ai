import "dotenv/config";
import { PubSub } from "@google-cloud/pubsub";
import { processPubSubWorkerMessage } from "../lib/cloud/worker";
import {
  TASKMASTER_EVENT_SUBSCRIPTION,
  subscribeLocalPubSub,
} from "../lib/cloud/pubsub";
import { closePool } from "../db/client";

async function startWorker() {
  console.log("==================================================");
  console.log("Taskmaster Asynchronous Pub/Sub Event Worker");
  console.log("==================================================");
  console.log(`Subscription: ${TASKMASTER_EVENT_SUBSCRIPTION}`);
  console.log(`Google Cloud Project: ${process.env.GOOGLE_CLOUD_PROJECT_ID || "(Local/Emulator Mode)"}`);

  // 1. Listen on local in-process Pub/Sub bus
  subscribeLocalPubSub(async (msg) => {
    console.log(`[Local Worker] Received event: ${msg.eventType} (${msg.eventId})`);
    try {
      const res = await processPubSubWorkerMessage(msg);
      console.log(`[Local Worker] Result: ${res.status} (Run: ${res.runId || "none"}, ${res.durationMs}ms)`);
    } catch (err: any) {
      console.error(`[Local Worker] Error: ${err.message}`);
    }
  });

  // 2. If GCP configured, start Google Cloud Pub/Sub pull subscriber
  if (process.env.GOOGLE_CLOUD_PROJECT_ID) {
    try {
      const pubsub = new PubSub({
        projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      });
      const subscription = pubsub.subscription(TASKMASTER_EVENT_SUBSCRIPTION);

      console.log(`Connecting to GCP Subscription '${TASKMASTER_EVENT_SUBSCRIPTION}'…`);

      subscription.on("message", async (message) => {
        try {
          const rawString = message.data.toString("utf-8");
          const data = JSON.parse(rawString);
          console.log(`[GCP Worker] Received message ${message.id}: ${data.eventType} (${data.eventId})`);

          const res = await processPubSubWorkerMessage(data);

          if (res.success) {
            message.ack();
            console.log(`[GCP Worker] Acknowledged message ${message.id}`);
          } else {
            console.warn(`[GCP Worker] Processing failed, nacking message ${message.id}`);
            message.nack();
          }
        } catch (err: any) {
          console.error(`[GCP Worker] Handler error: ${err.message}`);
          message.nack();
        }
      });

      subscription.on("error", (error) => {
        console.error("[GCP Worker] Subscription stream error:", error.message);
      });
    } catch (err: any) {
      console.warn(`[GCP Worker] Could not start Cloud Pub/Sub subscriber: ${err.message}`);
    }
  }

  console.log("Worker is running and waiting for events… (Press Ctrl+C to exit)");
}

// Graceful shutdown handlers
process.on("SIGINT", async () => {
  console.log("\nShutting down Taskmaster Event Worker…");
  await closePool();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down Taskmaster Event Worker…");
  await closePool();
  process.exit(0);
});

if (require.main === module) {
  startWorker().catch(async (err) => {
    console.error("Worker startup error:", err);
    await closePool();
    process.exit(1);
  });
}
