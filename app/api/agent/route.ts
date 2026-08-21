import { NextRequest, NextResponse } from "next/server";
import { workflowService } from "@/lib/services/workflow.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      goal?: string;
      projectId?: string;
      idempotencyKey?: string;
    };
    const goal = body.goal?.trim() || "Get this project back on track.";
    const projectId = body.projectId?.trim() || "student-marketplace";

    const { run } = await workflowService.createOrGetRun({
      projectId,
      goal,
      triggerType: "USER_GOAL",
      idempotencyKey: body.idempotencyKey ?? `goal:${projectId}:${Buffer.from(goal).toString("base64")}`,
    });

    const executedRun = await workflowService.executeWorkflowStage(run.id);

    return NextResponse.json({
      agentRunId: executedRun.id,
      status: executedRun.state,
      plan: executedRun.plan,
      findings: executedRun.plan?.findings ?? [],
      proposedActions: executedRun.plan?.proposedActions ?? [],
      summary: executedRun.summary ?? (executedRun.plan?.summary || "Planning completed."),
      currentStep: executedRun.currentStep,
      waitingReason: executedRun.waitingReason,
      mode: process.env.GEMINI_API_KEY ? "gemini-3.5-flash" : "unconfigured",
    });
  } catch (error: any) {
    console.error("POST /api/agent failed:", error.message);
    return NextResponse.json(
      { error: "Agent execution failed", details: error.message },
      { status: 500 }
    );
  }
}
