"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Modal } from "./Modal";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import { verifiedManualRetestAck, verifiedManualRetestRead, sameManualRetestScope } from "@/lib/manual-retest-scope-ack";
import type { ManualRetestExpectedScope } from "@vaettir/api/src/services/manualRetestScopeSchema";

type Preview = RouterOutputs["manualRetest"]["preview"];
type Start = RouterInputs["manualRetest"]["start"];
const link = (projectId: string, runId: string) =>
  `/projects/${encodeURIComponent(projectId)}/test-runs/manual/${encodeURIComponent(runId)}`;
const labels: Record<string, string> = {
  configuration: "Configuration / variant",
  platform: "Platform / device",
  build: "Build / revision",
  environment: "Environment",
  hardwareRevision: "Hardware revision",
  firmwareVersion: "Firmware version",
  rig: "Rig",
  batchOrLot: "Batch / lot",
  calibrationReference: "Calibration reference",
  protocolReference: "Protocol reference",
  setup: "Setup",
  safety: "Safety",
  instruments: "Instruments",
  acceptanceCriteria: "Acceptance criteria",
};

/** Local origin never silently rebases, even if both actors/organizations can read this project. */
function useRetestAccess(projectId: string, active: boolean, editor: boolean, pinnedScope?: ManualRetestExpectedScope | null) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [origin, setOrigin] = useState<ManualRetestExpectedScope | null>(pinnedScope ?? null);
  const project = trpcReact.project.byId.useQuery({ id: projectId }, { enabled: active, staleTime: 0, retry: false });
  const organizations = trpcReact.organization.mine.useQuery(undefined, { enabled: active, staleTime: 0, retry: false });
  const actorReady = isLoaded && isSignedIn && !!userId;
  const projectReady = !project.error && !project.isFetching && !project.isPaused && project.data?.id === projectId;
  const memberChecked = !organizations.error && !organizations.isFetching && !organizations.isPaused && Array.isArray(organizations.data);
  const member = memberChecked ? organizations.data?.find(row => row.id === project.data?.organizationId) : undefined;
  const memberReady = !!member && ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(member.role) && ["FULL", "READ_ONLY"].includes(member.seatType);
  const canWrite = !!member && member.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(member.role);
  const current = actorReady && projectReady && memberReady ? { projectId, organizationId: project.data!.organizationId, clerkActorId: userId! } : null;
  useEffect(() => {
    if (active && !origin && current && (!pinnedScope || sameManualRetestScope(pinnedScope, current))) setOrigin(pinnedScope ?? current);
  }, [active, origin, current, pinnedScope]);
  const paused = project.isPaused || organizations.isPaused;
  const changed = !!origin && !!current && !sameManualRetestScope(origin, current) || !!origin && !!pinnedScope && !sameManualRetestScope(origin, pinnedScope);
  const denied = (isLoaded && !actorReady) || !!project.error || !!organizations.error || changed ||
    (projectReady && memberChecked && (!memberReady || editor && !canWrite));
  const ready = active && !denied && !paused && !!origin && sameManualRetestScope(origin, current) && (!editor || canWrite);
  const actorNow = useRef({ actorReady, userId }); actorNow.current = { actorReady, userId };
  async function refresh() {
    try {
      const [freshProject, freshOrganizations] = await Promise.all([project.refetch(), organizations.refetch()]);
      return !!origin && actorNow.current.actorReady && actorNow.current.userId === origin.clerkActorId &&
        !freshProject.error && !freshProject.isFetching && !freshProject.isPaused && freshProject.data?.id === projectId && freshProject.data.organizationId === origin.organizationId &&
        !freshOrganizations.error && !freshOrganizations.isFetching && !freshOrganizations.isPaused && !!freshOrganizations.data?.some(row => row.id === origin.organizationId &&
          ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(row.role) && ["FULL", "READ_ONLY"].includes(row.seatType) &&
          (!editor || row.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(row.role)));
    } catch { return false; /* Keep origin and reviewed values; failed current reads do not authorize cache. */ }
  }
  return { ready, paused, denied, origin, canWrite, refresh };
}

