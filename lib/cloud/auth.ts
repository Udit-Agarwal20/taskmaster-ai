import { OAuth2Client } from "google-auth-library";

const authClient = new OAuth2Client();

export const EXPECTED_PUBSUB_SERVICE_ACCOUNT =
  process.env.PUBSUB_INVOKER_SERVICE_ACCOUNT ||
  "taskmaster-pubsub-invoker@gen-lang-client-0057923797.iam.gserviceaccount.com";

export interface OidcVerificationResult {
  valid: boolean;
  email?: string;
  error?: string;
}

/**
 * Validates Google Cloud IAM / OIDC ID token from incoming Pub/Sub push requests.
 * Ensures the request originates from the authorized Google Cloud Pub/Sub service account.
 */
export async function verifyGoogleOidcToken(
  authHeader: string | null
): Promise<OidcVerificationResult> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Missing or malformed Authorization Bearer header" };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { valid: false, error: "Empty Bearer token" };
  }

  // Support local test environment verification token if configured and not in production
  const isProduction = process.env.NODE_ENV === "production";
  const localTestToken = process.env.PUBSUB_VERIFICATION_TOKEN;

  if (!isProduction && localTestToken) {
    if (token === localTestToken) {
      return { valid: true, email: EXPECTED_PUBSUB_SERVICE_ACCOUNT };
    }
    return { valid: false, error: "Invalid test verification token" };
  }

  try {
    const ticket = await authClient.verifyIdToken({
      idToken: token,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      return { valid: false, error: "Missing token payload" };
    }

    if (!payload.email_verified) {
      return { valid: false, error: "Token email is not verified" };
    }

    const email = payload.email || "";
    if (email.toLowerCase() !== EXPECTED_PUBSUB_SERVICE_ACCOUNT.toLowerCase()) {
      return {
        valid: false,
        email,
        error: `Unauthorized service account: '${email}'. Expected '${EXPECTED_PUBSUB_SERVICE_ACCOUNT}'`,
      };
    }

    return { valid: true, email };
  } catch (err: any) {
    return { valid: false, error: `Invalid Google OIDC token: ${err.message}` };
  }
}
