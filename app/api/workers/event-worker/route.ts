import { NextRequest, NextResponse } from "next/server";
import { processPubSubWorkerMessage } from "@/lib/cloud/worker";

export const runtime = "nodejs";

/**
 * Cloud Run Pub/Sub Push Subscription Endpoint.
 * Receives messages pushed by Google Cloud Pub/Sub, decodes the payload,
 * and executes the idempotent Taskmaster workflow.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();

    let messageData: any;
    if (rawBody.message?.data) {
      // Standard GCP Pub/Sub Push envelope with base64 data
      const decodedString = Buffer.from(rawBody.message.data, "base64").toString("utf-8");
      messageData = JSON.parse(decodedString);
    } else if (rawBody.eventId) {
      // Direct message payload
      messageData = rawBody;
    } else {
      return NextResponse.json(
        { error: "Invalid Pub/Sub envelope: missing message data" },
        { status: 400 }
      );
    }

    const result = await processPubSubWorkerMessage(messageData);

    if (!result.success && result.status === "failed") {
      return NextResponse.json(
        { error: "Event processing failed", details: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("POST /api/workers/event-worker error:", error.message);
    return NextResponse.json(
      { error: "Worker error", details: error.message },
      { status: 500 }
    );
  }
}
