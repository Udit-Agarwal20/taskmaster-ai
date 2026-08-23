export type SlackMessageParams = {
  projectTitle: string;
  triggerDescription: string;
  actionDescription: string;
  statusText?: string;
  reason: string;
};

/**
 * Formats a clean, structured notification message for team channels in Slack.
 * Designed to be concise and actionable without exposing model chain-of-thought.
 */
export function formatTaskmasterSlackUpdate(params: SlackMessageParams): string {
  const status = params.statusText || "Verified ✓";

  return [
    `*Taskmaster completed a project action*`,
    ``,
    `*Project:* ${params.projectTitle}`,
    `*Trigger:* ${params.triggerDescription}`,
    `*Action:* ${params.actionDescription}`,
    `*Status:* ${status}`,
    `*Reason:* ${params.reason}`,
  ].join("\n");
}
