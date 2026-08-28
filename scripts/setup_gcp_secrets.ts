import { spawnSync } from "child_process";
import * as fs from "fs";
import * as dotenv from "dotenv";
import * as crypto from "crypto";

const PROJECT_ID = "gen-lang-client-0057923797";

function setGcpSecret(name: string, value: string) {
  // 1. Create secret if it doesn't exist
  const createProc = spawnSync("gcloud", [
    "secrets",
    "create",
    name,
    "--project",
    PROJECT_ID,
    "--replication-policy",
    "automatic",
  ], {
    env: { ...process.env, CLOUDSDK_METRICS_ENVIRONMENT: "datacloud.antigravity" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  // 2. Add secret version via stdin (no value in command line or logs)
  const addProc = spawnSync("gcloud", [
    "secrets",
    "versions",
    "add",
    name,
    "--project",
    PROJECT_ID,
    "--data-file=-",
  ], {
    input: value,
    env: { ...process.env, CLOUDSDK_METRICS_ENVIRONMENT: "datacloud.antigravity" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (addProc.status !== 0) {
    const err = addProc.stderr.toString();
    throw new Error(`Failed to add version for ${name}: ${err}`);
  }

  console.log(`✓ Secret '${name}' configured in Secret Manager.`);
}

async function main() {
  console.log("==================================================");
  console.log(`Configuring Secret Manager for project: ${PROJECT_ID}`);
  console.log("==================================================");

  const envConfig = dotenv.parse(fs.readFileSync(".env", "utf-8"));

  const dbUrl = envConfig.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is missing in .env");

  const geminiKey = envConfig.GEMINI_API_KEY;
  if (!geminiKey) throw new Error("GEMINI_API_KEY is missing in .env");

  const slackToken = envConfig.SLACK_BOT_TOKEN;
  if (!slackToken) throw new Error("SLACK_BOT_TOKEN is missing in .env");

  const slackChannel = envConfig.SLACK_CHANNEL_ID;
  if (!slackChannel) throw new Error("SLACK_CHANNEL_ID is missing in .env");

  let webhookSecret = envConfig.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    webhookSecret = crypto.randomBytes(32).toString("hex");
    fs.appendFileSync(".env", `\nGITHUB_WEBHOOK_SECRET="${webhookSecret}"\n`);
    console.log("✓ Generated GITHUB_WEBHOOK_SECRET and appended to .env");
  }

  let pubsubVerificationToken = envConfig.PUBSUB_VERIFICATION_TOKEN;
  if (!pubsubVerificationToken) {
    pubsubVerificationToken = crypto.randomBytes(32).toString("hex");
    fs.appendFileSync(".env", `\nPUBSUB_VERIFICATION_TOKEN="${pubsubVerificationToken}"\n`);
    console.log("✓ Generated PUBSUB_VERIFICATION_TOKEN and appended to .env");
  }

  // Set all 6 secrets in Secret Manager
  setGcpSecret("taskmaster-database-url", dbUrl);
  setGcpSecret("taskmaster-gemini-api-key", geminiKey);
  setGcpSecret("taskmaster-github-webhook-secret", webhookSecret);
  setGcpSecret("taskmaster-slack-bot-token", slackToken);
  setGcpSecret("taskmaster-slack-channel-id", slackChannel);
  setGcpSecret("taskmaster-pubsub-verification-token", pubsubVerificationToken);

  console.log("==================================================");
  console.log("✓ All 6 secrets successfully created in Secret Manager!");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("Error setting secrets:", err.message);
  process.exit(1);
});
