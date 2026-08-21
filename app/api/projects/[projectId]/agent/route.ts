import { NextRequest, NextResponse } from "next/server";
import { executeTaskmasterAgent } from "@/agent/executor";
import { projectRepository } from "@/db/repositories";
import { projectIdParamSchema } from "@/lib/validation";
import { z } from "zod";

export const runtime = "nodejs";

const agentGoalSchema = z.object({
  goal: z.string().min(1, "Goal is required").max(1000).optional().default("Get this project back on track."),
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
    const result = await executeTaskmasterAgent({
      projectId,
      goal,
    });

    return NextResponse.json({
      agentRunId: result.agentRunId,
      status: result.state,
      plan: result.plan,
      findings: result.plan?.findings ?? [],
      proposedActions: result.plan?.proposedActions ?? [],
      summary: result.summary,
      stepsCount: result.stepsCount,
    });
  } catch (error: any) {
    console.error("POST /api/projects/[projectId]/agent failed:", error.message);
    return NextResponse.json(
      { error: "Agent execution failed", details: error.message },
      { status: 500 }
    );
  }
}
