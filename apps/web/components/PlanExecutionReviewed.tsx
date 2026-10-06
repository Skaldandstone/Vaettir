"use client";
import { useLayoutEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { usePlanExecutionReviewedAccess, type PlanExecutionReadAdapter } from "@/lib/use-plan-execution-reviewed-access";
import { useManualRunStartReviewedAccess, type ManualRunStartReadAdapter } from "@/lib/use-manual-run-start-reviewed-access";
import { PlanExecutionReviewedController, type PlanExecutionView } from "@/lib/plan-execution-reviewed-controller";
import type { PlanExecutionReadPageWire, PlanExecutionReadPageInput } from "@/lib/plan-execution-reviewed-reader";
import { Modal } from "./Modal";

const contextLabels: Record<string, string> = {
  configuration: "Configuration / variant", platform: "Platform / device", build: "Build / revision",
  hardwareRevision: "Hardware revision", firmwareVersion: "Firmware version", rig: "Rig / simulator",
  batchOrLot: "Batch / lot / controlled sample", environment: "Execution environment",
  calibrationReference: "Instrument / calibration reference", protocolReference: "Protocol / method reference",
};
export function PlanExecutionReviewed({ projectId, testPlanId, organizationId, open, onClose, onSaved, legacyBlocked = false, legacyHasDraft = false }: {
  projectId: string; testPlanId: string; organizationId?: string; open: boolean;
  onClose: () => void; onSaved?: () => void; legacyBlocked?: boolean; legacyHasDraft?: boolean;
}) {
  const utils = trpcReact.useUtils();
  const router = useRouter();
  const start = trpcReact.manualRunStartReviewed.start.useMutation();
  const planAdapter = useMemo<PlanExecutionReadAdapter>(() => ({
    access: input => utils.planExecutionReads.access.fetch(input),
    page: input => utils.planExecutionReads.page.fetch(input),
    key: (projection, input) => ["planExecutionReads", projection, input],
  }), [utils]);
  const profileAdapter = useMemo<ManualRunStartReadAdapter>(() => ({
    access: input => utils.manualRunStartReviewed.access.fetch(input),
    preview: input => utils.manualRunStartReviewed.preview.fetch(input),
    key: (projection, input) => ["manualRunStartReviewed", projection, input],
  }), [utils]);
  const active = open && !legacyBlocked;
  const plan = usePlanExecutionReviewedAccess(projectId, testPlanId, organizationId, planAdapter, { active });
  // A freshly observed plan owner is required BEFORE profile discovery. This
  // pin never supplies historical provenance for a legacy request.
  const profile = useManualRunStartReviewedAccess(projectId, organizationId, profileAdapter, {
    active, originalNativeActorId: plan.origin?.nativeActorId ?? null,
  });
  const [, post] = useState<PlanExecutionView | null>(null);
  const [controller] = useState(() => new PlanExecutionReviewedController(projectId, testPlanId, value => {
    post(previous => previous && Object.keys(value).every(key => previous[key as keyof PlanExecutionView] === value[key as keyof PlanExecutionView]) ? previous : value);
  }));
  const [search, setSearch] = useState("");
  const [previousCursors, setPreviousCursors] = useState<(PlanExecutionReadPageInput["cursor"])[]>([]);
  const [currentCursor, setCurrentCursor] = useState<PlanExecutionReadPageInput["cursor"]>(undefined);
  const [pagingError, setPagingError] = useState("");
  useLayoutEffect(() => { controller.attach(); return () => controller.detach(); }, [controller]);
  useLayoutEffect(() => {
    controller.bind({ active, open, legacyBlocked, plan: plan.snapshot, profile: profile.snapshot, currentPlan: plan.current, currentProfile: profile.current });
  });
  const currentPlan = plan.current(), currentProfile = profile.current();
  const page = active && currentPlan === plan.snapshot && currentPlan?.projection === "PAGE" && "plan" in currentPlan.data ? currentPlan.data as PlanExecutionReadPageWire : null;
  const recovery = active && currentProfile === profile.snapshot && !!currentProfile?.data.canConfigure && !!currentProfile.data.canRecover;
  const view = controller.view();
  // Captured callbacks may not operate a later posted frame. Reader current()
  // independently checks installed SDK, cache and render epochs before layout.
  const exactFrame = () => active && controller.view().epoch === view.epoch && plan.current() === currentPlan && profile.current() === currentProfile;
  const fullPage = () => exactFrame() && !!page && plan.current() === currentPlan;
  function readPage(cursor?: PlanExecutionReadPageInput["cursor"], backwards = false) {
    if (!exactFrame() || !currentPlan || !page && cursor !== undefined) return;
    if (!backwards && cursor && previousCursors.length >= 100) { setPagingError("This browser visit reached its 100-page navigation bound. Apply a new search explicitly; no cases were truncated or selected."); return; }
    if (plan.readPage({ search: cursor === undefined && !backwards ? search : page?.search ?? search, limit: 50, ...(cursor !== undefined ? { cursor } : {}) })) {
      setPagingError("");
      setCurrentCursor(cursor);
      if (backwards) setPreviousCursors(values => values.slice(0, -1));
      else if (cursor && page) setPreviousCursors(values => [...values, currentCursor]);
      else setPreviousCursors([]);
    }
  }
  const privateNotice = (page || recovery) && view.notice;
  return <Modal open={open} onClose={onClose} title="Execute a test plan" size="wide" keepMounted>
    <p>Reuse a saved selection and configuration. New run creation still requires server admission of current approved procedures and prerequisites.</p>
    {(legacyBlocked || legacyHasDraft) && <p role="status">A legacy draft or request is retained privately in its original mounted owner. It is not migrated, resent or assigned a newly observed native identity. {legacyBlocked ? "A held legacy request blocks replacement here." : "The new flow starts separately; old draft contents are not adopted."}</p>}
    {!legacyBlocked && <>
      <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
        <button type="button" className="btn-secondary" disabled={view.busy} onClick={() => { if (exactFrame()) plan.refresh(); }}>Recheck original plan access</button>
        <button type="button" className="btn-secondary" disabled={view.busy || !plan.origin} onClick={() => { if (exactFrame()) profile.refresh(); }}>Recheck original run-profile access</button>
        <button type="button" className="btn-secondary" disabled={view.busy || !currentProfile} onClick={() => { if (exactFrame()) profile.readPreview(); }}>Read current run profile</button>
      </div>
      {!page && <p role="status">Private plan details are withheld until a completed current native PAGE read. ACCESS proves current membership only, not start/save permission or a receipt.</p>}
      {active && (plan.error || profile.error) && <p role="status">Current metadata is unavailable. Explicitly recheck original access; no cached body or substitute scope is used.</p>}
      <form onSubmit={event => { event.preventDefault(); if (exactFrame()) readPage(); }}>
        <label>Literal title or case-ID search <input value={currentPlan ? search : ""} disabled={!active || view.busy || !currentPlan} onChange={event => { if (exactFrame()) setSearch(event.target.value); }} maxLength={200} /></label>
        <button className="btn-secondary" type="submit" disabled={!active || view.busy || !currentPlan}>Read saved template / apply search</button>
      </form>
      {page && <section>
        <h3 style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{page.plan.name}</h3>
        <p>Plan status: {page.plan.status}. {page.interpretation === "EXACT_LITERAL_V2_READ_ONLY" ? "Exact literal version-2 template, read-only. SAVE and START are unavailable for this version; viewing it does not approve an execution." : page.interpretation === "EXACT_SUPPORTED" ? "Exact supported saved-template interpretation." : "Legacy-normalized display only; it cannot approve a new execution."}</p>
        <h4>Complete saved selection ({page.selected.length})</h4>
        <ol>{page.selected.map(item => <li key={item.testCaseId} style={{ marginBottom: 8, overflowWrap: "anywhere" }}>
          <code>{item.metadata?.displayId || item.testCaseId}</code>{item.metadata?.displayId === "" && <small> (no display ID)</small>}
          <span style={{ whiteSpace: "pre-wrap" }}> {item.metadata ? item.metadata.title === "" ? "(explicit empty title)" : item.metadata.title : "Current case metadata unavailable"}</span>
          <strong style={{ color: item.state === "AVAILABLE" ? "var(--muted)" : "var(--warning)" }}> · {item.state}</strong>
          {item.metadata && <span> · {item.metadata.reviewStatus}{item.metadata.archived ? " · archived" : ""}</span>}
        </li>)}</ol>
        <p>Missing, archived or unapproved selected cases are retained as identities and block a new start. Browsing candidates never changes this selection.</p>
        <h4>Current candidate page ({page.candidates.length}; limit {page.limit})</h4>
        <ul>{page.candidates.map(item => <li key={item.id} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><code>{item.displayId || item.id}</code> {item.title === "" ? "(explicit empty title)" : item.title} · {item.reviewStatus}</li>)}</ul>
        <p>Pages use an ID cursor, not chronological order or a globally frozen count.</p>
        <button type="button" className="btn-secondary" disabled={view.busy || previousCursors.length === 0} onClick={() => { if (fullPage()) readPage(previousCursors.at(-1), true); }}>Previous candidate page</button>
        <button type="button" className="btn-secondary" disabled={view.busy || !page.nextCursor} onClick={() => { if (fullPage() && page.nextCursor) readPage(page.nextCursor); }}>Next candidate page</button>
        {pagingError && <p role="status">{pagingError}</p>}
        <h4>Saved configurations</h4>
        {page.template?.configurations.map(item => <section key={item.id} style={{ border: "1px solid var(--border)", padding: 12, marginBottom: 12 }}>
          <label><input type="radio" name={`plan-configuration-${testPlanId}`} checked={view.selectedConfigurationId === item.id} disabled={view.busy || view.hasReview || view.pending || view.confirmed} onChange={() => { if (fullPage()) controller.select(item.id); }} /> <span style={{ whiteSpace: "pre-wrap" }}>{item.name}</span></label>
          <dl>{Object.entries(item.context).map(([key, value]) => <div key={key}><dt>{contextLabels[key] ?? key}</dt><dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value === "" ? "(explicit empty text)" : value}</dd></div>)}</dl>
        </section>)}
        {!page.template && <p>No supported saved configuration is available. Raw template contents are retained, not repaired.</p>}
        <details><summary>Exact raw stored template JSONB (separate from display interpretation)</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{page.rawTemplate.sqlNull ? "SQL NULL" : page.rawTemplate.jsonText}</pre></details>
        <button type="button" className="btn-secondary" disabled>Save reusable template (reviewed native-save protocol unavailable)</button>
      </section>}
      <div className="flex gap-2" style={{ flexWrap: "wrap", marginTop: 16 }}>
        <button type="button" className="btn-secondary" disabled={!page || !view.canReview} onClick={() => { if (fullPage()) controller.review(); }}>Review this saved execution</button>
        <button type="button" className="btn-primary" disabled={!page || !view.canSend} onClick={() => { if (fullPage()) void controller.submit(input => start.mutateAsync(input), onSaved); }}>Confirm and start reviewed execution</button>
        <button type="button" className="btn-secondary" disabled={!recovery || !view.canRetry} onClick={() => { if (exactFrame()) void controller.submit(input => start.mutateAsync(input), onSaved); }}>Retry exact held request</button>
        <button type="button" className="btn-secondary" disabled={!recovery || !view.canDiscard} onClick={() => { if (exactFrame()) controller.discard(); }}>Discard unsent / definitively refused review</button>
        <button type="button" className="btn-secondary" disabled={!recovery || !view.canAnother} onClick={() => { if (exactFrame()) controller.another(); }}>Prepare a separate execution</button>
      </div>
      {privateNotice && <p role="status">{view.notice}</p>}
      {view.pending && <p role="status">An original request is retained while this component stays mounted. Close or access loss does not reset its body or key. Reload/route replacement recovery is not provided here.</p>}
      {recovery && view.confirmedRunId && <p>Exact original receipt confirmed. <button type="button" className="btn-secondary" onClick={() => {
        if (!exactFrame() || !recovery || controller.view().confirmedRunId !== view.confirmedRunId) return;
        router.push(`/projects/${encodeURIComponent(projectId)}/test-runs/manual/${encodeURIComponent(view.confirmedRunId!)}`);
      }}>Open the confirmed manual run</button></p>}
    </>}
  </Modal>;
}
