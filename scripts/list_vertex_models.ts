import { GoogleGenAI } from "@google/genai";

async function main() {
  const project = "gen-lang-client-0057923797";
  const locations = ["us-central1", "global"];

  for (const location of locations) {
    console.log(`\n=== Listing models in ${location} ===`);
    try {
      const ai = new GoogleGenAI({
        vertexai: true,
        project,
        location,
      });

      const list = await ai.models.list();
      console.log("Found models count:", list);
    } catch (err: any) {
      console.error(`Error listing models in ${location}:`, err.message);
    }
  }
}

main().catch(console.error);
