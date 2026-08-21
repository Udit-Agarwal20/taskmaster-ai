import { NextRequest, NextResponse } from "next/server";
import { workflowService } from "@/lib/services/workflow.service";
import { WorkflowEventTypeSchema } from "@/agent/state";
import { z } from "zod";

export const runtime = "nodejs";

const eventIngestionSchema = z.object({
  type: WorkflowEventTypeSchema,
  projectId: z.string().min(1, "projectId is required"),
  source: z.string().min(1, "source is required"),
  idempotencyKey: z.string().optional().nullable(),
  payload: z.record(z.string(), z.any()).optional().default({}),
});

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json().catch(() => ({}));
    const validated = eventIngestionSchema.safeParse(rawBody);

    if (!validated.success) {
      return NextResponse.json(
        { error: "Invalid event payload", details: validated.error.format() },
        { status: 400 }
      );
    }

    const result = await workflowService.processEvent(validated.data);

    return NextResponse.json({
      status: result.status,
      eventId: result.event.id,
      eventType: result.event.type,
      linkedRunId: result.run?.id ?? result.event.linkedRunId,
      runState: result.run?.state,
      event: result.event,
    });
  } catch (error: any) {
    console.error("POST /api/events failed:", error.message);
    return NextResponse.json(
      { error: "Event processing failed", details: error.message },
      { status: 500 }
    );
  }
}
