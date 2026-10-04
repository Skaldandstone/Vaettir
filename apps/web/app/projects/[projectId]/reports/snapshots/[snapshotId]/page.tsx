"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FrozenReport } from "@/components/FrozenReport";
import { trpcReact } from "@/lib/trpcReact";
export default function ReportSnapshotPage() {
  const { projectId, snapshotId } = useParams<{
    projectId: string;
    snapshotId: string;
  }>();
  return (
    <SnapshotDetail
      key={`${projectId}:${snapshotId}`}
      projectId={projectId}
      snapshotId={snapshotId}
    />
  );
}
function SnapshotDetail({
  projectId,
  snapshotId,
}: {
  projectId: string;
  snapshotId: string;
}) {
  const project = trpcReact.project.byId.useQuery(
    { id: projectId },
    { retry: false, staleTime: 0 },
  );
  const organizations = trpcReact.organization.mine.useQuery(undefined, {
    retry: false,
    staleTime: 0,
  });
  const projectReady =
    !project.error &&
    !project.isFetching &&
    !project.isPaused &&
    project.data?.id === projectId;
  const organizationId =
    project.data?.id === projectId ? project.data.organizationId : undefined;
  const accessReady =
    projectReady &&
    !organizations.error &&
    !organizations.isFetching &&
    !organizations.isPaused &&
    !!organizations.data?.some((org) => org.id === organizationId);
  const snapshot = trpcReact.reportSnapshots.get.useQuery(
    { projectId, id: snapshotId },
    { enabled: accessReady, retry: false, staleTime: 0 },
  );
  const ready =
    accessReady &&
    !snapshot.error &&
    !snapshot.isFetching &&
    !snapshot.isPaused &&
    snapshot.data?.id === snapshotId &&
    snapshot.data.projectId === projectId &&
    snapshot.data.organizationId === organizationId
      ? snapshot.data
      : null;
  const missingMembership =
    projectReady &&
    !organizations.error &&
    !organizations.isFetching &&
    !organizations.isPaused &&
    !!organizations.data &&
    !organizations.data.some((org) => org.id === organizationId);
  const wrongIdentity =
    accessReady &&
    !snapshot.error &&
    !snapshot.isFetching &&
    !snapshot.isPaused &&
    !!snapshot.data &&
    (snapshot.data.id !== snapshotId ||
      snapshot.data.projectId !== projectId ||
      snapshot.data.organizationId !== organizationId);
  const [message, setMessage] = useState("");
  const [copying, setCopying] = useState(false);
  const alive = useRef(true),
    copyGeneration = useRef(0);
  const previousOrganization = useRef<string | undefined>(undefined);
  const currentScope = useRef({ projectId, snapshotId, organizationId });
  currentScope.current = { projectId, snapshotId, organizationId };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      copyGeneration.current++;
    };
  }, []);
  useEffect(() => {
    copyGeneration.current++;
    setMessage("");
    setCopying(false);
    if (
      organizationId &&
      previousOrganization.current &&
      previousOrganization.current !== organizationId
    ) {
      // Same route can acquire a different current organization. Retain the
      // immutable cached capture, but obtain new access evidence before use.
      void snapshot.refetch();
    }
    previousOrganization.current = organizationId;
  }, [organizationId, snapshot.refetch]);
  async function refresh() {
    setMessage("");
    await Promise.all([
      project.refetch(),
      organizations.refetch(),
      snapshot.refetch(),
    ]);
  }
  async function copy() {
    if (!ready || ready.payload.state !== "approved" || copying) return;
    const originalOrganizationId = ready.organizationId;
    const generation = ++copyGeneration.current;
    setCopying(true);
    setMessage("");
    try {
      // Read-only reauthorization immediately before sharing. A cached approved
      // state is not permission, and an old tenant's successful response is not
      // permission after project reparenting or a route change.
      const [freshProject, freshOrganizations, freshSnapshot] =
        await Promise.all([
          project.refetch(),
          organizations.refetch(),
          snapshot.refetch(),
        ]);
      const scope = currentScope.current;
      if (
        !alive.current ||
        generation !== copyGeneration.current ||
        scope.projectId !== projectId ||
        scope.snapshotId !== snapshotId ||
        scope.organizationId !== originalOrganizationId
      )
        return;
      if (
        freshProject.error ||
        freshProject.isFetching ||
        freshProject.isPaused ||
        freshProject.data?.id !== projectId ||
        freshProject.data.organizationId !== originalOrganizationId ||
        freshOrganizations.error ||
        freshOrganizations.isFetching ||
        freshOrganizations.isPaused ||
        !freshOrganizations.data?.some(
          (org) => org.id === originalOrganizationId,
        ) ||
        freshSnapshot.error ||
        freshSnapshot.isFetching ||
        freshSnapshot.isPaused ||
        freshSnapshot.data?.id !== snapshotId ||
        freshSnapshot.data.projectId !== projectId ||
        freshSnapshot.data.organizationId !== originalOrganizationId ||
        freshSnapshot.data.payload.state !== "approved"
      ) {
        setMessage(
          "Current snapshot access could not be verified. No sharing link was copied.",
        );
        return;
      }
      const link = new URL(
        `/projects/${encodeURIComponent(projectId)}/reports/snapshots/${encodeURIComponent(snapshotId)}`,
        window.location.origin,
      );
      await navigator.clipboard.writeText(link.href);
      if (!alive.current || generation !== copyGeneration.current) return;
      setMessage(
        "Link copied. Recipients must already have access to this workspace.",
      );
    } catch {
      if (!alive.current || generation !== copyGeneration.current) return;
      setMessage(
        "Sharing link could not be copied. Retry after current workspace access is verified; recipients still need their own access.",
      );
    } finally {
      if (alive.current && generation === copyGeneration.current)
        setCopying(false);
    }
  }
  return (
    <main style={{ maxWidth: 1100, marginInline: "auto" }}>
      <Link href={`/projects/${encodeURIComponent(projectId)}/reports`}>
        Back to reports
      </Link>
      {project.error ||
      organizations.error ||
      snapshot.error ||
      missingMembership ||
      wrongIdentity ? (
        <div className="panel" role="alert">
          <p>
            Report unavailable. Current workspace access is required. Cached
            preview, export and sharing controls are withheld.
          </p>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => void refresh()}
          >
            Try again
          </button>
        </div>
      ) : !ready ? (
        <p role="status">
          {project.isPaused || organizations.isPaused || snapshot.isPaused
            ? "Reconnect to verify current snapshot access. Cached reports and exports are withheld."
            : "Verifying current workspace and frozen snapshot access…"}
        </p>
      ) : null}
      {message && <p role="status">{message}</p>}
      {ready && (
        <div className="panel" style={{ marginTop: 16 }}>
          {ready.payload.state === "approved" ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={copying}
              onClick={() => void copy()}
            >
              {copying
                ? "Verifying sharing access…"
                : "Copy workspace sharing link"}
            </button>
          ) : (
            <p>
              Private preview. Approve it from the report builder before
              workspace sharing.
            </p>
          )}
          <FrozenReport
            report={ready.payload}
            projectId={projectId}
            snapshotId={snapshotId}
            allowExport={ready.payload.state === "approved"}
          />
        </div>
      )}
    </main>
  );
}
