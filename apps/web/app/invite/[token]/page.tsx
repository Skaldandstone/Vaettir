"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc, type RouterOutputs } from "../../../lib/trpc";

export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [preview, setPreview] = useState<RouterOutputs["organization"]["previewInvitation"] | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.organization.previewInvitation
      .query({ token: params.token })
      .then(setPreview)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [params.token]);

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

  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!preview) return <p>Loading…</p>;

  if (preview.status !== "PENDING") {
    return <p>This invitation has already been {preview.status.toLowerCase()}.</p>;
  }
  if (preview.expired) {
    return <p>This invitation has expired. Ask an admin to send a new one.</p>;
  }
  if (!preview.emailMatches) {
    return <p>This invitation was sent to a different email address than the one you're signed in with.</p>;
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
