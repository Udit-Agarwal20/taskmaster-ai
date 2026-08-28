import { GoogleGenAI } from "@google/genai";

async function main() {
  const project = "gen-lang-client-0057923797";
  const location = "global";
  const models = [
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
  ];

  for (const model of models) {
    try {
      console.log(`\nTesting model '${model}' on Vertex AI (${location})…`);
      const ai = new GoogleGenAI({
        vertexai: true,
        project,
        location,
      });

      const response = await ai.models.generateContent({
        model,
        contents: "Respond in 5 words or less: Taskmaster operational check.",
      });

      console.log(`✓ SUCCESS: Model '${model}'`);
      console.log(`  Response: ${response.text?.trim()}`);
    } catch (err: any) {
      console.error(`✗ FAILED: Model '${model}' -> ${err.message}`);
    }
  }
}

main().catch(console.error);
