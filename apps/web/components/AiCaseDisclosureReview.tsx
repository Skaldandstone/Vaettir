"use client";

import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { trpcReact, type RouterInputs, type RouterOutputs } from "@/lib/trpcReact";

type Input = RouterInputs["aiDisclosure"]["issueCases"];
type Preview = RouterOutputs["aiDisclosure"]["previewCases"];
type Choices = RouterOutputs["aiDisclosure"]["caseChoices"];
const fields = ["title", "given", "when", "then"] as const;

function endReviewSession(live: { current: boolean }, generation: { current: number }) {
  live.current = false;
  generation.current++;
}

export function AiCaseDisclosureReview(props: {
  projectId: string; organizationId: string; actorClerkUserId: string;
  policyVersion: number; disabled: boolean; onApprove: (input: Input) => void;
}) {
  const rpc = trpcReact.useUtils().client.aiDisclosure;
  const [search, setSearch] = useState("");
  const [choices, setChoices] = useState<Choices | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [included, setIncluded] = useState<Input["fields"]>([...fields]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [days, setDays] = useState(1);
  const live = useRef(true), generation = useRef(0), running = useRef(false);
  useEffect(() => { live.current = true; return () => endReviewSession(live, generation); }, []);
  function clearReview() { generation.current++; setPreview(null); setAttest(false); setMessage(""); }
  const scope = { organizationId: props.organizationId, projectId: props.projectId };
  const reviewGeneration = generation.current;
  const bound = (v: { organizationId: string; projectId: string; actorClerkUserId: string }) => v.organizationId === scope.organizationId && v.projectId === scope.projectId && v.actorClerkUserId === props.actorClerkUserId;
  async function load(kind: "choices" | "preview") {
    if (running.current || props.disabled) return;
    running.current = true; setBusy(true); clearReview();
    const seq = generation.current;
    try {
      if (kind === "choices") {
        setChoices(null);
        const v = await rpc.caseChoices.query({ ...scope, search });
        if (live.current && generation.current === seq && bound(v)) setChoices(v);
      } else {
        const v = await rpc.previewCases.query({ ...scope, caseIds: selected, fields: included, expectedPolicyVersion: props.policyVersion });
        if (live.current && generation.current === seq && bound(v)) setPreview(v);
      }
    } catch { if (live.current && generation.current === seq) { setChoices(null); setSelected([]); setMessage("Refresh access and try again."); } }
    finally { running.current = false; if (live.current) setBusy(false); }
  }
  return <section aria-label="Selected case sharing" data-sentry-mask="true" data-private="true">
    <h3>Share cases</h3>
    <p>Choose up to 20 cases and preview exactly what Codex can read.</p>
    <fieldset disabled={props.disabled || busy} style={{ border: 0, padding: 0 }}>
      <label>Find cases <input value={search} maxLength={80} onChange={e => { clearReview(); setChoices(null); setSearch(e.target.value); }} /></label>{" "}
      <ActionButton type="button" tooltip="Find cases in this project without granting external access" onClick={() => void load("choices")}>Search</ActionButton>
      {choices && <div aria-label="Choose cases">{choices.cases.map(c => <label key={c.id} style={{ display: "block" }}>
        <input type="checkbox" checked={selected.includes(c.id)} disabled={!selected.includes(c.id) && selected.length >= 20} onChange={e => { clearReview(); setSelected(e.target.checked ? [...selected, c.id] : selected.filter(id => id !== c.id)); }} /> {c.title}
      </label>)}{choices.more && <p>Refine your search for more cases.</p>}</div>}
      <p>{selected.length} selected</p>
      <div aria-label="Shared fields">{fields.map(f => <label key={f} style={{ marginInlineEnd: 12 }}><input type="checkbox" checked={included.includes(f)} onChange={e => { clearReview(); setIncluded(e.target.checked ? [...included, f] : included.filter(x => x !== f)); }} /> {f}</label>)}</div>
      <label>Expires <select value={days} onChange={e => { clearReview(); setDays(Number(e.target.value)); }}><option value={1}>1 day</option><option value={7}>7 days</option></select></label>{" "}
      <ActionButton type="button" tooltip="Review the exact selected content before authorizing Codex" disabled={props.disabled || busy || !selected.length || !included.length} onClick={() => void load("preview")}>Preview</ActionButton>
      {preview && <>
        <div aria-label="Content Codex will receive" style={{ maxHeight: 360, overflow: "auto" }}>
          {preview.snapshot.cases.map(c => <article key={c.id}><h4>{c.title ?? c.id}</h4>{fields.filter(f => f !== "title").map(f => c[f] && <div key={f}><strong>{f}</strong><ol>{c[f]!.map((s, i) => <li key={i} style={{ whiteSpace: "pre-wrap" }}>{s}</li>)}</ol></div>)}</article>)}
        </div>
        <label><input type="checkbox" checked={attest} onChange={e => setAttest(e.target.checked)} /> I approve this content for Codex and confirm it contains no regulated or personal health data. Anyone holding the credential can read this approved content.</label>{" "}
        <ActionButton type="button" tooltip="Issue a read-only grant for this exact preview; changed cases require new approval" disabled={props.disabled || busy || !attest} onClick={() => {
          if (!live.current || props.disabled || running.current || !attest || generation.current !== reviewGeneration) return;
          const input: Input = { ...scope, caseIds: [...selected], fields: [...included], expectedPolicyVersion: props.policyVersion, requestId: crypto.randomUUID(), previewDigest: preview.digest, lifetimeDays: days, approveDisclosure: true, attestNoRegulatedData: true };
          clearReview(); props.onApprove(input);
        }}>Approve</ActionButton>
      </>}
    </fieldset>
    {message && <p role="status">{message}</p>}
  </section>;
}
