import * as Sentry from "@sentry/node";
import { prisma } from "@vaettir/db";
import { exchangeGooglePlayCode } from "./productionSignalOAuth.js";
import { encryptToken } from "./tokenEncryption.js";

export const GOOGLE_PLAY_CONNECTION_CANCELED_MESSAGE =
  "Google Play connection was canceled. No access was granted.";
export const GOOGLE_PLAY_CONNECTION_FAILED_MESSAGE =
  "Google Play could not be connected. Please try again. If it continues, contact beta support.";

type GooglePlayCallbackQuery = {
  code?: string;
  state?: string;
  error?: string;
};

type GooglePlayCallbackResult =
  | { httpStatus: 200; projectId: string; status: "connected"; message?: undefined }
  | { httpStatus: 200; projectId: string; status: "error"; message: string }
  | { httpStatus: 400; projectId: null; status: "error"; message: string };

type GooglePlayCallbackDependencies = {
  exchangeCode: typeof exchangeGooglePlayCode;
  encryptCredentials: typeof encryptToken;
  reportUnexpectedError: (error: unknown) => void;
};

const DEFAULT_DEPENDENCIES: GooglePlayCallbackDependencies = {
  exchangeCode: exchangeGooglePlayCode,
  encryptCredentials: encryptToken,
  reportUnexpectedError: (error) => Sentry.captureException(error),
};

/**
 * Completes the one-time Google Play callback without returning or persisting
 * provider exception text. Keeping this outside server.ts makes cancellation,
 * retry, and failure behavior deterministic and directly testable.
 */
export async function handleGooglePlayOAuthCallback(
  db: typeof prisma,
  query: GooglePlayCallbackQuery,
  dependencies: GooglePlayCallbackDependencies = DEFAULT_DEPENDENCIES,
): Promise<GooglePlayCallbackResult> {
  if (!query.state) {
    return { httpStatus: 400, projectId: null, status: "error", message: "missing connection state" };
  }

  const connection = await db.productionSignalConnection.findUnique({ where: { oauthState: query.state } });
  if (!connection || connection.provider !== "GOOGLE_PLAY") {
    return { httpStatus: 400, projectId: null, status: "error", message: "unknown or expired connection state" };
  }

  if (query.error) {
    const message =
      query.error === "access_denied"
        ? GOOGLE_PLAY_CONNECTION_CANCELED_MESSAGE
        : GOOGLE_PLAY_CONNECTION_FAILED_MESSAGE;
    if (query.error !== "access_denied") {
      dependencies.reportUnexpectedError(new Error("Google Play returned an OAuth error callback."));
    }
    await db.productionSignalConnection.update({
      where: { id: connection.id },
      data: { status: "ERROR", oauthState: null, lastSyncError: message },
    });
    return { httpStatus: 200, projectId: connection.projectId, status: "error", message };
  }

  if (!query.code) {
    await db.productionSignalConnection.update({
      where: { id: connection.id },
      data: {
        status: "ERROR",
        oauthState: null,
        lastSyncError: GOOGLE_PLAY_CONNECTION_FAILED_MESSAGE,
      },
    });
    return {
      httpStatus: 200,
      projectId: connection.projectId,
      status: "error",
      message: GOOGLE_PLAY_CONNECTION_FAILED_MESSAGE,
    };
  }

  try {
    const tokens = await dependencies.exchangeCode(query.code);
    const encrypted = dependencies.encryptCredentials(
      JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
    );
    await db.productionSignalConnection.update({
      where: { id: connection.id },
      data: {
        status: "CONNECTED",
        encryptedCredentials: encrypted.ciphertext,
        credentialsIv: encrypted.iv,
        credentialsAuthTag: encrypted.authTag,
        scope: tokens.scope,
        oauthState: null,
        connectedAt: new Date(),
        lastSyncError: null,
      },
    });
    return { httpStatus: 200, projectId: connection.projectId, status: "connected" };
  } catch (error) {
    dependencies.reportUnexpectedError(error);
    await db.productionSignalConnection.update({
      where: { id: connection.id },
      data: {
        status: "ERROR",
        oauthState: null,
        lastSyncError: GOOGLE_PLAY_CONNECTION_FAILED_MESSAGE,
      },
    });
    return {
      httpStatus: 200,
      projectId: connection.projectId,
      status: "error",
      message: GOOGLE_PLAY_CONNECTION_FAILED_MESSAGE,
    };
  }
}
