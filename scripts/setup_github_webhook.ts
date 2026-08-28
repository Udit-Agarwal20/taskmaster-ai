import { spawnSync } from "child_process";
import * as fs from "fs";
import * as dotenv from "dotenv";

const REPO = "Udit-Agarwal20/taskmaster-ai";
const WEBHOOK_URL = "https://taskmaster-service-137377771269.us-central1.run.app/api/integrations/github/webhook";

async function main() {
  console.log("==================================================");
  console.log(`Configuring GitHub Webhook for repository: ${REPO}`);
  console.log("==================================================");

  // 1. Get GitHub Token
  const cred = spawnSync("git", ["credential-osxkeychain", "get"], {
    input: "host=github.com\nprotocol=https\n",
  });
  const tokenMatch = cred.stdout.toString().match(/password=([^\n]+)/);
  if (!tokenMatch) throw new Error("Could not retrieve GitHub token from keychain");
  const token = tokenMatch[1];

  // 2. Get GITHUB_WEBHOOK_SECRET
  const envConfig = dotenv.parse(fs.readFileSync(".env", "utf-8"));
  const webhookSecret = envConfig.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("GITHUB_WEBHOOK_SECRET missing in .env");

  // 3. Check existing webhooks
  const listRes = await fetch(`https://api.github.com/repos/${REPO}/hooks`, {
    headers: {
      Authorization: `token ${token}`,
      "User-Agent": "Taskmaster-Agent",
      Accept: "application/vnd.github.v3+json",
    },
  });
  const existingHooks = (await listRes.json()) as any[];

  const matchingHook = Array.isArray(existingHooks)
    ? existingHooks.find((h) => h.config?.url === WEBHOOK_URL)
    : null;

  const hookPayload = {
    name: "web",
    active: true,
    events: ["pull_request"],
    config: {
      url: WEBHOOK_URL,
      content_type: "json",
      secret: webhookSecret,
      insecure_ssl: "0",
    },
  };

  if (matchingHook) {
    console.log(`Found existing webhook #${matchingHook.id}. Updating…`);
    const updateRes = await fetch(`https://api.github.com/repos/${REPO}/hooks/${matchingHook.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `token ${token}`,
        "User-Agent": "Taskmaster-Agent",
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify(hookPayload),
    });
    if (!updateRes.ok) {
      const err = await updateRes.text();
      throw new Error(`Failed to update webhook: ${err}`);
    }
    const updated = await updateRes.json();
    console.log(`✓ Webhook #${updated.id} updated successfully.`);
  } else {
    console.log("Creating new webhook on GitHub…");
    const createRes = await fetch(`https://api.github.com/repos/${REPO}/hooks`, {
      method: "POST",
      headers: {
        Authorization: `token ${token}`,
        "User-Agent": "Taskmaster-Agent",
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify(hookPayload),
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create webhook: ${err}`);
    }
    const created = await createRes.json();
    console.log(`✓ Webhook #${created.id} created successfully!`);
    console.log(`  Target URL: ${created.config.url}`);
    console.log(`  Events: ${created.events.join(", ")}`);
    console.log(`  Active: ${created.active}`);
  }

  console.log("==================================================");
}

main().catch((err) => {
  console.error("✗ Webhook setup failed:", err.message);
  process.exit(1);
});
