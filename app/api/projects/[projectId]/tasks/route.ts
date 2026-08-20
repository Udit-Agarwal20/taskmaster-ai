import { NextRequest, NextResponse } from "next/server";
import { taskRepository, projectRepository } from "@/db/repositories";
import { createTaskSchema, projectIdParamSchema } from "@/lib/validation";

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

    const tasks = await taskRepository.listByProject(projectId);
    return NextResponse.json(tasks);
  } catch (error: any) {
    console.error("GET /api/projects/[projectId]/tasks failed:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch tasks from database" },
      { status: 500 }
    );
  }
}

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

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Request body is required and must be JSON" }, { status: 400 });
    }

    const validatedBody = createTaskSchema.safeParse(body);
    if (!validatedBody.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validatedBody.error.format() },
        { status: 400 }
      );
    }

    const created = await taskRepository.create({
      ...validatedBody.data,
      projectId,
      assignee: validatedBody.data.assignee || project.members[0] || "Unassigned",
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/projects/[projectId]/tasks failed:", error.message);
    return NextResponse.json(
      { error: "Failed to create task in database" },
      { status: 500 }
    );
  }
}