export function ManualRetestWizard({
  projectId,
  sourceRunId,
  testCaseId,
  open,
  onClose,
  active = true,
  onRetainedRequestChange,
  expectedScope,
}: {
  projectId: string;
  sourceRunId: string;
  testCaseId: string;
  open: boolean;
  onClose: () => void;
  active?: boolean;
  onRetainedRequestChange?: (retained: boolean) => void;
  expectedScope?: ManualRetestExpectedScope | null;
}) {
  const utils = trpcReact.useUtils();
  const mutation = trpcReact.manualRetest.start.useMutation();
  const access = useRetestAccess(projectId, active, true, expectedScope);
  const accessNow = useRef(access); accessNow.current = access;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [attempt, setAttempt] = useState<Start | null>(null);
  const [receipt, setReceipt] = useState<
    RouterOutputs["manualRetest"]["start"] | null
  >(null);
  const [busy, setBusy] = useState(false),
    [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [ambiguous, setAmbiguous] = useState(false),
    [rejected, setRejected] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState("");
  const [accessRejected, setAccessRejected] = useState(false);
  const unknown = useRef(false), openNow = useRef(open && active); openNow.current = open && active;
  useEffect(() => { onRetainedRequestChange?.(busy || Boolean(attempt && !receipt && !rejected)); }, [busy, attempt, receipt, rejected, onRetainedRequestChange]);
  async function review() {
    if (!active || !open || busy || attempt || receipt) return;
    if (!access.ready || !access.origin) return;
    if (accessRejected) return;
    const request = { projectId, sourceRunId, testCaseId, expectedScope: access.origin };
    onRetainedRequestChange?.(true);
    setBusy(true);
    setError(null);
    try {
      const result = await utils.manualRetest.preview.fetch(request, { staleTime: 0 });
      if (!accessNow.current.ready || !openNow.current || !sameManualRetestScope(request.expectedScope, accessNow.current.origin)) {
        setError("Current access or the open review changed while loading. Retained evidence was not replaced; recheck the original scope."); return;
      }
      if (!verifiedManualRetestRead(request, result) || result.projectId !== projectId || result.sourceRunId !== sourceRunId || result.testCaseId !== testCaseId)
        throw Error("The exact retest preview scope could not be verified. No approval baseline was replaced.");
      setPreview(result);
      setApproved(false);
    } catch (e) {
      if (["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes((e as { data?: { code?: string } }).data?.code ?? "")) setAccessRejected(true);
      setError(
        e instanceof Error
          ? e.message
          : "Original evidence could not be reviewed. Nothing was started.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!active || !open || !preview || !approved || busy || receipt || rejected) return;
    if (!access.ready || !access.origin) return;
    if (accessRejected) return;
    const request = attempt ?? {
      projectId,
      sourceRunId,
      testCaseId,
      expectedReviewHash: preview.reviewHash,
      idempotencyKey: crypto.randomUUID(),
      expectedScope: access.origin,
    };
    if (!sameManualRetestScope(request.expectedScope, access.origin)) { setError("Restore the exact original actor and organization before retrying. This request was not rebound."); return; }
    setAttempt(request);
    onRetainedRequestChange?.(true);
    setBusy(true);
    setError(null);
    try {
      const result = await mutation.mutateAsync(request);
      if (!await verifiedManualRetestAck(request, result)) {
        unknown.current = true; setAmbiguous(true); setError("The retest acknowledgement did not prove this exact scoped request and deterministic run. Keep and retry the same UUID; no receipt was substituted."); return;
      }
      // Verified historical ACK is retained even after current UI scope changes;
      // factual rendering remains gated. A refresh failure cannot resubmit it.
      setReceipt(result); unknown.current = false; setAmbiguous(false); setRejected(false);
      void Promise.all([
        Promise.resolve().then(() => utils.manualRetest.links.invalidate({ projectId, sourceRunId, testCaseId })),
        Promise.resolve().then(() => utils.caseExecutionHistory.list.invalidate({ projectId, testCaseId })),
      ]).catch(() => setRefreshNotice("Retest creation is confirmed, but refreshing current history or links failed. Recheck access and refresh those views; do not submit the accepted request again."));
    } catch (e) {
      const code = (e as { data?: { code?: string } }).data?.code;
      if (["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(code ?? "")) setAccessRejected(true);
      const definitive = [
        "BAD_REQUEST",
        "CONFLICT",
        "FORBIDDEN",
        "NOT_FOUND",
        "UNAUTHORIZED",
      ].includes(code ?? "");
      if (definitive && !ambiguous && !unknown.current) setRejected(true);
      else { unknown.current = true; setAmbiguous(true); }
      setError(
        e instanceof Error
          ? e.message
          : "The retest response is unknown. Retry this same request to recover its receipt.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open && active}
      onClose={onClose}
      title="Retest this execution"
      size="wide"
      dismissible={!busy}
    >
      {!active ? <p role="status">Current history access is unavailable. The exact retained retest request and review remain mounted; private evidence and actions are hidden.</p>
      : !access.ready || accessRejected ? <section><p role={access.denied || accessRejected ? "alert" : "status"}>{access.paused ? "Waiting for a connection to verify the original retest actor and organization." : "Current original actor, organization and full-editor access must be verified. Private evidence and actions are hidden; the exact request and local approval remain retained."}</p><button type="button" className="btn-secondary" onClick={async () => { if (await access.refresh()) setAccessRejected(false); }}>Recheck original retest access</button></section> : <>
      {error && (
        <p
          role="alert"
          style={{ color: "var(--ember)", overflowWrap: "anywhere" }}
        >
          {error}
        </p>
      )}
      {receipt ? (
        <section>
          <h3>Separate retest ready</h3>
          <p role="status">
            {receipt.recovered
              ? "Recovered the existing retest"
              : "Created one new retest"}
            . Original evidence is retained. No previous Pass or result was
            copied.
          </p>
          {refreshNotice && <p role="alert">{refreshNotice}</p>}
          <a className="btn-primary" href={link(projectId, receipt.testRunId)}>
            Open retest run
          </a>
          <p>
            A later Pass is a separate execution, not proof that a linked defect
            was fixed.
          </p>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </section>
      ) : !preview ? (
        <section>
          <h3>Review the original Failed or Blocked result</h3>
          <p>
            This creates a separate manual run using exactly the original frozen
            procedure, configuration and prerequisites. Current case edits are
            not substituted. Prerequisites must pass again in the new run.
          </p>
          <p>No AI credits are used. No test is executed automatically.</p>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void review()}
          >
            {busy ? "Loading original evidence…" : "Review retest"}
          </button>
        </section>
      ) : (
        <section>
          <h3>
            {preview.displayId} · Original{" "}
            {preview.sourceOutcome === "FAIL" ? "Failed" : "Blocked"} outcome
          </h3>
          <p>
            {preview.caseDefinitions.length} case
            {preview.caseDefinitions.length === 1 ? "" : "s"}, including{" "}
            {preview.prerequisiteCount} prerequisite
            {preview.prerequisiteCount === 1 ? "" : "s"}. One separate run · 0
            AI credits.
          </p>
          <a href={link(projectId, sourceRunId)}>Open original execution</a>
          <h4>Exact original configuration</h4>
          <dl>
            {Object.entries(preview.configuration)
              .filter(([, v]) => v)
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{labels[key] ?? key}</dt>
                  <dd
                    style={{
                      marginLeft: 0,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {value}
                  </dd>
                </div>
              ))}
          </dl>
          {!Object.values(preview.configuration).some(Boolean) && (
            <p className="text-muted">
              No configuration values were recorded. Nothing has been inferred.
            </p>
          )}
          {preview.sourceDatasetExecution && (
            <section>
            <p>
              Original dataset row {preview.sourceDatasetExecution.rowIndex + 1}
              : {preview.sourceDatasetExecution.rowName}. The original resolved
              values are retained, not the current dataset.
            </p>
            <h4>Captured original dataset values</h4>
            <dl>
              {Object.entries(preview.sourceDatasetExecution.values).map(([name, value]) => (
                <div key={name}>
                  <dt style={{ overflowWrap: "anywhere" }}>{name}</dt>
                  <dd style={{ marginLeft: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {value === "" ? <em>Empty string</em> : value}
                  </dd>
                </div>
              ))}
            </dl>
            {!Object.keys(preview.sourceDatasetExecution.values).length && <p>No dataset values were captured. Nothing is inferred from the current dataset.</p>}
            </section>
          )}
          <details>
            <summary>Captured original result evidence</summary>
            {preview.sourceResults.map((result) => (
              <section key={result.id}>
                <strong>
                  {
                    preview.caseDefinitions.find(
                      (c) => c.testCaseId === result.testCaseId,
                    )?.title
                  }{" "}
                  · {result.status}
                </strong>
                {result.note && (
                  <p
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {result.note}
                  </p>
                )}
                {result.errorMessage && (
                  <p
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {result.errorMessage}
                  </p>
                )}
                <pre
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {JSON.stringify(result.observations, null, 2)}
                </pre>
              </section>
            ))}
            <p>
              Captured when the retest is approved. Earlier whole-case
              correction history may not have been recorded.
            </p>
          </details>
          {preview.caseDefinitions.map((c) => (
            <details key={c.testCaseId} style={{ marginTop: 12 }}>
              <summary>
                {c.testCaseId === testCaseId
                  ? "Retest procedure"
                  : "Prerequisite procedure"}
                : {c.title}
              </summary>
              {c.background && (
                <p style={{ whiteSpace: "pre-wrap" }}>
                  Preconditions / setup: {c.background}
                </p>
              )}
              {(["given", "when", "then"] as const).map(
                (phase) =>
                  c[phase].length > 0 && (
                    <section key={phase}>
                      <h4>{phase[0]!.toUpperCase() + phase.slice(1)}</h4>
                      <ol>
                        {c[phase].map((text, index) => (
                          <li
                            key={index}
                            style={{
                              whiteSpace: "pre-wrap",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {text}
                          </li>
                        ))}
                      </ol>
                    </section>
                  ),
              )}
              {c.steps.length > 0 && (
                <div role="region" aria-label={`Frozen procedure: ${c.title}`} tabIndex={0} style={{ overflowX: "auto", maxWidth: "100%" }}>
                  <table className="workspace-table" style={{ minWidth: 760, width: "100%" }}>
                    <caption>Original frozen steps in captured sequence. Row numbers are presentation only; stored order and literal values are retained. Empty and absent expected values are distinct. Media references are not fetched or verified.</caption>
                    <thead>
                      <tr>
                        <th scope="col">Row</th>
                        <th scope="col">Stored order</th>
                        <th scope="col">{preview.stepFieldLabels?.action ?? "Action"}</th>
                        <th scope="col">{preview.stepFieldLabels?.expectedActionOrData ?? "Expected data"}</th>
                        <th scope="col">{preview.stepFieldLabels?.expectedResult ?? "Expected result"}</th>
                        <th scope="col">{preview.stepFieldLabels?.expectedResponse ?? "Expected response"}</th>
                        <th scope="col">Captured media references</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.steps.map((step, index) => (
                        <tr key={index}>
                          <th scope="row">{index + 1}</th>
                          <td>{step.order}</td>
                          {(["action", "expectedActionOrData", "expectedResult", "expectedResponse"] as const).map(field => (
                            <td key={field} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", verticalAlign: "top" }}>
                              {step[field] === null ? "Not supplied" : step[field] === "" ? <em>Empty string</em> : step[field]}
                            </td>
                          ))}
                          <td>
                            {step.mediaAttachmentIds.length ? <ul>{step.mediaAttachmentIds.map((id, mediaIndex) => <li key={`${mediaIndex}:${id}`} style={{ overflowWrap: "anywhere" }}>{id}</li>)}</ul> : "None recorded"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <dl>
                {Object.entries(c.verificationProfile)
                  .filter(([, v]) => v)
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>{labels[key]}</dt>
                      <dd
                        style={{
                          marginLeft: 0,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {value}
                      </dd>
                    </div>
                  ))}
              </dl>
            </details>
          ))}
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              margin: "16px 0",
            }}
          >
            <input
              type="checkbox"
              checked={approved}
              disabled={busy || Boolean(attempt)}
              onChange={(e) => setApproved(e.target.checked)}
            />
            I approve one separate retest with these original instructions and
            configuration. Previous results stay in the original execution.
          </label>
          {ambiguous && (
            <p role="status">
              The previous response was not confirmed. Closing and reopening
              preserves this request in this page; retry it before starting
              anything else. Reloading the page does not preserve this local
              review.
            </p>
          )}
          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}
          >
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={onClose}
            >
              Close
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || ambiguous || Boolean(attempt && !rejected)}
              onClick={() => {
                setAttempt(null);
                setRejected(false);
                setPreview(null);
                setApproved(false);
                setError(null);
                unknown.current = false;
              }}
            >
              Refresh original evidence
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!approved || busy || rejected}
              onClick={() => void start()}
            >
              {busy
                ? "Starting…"
                : attempt
                  ? "Retry same retest request"
                  : "Create retest run"}
            </button>
          </div>
        </section>
      )}
      </>}
    </Modal>
  );
}

/** Key this component by project/run/case at mounts to prevent scope carryover. */
export function ManualRetestActions({
  projectId,
  sourceRunId,
  testCaseId,
  canRetest = true,
  active = true,
  onRetainedRequestChange,
}: {
  projectId: string;
  sourceRunId: string;
  testCaseId: string;
  canRetest?: boolean;
  active?: boolean;
  onRetainedRequestChange?: (retained: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const access = useRetestAccess(projectId, active, false);
  const [anchors, setAnchors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const linksInput = {
    projectId,
    sourceRunId,
    testCaseId,
    before: anchors[anchors.length - 1],
    expectedScope: access.origin ?? undefined,
  };
  const links = trpcReact.manualRetest.links.useQuery(linksInput, { enabled: active && access.ready, staleTime: 0, retry: false });
  const linksDenied = !!links.error && ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(links.error.data?.code ?? "");
  const linksMismatch = access.ready && !links.error && !links.isFetching && !links.isPaused && !!links.data && !verifiedManualRetestRead(linksInput, links.data);
  const linksPage = active && access.ready && !links.error && !links.isFetching && !links.isPaused && links.data && verifiedManualRetestRead(linksInput, links.data) ? links.data : null;
  async function refreshLinks() { if (await access.refresh()) await links.refetch(); }
  return (
    <section style={{ marginTop: 12, minWidth: 0, overflowWrap: "anywhere" }}>
      {!active ? <p role="status">Current history access must be verified. Retest links and private preview are hidden; any exact request remains retained in this mounted workflow.</p>
      : !access.ready || linksDenied || linksMismatch ? <section><p role={access.denied || linksDenied || linksMismatch ? "alert" : "status"}>{access.paused ? "Waiting for a connection to verify native retest scope." : "Current original actor and organization must be verified. Cached native retest links and preview are hidden; the exact local request remains retained."}</p><button type="button" className="btn-secondary" onClick={refreshLinks}>Recheck native retest access</button></section> : <>
      {canRetest && access.canWrite && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setOpen(true)}
        >
          Review separate retest
        </button>
      )}
      {links.isError ? (
        <p role="alert">
          Retest relationships could not be verified.{" "}
          <button
            type="button"
            className="btn-secondary"
            onClick={refreshLinks}
          >
            Retry links
          </button>
        </p>
      ) : links.isPending ||
        links.isFetching ||
        links.fetchStatus === "paused" ? (
        <p role="status">Checking retest relationships…</p>
      ) : (
        linksPage && (
          <>
            {linksPage.original && (
              <p>
                <a href={link(projectId, linksPage.original.testRunId)}>
                  Original execution
                </a>{" "}
                ·{" "}
                {linksPage.original.capturedOutcome === "FAIL"
                  ? "Failed"
                  : "Blocked"}{" "}
                outcome captured when this retest was created, not a
                defect-resolution claim.
              </p>
            )}
            {linksPage.retests.length > 0 && (
              <details>
                <summary>
                  Linked separate retests ({linksPage.retests.length} on this
                  page)
                </summary>
                <ul>
                  {linksPage.retests.map((run) => (
                    <li key={run.testRunId}>
                      <a href={link(projectId, run.testRunId)}>
                        Retest started{" "}
                        {new Date(run.startedAt).toLocaleString()}
                      </a>{" "}
                      · Overall run: {run.status.toLowerCase()} (not an
                      individual case verdict)
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {anchors.length > 1 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setAnchors((a) => a.slice(0, -1))}
                >
                  Newer retests
                </button>
              )}
              {linksPage.nextCursor && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    setAnchors((a) => [...a, linksPage.nextCursor!])
                  }
                >
                  Older retests
                </button>
              )}
            </div>
          </>
        )
      )}
      </>}
      <ManualRetestWizard
        key={`${projectId}:${sourceRunId}:${testCaseId}`}
        projectId={projectId}
        sourceRunId={sourceRunId}
        testCaseId={testCaseId}
        open={open}
        onClose={() => setOpen(false)}
        active={active && canRetest && access.ready && access.canWrite && !linksDenied && !linksMismatch && !links.isPaused}
        expectedScope={access.origin}
        onRetainedRequestChange={onRetainedRequestChange}
      />
    </section>
  );
}
