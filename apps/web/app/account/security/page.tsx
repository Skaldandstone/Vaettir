"use client";

import { useState } from "react";
import { useClerk, useUser, useReverification } from "@clerk/nextjs";

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "errors" in error) {
    const errors = (
      error as { errors?: Array<{ longMessage?: string; message?: string }> }
    ).errors;
    const first = errors?.[0];
    if (first)
      return (
        first.longMessage ??
        first.message ??
        "The security change could not be completed."
      );
  }
  return error instanceof Error
    ? error.message
    : "The security change could not be completed.";
}

export default function AccountSecurityPage() {
  const { isLoaded, user } = useUser();
  const clerk = useClerk();
  const reverify = useReverification((action: () => Promise<void>) => action());
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  if (!isLoaded || !user) return <p>Loading account security…</p>;
  const currentUser = user;

  async function run(label: string, action: () => Promise<void>) {
    setPending(label);
    setError(null);
    try {
      await reverify(action);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  }

  function startPasskey() {
    void run("passkey", async () => {
      await currentUser.createPasskey();
      await currentUser.reload();
    });
  }

  function startTotp() {
    void run("totp-start", async () => {
      const resource = await currentUser.createTOTP();
      setTotpSecret(resource.secret ?? null);
      setTotpUri(resource.uri ?? null);
      setBackupCodes([]);
    });
  }

  function verifyTotp() {
    void run("totp-verify", async () => {
      const resource = await currentUser.verifyTOTP({ code: totpCode.trim() });
      setBackupCodes(resource.backupCodes ?? []);
      setTotpCode("");
      setTotpSecret(null);
      setTotpUri(null);
      await currentUser.reload();
    });
  }

  function disableTotp() {
    if (
      !confirm(
        "Disable authenticator-app two-factor authentication for this account?",
      )
    )
      return;
    void run("totp-disable", async () => {
      await currentUser.disableTOTP();
      setBackupCodes([]);
      await currentUser.reload();
    });
  }

  function regenerateBackupCodes() {
    if (
      !confirm(
        "Replace the existing backup codes? Previously saved codes will stop working.",
      )
    )
      return;
    void run("backup-codes", async () => {
      const resource = await currentUser.createBackupCode();
      setBackupCodes(resource.codes);
      await currentUser.reload();
    });
  }

  return (
    <div className="security-center">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Account</div>
          <h1>Security &amp; sign-in</h1>
          <p>
            Manage passwordless sign-in and second factors. Available methods
            depend on your organization and identity-provider settings.
          </p>
        </div>
      </div>

      {error && (
        <div className="workspace-alert workspace-alert-error" role="alert">
          <strong>Security option unavailable</strong>
          <span>{error}</span>
          <small>
            If Clerk reports that a strategy is disabled, an instance
            administrator must enable it before enrollment.
          </small>
        </div>
      )}

      <div className="security-method-grid">
        <section className="panel security-method-card">
          <div className="security-method-heading">
            <div>
              <span className="security-method-icon" aria-hidden="true">
                ⌘
              </span>
              <h2>Passkeys</h2>
            </div>
            <span
              className={`status-pill ${currentUser.passkeys.length ? "status-success" : "status-neutral"}`}
            >
              {currentUser.passkeys.length
                ? `${currentUser.passkeys.length} enrolled`
                : "Not enrolled"}
            </span>
          </div>
          <p>
            Sign in with Windows Hello, Touch ID, Face ID, or a hardware
            security key. No Vaettir password is needed.
          </p>
          {currentUser.passkeys.length > 0 && (
            <ul className="security-method-list">
              {currentUser.passkeys.map((passkey) => (
                <li key={passkey.id}>
                  <span>
                    <strong>{passkey.name || "Passkey"}</strong>
                    <small>
                      Added {passkey.createdAt.toLocaleDateString()}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      if (
                        confirm(
                          "Remove this passkey? Make sure you have another working sign-in method first.",
                        )
                      )
                        void run(`delete-${passkey.id}`, async () => {
                          await passkey.delete();
                          await currentUser.reload();
                        });
                    }}
                    disabled={pending !== null}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={startPasskey}
            disabled={pending !== null}
          >
            {pending === "passkey" ? "Waiting for device…" : "+ Add a passkey"}
          </button>
        </section>

        <section className="panel security-method-card">
          <div className="security-method-heading">
            <div>
              <span className="security-method-icon" aria-hidden="true">
                2×
              </span>
              <h2>Authenticator 2FA</h2>
            </div>
            <span
              className={`status-pill ${currentUser.totpEnabled ? "status-success" : "status-neutral"}`}
            >
              {currentUser.totpEnabled ? "Enabled" : "Not enabled"}
            </span>
          </div>
          <p>
            Require a rotating code from 1Password, Google Authenticator, Authy,
            or another TOTP app after sign-in.
          </p>
          {!currentUser.totpEnabled && !totpSecret && (
            <button
              type="button"
              className="btn-primary"
              onClick={startTotp}
              disabled={pending !== null}
            >
              Set up authenticator
            </button>
          )}
          {totpSecret && (
            <div className="security-enrollment sentry-block" data-private>
              <strong>1. Add Vaettir to your authenticator</strong>
              <p>
                Enter this private setup key in your authenticator. Never share
                it.
              </p>
              <code>{totpSecret}</code>
              {totpUri && <a href={totpUri}>Open in an authenticator app</a>}
              <label>
                <span>2. Enter the six-digit code</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={(event) =>
                    setTotpCode(
                      event.target.value.replace(/\D/g, "").slice(0, 6),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="btn-primary"
                disabled={totpCode.length !== 6 || pending !== null}
                onClick={verifyTotp}
              >
                Verify and enable 2FA
              </button>
            </div>
          )}
          {currentUser.totpEnabled && (
            <div className="button-row">
              <button
                type="button"
                className="btn-secondary"
                onClick={regenerateBackupCodes}
                disabled={pending !== null}
              >
                New backup codes
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={disableTotp}
                disabled={pending !== null}
              >
                Disable 2FA
              </button>
            </div>
          )}
        </section>
      </div>

      {backupCodes.length > 0 && (
        <section
          className="panel backup-code-panel sentry-block"
          data-private
          aria-live="polite"
        >
          <h2>Save your backup codes now</h2>
          <p>
            Each code can be used once if your authenticator is unavailable.
            Store them somewhere secure.
          </p>
          <div>
            {backupCodes.map((code) => (
              <code key={code}>{code}</code>
            ))}
          </div>
          <button onClick={() => setBackupCodes([])}>
            I saved these codes; hide them
          </button>
        </section>
      )}

      <section className="panel account-identity-panel">
        <div>
          <h2>OAuth identities and active sessions</h2>
          <p>
            {currentUser.externalAccounts.length
              ? `${currentUser.externalAccounts.length} connected OAuth ${currentUser.externalAccounts.length === 1 ? "identity" : "identities"}. Review connected providers and sign out old devices from the account manager.`
              : "No OAuth identity is currently visible on this account. Review the account manager before changing sign-in methods."}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => clerk.openUserProfile()}
        >
          Review account and devices
        </button>
      </section>
    </div>
  );
}
