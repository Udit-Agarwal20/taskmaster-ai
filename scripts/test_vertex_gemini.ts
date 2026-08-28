import { GoogleGenAI } from "@google/genai";

async function main() {
  console.log("==================================================");
  console.log("Testing Vertex AI for gemini-3.5-flash with ADC");
  console.log("==================================================");

  const project = "gen-lang-client-0057923797";
  const locations = ["global", "us-central1", "us-east4", "us-west1"];
  const models = ["gemini-3.5-flash", "gemini-3.0-flash", "gemini-3.0-pro"];

  for (const location of locations) {
    console.log(`\n--- Testing location: ${location} ---`);
    for (const model of models) {
      try {
        const ai = new GoogleGenAI({
          vertexai: true,
          project,
          location,
        });

        const response = await ai.models.generateContent({
          model,
          contents: "Say hello from Gemini 3.5 Flash!",
        });

        console.log(`✓ SUCCESS: Location '${location}', Model '${model}'`);
        console.log(`  Response: ${response.text?.trim()}`);
      } catch (err: any) {
        console.error(`✗ FAILED: Location '${location}', Model '${model}' -> ${err.message}`);
      }
    }
  }
}

main().catch(console.error);
