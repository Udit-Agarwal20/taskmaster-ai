import { NextResponse } from "next/server";
import { projectRepository } from "@/db/repositories";

export const runtime = "nodejs";

export async function GET() {
  try {
    const projects = await projectRepository.list();
    return NextResponse.json(projects);
  } catch (error: any) {
    console.error("GET /api/projects failed:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch projects. Please verify database connectivity." },
      { status: 500 }
    );
  }
}
