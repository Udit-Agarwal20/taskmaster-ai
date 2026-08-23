export type SendSlackMessageParams = {
  channelId?: string;
  text: string;
  blocks?: unknown[];
  idempotencyKey: string;
};

export type SendSlackMessageResult = {
  ok: boolean;
  messageId?: string;
  channelId?: string;
  ts?: string;
  error?: string;
  isMock?: boolean;
};

type MockSlackHandler = (
  params: SendSlackMessageParams
) => Promise<SendSlackMessageResult> | SendSlackMessageResult;

let mockHandler: MockSlackHandler | null = null;

export function setMockSlackHandler(handler: MockSlackHandler | null): void {
  mockHandler = handler;
}

/**
 * Sends a message to Slack using the official Slack Web API (chat.postMessage).
 * Requires the 'chat:write' bot token scope.
 * Never exposes the token in return values or error logs.
 */
export async function sendSlackMessage(
  params: SendSlackMessageParams
): Promise<SendSlackMessageResult> {
  if (mockHandler) {
    return await mockHandler(params);
  }

  const token = process.env.SLACK_BOT_TOKEN;
  const channel = params.channelId || process.env.SLACK_CHANNEL_ID;

  if (!token) {
    return {
      ok: false,
      error: "SLACK_BOT_TOKEN is not configured on server",
      channelId: channel,
    };
  }

  if (!channel) {
    return {
      ok: false,
      error: "SLACK_CHANNEL_ID is not configured and no channel was provided",
    };
  }

  try {
    const payload: Record<string, any> = {
      channel,
      text: params.text,
    };

    if (params.blocks && Array.isArray(params.blocks) && params.blocks.length > 0) {
      payload.blocks = params.blocks;
    }

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      const errorMsg = data.error || `Slack API HTTP status ${response.status}`;
      return {
        ok: false,
        error: errorMsg,
        channelId: channel,
      };
    }

    return {
      ok: true,
      messageId: data.ts,
      channelId: data.channel || channel,
      ts: data.ts,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err.message || "Failed to communicate with Slack API",
      channelId: channel,
    };
  }
}
