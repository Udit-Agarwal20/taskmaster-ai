import { NextRequest, NextResponse } from "next/server";
import { executeTaskmasterAgent } from "@/agent/executor";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      goal?: string;
      projectId?: string;
    };
    const goal = body.goal?.trim() || "Get this project back on track.";
    const projectId = body.projectId?.trim() || "student-marketplace";

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
