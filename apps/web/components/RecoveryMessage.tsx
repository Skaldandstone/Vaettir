"use client";
import Link from "next/link";

export function RecoveryMessage({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return <div role="alert" style={{ color: "var(--ember)", margin: "12px 0" }}>
    <p>{error}</p>
    <p>Check your connection and that you are signed in with the invited account. If your session expired, sign in again.</p>
    {onRetry && <button className="btn-secondary" onClick={onRetry}>Try again</button>}{" "}
    <Link href="/sign-in">Sign in</Link>{" · "}<Link href="/beta-guide">Beta help</Link>
  </div>;
}
