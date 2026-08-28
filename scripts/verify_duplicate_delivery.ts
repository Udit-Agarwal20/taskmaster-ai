import * as crypto from "crypto";
import * as fs from "fs";
import * as dotenv from "dotenv";

const WEBHOOK_URL = "https://taskmaster-service-137377771269.us-central1.run.app/api/integrations/github/webhook";

async function main() {
  console.log("==================================================");
  console.log("Taskmaster: Verifying Duplicate GitHub Delivery Handling");
  console.log("==================================================");

  const envConfig = dotenv.parse(fs.readFileSync(".env", "utf-8"));
  const webhookSecret = envConfig.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("GITHUB_WEBHOOK_SECRET missing");

  function sign(payload: string): string {
    const hmac = crypto.createHmac("sha256", webhookSecret);
    return "sha256=" + hmac.update(payload).digest("hex");
  }

  // Replay the exact same delivery ID from PR #3
  const deliveryId = "4c90e7b0-a259-11f1-9ef1-434e965104da";
  const duplicatePayload = JSON.stringify({
    action: "closed",
    pull_request: {
      number: 3,
      title: "Taskmaster live event test",
      merged: true,
      user: { login: "Udit-Agarwal20" },
      head: { ref: "test/live-event-1787863979405" },
      base: { ref: "main" },
      merged_at: "2026-08-27T20:53:04Z",
    },
    repository: { full_name: "Udit-Agarwal20/taskmaster-ai" },
  });

  const signature = sign(duplicatePayload);

  console.log(`Replaying Delivery ID: ${deliveryId}…`);
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": signature,
    },
    body: duplicatePayload,
  });

  console.log(`Response Status: ${res.status} (Expected: 200)`);
  const data = await res.json();
  console.log("Response Body:", data);

  if (res.status !== 200 || data.status !== "duplicate") {
    throw new Error(`Expected status 'duplicate', got: ${JSON.stringify(data)}`);
  }

  console.log("\n==================================================");
  console.log("✓ DUPLICATE DELIVERY SAFELY IDENTIFIED AND IGNORED!");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("✗ Duplicate test failed:", err.message);
  process.exit(1);
});
