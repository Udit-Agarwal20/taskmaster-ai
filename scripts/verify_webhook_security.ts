import * as crypto from "crypto";
import * as fs from "fs";
import * as dotenv from "dotenv";

const WEBHOOK_URL = "https://taskmaster-service-137377771269.us-central1.run.app/api/integrations/github/webhook";

async function main() {
  console.log("==================================================");
  console.log("Taskmaster: Verifying Cloud Run Webhook Security");
  console.log("==================================================");

  const envConfig = dotenv.parse(fs.readFileSync(".env", "utf-8"));
  const webhookSecret = envConfig.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("GITHUB_WEBHOOK_SECRET missing in .env");

  function sign(payload: string, secret = webhookSecret): string {
    const hmac = crypto.createHmac("sha256", secret);
    return "sha256=" + hmac.update(payload).digest("hex");
  }

  const samplePrPayload = JSON.stringify({
    action: "closed",
    pull_request: {
      number: 999,
      title: "Security Verification PR",
      merged: true,
      head: { ref: "feature/test-sec" },
      base: { ref: "main" },
    },
    repository: { full_name: "Udit-Agarwal20/taskmaster-ai" },
  });

  const nonMergedPrPayload = JSON.stringify({
    action: "opened",
    pull_request: {
      number: 998,
      title: "Opened PR (Non-merged)",
      merged: false,
      head: { ref: "feature/test-sec" },
      base: { ref: "main" },
    },
    repository: { full_name: "Udit-Agarwal20/taskmaster-ai" },
  });

  // 1. Missing signature
  console.log("\n[1/4] Testing Missing Signature…");
  const resNoSig = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": "del-sec-nosig-" + Date.now(),
    },
    body: samplePrPayload,
  });
  console.log(`Status: ${resNoSig.status} (Expected: 401)`);
  if (resNoSig.status !== 401) throw new Error("Missing signature was not rejected with 401");
  console.log("✓ Correctly rejected missing signature with 401 Unauthorized.");

  // 2. Invalid signature
  console.log("\n[2/4] Testing Invalid Signature…");
  const resBadSig = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": "del-sec-badsig-" + Date.now(),
      "x-hub-signature-256": "sha256=invalid1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
    },
    body: samplePrPayload,
  });
  console.log(`Status: ${resBadSig.status} (Expected: 401)`);
  if (resBadSig.status !== 401) throw new Error("Invalid signature was not rejected with 401");
  console.log("✓ Correctly rejected invalid signature with 401 Unauthorized.");

  // 3. Valid signature (Merged PR)
  console.log("\n[3/4] Testing Valid Signature (Merged PR)…");
  const validSig = sign(samplePrPayload);
  const deliveryId = "del-sec-valid-" + Date.now();
  const resValid = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": validSig,
    },
    body: samplePrPayload,
  });
  console.log(`Status: ${resValid.status} (Expected: 200)`);
  const dataValid = await resValid.json();
  console.log(`Response:`, dataValid);
  if (resValid.status !== 200 || dataValid.status !== "queued") {
    throw new Error("Valid signature merged PR was not queued");
  }
  console.log("✓ Correctly accepted and queued valid merged PR webhook.");

  // 4. Non-merged PR event
  console.log("\n[4/4] Testing Non-merged PR Event…");
  const nonMergedSig = sign(nonMergedPrPayload);
  const resNonMerged = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": "del-sec-nonmerged-" + Date.now(),
      "x-hub-signature-256": nonMergedSig,
    },
    body: nonMergedPrPayload,
  });
  console.log(`Status: ${resNonMerged.status} (Expected: 200)`);
  const dataNonMerged = await resNonMerged.json();
  console.log(`Response:`, dataNonMerged);
  if (resNonMerged.status !== 200 || dataNonMerged.status !== "ignored") {
    throw new Error("Non-merged PR was not ignored");
  }
  console.log("✓ Correctly ignored non-merged PR event.");

  console.log("\n==================================================");
  console.log("✓ ALL 4 WEBHOOK SECURITY CHECKS PASSED!");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("✗ Security check failed:", err.message);
  process.exit(1);
});
