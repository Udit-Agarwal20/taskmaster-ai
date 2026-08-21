import { NextRequest, NextResponse } from "next/server";
import { processPubSubWorkerMessage } from "@/lib/cloud/worker";

export const runtime = "nodejs";

/**
 * Cloud Run Pub/Sub Push Subscription Endpoint.
 * Receives authenticated messages pushed by Google Cloud Pub/Sub,
 * validates authorization, decodes the payload, and executes the idempotent workflow.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Verify push authentication token when configured
    const verificationToken = process.env.PUBSUB_VERIFICATION_TOKEN;
    if (verificationToken) {
      const authHeader = req.headers.get("authorization");
      const urlToken = req.nextUrl.searchParams.get("token");
      const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

      if (bearer !== verificationToken && urlToken !== verificationToken) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid Pub/Sub verification token" },
          { status: 401 }
        );
      }
    }

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
