import { NextRequest, NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/store";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return NextResponse.json(listTasks(projectId));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = await req.json();
  if (!body?.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  return NextResponse.json(createTask({ ...body, projectId }), { status: 201 });
}
