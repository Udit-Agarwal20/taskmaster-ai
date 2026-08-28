import { NextRequest, NextResponse } from "next/server";
import { processPubSubWorkerMessage } from "@/lib/cloud/worker";
import { verifyGoogleOidcToken } from "@/lib/cloud/auth";

export const runtime = "nodejs";

/**
 * Cloud Run Pub/Sub Push Subscription Endpoint.
 * Hardened with Google Cloud IAM / OIDC ID Token verification.
 * Only Google Cloud Pub/Sub using the authorized Service Account can invoke this endpoint.
 */
export async function POST(req: NextRequest) {
  try {
    const isProduction = process.env.NODE_ENV === "production";
    const authHeader = req.headers.get("authorization");

    // In production, strictly enforce Google Cloud IAM OIDC token validation
    if (isProduction || authHeader) {
      const oidcResult = await verifyGoogleOidcToken(authHeader);
      if (!oidcResult.valid) {
        console.warn(`[Event Worker] OIDC verification failed: ${oidcResult.error}`);
        return NextResponse.json(
          {
            error: "Unauthorized: Invalid or missing Google Cloud OIDC token",
            details: oidcResult.error,
          },
          { status: 401 }
        );
      }
      console.log(`[Event Worker] OIDC verified successfully for: ${oidcResult.email}`);
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

    console.log(`[Event Worker] Processing Pub/Sub event: ${messageData.eventId} (${messageData.eventType || "unknown"})`);
    const result = await processPubSubWorkerMessage(messageData);
    console.log(`[Event Worker] Completed event: ${messageData.eventId}, status: ${result.status}, runId: ${result.runId}`);

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
