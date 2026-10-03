"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { FrozenReport } from "@/components/FrozenReport";
import { trpcReact } from "@/lib/trpcReact";
export default function ReportSnapshotPage() {
  const { projectId, snapshotId } = useParams<{
    projectId: string;
    snapshotId: string;
  }>();
  const snapshot = trpcReact.reportSnapshots.get.useQuery({
    projectId,
    id: snapshotId,
  });
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage(
        "Link copied. Recipients must already have access to this workspace.",
      );
    } catch {
      setMessage(
        "Copy unavailable. Copy the address from your browser; workspace access is still required.",
      );
    }
  }
  return (
    <main style={{ maxWidth: 1100, marginInline: "auto" }}>
      <Link href={`/projects/${encodeURIComponent(projectId)}/reports`}>
        Back to reports
      </Link>
      {snapshot.isLoading && <p role="status">Loading frozen snapshot…</p>}
      {snapshot.error && (
        <div className="panel" role="alert">
          <p>Report unavailable. Workspace access is required.</p>
          <button
            className="btn-secondary"
            onClick={() => void snapshot.refetch()}
          >
            Try again
          </button>
        </div>
      )}
      {snapshot.data && !snapshot.error && (
        <div className="panel" style={{ marginTop: 16 }}>
          {snapshot.data.payload.state === "approved" ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void copy()}
            >
              Copy workspace sharing link
            </button>
          ) : (
            <p>
              Private preview. Approve it from the report builder before
              workspace sharing.
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <FrozenReport
            report={snapshot.data.payload}
            projectId={projectId}
            snapshotId={snapshotId}
            allowExport={snapshot.data.payload.state === "approved"}
          />
        </div>
      )}
    </main>
  );
}
