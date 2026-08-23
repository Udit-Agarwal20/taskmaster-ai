import { NextRequest, NextResponse } from "next/server";
import { workflowService } from "@/lib/services/workflow.service";
import { projectRepository } from "@/db/repositories";
import { projectIdParamSchema } from "@/lib/validation";
import { z } from "zod";

export const runtime = "nodejs";

const agentGoalSchema = z.object({
  goal: z.string().min(1, "Goal is required").max(1000).optional().default("Get this project back on track."),
  idempotencyKey: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const rawParams = await params;
    const validatedParams = projectIdParamSchema.safeParse(rawParams);
    if (!validatedParams.success) {
      return NextResponse.json(
        { error: "Invalid projectId parameter", details: validatedParams.error.format() },
        { status: 400 }
      );
    }

    const { projectId } = validatedParams.data;
    const project = await projectRepository.findById(projectId);
    if (!project) {
      return NextResponse.json({ error: `Project '${projectId}' not found` }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const validatedBody = agentGoalSchema.safeParse(body);
    if (!validatedBody.success) {
      return NextResponse.json(
        { error: "Invalid goal payload", details: validatedBody.error.format() },
        { status: 400 }
      );
    }

    const goal = validatedBody.data.goal;
    const idempotencyKey = validatedBody.data.idempotencyKey;

    // 1. Idempotent workflow run creation
    const { run } = await workflowService.createOrGetRun({
      projectId,
      goal,
      triggerType: "USER_GOAL",
      idempotencyKey: idempotencyKey ?? `goal:${projectId}:${Buffer.from(goal).toString("base64")}`,
    });

    // 2. Execute workflow stage
    const executedRun = await workflowService.executeWorkflowStage(run.id);

    let approvalId: string | undefined;
    let pendingApproval: any;
    if (executedRun.state === "WAITING_FOR_APPROVAL") {
      const { approvalRepository } = await import("@/db/repositories");
      const approvals = await approvalRepository.listByRun(executedRun.id);
      const pending = approvals.find((a) => a.status === "pending");
      if (pending) {
        approvalId = pending.id;
        pendingApproval = pending;
      }
    }

    return NextResponse.json({
      agentRunId: executedRun.id,
      status: executedRun.state,
      currentStep: executedRun.currentStep,
      plan: executedRun.plan,
      findings: executedRun.plan?.findings ?? [],
      proposedActions: executedRun.plan?.proposedActions ?? [],
      summary: executedRun.summary ?? (executedRun.plan?.summary || "Planning completed."),
      waitingReason: executedRun.waitingReason,
      expectedEventType: executedRun.expectedEventType,
      approvalId,
      pendingApproval,
      stepsCount: 0,
    });
  } catch (error: any) {
    console.error("POST /api/projects/[projectId]/agent failed:", error.message);
    return NextResponse.json(
      { error: "Agent execution failed", details: error.message },
      { status: 500 }
    );
  }
}
