"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpcReact } from "../../../lib/trpcReact";

// P1-15
export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const previewQuery = trpcReact.organization.previewInvitation.useQuery({ token: params.token });
  const [error, setError] = useState<string | null>(null);

  const acceptMutation = trpcReact.organization.acceptInvitation.useMutation({
    onSuccess: () => router.push("/projects"),
    onError: (e) => setError(e.message),
  });

  function accept() {
    setError(null);
    acceptMutation.mutate({ token: params.token });
  }

  const preview = previewQuery.data;
  const combinedError = error ?? previewQuery.error?.message ?? null;

  if (combinedError) return <p style={{ color: "var(--ember)" }}>{combinedError}</p>;
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
      <button onClick={accept} disabled={acceptMutation.isPending}>
        {acceptMutation.isPending ? "Joining…" : "Accept invitation"}
      </button>
    </div>
  );
}
