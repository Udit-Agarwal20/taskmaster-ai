import { NextResponse } from "next/server";
import { analyzeProject } from "@/lib/store";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return NextResponse.json(analyzeProject(projectId));
}
