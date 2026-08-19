import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";

export async function GET() {
  const project = getProject("student-marketplace");
  return NextResponse.json(project ? [project] : []);
}
