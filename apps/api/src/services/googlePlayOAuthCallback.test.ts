import { describe, expect, it, vi } from "vitest";
import type { prisma } from "@vaettir/db";
import {
  GOOGLE_PLAY_CONNECTION_CANCELED_MESSAGE,
  GOOGLE_PLAY_CONNECTION_FAILED_MESSAGE,
  handleGooglePlayOAuthCallback,
} from "./googlePlayOAuthCallback.js";

function callbackHarness() {
  const connection = { id: "connection-1", projectId: "project-1", provider: "GOOGLE_PLAY" };
  const findUnique = vi.fn().mockResolvedValue(connection);
  const update = vi.fn().mockResolvedValue(connection);
  const exchangeCode = vi.fn().mockResolvedValue({
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    scope: "androidpublisher",
    expiresInSeconds: 3600,
  });
  const encryptCredentials = vi.fn().mockReturnValue({
    ciphertext: "encrypted",
    iv: "iv",
    authTag: "tag",
  });
  const reportUnexpectedError = vi.fn();
  const db = { productionSignalConnection: { findUnique, update } } as unknown as typeof prisma;
  const dependencies = { exchangeCode, encryptCredentials, reportUnexpectedError };
  return { db, dependencies, findUnique, update, exchangeCode, encryptCredentials, reportUnexpectedError };
}

describe("handleGooglePlayOAuthCallback", () => {
  it("clears a canceled flow and returns useful bounded copy", async () => {
    const harness = callbackHarness();
    const result = await handleGooglePlayOAuthCallback(
      harness.db,
      { state: "one-time-state", error: "access_denied" },
      harness.dependencies,
    );

    expect(result).toEqual({
      httpStatus: 200,
      projectId: "project-1",
      status: "error",
      message: GOOGLE_PLAY_CONNECTION_CANCELED_MESSAGE,
    });
    expect(harness.update).toHaveBeenCalledWith({
      where: { id: "connection-1" },
      data: {
        status: "ERROR",
        oauthState: null,
        lastSyncError: GOOGLE_PLAY_CONNECTION_CANCELED_MESSAGE,
      },
    });
    expect(harness.exchangeCode).not.toHaveBeenCalled();
    expect(harness.reportUnexpectedError).not.toHaveBeenCalled();
  });

  it("reports an exchange failure internally without reflecting or persisting its details", async () => {
    const harness = callbackHarness();
    const providerError = new Error("invalid_grant: code and private provider details");
    harness.exchangeCode.mockRejectedValue(providerError);

    const result = await handleGooglePlayOAuthCallback(
      harness.db,
      { state: "one-time-state", code: "authorization-code" },
      harness.dependencies,
    );

    expect(harness.reportUnexpectedError).toHaveBeenCalledWith(providerError);
    expect(result).toEqual({
      httpStatus: 200,
      projectId: "project-1",
      status: "error",
      message: GOOGLE_PLAY_CONNECTION_FAILED_MESSAGE,
    });
    expect(harness.update).toHaveBeenCalledWith({
      where: { id: "connection-1" },
      data: {
        status: "ERROR",
        oauthState: null,
        lastSyncError: GOOGLE_PLAY_CONNECTION_FAILED_MESSAGE,
      },
    });
    expect(JSON.stringify(result)).not.toContain("invalid_grant");
    expect(JSON.stringify(harness.update.mock.calls)).not.toContain("private provider details");
  });

  it("bounds a provider error callback and consumes its one-time state", async () => {
    const harness = callbackHarness();
    const result = await handleGooglePlayOAuthCallback(
      harness.db,
      { state: "one-time-state", error: "provider_specific_error" },
      harness.dependencies,
    );

    expect(result).toEqual({
      httpStatus: 200,
      projectId: "project-1",
      status: "error",
      message: GOOGLE_PLAY_CONNECTION_FAILED_MESSAGE,
    });
    expect(harness.reportUnexpectedError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("provider_specific_error");
    expect(JSON.stringify(harness.update.mock.calls)).not.toContain("provider_specific_error");
  });

  it("clears a valid state when the callback omits both code and provider error", async () => {
    const harness = callbackHarness();
    const result = await handleGooglePlayOAuthCallback(
      harness.db,
      { state: "one-time-state" },
      harness.dependencies,
    );

    expect(result).toEqual({
      httpStatus: 200,
      projectId: "project-1",
      status: "error",
      message: GOOGLE_PLAY_CONNECTION_FAILED_MESSAGE,
    });
    expect(harness.update).toHaveBeenCalledWith({
      where: { id: "connection-1" },
      data: {
        status: "ERROR",
        oauthState: null,
        lastSyncError: GOOGLE_PLAY_CONNECTION_FAILED_MESSAGE,
      },
    });
    expect(harness.exchangeCode).not.toHaveBeenCalled();
  });

  it("stores only encrypted credentials after a successful exchange", async () => {
    const harness = callbackHarness();
    const result = await handleGooglePlayOAuthCallback(
      harness.db,
      { state: "one-time-state", code: "authorization-code" },
      harness.dependencies,
    );

    expect(result).toEqual({ httpStatus: 200, projectId: "project-1", status: "connected" });
    expect(harness.encryptCredentials).toHaveBeenCalledWith(
      JSON.stringify({ accessToken: "access-secret", refreshToken: "refresh-secret" }),
    );
    const updateInput = harness.update.mock.calls[0]?.[0];
    expect(updateInput.data).toMatchObject({
      status: "CONNECTED",
      encryptedCredentials: "encrypted",
      credentialsIv: "iv",
      credentialsAuthTag: "tag",
      scope: "androidpublisher",
      oauthState: null,
      lastSyncError: null,
    });
    expect(JSON.stringify(updateInput)).not.toContain("access-secret");
    expect(JSON.stringify(updateInput)).not.toContain("refresh-secret");
  });

  it("fails closed for missing or expired state without exchanging a code", async () => {
    const missingState = callbackHarness();
    await expect(
      handleGooglePlayOAuthCallback(missingState.db, { code: "authorization-code" }, missingState.dependencies),
    ).resolves.toEqual({
      httpStatus: 400,
      projectId: null,
      status: "error",
      message: "missing connection state",
    });
    expect(missingState.findUnique).not.toHaveBeenCalled();

    const expiredState = callbackHarness();
    expiredState.findUnique.mockResolvedValue(null);
    await expect(
      handleGooglePlayOAuthCallback(
        expiredState.db,
        { state: "expired", code: "authorization-code" },
        expiredState.dependencies,
      ),
    ).resolves.toEqual({
      httpStatus: 400,
      projectId: null,
      status: "error",
      message: "unknown or expired connection state",
    });
    expect(expiredState.exchangeCode).not.toHaveBeenCalled();
  });
});
