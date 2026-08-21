import { NextRequest, NextResponse } from "next/server";
import {
  verifyGitHubWebhookSignature,
  normalizeGitHubWebhook,
} from "@/lib/integrations/github/webhook";
import { eventRepository } from "@/db/repositories/event.repository";
import { publishTaskmasterEvent } from "@/lib/cloud/pubsub";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const eventHeader = req.headers.get("x-github-event");
    const deliveryId = req.headers.get("x-github-delivery");
    const signatureHeader = req.headers.get("x-hub-signature-256");

    const rawBody = await req.text();

    // 1. Validate HMAC-SHA256 signature
    const isValid = verifyGitHubWebhookSignature(rawBody, signatureHeader);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid or missing GitHub webhook signature" },
        { status: 401 }
      );
    }

    // 2. Parse JSON payload
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    // 3. Normalize GitHub event
    const { shouldProcess, reason, normalizedEvent } = normalizeGitHubWebhook(
      eventHeader,
      deliveryId,
      payload
    );

    if (!shouldProcess || !normalizedEvent) {
      return NextResponse.json({
        status: "ignored",
        reason: reason || "Event criteria not met for Taskmaster workflow processing",
        webhookDurationMs: Date.now() - startTime,
      });
    }

    // 4. Idempotency check: reject duplicate deliveries before publishing
    if (normalizedEvent.idempotencyKey) {
      const existing = await eventRepository.findByIdempotencyKey(
        normalizedEvent.idempotencyKey
      );
      if (existing) {
        return NextResponse.json({
          status: "duplicate",
          eventId: existing.id,
          deliveryId: normalizedEvent.payload.deliveryId,
          eventStatus: existing.status,
          webhookDurationMs: Date.now() - startTime,
        });
      }
    }

    // 5. Persist event with 'queued' status
    const persistedEvent = await eventRepository.create({
      ...normalizedEvent,
      status: "queued",
    });

    // 6. Publish event message to Cloud Pub/Sub
    const pubResult = await publishTaskmasterEvent(persistedEvent);

    // 7. Fast synchronous response (No Gemini latency or mutation waiting)
    const durationMs = Date.now() - startTime;
    return NextResponse.json({
      status: "queued",
      eventId: persistedEvent.id,
      deliveryId: normalizedEvent.payload.deliveryId,
      topic: pubResult.topic,
      messageId: pubResult.messageId,
      webhookDurationMs: durationMs,
    });
  } catch (error: any) {
    console.error("POST /api/integrations/github/webhook failed:", error.message);
    return NextResponse.json(
      { error: "Failed to ingest GitHub webhook", details: error.message },
      { status: 500 }
    );
  }
}
