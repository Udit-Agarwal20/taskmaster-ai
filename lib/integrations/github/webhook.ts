import crypto from "crypto";
import { CreateEventInput } from "@/db/repositories/event.repository";

export type NormalizedGitHubEventResult = {
  shouldProcess: boolean;
  reason?: string;
  normalizedEvent?: CreateEventInput;
};

/**
 * Verifies the GitHub HMAC-SHA256 signature (X-Hub-Signature-256) using timing-safe comparison.
 * Never exposes the secret or logs unverified payloads.
 */
export function verifyGitHubWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret = process.env.GITHUB_WEBHOOK_SECRET
): boolean {
  if (!secret) {
    // If no secret configured in test/demo mode, reject unless explicitly set
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  try {
    const hmac = crypto.createHmac("sha256", secret);
    const expectedSignature = "sha256=" + hmac.update(rawBody).digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    const signatureBuffer = Buffer.from(signatureHeader, "utf8");

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch {
    return false;
  }
}

/**
 * Resolves the Taskmaster project ID associated with a GitHub repository.
 * Milestone 4A uses deterministic server configuration (GITHUB_PROJECT_ID).
 */
export function getGitHubProjectMapping(repositoryFullName?: string): string {
  return process.env.GITHUB_PROJECT_ID || "student-marketplace";
}

/**
 * Normalizes incoming GitHub webhook payloads.
 * Only processes pull_request events where action="closed" AND pull_request.merged=true.
 * All other pull_request actions or event types are safely ignored.
 */
export function normalizeGitHubWebhook(
  eventHeader: string | null,
  deliveryId: string | null,
  payload: any
): NormalizedGitHubEventResult {
  if (!eventHeader || eventHeader.toLowerCase() !== "pull_request") {
    return {
      shouldProcess: false,
      reason: `Ignored GitHub event '${eventHeader || "unknown"}' (only 'pull_request' is handled)`,
    };
  }

  if (payload.action !== "closed" || !payload.pull_request?.merged) {
    return {
      shouldProcess: false,
      reason: `Pull request event ignored: action='${payload.action}', merged=${Boolean(payload.pull_request?.merged)}`,
    };
  }

  const pr = payload.pull_request;
  const repoName = payload.repository?.full_name || payload.repository?.name || "unknown/repository";
  const projectId = getGitHubProjectMapping(repoName);

  const effectiveDeliveryId = deliveryId || `sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const normalizedEvent: CreateEventInput = {
    type: "GITHUB_PULL_REQUEST_MERGED",
    projectId,
    source: "github",
    idempotencyKey: `github:${effectiveDeliveryId}`,
    payload: {
      repository: repoName,
      pullRequestNumber: pr.number,
      title: pr.title || "Untitled Pull Request",
      sourceBranch: pr.head?.ref || "feature",
      targetBranch: pr.base?.ref || "main",
      mergedBy: pr.merged_by?.login || payload.sender?.login || "github-user",
      mergedAt: pr.merged_at || new Date().toISOString(),
      deliveryId: effectiveDeliveryId,
    },
  };

  return {
    shouldProcess: true,
    normalizedEvent,
  };
}
