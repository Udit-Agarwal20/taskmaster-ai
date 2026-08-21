import { NextRequest, NextResponse } from "next/server";
import {
  verifyGitHubWebhookSignature,
  normalizeGitHubWebhook,
} from "@/lib/integrations/github/webhook";
import { workflowService } from "@/lib/services/workflow.service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
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
      });
    }

    // 4. Ingest and route event through Taskmaster workflow service
    const eventResult = await workflowService.processEvent(normalizedEvent);

    return NextResponse.json({
      status: eventResult.status === "ignored" ? "duplicate" : "processed",
      eventId: eventResult.event.id,
      runId: eventResult.run?.id ?? null,
      workflowState: eventResult.run?.state ?? null,
      summary: eventResult.run?.summary ?? null,
    });
  } catch (error: any) {
    console.error("POST /api/integrations/github/webhook failed:", error.message);
    return NextResponse.json(
      { error: "Failed to process GitHub webhook", details: error.message },
      { status: 500 }
    );
  }
}
