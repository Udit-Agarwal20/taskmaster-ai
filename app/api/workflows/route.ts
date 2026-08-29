import { NextRequest, NextResponse } from "next/server";
import { agentRunRepository, approvalRepository, activityRepository } from "../../../db/repositories";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId") || "student-marketplace";
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const allRuns = await agentRunRepository.listByProject(projectId);
    const runs = allRuns.slice(0, limit);

    // Enrich each run with approvals and step counts
    const enrichedRuns = await Promise.all(
      runs.map(async (run) => {
        const [steps, approvals] = await Promise.all([
          agentRunRepository.getSteps(run.id),
          approvalRepository.listByRun(run.id),
        ]);

        const started = run.startedAt ? new Date(run.startedAt).getTime() : 0;
        const ended = run.completedAt
          ? new Date(run.completedAt).getTime()
          : run.updatedAt
          ? new Date(run.updatedAt).getTime()
          : Date.now();
        const durationMs = started > 0 ? Math.max(0, ended - started) : 0;

        return {
          id: run.id,
          projectId: run.projectId,
          goal: run.goal,
          triggerType: run.triggerType || "USER_GOAL",
          triggerId: run.triggerId,
          state: run.state,
          currentStep: run.currentStep,
          waitingReason: run.waitingReason,
          summary: run.summary,
          plan: run.plan,
          contextSnapshot: run.contextSnapshot,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          updatedAt: run.updatedAt,
          durationMs,
          stepsCount: steps.length,
          steps: steps.map((s) => ({
            stepNumber: s.stepNumber,
            stepType: s.stepType,
            toolName: s.toolName,
            createdAt: s.createdAt,
          })),
          approvals: approvals.map((a) => ({
            id: a.id,
            action: a.action,
            riskLevel: a.riskLevel,
            status: a.status,
            approvedBy: a.approvedBy,
            createdAt: a.createdAt,
            resolvedAt: a.resolvedAt,
          })),
        };
      })
    );

    return NextResponse.json({
      projectId,
      totalRuns: enrichedRuns.length,
      workflows: enrichedRuns,
    });
  } catch (error: any) {
    console.error("[Workflows API] Error fetching workflow runs:", error);
    return NextResponse.json(
      { error: "Failed to fetch workflow runs", message: error.message },
      { status: 500 }
    );
  }
}
