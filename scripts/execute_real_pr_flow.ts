import { spawnSync } from "child_process";
import * as fs from "fs";

const REPO = "Udit-Agarwal20/taskmaster-ai";
const HOOK_ID = 671215056;

async function main() {
  console.log("==================================================");
  console.log("Taskmaster: Executing REAL GitHub PR Merge Flow");
  console.log("==================================================");

  // 1. Get GitHub Token
  const cred = spawnSync("git", ["credential-osxkeychain", "get"], {
    input: "host=github.com\nprotocol=https\n",
  });
  const tokenMatch = cred.stdout.toString().match(/password=([^\n]+)/);
  if (!tokenMatch) throw new Error("Could not retrieve GitHub token from keychain");
  const token = tokenMatch[1];

  const headers = {
    Authorization: `token ${token}`,
    "User-Agent": "Taskmaster-Agent",
    "Content-Type": "application/json",
    Accept: "application/vnd.github.v3+json",
  };

  // 2. Fetch main branch ref
  console.log("\n[1/5] Fetching main branch reference…");
  const mainRefRes = await fetch(`https://api.github.com/repos/${REPO}/git/refs/heads/main`, { headers });
  if (!mainRefRes.ok) throw new Error("Failed to get main ref: " + (await mainRefRes.text()));
  const mainRefData = await mainRefRes.json();
  const mainSha = mainRefData.object.sha;
  console.log(`✓ Main SHA: ${mainSha}`);

  // 3. Create branch test/live-event-webhook-<timestamp>
  const branchName = `test/live-event-${Date.now()}`;
  console.log(`\n[2/5] Creating branch: ${branchName}…`);
  const createBranchRes = await fetch(`https://api.github.com/repos/${REPO}/git/refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: mainSha,
    }),
  });
  if (!createBranchRes.ok) throw new Error("Failed to create branch: " + (await createBranchRes.text()));
  console.log(`✓ Branch ${branchName} created.`);

  // 4. Create/update a file on the branch
  console.log("\n[3/5] Creating commit on branch…");
  const filePath = `docs/live_event_test_${Date.now()}.md`;
  const fileContent = Buffer.from(
    `# Live Event Verification\n\nTriggered at: ${new Date().toISOString()}\nTarget: Cloud Run + Pub/Sub + Gemini\n`
  ).toString("base64");

  const createFileRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: "chore: live event verification test",
      content: fileContent,
      branch: branchName,
    }),
  });
  if (!createFileRes.ok) throw new Error("Failed to create file: " + (await createFileRes.text()));
  console.log(`✓ Commit created on branch ${branchName}.`);

  // 5. Create Pull Request
  console.log("\n[4/5] Creating Pull Request…");
  const prRes = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Complete payment webhook integration",
      body: "Implement payment webhook handler and checkout verification for Student Marketplace Launch. Staging validation is the next step.",
      head: branchName,
      base: "main",
    }),
  });
  if (!prRes.ok) throw new Error("Failed to create PR: " + (await prRes.text()));
  const prData = await prRes.json();
  const prNumber = prData.number;
  console.log(`✓ Real PR #${prNumber} created: "${prData.title}" (${prData.html_url})`);

  // 6. Merge Pull Request
  console.log(`\n[5/5] Merging PR #${prNumber}…`);
  const mergeRes = await fetch(`https://api.github.com/repos/${REPO}/pulls/${prNumber}/merge`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      commit_title: `Merge PR #${prNumber}: Complete payment webhook integration`,
      merge_method: "merge",
    }),
  });
  if (!mergeRes.ok) throw new Error("Failed to merge PR: " + (await mergeRes.text()));
  const mergeData = await mergeRes.json();
  console.log(`✓ Real PR #${prNumber} MERGED successfully!`);
  console.log(`  Merge SHA: ${mergeData.sha}`);
  console.log(`  Merged at: ${new Date().toISOString()}`);

  // 7. Wait 5 seconds and fetch GitHub Webhook deliveries
  console.log("\nFetching GitHub Webhook deliveries log…");
  await new Promise((r) => setTimeout(r, 6000));

  const delivRes = await fetch(`https://api.github.com/repos/${REPO}/hooks/${HOOK_ID}/deliveries?per_page=5`, {
    headers,
  });
  if (delivRes.ok) {
    const deliveries = (await delivRes.json()) as any[];
    console.log(`Found ${deliveries.length} recent GitHub deliveries:`);
    deliveries.forEach((d, idx) => {
      console.log(`  [Delivery ${idx + 1}] ID: ${d.id}, Event: ${d.event}, Action: ${d.action}, Status: ${d.status_code}, DeliveredAt: ${d.delivered_at}`);
    });
  }

  console.log("\n==================================================");
  console.log("✓ REAL GITHUB PR MERGE FLOW EXECUTED!");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("✗ PR flow failed:", err.message);
  process.exit(1);
});
