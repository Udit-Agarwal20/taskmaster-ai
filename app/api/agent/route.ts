import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { goal?: string };
  const goal = body.goal?.trim() || "Get this project back on track.";

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({
      summary: `Demo mode: received “${goal}”. Gemini is not configured yet.`,
      mode: "demo",
    });
  }

  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await client.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [
      {
        role: "user",
        parts: [{
          text: `You are Taskmaster, an AI project operator. Respond in one concise operational summary. Goal: ${goal}. Project state: 17 tasks, 4 blockers, 2 deadline risks, Rahul has 11 active tasks. Do not claim actions were executed; only propose what should happen next.`,
        }],
      },
    ],
  });

  return NextResponse.json({
    summary: response.text ?? "No agent summary returned.",
    mode: "gemini",
  });
}
