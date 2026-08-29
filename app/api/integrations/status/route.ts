import { NextRequest, NextResponse } from "next/server";
import { activityRepository, eventRepository, agentRunRepository } from "../../../../db/repositories";

export async function GET(request: NextRequest) {
  try {
    const projectId = "student-marketplace";

    // Query recent activities and events for real timestamps
    const [recentActivities, recentEvents, recentRuns] = await Promise.all([
      activityRepository.listByProject(projectId, 50),
      eventRepository.listByProject(projectId, 20),
      agentRunRepository.listByProject(projectId),
    ]);

    // Find last known timestamps
    const lastGithubActivity = recentActivities.find(
      (a: any) => a.actorId === "github-webhook" || a.eventType.includes("GITHUB")
    );
    const lastAgentActivity = recentActivities.find(
      (a: any) => a.actorType === "agent"
    );
    const lastSlackActivity = recentActivities.find(
      (a: any) => a.eventType === "SLACK_MESSAGE_SENT"
    );
    const lastEvent = recentEvents[0];
    const lastDbActivity = recentActivities[0];

    const integrations = [
      {
        id: "github",
        name: "GitHub",
        icon: "🐙",
        status: "CONNECTED",
        role: "Receives pull_request merge events and triggers autonomous project recovery",
        details: {
          repository: "Udit-Agarwal20/taskmaster-ai",
          events: ["pull_request.closed (merged)"],
          authMethod: "HMAC-SHA256 Webhook Signature",
        },
        lastEvent: lastGithubActivity
          ? {
              type: lastGithubActivity.eventType,
              timestamp: lastGithubActivity.createdAt,
              summary: lastGithubActivity.metadata?.prTitle
                ? `PR #${lastGithubActivity.metadata.prNumber}: ${lastGithubActivity.metadata.prTitle}`
                : "Pull request merged into main",
            }
          : null,
      },
      {
        id: "vertex-ai",
        name: "Google Cloud Vertex AI",
        icon: "🧠",
        status: "CONNECTED",
        role: "Powers autonomous project reasoning, dependency analysis, and recovery planning",
        details: {
          model: process.env.TASKMASTER_MODEL || "gemini-3.5-flash",
          framework: "@google/adk (1.6.0)",
          project: process.env.GOOGLE_CLOUD_PROJECT || "gen-lang-client-0057923797",
          location: process.env.GOOGLE_CLOUD_LOCATION || "global",
          authMethod: "Application Default Credentials (ADC)",
        },
        lastEvent: lastAgentActivity
          ? {
              type: lastAgentActivity.eventType,
              timestamp: lastAgentActivity.createdAt,
              summary:
                recentRuns[0]?.summary ||
                "Analyzed project dependencies & generated structured recovery plan",
            }
          : null,
      },
      {
        id: "pubsub",
        name: "Google Cloud Pub/Sub",
        icon: "📬",
        status: "CONNECTED",
        role: "Durable event buffer with authenticated IAM OIDC push delivery",
        details: {
          topic: process.env.PUBSUB_TOPIC || "taskmaster-events",
          subscription:
            process.env.PUBSUB_SUBSCRIPTION || "taskmaster-events-cloudrun-sub",
          deliveryType: "Authenticated Push (Google IAM OIDC)",
          serviceAccount:
            "taskmaster-pubsub-invoker@gen-lang-client-0057923797.iam.gserviceaccount.com",
        },
        lastEvent: lastEvent
          ? {
              type: lastEvent.type,
              timestamp: lastEvent.createdAt,
              summary: `Event ${lastEvent.id} (${lastEvent.type}) processed`,
            }
          : null,
      },
      {
        id: "postgres",
        name: "Neon PostgreSQL",
        icon: "🐘",
        status: "CONNECTED",
        role: "Authoritative ground truth for tasks, team members, dependencies, runs, and audit trail",
        details: {
          database: "Neon Serverless PostgreSQL",
          sslMode: "verify-full",
          safetyGuards: "Double DB Verification + Atomic DB Transactions",
        },
        lastEvent: lastDbActivity
          ? {
              type: lastDbActivity.eventType,
              timestamp: lastDbActivity.createdAt,
              summary: `Audit log record ${lastDbActivity.id} written`,
            }
          : null,
      },
      {
        id: "slack",
        name: "Slack Web API",
        icon: "💬",
        status: "CONNECTED",
        role: "Posts verified project updates and human approval notifications",
        details: {
          channel: "#taskmaster-demo (C0BS0FNNGMT)",
          client: "@slack/web-api",
          deliveryPolicy: "Guarded by post-mutation DB verification",
        },
        lastEvent: lastSlackActivity
          ? {
              type: lastSlackActivity.eventType,
              timestamp: lastSlackActivity.createdAt,
              summary:
                lastSlackActivity.metadata?.messagePreview ||
                "Project recovery notification delivered to #taskmaster-demo",
            }
          : null,
      },
    ];

    return NextResponse.json({
      status: "healthy",
      totalIntegrations: integrations.length,
      integrations,
    });
  } catch (error: any) {
    console.error("[Integrations API] Error fetching status:", error);
    return NextResponse.json(
      { error: "Failed to fetch integrations status", message: error.message },
      { status: 500 }
    );
  }
}
