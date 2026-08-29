import { NextRequest, NextResponse } from "next/server";
import { projectAnalysisService } from "@/lib/services/project-analysis.service";
import {
  projectRepository,
  activityRepository,
  approvalRepository,
  agentRunRepository,
  taskRepository,
  eventRepository,
} from "@/db/repositories";
import { buildActionExplanations } from "@/lib/models/action-explanation";
import { projectIdParamSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
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

    const [analysis, recentActivities, pendingApprovals, runs, tasks, recentEvents] =
      await Promise.all([
        projectAnalysisService.analyze(projectId),
        activityRepository.listByProject(projectId, 30),
        approvalRepository.listPendingByProject(projectId),
        agentRunRepository.listByProject(projectId),
        taskRepository.listByProject(projectId),
        eventRepository.listByProject(projectId, 10),
      ]);

    const latestRun = runs[0];
    const actionExplanations = buildActionExplanations({
      run: latestRun,
      plan: latestRun?.plan,
      activities: recentActivities,
      approvals: pendingApprovals,
      tasks,
      events: recentEvents,
    });

    return NextResponse.json({
      ...analysis,
      recentActivities,
      pendingApprovals,
      actionExplanations,
      latestRun: latestRun
        ? {
            id: latestRun.id,
            state: latestRun.state,
            goal: latestRun.goal,
            summary: latestRun.summary,
            triggerType: latestRun.triggerType,
            startedAt: latestRun.startedAt,
            completedAt: latestRun.completedAt,
          }
        : null,
    });
  } catch (error: any) {
    console.error("GET /api/projects/[projectId]/analysis failed:", error.message);
    return NextResponse.json(
      { error: "Failed to compute project analysis from database state" },
      { status: 500 }
    );
  }
}
