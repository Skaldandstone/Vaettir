"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Modal } from "./Modal";
import { CaseProcedureColumns } from "./CaseProcedureColumns";
import { trpcReact } from "@/lib/trpcReact";
import { currentSessionScope } from "@/lib/auth-query-cache";
import {
  useWholeCaseReviewedAccess,
  useWholeCaseReadNonce,
} from "@/lib/use-whole-case-reviewed-access";
import {
  WholeCaseReviewedController,
  emptyWholeCaseCompletion,
} from "@/lib/whole-case-reviewed-controller";
import {
  wholeCaseDraft,
  wholeCaseRequest,
  wholeCaseReadMatches,
  type WholeCaseDraft,
  type WholeCaseReading,
} from "@/lib/whole-case-reviewed-draft";
import type { ManualCaseReviewedExactWrite } from "@vaettir/api/src/services/manualCaseResultSchema";
import type { ManualRunCurrentOrigin } from "@/lib/manual-run-current-reader";
function currentWholeCaseParent(callback: (() => boolean) | null | undefined, activation?: string) {
  try { return callback === undefined || typeof callback === "function" && typeof activation === "string" && activation.length > 0 && activation.length <= 200 && callback() === true; } catch { return false; }
}
export type WholeCaseReviewIntent = {
  seedId: string;
  status: ManualCaseReviewedExactWrite["status"];
  note: string | null;
  context?: WholeCaseDraft["context"];
  readings?: WholeCaseReading[];
};
const contextFields = [
  { key: "specimen", label: "Specimen" },
  { key: "hardwareRevision", label: "Hardware revision" },
  { key: "firmwareVersion", label: "Firmware version" },
  { key: "environment", label: "Environment" },
] as const;
const measurementFields = [
  { key: "name", label: "Name" },
  { key: "unit", label: "Unit" },
  { key: "value", label: "Value" },
  { key: "lowerLimit", label: "Lower limit" },
  { key: "upperLimit", label: "Upper limit" },
  { key: "instrument", label: "Instrument" },
] as const;
function liveSession() {
  return currentSessionScope(
    window.Clerk?.loaded ? window.Clerk.session : null,
  );
}
const fullField = {
  width: "100%",
  boxSizing: "border-box" as const,
  minWidth: 0,
};
/** Friendly known context does not normalize or replace the exact disclosure. */
function ObservationContext({ value }: { value: unknown }) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!record)
    return (
      <p>
        Retained observation root is not a supported context object. See the
        exact read-only disclosure.
      </p>
    );
  return (
    <dl>
      {contextFields.map(({ key, label }) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {!Object.hasOwn(record, key)
              ? "Unset"
              : record[key] === null
                ? "NULL (retained)"
                : typeof record[key] === "string"
                  ? record[key] === ""
                    ? "Empty text"
                    : (record[key] as string)
                  : "Unsupported retained value; see exact JSON"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function FrozenObservationProcedure({ value }: { value: unknown }) {
  const p =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const strings = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((item) => typeof item === "string");
  type SavedStep = {
    order: number;
    action: string;
    expectedActionOrData?: string | null;
    expectedResult?: string | null;
    expectedResponse?: string | null;
    mediaAttachmentIds?: string[];
  };
  const steps = p?.steps;
  const supported =
    !!p &&
    typeof p.title === "string" &&
    (p.background === null || typeof p.background === "string") &&
    strings(p.given) &&
    strings(p.when) &&
    strings(p.then) &&
    Array.isArray(steps) &&
    steps.every(
      (s) =>
        !!s &&
        typeof s === "object" &&
        !Array.isArray(s) &&
        typeof s.order === "number" &&
        typeof s.action === "string" &&
        ["expectedActionOrData", "expectedResult", "expectedResponse"].every(
          (key) =>
            s[key] === undefined ||
            s[key] === null ||
            typeof s[key] === "string",
        ) &&
        (s.mediaAttachmentIds === undefined || strings(s.mediaAttachmentIds)),
    );
  if (!supported || !p)
    return (
      <p>
        Friendly procedure view is unavailable for this exact stored
        representation. Use the exact JSON; no current procedure or defaults
        were substituted.
      </p>
    );
  return (
    <section>
      <h4 style={{ whiteSpace: "pre-wrap" }}>{p.title as string}</h4>
      {p.background !== null && (
        <p style={{ whiteSpace: "pre-wrap" }}>{p.background as string}</p>
      )}
      {(["given", "when", "then"] as const).map((key) => (
        <div key={key}>
          <h5>
            {key === "given"
              ? "Preconditions"
              : key === "when"
                ? "Actions"
                : "Expected outcomes"}
          </h5>
          {(p[key] as string[]).length ? (
            <ol>
              {(p[key] as string[]).map((item, index) => (
                <li key={index} style={{ whiteSpace: "pre-wrap" }}>
                  {item === "" ? "Empty authored text" : item}
                </li>
              ))}
            </ol>
          ) : (
            <p>No authored items.</p>
          )}
        </div>
      ))}
      <p>
        Generic procedure labels. Stored order and aligned technical descriptors
        are shown; exact empty/NULL/media values remain in the disclosure below.
      </p>
      <CaseProcedureColumns steps={steps as SavedStep[]} />
    </section>
  );
}
/** Keep keyed project/run/case and mounted through close/inactive. Reload recovery is not supported. */
export function ManualCaseResultHistory({
  projectId,
  testRunId,
  testCaseId,
  active = true,
  disabled = false,
  onUnconfirmedChange,
  onChanged,
  reviewIntent,
  parentRunScope,
  parentCurrent,
  parentActivation,
}: {
  projectId: string;
  testRunId: string;
  testCaseId: string;
  active?: boolean;
  disabled?: boolean;
  onUnconfirmedChange?: (pending: boolean) => void;
  onChanged?: () => Promise<unknown>;
  reviewIntent?: WholeCaseReviewIntent | null;
  parentRunScope?: ManualRunCurrentOrigin | null;
  parentCurrent?: (() => boolean) | null;
  parentActivation?: string;
}) {
  const [nativeOrigin] = useState({ projectId, testRunId, testCaseId });
  const nativeSame =
    nativeOrigin.projectId === projectId &&
    nativeOrigin.testRunId === testRunId &&
    nativeOrigin.testCaseId === testCaseId;
  const access = useWholeCaseReviewedAccess(
    nativeOrigin.projectId,
    nativeOrigin.testRunId,
    nativeOrigin.testCaseId,
    active && nativeSame,
    parentRunScope,
    parentCurrent,
    parentActivation,
  );
  const { current: currentRead, observedSessionId } = access;
  const readerCurrent = access.readable && currentRead();
  const parentReadable = parentRunScope !== null && currentWholeCaseParent(parentCurrent, parentActivation) && (parentRunScope === undefined || !!access.origin && access.origin.projectId === parentRunScope.projectId && access.origin.testRunId === parentRunScope.testRunId && access.origin.organizationId === parentRunScope.organizationId && access.origin.clerkActorId === parentRunScope.clerkActorId && access.origin.nativeActorId === parentRunScope.nativeActorId);
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<WholeCaseDraft | null>(null),
    [before, setBefore] = useState<string | undefined>(),
    [limit, setLimit] = useState(10);
  const [, setView] = useState(emptyWholeCaseCompletion),
    [notice, setNotice] = useState<string | null>(null),
    [baselineRefresh, setBaselineRefresh] = useState(0);
  const [controller] = useState(() => new WholeCaseReviewedController(setView));
  const draftRef = useRef(draft),
    seenSeed = useRef<string | null>(null),
    mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    controller.attach();
    return () => {
      mounted.current = false;
      controller.detach();
    };
  }, [controller]);
  const readNonce = useWholeCaseReadNonce(
    JSON.stringify([access.activation, access.readable, open, baselineRefresh, parentActivation ?? null]),
  );
  const input = {
    ...nativeOrigin,
    expectedScope: {
      projectId: nativeOrigin.projectId,
      organizationId: access.origin?.organizationId ?? "pending",
      clerkActorId: access.origin?.clerkActorId ?? "pending",
    },
    expectedNativeActorId: access.origin?.nativeActorId ?? "pending",
    readRequestId: readNonce.requestId,
  };
  const preview = trpcReact.manualCaseResults.previewReviewed.useQuery(input, {
    enabled: readerCurrent && parentReadable && open && readNonce.ready,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const baseline =
    readerCurrent &&
    parentReadable &&
    readNonce.ready &&
    preview.isFetchedAfterMount &&
    !preview.error &&
    !preview.isFetching &&
    !preview.isPaused &&
    preview.data &&
    wholeCaseReadMatches(input, preview.data, "PREVIEW")
      ? preview.data
      : null;
  const historyNonce = useWholeCaseReadNonce(
    JSON.stringify([
      access.activation,
      access.readable,
      before,
      limit,
      baselineRefresh,
      parentActivation ?? null,
    ]),
  );
  const historyInput = {
    ...input,
    readRequestId: historyNonce.requestId,
    before,
    limit,
  };
  const history = trpcReact.manualCaseResults.historyReviewed.useQuery(
    historyInput,
    {
      enabled: readerCurrent && parentReadable && historyNonce.ready,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const page =
    readerCurrent &&
    parentReadable &&
    historyNonce.ready &&
    history.isFetchedAfterMount &&
    !history.error &&
    !history.isFetching &&
    !history.isPaused &&
    history.data &&
    wholeCaseReadMatches(historyInput, history.data, "HISTORY")
      ? history.data
      : null;
  const frame = useMemo(() => ({
      origin: access.readable && parentReadable ? access.origin : null,
      open: open && active && nativeSame,
      canRecover: access.canRecover && parentReadable && !disabled,
      canWrite: !!baseline?.canWrite && !disabled,
      activation: JSON.stringify([access.activation, readNonce.requestId]),
      readerActivation: access.activation,
      parentCurrent,
      parentActivation,
      observedSessionId,
      currentRead,
    }), [
    access.origin,
    access.readable,
    parentReadable,
    access.canRecover,
    access.activation,
    open,
    active,
    nativeSame,
    disabled,
    baseline?.canWrite,
    readNonce.requestId,
    parentCurrent,
    parentActivation,
    observedSessionId,
    currentRead,
  ]);
  const view = controller.renderView(frame);
  useLayoutEffect(() => { controller.bind(frame); }, [controller, frame]);
  useLayoutEffect(() => {
    let live = true;
    const observe = () => { if (live) controller.observeSession(liveSession()); };
    observe();
    const clerk = typeof window !== "undefined" ? window.Clerk : null,
      addListener = clerk ? Reflect.get(clerk, "addListener") : undefined;
    let unsubscribe: unknown;
    try { unsubscribe = typeof addListener === "function" ? addListener.call(clerk, observe) : undefined; }
    catch { live = false; /* The independently installed access monitor remains the authority. */ }
    return () => {
      live = false;
      try { if (typeof unsubscribe === "function") unsubscribe(); } catch { /* Observation is already detached; no SDK error body is published. */ }
    };
  }, [controller, access.activation, access.origin]);
  useEffect(() => {
    if (
      !baseline ||
      !baseline.canWrite ||
      !access.origin ||
      !view.canEdit ||
      !controller.current(liveSession(), view.epoch) ||
      draftRef.current
    )
      return;
    const next = wholeCaseDraft(baseline);
    draftRef.current = next;
    setDraft(next);
  }, [baseline, access.origin, view.canEdit, view.epoch, controller]);
  useEffect(() => {
    if (
      !reviewIntent ||
      seenSeed.current === reviewIntent.seedId ||
      !access.canRecover ||
      disabled ||
      !nativeSame
    )
      return;
    setOpen(true);
  }, [reviewIntent, access.canRecover, disabled, nativeSame]);
  useEffect(() => {
    if (
      !reviewIntent ||
      seenSeed.current === reviewIntent.seedId ||
      !draft ||
      !view.canEdit ||
      !controller.current(liveSession(), view.epoch)
    )
      return;
    const next = {
      ...draft,
      status: reviewIntent.status,
      note: reviewIntent.note,
      noteText: reviewIntent.note ?? draft.noteText,
      ...(reviewIntent.context
        ? { context: structuredClone(reviewIntent.context) }
        : {}),
      ...(reviewIntent.readings
        ? {
            readings: structuredClone(reviewIntent.readings),
            measurementsPresent: true,
          }
        : {}),
    };
    draftRef.current = next;
    setDraft(next);
    seenSeed.current = reviewIntent.seedId;
    controller.edited(liveSession(), view.epoch);
  }, [reviewIntent, draft, controller, view.canEdit, view.epoch]);
  useEffect(() => {
    if (!controller.current(liveSession(), view.epoch)) return;
    onUnconfirmedChange?.(
      view.busy || !!view.pending || (view.reviewed && !view.confirmed),
    );
  }, [
    view.busy,
    view.pending,
    view.reviewed,
    view.confirmed,
    view.epoch,
    controller,
    onUnconfirmedChange,
  ]);
  const mutation = trpcReact.manualCaseResults.recordReviewed.useMutation();
  const locked = !view.canEdit;
  function update(patch: Partial<WholeCaseDraft>) {
    if (
      !draftRef.current ||
      !view.canEdit ||
      !controller.edited(liveSession(), view.epoch)
    )
      return;
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    setNotice(null);
  }
  function review() {
    if (!draftRef.current || !access.origin || !view.canEdit) return;
    try {
      const request = wholeCaseRequest(
        draftRef.current,
        access.origin,
        crypto.randomUUID(),
      );
      if (
        !controller.review(
          request,
          draftRef.current.baseline,
          liveSession(),
          view.epoch,
        )
      )
        throw Error("Original review frame changed. Nothing was submitted.");
      setNotice(null);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The entered observation could not be reviewed.",
      );
    }
  }
  const afterConfirmed = () => {
    if (!parentReadable || !currentWholeCaseParent(parentCurrent, parentActivation)) return;
    const epoch = controller.snapshot().epoch;
    onUnconfirmedChange?.(false);
    setBaselineRefresh((n) => n + 1);
    const refresh = onChanged?.();
    void refresh?.catch(() => {
      if (mounted.current && controller.current(liveSession(), epoch))
        setNotice(
          "Confirmed revision; refreshing failed. Refresh without resubmitting.",
        );
    });
  };
  function refreshBaseline() {
    if (!view.canEdit || !controller.current(liveSession(), view.epoch)) return;
    setBaselineRefresh((n) => n + 1);
    setNotice(
      "Draft retained. Explicitly admit the refreshed baseline before reviewing again.",
    );
  }
  function adoptBaseline() {
    if (
      !baseline?.canWrite ||
      !draftRef.current ||
      !view.canEdit ||
      !controller.edited(liveSession(), view.epoch)
    )
      return;
    const next = { ...draftRef.current, baseline: structuredClone(baseline) };
    draftRef.current = next;
    setDraft(next);
    setNotice(null);
  }
  return (
    <section style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <h3>Whole-case observation history</h3>
      <p>
        Immutable human observations retain corrections. They are not new
        executions, defect resolutions or qualified sign-offs.
      </p>
      {!readerCurrent || !parentReadable ? (
        <p role="status">
          Current original native reader/session must be verified. Private
          cached observations are hidden; retained drafts and requests remain
          mounted. {access.error}
          <button type="button" onClick={access.refresh}>
            Recheck original access
          </button>
        </p>
      ) : history.error ? (
        <p role="alert">
          History could not be admitted, not an empty history. No private cached
          history or raw server error was exposed.
          <button
            type="button"
            onClick={() => { if (currentRead()) setBaselineRefresh((n) => n + 1); }}
          >
            Retry current history
          </button>
        </p>
      ) : !page ? (
        <p role="status">Checking exact native history and read nonce…</p>
      ) : (
        <>
          <label>
            History page size
            <select
              value={limit}
              disabled={view.busy}
              onChange={(e) => {
                if (!currentRead() || !parentReadable || !currentWholeCaseParent(parentCurrent, parentActivation)) return;
                setLimit(parseInt(e.target.value, 10));
                setBefore(undefined);
              }}
            >
              {[1, 5, 10, 20].map((n) => (
                <option key={n} value={n}>
                  {n} revisions
                </option>
              ))}
            </select>
          </label>
          {!page.revisions.length ? (
            <p>
              No immutable whole-case revisions. A prior mutable observation may
              still exist; its author/time were not reconstructed.
            </p>
          ) : (
            <ol>
              {page.revisions.map((r) => (
                <li key={r.id}>
                  <strong>
                    Revision {r.revisionNumber} · {r.result.status}
                  </strong>{" "}
                  · {r.actorLabel} · {new Date(r.recordedAt).toLocaleString()}
                  <p style={{ whiteSpace: "pre-wrap" }}>
                    {r.result.note === null
                      ? "Note: NULL"
                      : r.result.note === ""
                        ? "Note: empty text"
                        : r.result.note}
                  </p>
                  {r.correctionReason !== null && (
                    <p style={{ whiteSpace: "pre-wrap" }}>
                      Reason: {r.correctionReason}
                    </p>
                  )}
                  <details>
                    <summary>Exact recorded observations</summary>
                    <ObservationContext value={r.result.observations} />
                    <pre style={{ whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(r.result.observations, null, 2)}
                    </pre>
                  </details>
                  {r.legacyPriorKind !== "SQL_NULL" && (
                    <details>
                      <summary>
                        Unversioned prior observation captured at correction
                        (original recorder/time unknown)
                      </summary>
                      <ObservationContext
                        value={
                          r.legacyPrior &&
                          typeof r.legacyPrior === "object" &&
                          !Array.isArray(r.legacyPrior) &&
                          "captured" in r.legacyPrior &&
                          r.legacyPrior.captured &&
                          typeof r.legacyPrior.captured === "object" &&
                          !Array.isArray(r.legacyPrior.captured) &&
                          "observations" in r.legacyPrior.captured
                            ? r.legacyPrior.captured.observations
                            : null
                        }
                      />
                      <pre style={{ whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(r.legacyPrior, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          )}
          <button
            type="button"
            disabled={!before || view.busy}
            onClick={() => { if (currentRead() && parentReadable && currentWholeCaseParent(parentCurrent, parentActivation)) setBefore(undefined); }}
          >
            Latest revisions
          </button>
          <button
            type="button"
            disabled={!page.nextCursor || view.busy}
            onClick={() => { if (currentRead() && parentReadable && currentWholeCaseParent(parentCurrent, parentActivation)) setBefore(page.nextCursor ?? undefined); }}
          >
            Older revisions
          </button>
        </>
      )}
      {readerCurrent && parentReadable && access.canRecover && !disabled && (
        <button type="button" onClick={() => { if (currentRead() && currentWholeCaseParent(parentCurrent, parentActivation)) setOpen(true); }}>
          {view.pending
            ? "Recover identical observation UUID"
            : view.confirmed
              ? "Inspect confirmed observation"
              : "Review whole-case observation"}
        </button>
      )}
      <Modal
        open={open && active && nativeSame && parentReadable}
        onClose={() => setOpen(false)}
        title="Review whole-case observation"
        size="wide"
        dismissible={!view.busy}
      >
        {!view.authorized || !parentReadable ? (
          <p role="status">
            Original native author/session access is unavailable. Private
            evidence and actions are hidden; exact local draft/UUID remain
            retained.{" "}
            <button type="button" onClick={access.refresh}>
              Recheck original access
            </button>
          </p>
        ) : (
          <>
            {view.error && <p role="alert">{view.error}</p>}
            {notice && <p role="alert">{notice}</p>}
            {view.confirmed ? (
              <section>
                <h3>Revision {view.confirmed.revisionNumber} confirmed</h3>
                <p>
                  Earlier observations retained. Do not resubmit this known
                  receipt.
                </p>
                <button
                  type="button"
                  disabled={!view.canPublish}
                  onClick={() =>
                    controller.publishConfirmed(
                      liveSession(),
                      view.epoch,
                      afterConfirmed,
                    )
                  }
                >
                  Refresh confirmed observation
                </button>
                <button
                  type="button"
                  disabled={view.busy || !baseline?.canWrite}
                  onClick={() => {
                    if (controller.nextReview(liveSession(), view.epoch)) {
                      draftRef.current = null;
                      setDraft(null);
                      setBaselineRefresh((n) => n + 1);
                    }
                  }}
                >
                  Explicitly review another observation
                </button>
              </section>
            ) : !draft ? (
              <p role="status">
                {baseline && !baseline.canWrite
                  ? "This admitted observation is read-only: the run is no longer active, uses step revisions, or retains an unsupported observation representation. No current facts will be substituted. Exact prior UUID recovery remains separate."
                  : preview.error
                    ? "Current baseline could not be admitted. No raw private server error or cached replacement evidence was exposed."
                    : "Checking saved run procedure and current observation…"}
                <button
                  type="button"
                  onClick={() => setBaselineRefresh((n) => n + 1)}
                >
                  Retry current baseline
                </button>
              </p>
            ) : (
              <section>
                <p>
                  {draft.baseline.displayId} ·{" "}
                  {draft.baseline.current
                    ? "Correct existing observation (reason required)"
                    : "Record first human observation"}
                </p>
                <details>
                  <summary>
                    Frozen procedure and prerequisites reviewed for this
                    observation
                  </summary>
                  <FrozenObservationProcedure
                    value={draft.baseline.frozenEvidence.procedure}
                  />
                  <details>
                    <summary>
                      Frozen prerequisite native identities (not public case ID
                      chips)
                    </summary>
                    <dl>
                      {Object.entries(
                        draft.baseline.frozenEvidence.prerequisites,
                      ).map(([id, dependencies]) => (
                        <div key={id}>
                          <dt>{id}</dt>
                          <dd>
                            {dependencies.length
                              ? dependencies.join(", ")
                              : "No frozen prerequisites"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                  <details>
                    <summary>
                      Exact saved procedure, graph and context JSON (read-only)
                    </summary>
                    <pre style={{ whiteSpace: "pre-wrap" }}>
                      {JSON.stringify(draft.baseline.frozenEvidence, null, 2)}
                    </pre>
                  </details>
                </details>
                {!draft.baseline.tracked && draft.baseline.current && (
                  <p>
                    Prior mutable observation will be captured now without
                    inventing original author/time.
                  </p>
                )}
                <label style={{ display: "block" }}>
                  Observed status
                  <select
                    style={fullField}
                    disabled={locked}
                    value={draft.status}
                    onChange={(e) =>
                      update({
                        status: e.target.value as WholeCaseDraft["status"],
                      })
                    }
                  >
                    <option value="">Choose explicitly</option>
                    {["PASS", "FAIL", "BLOCKED", "SKIP"].map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "block" }}>
                  Note representation
                  <select
                    disabled={locked}
                    value={draft.note === null ? "NULL" : "TEXT"}
                    onChange={(e) =>
                      update({
                        note: e.target.value === "NULL" ? null : draft.noteText,
                      })
                    }
                  >
                    <option value="NULL">NULL (not supplied)</option>
                    <option value="TEXT">Exact text (empty allowed)</option>
                  </select>
                </label>
                <label style={{ display: "block" }}>
                  What actually happened
                  <textarea
                    style={fullField}
                    disabled={locked || draft.note === null}
                    rows={3}
                    maxLength={10000}
                    value={draft.noteText}
                    onChange={(e) =>
                      update({ note: e.target.value, noteText: e.target.value })
                    }
                  />
                </label>
                {contextFields.map(({ key, label }) => (
                  <div key={key}>
                    <label style={{ display: "block" }}>
                      {label}
                      <textarea
                        style={fullField}
                        rows={key === "environment" ? 3 : 1}
                        disabled={locked}
                        value={draft.context[key] ?? ""}
                        onChange={(e) =>
                          update({
                            context: {
                              ...draft.context,
                              [key]: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <small>
                      {Object.hasOwn(draft.context, key)
                        ? "Present exact text"
                        : "Unset; typing explicitly sets text"}
                    </small>
                    <button
                      type="button"
                      disabled={locked || !Object.hasOwn(draft.context, key)}
                      onClick={() => {
                        const next = { ...draft.context };
                        delete next[key];
                        update({ context: next });
                      }}
                    >
                      Remove to unset
                    </button>
                  </div>
                ))}
                <details>
                  <summary>Measured evidence ({draft.readings.length})</summary>
                  {draft.readings.map((reading, index) => (
                    <fieldset
                      key={index}
                      disabled={locked}
                      style={{ minWidth: 0 }}
                    >
                      <legend>Reading {index + 1}</legend>
                      {measurementFields.map(({ key, label }) => (
                        <div key={key}>
                          <label style={{ display: "block" }}>
                            {label}
                            {key === "name" ||
                            key === "unit" ||
                            key === "instrument" ? (
                              <textarea
                                style={fullField}
                                rows={1}
                                value={reading[key] ?? ""}
                                onChange={(e) =>
                                  update({
                                    readings: draft.readings.map((item, n) =>
                                      n === index
                                        ? { ...item, [key]: e.target.value }
                                        : item,
                                    ),
                                  })
                                }
                              />
                            ) : (
                              <input
                                style={fullField}
                                value={reading[key] ?? ""}
                                onChange={(e) =>
                                  update({
                                    readings: draft.readings.map((item, n) =>
                                      n === index
                                        ? { ...item, [key]: e.target.value }
                                        : item,
                                    ),
                                  })
                                }
                              />
                            )}
                          </label>
                          {(key === "lowerLimit" || key === "upperLimit") && (
                            <button
                              type="button"
                              onClick={() =>
                                update({
                                  readings: draft.readings.map((item, n) =>
                                    n === index
                                      ? { ...item, [key]: null }
                                      : item,
                                  ),
                                })
                              }
                            >
                              Remove limit (unset)
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          update({
                            readings: draft.readings.filter(
                              (_, n) => n !== index,
                            ),
                          })
                        }
                      >
                        Remove reading
                      </button>
                    </fieldset>
                  ))}
                  <button
                    type="button"
                    disabled={locked || draft.readings.length >= 100}
                    onClick={() =>
                      update({
                        measurementsPresent: true,
                        readings: [
                          ...draft.readings,
                          {
                            name: "",
                            unit: "",
                            value: "",
                            lowerLimit: null,
                            upperLimit: null,
                            instrument: undefined,
                          },
                        ],
                      })
                    }
                  >
                    Add reading
                  </button>
                </details>
                <label style={{ display: "block" }}>
                  Human correction reason
                  <textarea
                    style={fullField}
                    disabled={locked}
                    rows={2}
                    maxLength={2000}
                    value={draft.reason}
                    onChange={(e) => update({ reason: e.target.value })}
                  />
                </label>
                {view.reviewed && (
                  <section>
                    <ObservationContext value={draft.context} />
                    <p role="status">
                      Exact body reviewed and frozen. Confirm explicitly; no
                      automatic submission.
                    </p>
                  </section>
                )}
                {view.pending && (
                  <p role="status">
                    Outcome unknown. Only the immutable original UUID/body can
                    be retried, even after completion or a later unsupported
                    preview. Reload loses this local buffer.
                  </p>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button
                    type="button"
                    disabled={!view.canEdit}
                    onClick={review}
                  >
                    Review exact observation
                  </button>
                  <button
                    type="button"
                    disabled={!view.canSubmit && !view.canRetry}
                    onClick={() =>
                      void controller.submit(
                        view.epoch,
                        (input) => {
                          return mutation.mutateAsync(input);
                        },
                        liveSession,
                        afterConfirmed,
                        () => onUnconfirmedChange?.(true),
                      )
                    }
                  >
                    {view.pending
                      ? "Retry identical UUID"
                      : "Confirm reviewed observation"}
                  </button>
                  <button
                    type="button"
                    disabled={!view.canEdit}
                    onClick={refreshBaseline}
                  >
                    Refresh baseline; keep my draft
                  </button>
                  <button
                    type="button"
                    disabled={!view.canEdit || !baseline?.canWrite}
                    onClick={adoptBaseline}
                  >
                    Explicitly admit refreshed baseline
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </Modal>
    </section>
  );
}
