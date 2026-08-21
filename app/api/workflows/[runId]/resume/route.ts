import { NextRequest, NextResponse } from "next/server";
import { workflowService } from "@/lib/services/workflow.service";
import { agentRunRepository } from "@/db/repositories";
import { z } from "zod";

export const runtime = "nodejs";

const resumeBodySchema = z.object({
  reason: z.string().optional().default("Resumed via API"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    if (!runId || typeof runId !== "string") {
      return NextResponse.json({ error: "runId parameter is required" }, { status: 400 });
    }

    const run = await agentRunRepository.findById(runId);
    if (!run) {
      return NextResponse.json({ error: `Workflow run '${runId}' not found` }, { status: 404 });
    }

    if (run.state !== "WAITING_FOR_APPROVAL" && run.state !== "WAITING_FOR_EVENT") {
      return NextResponse.json(
        {
          error: `Workflow run '${runId}' cannot be resumed from state '${run.state}'. Expected WAITING_FOR_APPROVAL or WAITING_FOR_EVENT.`,
        },
        { status: 409 }
      );
    }

    const rawBody = await req.json().catch(() => ({}));
    const validated = resumeBodySchema.safeParse(rawBody);
    const reason = validated.success ? validated.data.reason : "Resumed via API";

    const resumed = await workflowService.resumeWorkflow(runId, reason);

    return NextResponse.json({
      runId: resumed.id,
      state: resumed.state,
      summary: resumed.summary,
      currentStep: resumed.currentStep,
      plan: resumed.plan,
    });
  } catch (error: any) {
    console.error("POST /api/workflows/[runId]/resume failed:", error.message);
    return NextResponse.json(
      { error: "Failed to resume workflow", details: error.message },
      { status: 500 }
    );
  }
}
