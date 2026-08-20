import { NextRequest, NextResponse } from "next/server";
import { projectAnalysisService } from "@/lib/services/project-analysis.service";
import { projectRepository } from "@/db/repositories";
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

    const analysis = await projectAnalysisService.analyze(projectId);
    return NextResponse.json(analysis);
  } catch (error: any) {
    console.error("GET /api/projects/[projectId]/analysis failed:", error.message);
    return NextResponse.json(
      { error: "Failed to compute project analysis from database state" },
      { status: 500 }
    );
  }
}
