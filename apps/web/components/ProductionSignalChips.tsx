"use client";

import { useState } from "react";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { Modal } from "./Modal";
import { ProviderMark } from "./SourceConnectionChips";

type Provider = "pagerduty" | "datadog";
type Readiness = RouterOutputs["signalRouting"]["readiness"];
const labels = { pagerduty: "PagerDuty", datadog: "Datadog" };
const datadogPayload = JSON.stringify({ eventId:"$ID", transition: "$ALERT_TRANSITION", priority: "$ALERT_PRIORITY", title: "$ALERT_TITLE", projectTag: "$TAGS[vaettir_project]" }, null, 2);

function publicEndpoint(path: string) {
  const api = process.env.NEXT_PUBLIC_API_URL;
  if (!api) return null;
  try {
    const url = new URL(api);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/$/, "")}${path}`;
  } catch { return null; }
}

export function ProductionSignalChips({ projectId }: { projectId: string }) {
  const readiness = trpcReact.signalRouting.readiness.useQuery({ projectId });
  const [provider, setProvider] = useState<Provider | null>(null);
  const ready = readiness.data;
  return <section aria-label="Production signal routing">
    {readiness.error && <p role="alert">Could not load signal setup: {readiness.error.message}</p>}
    <div className="source-chip-list">
      {(["pagerduty", "datadog"] as const).map(id => <button type="button" key={id} className="source-connection-chip" onClick={() => setProvider(id)}>
        <ProviderMark id={id} /><span><strong>{labels[id]}</strong><small>{!ready ? "Checking setup…" : !ready[id].route ? "Set up alerts" : !ready[id].secretConfigured ? "Webhook setup needed" : "Routing saved · Delivery unverified"}</small></span><span aria-hidden="true">+</span>
      </button>)}
    </div>
    {provider && (ready?<SignalSetup key={provider} projectId={projectId} provider={provider} readiness={ready} onClose={() => setProvider(null)} onRefresh={() => void readiness.refetch()} />:<Modal open title={`${labels[provider]} alerts`} onClose={()=>setProvider(null)}><p role={readiness.error?"alert":"status"}>{readiness.error?.message??"Loading workspace and release setup…"}</p></Modal>)}
  </section>;
}

function SignalSetup({ projectId, provider, readiness, onClose, onRefresh }: {
  projectId: string; provider: Provider; readiness: Readiness; onClose: () => void; onRefresh: () => void;
}) {
  const utils = trpcReact.useUtils();
  const saveRoute = trpcReact.signalRouting.save.useMutation();
  const [step, setStep] = useState(0);
  const [routeInput, setRouteInput] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [secretSaved, setSecretSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  // Provider-window focus can refetch readiness. Never advance the reviewed
  // baseline while the user's local draft is still open.
  const [baseline]=useState(()=>({route:readiness[provider].route}));
  const busy = saveRoute.isPending;
  const configuration = readiness?.[provider];
  const route = routeInput ?? baseline?.route ?? "";
  const trimmedRoute = route.trim();
  const endpoint = configuration ? publicEndpoint(configuration.endpointPath) : null;
  const hasSecret = Boolean(configuration?.secretConfigured || secretSaved);
  const canSave = Boolean(baseline && readiness?.canEdit && endpoint && trimmedRoute && (hasSecret || provider === "datadog" && readiness.canConfigureSecret && secret.trim().length >= 16));
  async function copy(value: string, name: string) {
    try { await navigator.clipboard.writeText(value); setMessage(`${name} copied.`); }
    catch { setMessage(`Copy was unavailable. Select and copy the ${name.toLowerCase()} below.`); }
  }
  function next() { setMessage(""); setStep(current => current + 1); }
  async function save() {
    if (!readiness || !canSave) return;
    setMessage("");
    try {
      await saveRoute.mutateAsync({projectId,provider,route:trimmedRoute,expectedRoute:baseline!.route,
        ...(provider==="datadog"&&!hasSecret?{newDatadogSecret:secret.trim()}:{})});
      if(provider==="datadog"&&!hasSecret)setSecretSaved(true);
      setSecret("");
      await utils.project.byId.invalidate({ id: projectId });
      onRefresh();
      setSaved(true);
      setMessage("Routing saved. Provider delivery has not been verified.");
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : "Setup could not be confirmed. Your input is retained for retry.";
      setMessage(detail);
    }
  }
  return <Modal open onClose={onClose} title={`${labels[provider]} alerts`} dismissible={!busy}>
    {saved ? <>
      <h3>Routing is configured</h3><p>Delivery is unverified. This screen does not confirm a received provider webhook.</p>
      <p>{readiness.shippedRelease ? `Incoming triggered alerts will create risk flags on ${readiness.shippedRelease.name}, the most recently updated shipped release.` : "No shipped release exists. Incoming alerts will be ignored until a release is marked Shipped."}</p>
      <a href={`/projects/${projectId}/releases`}>Review release risk flags</a>
      <div className="form-actions"><button type="button" className="btn-secondary" onClick={() => { setSaved(false); setStep(1); }}>Review provider instructions</button><button type="button" className="btn-primary" onClick={onClose}>Done</button></div>
    </> : <>
      <p className="eyebrow">Step {step + 1} of 3 · {["Choose routing", "Configure webhook", "Review setup"][step]}</p>
      {!readiness.canEdit && <p>A full editor seat is required to change routing. You can review the saved setup here.</p>}
      {step === 0 && <>
        <h3>Which alerts belong to this project?</h3>
        <label>{provider === "pagerduty" ? "PagerDuty service ID" : "Datadog project tag value"}<input value={route} maxLength={100} disabled={!readiness.canEdit || busy} onChange={event => setRouteInput(event.target.value)} placeholder={provider === "pagerduty" ? "PXXXXXX" : "checkout-service"} /></label>
        <p className="text-muted">{provider === "pagerduty" ? "Find the service ID in PagerDuty’s service URL. Only triggered incidents from that service will route here." : "Use a unique value for this workspace. Add the matching vaettir_project tag to the monitors you want included."}</p>
        <p>{readiness.shippedRelease ? `Release destination: ${readiness.shippedRelease.name} (Shipped).` : "No shipped release yet. You can prepare routing now, but alerts will be ignored until a release is marked Shipped."}</p>
      </>}
      {step === 1 && <>
        <h3>Set up the provider webhook</h3>
        {endpoint ? <><label>Webhook URL<code style={{ display: "block", overflowWrap: "anywhere", userSelect: "all" }}>{endpoint}</code></label><button type="button" className="btn-secondary" onClick={() => void copy(endpoint, "Webhook URL")}>Copy webhook URL</button></> : <p role="alert">A public HTTPS API address is not configured. Ask your Vaettir administrator to configure the deployment’s public API address before setting up alerts.</p>}
        {provider === "pagerduty" ? <>
          {!hasSecret && <p role="alert">The Vaettir platform’s PagerDuty signing secret is missing. A Vaettir administrator must configure it before incident delivery can be accepted.</p>}
          <ol><li>Create a PagerDuty V3 webhook subscription scoped to service <strong>{trimmedRoute || "your selected service"}</strong>.</li><li>Use the webhook URL above and subscribe to <code>incident.triggered</code>.</li><li>Have your Vaettir administrator securely configure the subscription signing secret in Vaettir. PagerDuty sends signed events automatically.</li></ol>
          <a href="https://support.pagerduty.com/main/docs/webhooks" target="_blank" rel="noreferrer">Open PagerDuty webhook setup</a>
        </> : <>
          {!hasSecret && (readiness.canConfigureSecret ? <><label>Workspace webhook secret<input type="password" autoComplete="new-password" value={secret} maxLength={2000} disabled={busy} onChange={event => setSecret(event.target.value)} /></label><div className="form-actions" style={{ flexWrap: "wrap" }}><button type="button" className="btn-secondary" disabled={busy} onClick={() => setSecret(Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join(""))}>Generate secret</button><button type="button" className="btn-secondary" disabled={busy || secret.trim().length < 16} onClick={() => void copy(JSON.stringify({ "X-Vaettir-Datadog-Secret": secret.trim() }), "Custom headers")}>Copy custom headers</button></div><p className="text-muted">Use at least 16 characters. Enter the same secret in Datadog’s custom header. It is saved only after your final approval.</p></> : <p role="alert">Ask a workspace Owner or Admin to configure the Datadog webhook secret. Your routing choices can be reviewed here.</p>)}
          {hasSecret && <p>A workspace webhook secret is already configured. Use the matching secret in Datadog; it is not displayed or replaced here.</p>}
          <ol><li>Create a webhook named <code>vaettir</code> in Datadog Integrations → Webhooks using the URL above.</li><li>Add custom header <code>X-Vaettir-Datadog-Secret</code> with your workspace webhook secret.</li><li>Use the payload below. Tag each selected monitor <code style={{ overflowWrap: "anywhere" }}>vaettir_project:{trimmedRoute || "your-project"}</code> and add <code>@webhook-vaettir</code> to its notification.</li></ol>
          <details><summary>Payload template</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{datadogPayload}</pre><button type="button" className="btn-secondary" onClick={() => void copy(datadogPayload, "Payload template")}>Copy payload template</button></details>
          <a href="https://docs.datadoghq.com/integrations/webhooks/" target="_blank" rel="noreferrer">Open Datadog webhook setup</a>
        </>}
      </>}
      {step === 2 && <>
        <h3>Review routing before saving</h3><dl><dt>Provider</dt><dd>{labels[provider]}</dd><dt>{provider === "pagerduty" ? "Service" : "Project tag"}</dt><dd style={{ overflowWrap: "anywhere" }}>{trimmedRoute || "Not entered"}</dd><dt>Signing setup</dt><dd>{hasSecret ? "Configured" : provider === "datadog" && secret ? "Workspace secret will be saved" : "Administrator setup required"}</dd><dt>Release</dt><dd>{readiness.shippedRelease?.name ?? "No shipped release; incoming alerts are ignored"}</dd></dl>
        <p>Saving configures routing only. It does not contact the provider or verify delivery. No AI credits are used.</p>
        {!canSave && readiness.canEdit && <p role="status">Complete the route, public webhook address and signing setup before saving.</p>}
      </>}
      <div className="form-actions" style={{ flexWrap: "wrap" }}>
        <button type="button" className="btn-secondary" disabled={busy} onClick={step === 0 ? onClose : () => { setMessage(""); setStep(current => current - 1); }}>{step === 0 ? "Cancel" : "Back"}</button>
        {step < 2 ? <button type="button" className="btn-primary" disabled={busy || step === 0 && !trimmedRoute} onClick={next}>Continue</button> : readiness.canEdit ? <button type="button" className="btn-primary" disabled={!canSave || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save reviewed routing"}</button> : <button type="button" className="btn-primary" onClick={onClose}>Done</button>}
      </div>
    </>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </Modal>;
}
