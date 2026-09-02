"use client";
import Link from "next/link";
import { isConnectionFailure } from "../lib/usability";
import { Icon } from "./ui/Workspace";

export function RecoveryMessage({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}) {
  const connectionFailure = isConnectionFailure(error);
  return (
    <div role="alert" className="recovery-panel">
      <span className="recovery-icon">
        <Icon name="alert" size={22} />
      </span>
      <div>
        <h2>
          {connectionFailure
            ? "Unable to reach Vaettir"
            : "That action could not be completed"}
        </h2>
        <p>
          {connectionFailure
            ? "We could not connect to the workspace service. Check your connection and try again. If this continues, contact your team owner or beta support."
            : error}
        </p>
        {!connectionFailure && (
          <p className="text-muted">
            If your session expired, sign in again with the email your team
            invited.
          </p>
        )}
        <div className="recovery-actions">
          {onRetry && (
            <button className="btn-secondary" type="button" onClick={onRetry}>
              Try again
            </button>
          )}
          {!connectionFailure && <Link href="/sign-in">Sign in</Link>}
          <Link href="/beta-guide">Beta help</Link>
        </div>
      </div>
    </div>
  );
}
