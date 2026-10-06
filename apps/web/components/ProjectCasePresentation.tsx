"use client";
import { useState } from "react";
import { CASE_PRESENTATION_FIELDS, CASE_PRESENTATION_TYPES, CASE_PRESENTATION_DOMAINS, CASE_PRESENTATION_PRESETS, casePresentationSchema, casePresentationPreset, type CasePresentation } from "@vaettir/core";
import { trpcReact, type RouterInputs, type RouterOutputs } from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { type CaseFieldOrigin } from "@/lib/case-field-origin";
import { freshCasePresentation } from "@/lib/case-presentation-read";
import { manualStartDefinitivelyRejected as definitivelyRejected } from "@/lib/manual-run-start";
import { Modal } from "./Modal";

const fieldLabels = { background: "Background / description", tags: "Tag chips", technicalBehavior: "Per-step technical behavior", expectedResponse: "Per-step expected response", hardwareFixture: "Fixture setup, instruments and measurement criteria", safety: "Safety prerequisites / stop conditions", compliance: "Compliance controls" };
type State = RouterOutputs["casePresentation"]["get"];
export function ProjectCasePresentation({ projectId }: { projectId: string }) {
  const access = useCaseFieldAccess(projectId), utils = trpcReact.useUtils();
  const query = trpcReact.casePresentation.get.useQuery({ projectId, originalOrganizationId: access.origin?.organizationId, expectedClerkActorId: access.origin?.clerkActorId }, { enabled: access.readable, retry: false });
  const fresh = freshCasePresentation(query, access.current);
  const save = trpcReact.casePresentation.configure.useMutation();
  const [open, setOpen] = useState(false), [baseline, setBaseline] = useState<State | null>(null), [draft, setDraft] = useState<CasePresentation | null>(null);
  const [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false), [notice, setNotice] = useState("");
  const [pending, setPending] = useState<{ origin: CaseFieldOrigin; request: RouterInputs["casePresentation"]["configure"]; everAmbiguous: boolean } | null>(null);
  const canConfigure = Boolean(access.canConfigure && fresh?.canConfigure);
  function show() {
    if (!canConfigure || !fresh || !access.origin || !access.owns(access.origin, "configure")) return;
    setOpen(true);
    if (baseline || pending) return;
    setBaseline(fresh); setDraft(fresh.configuration ?? fresh.defaults); setNotice(""); setConfirmed(false);
  }
  function change(configuration: CasePresentation) { setDraft(configuration); setConfirmed(false); }
  async function submit() {
    const origin = pending?.origin ?? access.origin;
    if (!origin || !access.owns(origin, "configure") || !canConfigure || save.isPending) return;
    if (!pending && (!draft || !baseline || baseline.profileHash !== fresh?.profileHash || !confirmed || !reason.trim())) return;
    const parsed = pending ? null : casePresentationSchema.safeParse(draft);
    if (parsed && !parsed.success) { setNotice("Choose at least one supported type and domain. Your draft is retained."); return; }
    const attempt = pending ?? { origin, request: { projectId, originalOrganizationId: origin.organizationId, expectedClerkActorId: origin.clerkActorId, expectedProfileHash: baseline!.profileHash, configuration: parsed!.success ? parsed!.data : draft!, reason: reason.trim(), confirmed: true as const, requestId: crypto.randomUUID() }, everAmbiguous: false };
    setPending(attempt); setNotice("");
    try {
      const result = await save.mutateAsync(attempt.request);
      if (result.requestId !== attempt.request.requestId || result.projectId !== origin.projectId || result.organizationId !== origin.organizationId || result.actorClerkUserId !== origin.clerkActorId || typeof result.replayed !== "boolean") throw new Error("Preference acknowledgement did not match the original scoped request. Retry that exact request.");
      // A valid ACK settles only this receipt, never another actor's UI draft.
      setPending(current => current === attempt ? null : current);
      if (!access.owns(origin, "configure")) return;
      setOpen(false); setBaseline(null); setDraft(null); setReason(""); setConfirmed(false);
      setNotice("Saved built-in field preferences. Case values, shared procedures and frozen runs were not changed.");
    } catch (cause) {
      setPending(current => current === attempt ? definitivelyRejected(cause, attempt.everAmbiguous) ? null : { ...attempt, everAmbiguous: true } : current);
      if (access.owns(origin, "configure")) setNotice(cause instanceof Error ? cause.message : "The response is uncertain. Restore original access and retry identical preferences.");
      return;
    }
    try { await utils.casePresentation.get.invalidate({ projectId }); await utils.project.experience.invalidate({ projectId }); }
    catch { if (access.owns(origin, "configure")) setNotice("Preferences were saved, but refreshing current context failed. Refresh settings, not the write."); }
  }
  return <>
    {canConfigure && <button type="button" className="btn-secondary" onClick={show}>Configure built-in case fields</button>}
    {access.readable && query.error && <p role="alert">Built-in field preferences could not be read. Existing settings remain retained. <button type="button" onClick={() => void query.refetch()}>Retry preferences</button></p>}
    {access.readable && notice && !open && <p role="status">{notice}</p>}
    <Modal open={open} onClose={() => setOpen(false)} title="Project built-in case fields" size="wide" dismissible={!save.isPending}>
      {!canConfigure ? <p role="status">Current original full Owner/Admin access is required. The draft and identical pending request stay retained but private until that access returns.</p> : draft && <>
        <p>Choose the fields and choices useful to this project. Hiding a field never clears it: supplied values and mapped controls stay discoverable. This is presentation only, not an approval, processing permission or a change to supported case types.</p>
        {baseline?.profileHash !== fresh?.profileHash && <p role="alert">Project context changed after this draft opened. Preferences and rationale remain retained. Explicitly load current settings before a new save; pending requests must retry unchanged.</p>}
        <fieldset disabled={save.isPending || Boolean(pending)} style={{ border: 0, padding: 0, minWidth: 0 }}>
          <p>Use a reviewed starting point (it does not change existing cases):</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{CASE_PRESENTATION_PRESETS.map(preset => <button key={preset} type="button" className="btn-secondary" onClick={() => change(casePresentationPreset(preset))}>{preset === "REGULATORY" ? "Regulatory / protocol" : preset.charAt(0) + preset.slice(1).toLowerCase()}</button>)}</div>
          <div style={{ display: "grid", gap: 12, marginBlock: 16 }}>{CASE_PRESENTATION_FIELDS.map(field => <label key={field} style={{ display: "grid", gap: 4 }}>{fieldLabels[field]}<select value={draft.fields[field]} onChange={event => change({ ...draft, fields: { ...draft.fields, [field]: event.target.value as CasePresentation["fields"][typeof field] } })}><option value="AUTO">Automatic by case context</option><option value="SHOW">Show for this project</option><option value="HIDE">Hide when empty; retain supplied values</option></select></label>)}</div>
          <fieldset style={{ minWidth: 0 }}><legend>Preferred test type dropdown choices</legend><p>Existing saved or entered choices outside this list remain available with a retained-value label.</p>{CASE_PRESENTATION_TYPES.map(value => <label key={value} style={{ display: "block", marginBlock: 6 }}><input type="checkbox" checked={draft.testTypes.includes(value)} onChange={event => change({ ...draft, testTypes: event.target.checked ? [...draft.testTypes, value] : draft.testTypes.filter(item => item !== value) })} /> {value.replaceAll("_", " ").toLowerCase()}</label>)}</fieldset>
          <fieldset style={{ minWidth: 0, marginBlock: 12 }}><legend>Preferred validation domain dropdown choices</legend>{CASE_PRESENTATION_DOMAINS.map(value => <label key={value} style={{ display: "block", marginBlock: 6 }}><input type="checkbox" checked={draft.domains.includes(value)} onChange={event => change({ ...draft, domains: event.target.checked ? [...draft.domains, value] : draft.domains.filter(item => item !== value) })} /> {value.replaceAll("_", " ").toLowerCase()}</label>)}</fieldset>
          <label style={{ display: "block" }}>Reason for changing preferences<textarea value={reason} maxLength={1000} rows={2} onChange={event => { setReason(event.target.value); setConfirmed(false); }} style={{ display: "block", width: "100%" }} /></label>
          <label style={{ display: "block", marginBlock: 12 }}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I reviewed these project preferences. All existing case values and custom labels remain retained.</label>
        </fieldset>
        {notice && <p role="alert">{notice}</p>}
        {pending && <p role="status">Request {pending.request.requestId} is retained. Restore original access and retry its identical content; do not start a replacement.</p>}
        <button type="button" className="btn-primary" disabled={save.isPending || (!pending && (!confirmed || !reason.trim() || baseline?.profileHash !== fresh?.profileHash))} onClick={() => void submit()}>{save.isPending ? "Saving…" : pending ? "Retry same preferences" : "Save reviewed preferences"}</button>
        {!pending && <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => { if (!fresh || !access.origin || !access.owns(access.origin, "configure")) return; setBaseline(fresh); setDraft(fresh.configuration ?? fresh.defaults); setConfirmed(false); setNotice("Loaded current saved preferences. The rationale remains retained; review before saving."); }}>Discard preference draft and load current settings</button>}
      </>}
    </Modal>
  </>;
}
