"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc, type RouterOutputs } from "../../../lib/trpc";
import { RecoveryMessage } from "../../../components/RecoveryMessage";

export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [preview, setPreview] = useState<RouterOutputs["organization"]["previewInvitation"] | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setError(null);
    trpc.organization.previewInvitation
      .query({ token: params.token })
      .then((value) => { if (active) setPreview(value); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; };
  }, [params.token, attempt]);

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      await trpc.organization.acceptInvitation.mutate({ token: params.token });
      router.push("/projects");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccepting(false);
    }
  }

  if (error) return <div><h1>Join your beta team</h1><RecoveryMessage error={error} onRetry={() => setAttempt((value) => value + 1)} /></div>;
  if (!preview) return <p>Loading…</p>;

  if (preview.status !== "PENDING") {
    return <div><p>This invitation has already been {preview.status.toLowerCase()}.</p><Link href="/projects">Open your projects</Link><p>Need access? Ask your team admin for a new invitation.</p></div>;
  }
  if (preview.expired) {
    return <p>This invitation has expired. Ask an admin to send a new one.</p>;
  }
  if (!preview.emailMatches) {
    return <div><p>This invitation was sent to a different email address than the one you&apos;re signed in with.</p><p>Sign out using the account menu, then open this invitation again with the invited account.</p><a href="/beta-guide">Beta help</a></div>;
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <h1>Join {preview.organizationName}</h1>
      <p>
        You've been invited as <strong>{preview.role}</strong> ({preview.seatType.toLowerCase()} seat).
      </p>
      <button onClick={accept} disabled={accepting}>
        {accepting ? "Joining…" : "Accept invitation"}
      </button>
    </div>
  );
}
