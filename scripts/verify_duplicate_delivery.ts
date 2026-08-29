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

  // Generate unique delivery ID for this test run
  const deliveryId = `del-dup-test-${Date.now()}`;
  const payload = JSON.stringify({
    action: "closed",
    pull_request: {
      number: 998,
      title: "Duplicate idempotency test",
      merged: true,
      user: { login: "Udit-Agarwal20" },
      head: { ref: "test/duplicate-branch" },
      base: { ref: "main" },
      merged_at: new Date().toISOString(),
    },
    repository: { full_name: "Udit-Agarwal20/taskmaster-ai" },
  });

  const signature = sign(payload);

  console.log(`1. Sending First Delivery: ${deliveryId}…`);
  const firstRes = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": signature,
    },
    body: payload,
  });
  console.log(`First Delivery Status: ${firstRes.status} (Expected: 200)`);
  const firstData = await firstRes.json();
  console.log("First Delivery Response:", firstData);

  console.log(`\n2. Replaying Exact Duplicate Delivery: ${deliveryId}…`);
  const dupRes = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": signature,
    },
    body: payload,
  });

  console.log(`Duplicate Status: ${dupRes.status} (Expected: 200)`);
  const dupData = await dupRes.json();
  console.log("Duplicate Response Body:", dupData);

  if (dupRes.status !== 200 || dupData.status !== "duplicate") {
    throw new Error(`Expected status 'duplicate', got: ${JSON.stringify(dupData)}`);
  }

  console.log("\n==================================================");
  console.log("✓ DUPLICATE DELIVERY SAFELY IDENTIFIED AND IGNORED!");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("✗ Duplicate test failed:", err.message);
  process.exit(1);
});
