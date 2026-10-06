"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Modal } from "./Modal";
import { trpcReact, type RouterInputs, type RouterOutputs } from "@/lib/trpcReact";
import { sameManualRetestScope } from "@/lib/manual-retest-scope-ack";
import type { ManualRetestExpectedScope } from "@vaettir/api/src/services/manualRetestScopeSchema";
import { useManualRetestReviewedAccess } from "@/lib/use-manual-retest-reviewed-access";
import { ManualRetestReviewedController, type ReviewedRetestView } from "@/lib/manual-retest-reviewed-controller";
import { currentSessionScope } from "@/lib/auth-query-cache";
import type { ManualRunCurrentOrigin } from "@/lib/manual-run-current-reader";
import { inspectRetestWire } from "@/lib/manual-retest-reviewed-read";
type Preview=RouterOutputs["manualRetest"]["previewReviewed"]["preview"];
type Start=RouterInputs["manualRetest"]["start"];
const link=(p:string,r:string)=>`/projects/${encodeURIComponent(p)}/test-runs/manual/${encodeURIComponent(r)}`;
const labels:Record<string,string>={configuration:"Configuration / variant",platform:"Platform / device",build:"Build / revision",environment:"Environment",hardwareRevision:"Hardware revision",firmwareVersion:"Firmware version",rig:"Rig",batchOrLot:"Batch / lot",calibrationReference:"Calibration reference",protocolReference:"Protocol reference",setup:"Setup",safety:"Safety",instruments:"Instruments",acceptanceCriteria:"Acceptance criteria"};
function installedSession(){return typeof window==="undefined"?null:currentSessionScope(window.Clerk?.loaded?window.Clerk.session:null);}
function captureLegacyRequest(request:Readonly<Start>){
 try { inspectRetestWire(request,8192,true);const copy=structuredClone(request);if(copy.expectedScope)Object.freeze(copy.expectedScope);return Object.freeze(copy); }
 catch { return request; /* Unsupported opaque intent is held, never sent or displayed. */ }
}
// Private waiting frames cannot publish authority. Their epoch churn alone
// must not create a render/layout loop while the native read is in flight.
function sameView(a:ReviewedRetestView|null,b:ReviewedRetestView){return !!a&&(Object.keys(b) as Array<keyof ReviewedRetestView>).every(k=>k==="epoch"&&!a.readable&&!b.readable||a[k]===b[k]);}
/** Local origin never silently rebases, even if both actors/organizations can read this project. */
function useRetestAccess(projectId: string, active: boolean, editor: boolean, pinnedScope?: ManualRetestExpectedScope | null, readEnabled = active) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [origin, setOrigin] = useState<ManualRetestExpectedScope | null>(pinnedScope ?? null);
  const actorReady = isLoaded && isSignedIn && !!userId;
  // Metadata subscriptions must not disable themselves because their own shared
  // fetch makes the parent's factual access temporarily unavailable. Admission
  // grants no access: current active/actor/org/role/error/fetch/pause gates below
  // still withhold private evidence and actions, and the server authorizes reads.
  const metadataReadEnabled = readEnabled && actorReady;
  const project = trpcReact.project.byId.useQuery({ id: projectId }, { enabled: metadataReadEnabled, staleTime: 0, retry: false, refetchOnMount: false });
  const organizations = trpcReact.organization.mine.useQuery(undefined, { enabled: metadataReadEnabled, staleTime: 0, retry: false, refetchOnMount: false });
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
  const actorNow = useRef({ actorReady, userId });
  useLayoutEffect(() => { actorNow.current = { actorReady, userId }; }, [actorReady, userId]);
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



/** Compatibility owner shell: original hook/state order stays intact. The
 * legacy mutation handle is INERT (no mutate/fetch/invalidate path). Current N
 * is never assigned to an old submission. Old in-flight captured callback code
 * and hot-reload persistence are separate, unproved runtime boundaries. */
export function ManualRetestWizard({projectId,sourceRunId,testCaseId,open,onClose,active=true,readEnabled=open,onRetainedRequestChange,expectedScope,parentRunScope,parentCurrent,parentActivation,retainedLegacyAttempt}:{
 projectId:string;sourceRunId:string;testCaseId:string;open:boolean;onClose:()=>void;active?:boolean;readEnabled?:boolean;onRetainedRequestChange?:(retained:boolean)=>void;expectedScope?:ManualRetestExpectedScope|null;
 parentRunScope?:ManualRunCurrentOrigin|null;parentCurrent?:(()=>boolean)|null;parentActivation?:string;retainedLegacyAttempt?:Readonly<Start>|null;
}) {
  const utils = trpcReact.useUtils();
  const mutation = trpcReact.manualRetest.start.useMutation();
  const access = useRetestAccess(projectId, active, true, expectedScope, readEnabled);
  const accessNow = useRef(access);
  useLayoutEffect(() => { accessNow.current = access; }, [access]);
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
  const unknown = useRef(false), openNow = useRef(open && active);
  useLayoutEffect(() => { openNow.current = open && active; }, [open, active]);
  useEffect(() => { if(busy||attempt||receipt||retainedLegacyAttempt)onRetainedRequestChange?.(true); }, [busy, attempt, receipt, rejected, onRetainedRequestChange, retainedLegacyAttempt]);

  // Keep every old owner slot, including prior approvals and ambiguous markers,
  // without displaying, altering, normalizing or clearing their private bodies.
  void [utils,mutation,accessNow,preview,setPreview,setAttempt,setReceipt,approved,setApproved,error,setError,ambiguous,setAmbiguous,rejected,setRejected,refreshNotice,setRefreshNotice,accessRejected,setAccessRejected,setBusy,unknown,openNow];
  if(!attempt&&retainedLegacyAttempt)setAttempt(captureLegacyRequest(retainedLegacyAttempt));
  const held=attempt??retainedLegacyAttempt;
  return <>
    {(held||receipt||busy)&&<Modal open={open&&active} onClose={onClose} title="Retained earlier retest" size="wide" dismissible={!busy}><p role="status">An earlier retest request remains held unchanged in this mounted owner. Its original native submission pin is not available to this reviewed protocol. Current access does not invent that historical provenance. No replacement UUID or request will be sent.</p><p>Legacy recovery requires a separately verified compatibility path; the stored body stays withheld. Reloading does not recover local intent.</p></Modal>}
    {/* Never evict an existing reviewed UNKNOWN if an explicit legacy handoff
        arrives. Both private owners stay mounted; no conflicting start occurs. */}
    <ReviewedRetestWizard projectId={projectId} sourceRunId={sourceRunId} testCaseId={testCaseId} open={open} onClose={onClose} active={active&&access.ready&&!held&&!receipt&&!busy} readEnabled={readEnabled} onRetainedRequestChange={onRetainedRequestChange} expectedScope={expectedScope===undefined?access.origin:expectedScope} parentRunScope={parentRunScope} parentCurrent={parentCurrent} parentActivation={parentActivation}/>
  </>;
}
/** Hold earlier attempts without automatic adoption of current native pins.
 * Route-away/reload/hot-reload recovery is not a persistence guarantee. */
export function ReviewedRetestWizard({projectId,sourceRunId,testCaseId,open,onClose,active=true,readEnabled=open,onRetainedRequestChange,expectedScope,parentRunScope,parentCurrent,parentActivation,retainedLegacyAttempt}:{
 projectId:string;sourceRunId:string;testCaseId:string;open:boolean;onClose:()=>void;active?:boolean;readEnabled?:boolean;onRetainedRequestChange?:(retained:boolean)=>void;expectedScope?:ManualRetestExpectedScope|null;
 parentRunScope?:ManualRunCurrentOrigin|null;parentCurrent?:(()=>boolean)|null;parentActivation?:string;retainedLegacyAttempt?:Readonly<Start>|null;
}){
 const access=useRetestAccess(projectId,active,true,expectedScope,readEnabled);
 // These legacy owner slots are never cleared, rebased or resent. Explicit
 // caller handoff can retain a body, but current ACCESS cannot migrate it.
 const [attempt,setAttempt]=useState<Start|null>(null),[receipt]=useState<RouterOutputs["manualRetest"]["start"]|null>(null);
 if(!attempt&&retainedLegacyAttempt)setAttempt(captureLegacyRequest(retainedLegacyAttempt));
 const legacyHeld=attempt??retainedLegacyAttempt,legacyBlocked=!!legacyHeld||!!receipt;
 const reader=useManualRetestReviewedAccess(projectId,sourceRunId,testCaseId,{active:open&&active&&access.ready,organizationId:expectedScope===null?null:expectedScope?.organizationId??access.origin?.organizationId,parentRunScope,parentCurrent,parentActivation});
 const mutation=trpcReact.manualRetest.startReviewed.useMutation();
 const [,setPublished]=useState<ReviewedRetestView|null>(null);
 const [controller]=useState(()=>new ManualRetestReviewedController(next=>setPublished(old=>sameView(old,next)?old:next)));
 const [approval,setApproval]=useState<string|null>(null);
 const readCurrent=reader.current;
 const snapshot=readCurrent(),frame=useMemo(()=>({snapshot,current:readCurrent,open,active:active&&access.ready}),[snapshot,readCurrent,open,active,access.ready]);
 const view=controller.renderView(frame),epoch=view.epoch;
 useLayoutEffect(()=>{controller.attach();return()=>controller.detach();},[controller]);
 useLayoutEffect(()=>{controller.bind(frame);},[controller,frame]);
 const current=useCallback(()=>!!snapshot&&reader.current()===snapshot&&controller.view().epoch===epoch&&controller.view().readable&&open&&active,[snapshot,reader,controller,epoch,open,active]);
 const retained=legacyBlocked||view.busy||view.reviewed||view.pending||view.known&&(!view.receipt||view.canPublish);
 useEffect(()=>{if(current())onRetainedRequestChange?.(retained);},[retained,onRetainedRequestChange,current]);
 const preview=view.readable&&snapshot&&"preview" in snapshot.data?snapshot.data.preview:null,confirmed=current()?view.receipt:null;
 function refresh(){if(!controller.view().busy)reader.refresh();}
 function readEvidence(){if(!legacyBlocked&&current()&&!controller.view().busy)reader.read("PREVIEW");}
 async function approve(checked:boolean){
  if(legacyBlocked||!current()||controller.view().busy||controller.view().pending||controller.view().known)return;
  if(!checked){setApproval(null);return;}
  if(controller.view().canSubmit){setApproval(snapshot!.data.readContext.requestId);return;}
  if(!preview||!snapshot||!controller.view().canReview)return;
  onRetainedRequestChange?.(true);
  if(!current())return;
  const request:Start={projectId,sourceRunId,testCaseId,expectedScope:{projectId:snapshot.origin.projectId,organizationId:snapshot.origin.organizationId,clerkActorId:snapshot.origin.clerkActorId},expectedReviewHash:preview.reviewHash,idempotencyKey:crypto.randomUUID()};
  if(await controller.review(request,installedSession,epoch)&&current())setApproval(snapshot.data.readContext.requestId);
 }
 async function start(){
  if(legacyBlocked||!current())return;
  const state=controller.view();
  if(!state.canRetry&&(approval!==snapshot?.data.readContext.requestId||!state.canSubmit))return;
  onRetainedRequestChange?.(true);
  await controller.submit(epoch,input=>mutation.mutateAsync(input),installedSession);
  // No after-await navigation, implicit LINKS adoption or cache invalidation.
 }
 function readConfirmedLinks(){if(!legacyBlocked&&current()&&controller.view().known&&!controller.view().busy)reader.read("LINKS");}
 function openConfirmed(){
  if(legacyBlocked||!current())return;
  controller.publishConfirmed(installedSession(),epoch,known=>{
   if(reader.current()!==snapshot||!active||!open)return;
   onRetainedRequestChange?.(false);
   if(reader.current()===snapshot)window.location.assign(link(projectId,known.testRunId));
  });
 }
 return <Modal open={open&&active} onClose={onClose} title="Retest this execution" size="wide" dismissible={!view.busy}>
  {legacyBlocked?<section><p role="status">An earlier retest request remains held unchanged in this mounted owner. Its original native submission pin is not available to this reviewed protocol. Current access does not invent that historical provenance. No replacement UUID or request will be sent.</p><p>Legacy recovery requires a separately verified compatibility path; the stored body stays withheld. Reloading does not recover local intent.</p></section>
  :!view.readable?<section><p role="status">{reader.loading?"Verifying current native retest access…":"Current original native actor, organization and session must be explicitly verified. Private evidence, links and actions are hidden; local requests stay retained."}</p>{reader.error&&<p role="alert">The complete current read could not be admitted. Nothing was clipped or substituted.</p>}<button type="button" className="btn-secondary" disabled={view.busy} onClick={refresh}>Recheck original retest access</button></section>
  :<section>
   {view.error&&<p role="alert" style={{color:"var(--ember)",overflowWrap:"anywhere"}}>{view.error}</p>}
   {view.known?<section><h3>Retest receipt retained</h3><p role="status">The identical request has a verified receipt. It will not be submitted again. Current links must independently contain its target before opening it.</p>
    {confirmed?<><p>{confirmed.recovered?"Recovered the existing retest":"Created one separate retest"}. Earlier evidence stays separate.</p><button type="button" className="btn-primary" disabled={!view.canPublish} onClick={openConfirmed}>Open verified retest run</button><p>A later Pass is a separate execution, not proof that a defect was fixed.</p></>:<p>Current relationships have not verified the retained target. Its identifier and historical body remain withheld.</p>}
    <button type="button" className="btn-secondary" disabled={view.busy} onClick={readConfirmedLinks}>Read current links for confirmed retest</button>
   </section>
   :<><h3>Review the original Failed or Blocked execution</h3><p>A supported current FULL-editor preview is required. ACCESS proves only project membership, not start or recovery authority. One separate run uses captured procedures and prerequisites. No AI credits or automatic execution.</p>
    {!preview?<button type="button" className="btn-primary" disabled={view.busy||reader.loading} onClick={readEvidence}>Review original retest evidence</button>
    :<><ManualRetestEvidence preview={preview} projectId={projectId} sourceRunId={sourceRunId} testCaseId={testCaseId} canNavigate={current}/>
     <label style={{display:"flex",alignItems:"flex-start",gap:8,margin:"16px 0"}}><input type="checkbox" checked={approval===snapshot?.data.readContext.requestId} disabled={view.busy||view.pending} onChange={e=>void approve(e.target.checked)}/>I approve one separate retest with this exact supported captured evidence. Earlier results stay separate.</label>
     <button type="button" className="btn-primary" disabled={view.busy||(!view.canRetry&&(!view.canSubmit||approval!==snapshot?.data.readContext.requestId))} onClick={()=>void start()}>{view.busy?"Starting…":view.pending?"Retry identical retest request":"Create reviewed retest run"}</button>
    </>}
    {view.pending&&<p role="status">The response is UNKNOWN. This mounted owner retains the exact original body and UUID. A fresh supported FULL preview is required for retry; a changed preview never rewrites that request. Unsupported or deleted-source recovery is unavailable here. Closing preserves local intent; route-away or reload does not.</p>}
    <button type="button" className="btn-secondary" disabled={view.busy} onClick={readEvidence}>Read current FULL original evidence</button>
   </>}
   <p className="text-muted">Legacy bounded preparation projection, not raw-native audit fidelity. Whole supported preview ≤2 MiB; links ≤10 per page. Captured media references are not files or availability proof. No classification, source fetching or provider processing.</p>
   <button type="button" className="btn-secondary" disabled={view.busy} onClick={()=>{if(current())onClose();}}>Close</button>
  </section>}
 </Modal>;
}
export function ManualRetestEvidence({preview,projectId,sourceRunId,testCaseId,canNavigate}:{preview:Preview;projectId:string;sourceRunId:string;testCaseId:string;canNavigate?:()=>boolean}){return <section>
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
          <a href={link(projectId, sourceRunId)} onClick={event=>{if(!canNavigate?.())event.preventDefault();}}>Open original execution</a>
          <h4>Exact original configuration</h4>
          <dl>
            {Object.entries(preview.configuration)
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
                    {value === "" ? <em>Empty string</em> : value}
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
                {(
                  <p
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    Note: {result.note === null ? "Not supplied" : result.note === "" ? <em>Empty string</em> : result.note}
                  </p>
                )}
                {(
                  <p
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    Error: {result.errorMessage === null ? "Not supplied" : result.errorMessage === "" ? <em>Empty string</em> : result.errorMessage}
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
              {(
                <p style={{ whiteSpace: "pre-wrap" }}>
                  Preconditions / setup: {c.background === null ? "Not supplied" : c.background === "" ? <em>Empty string</em> : c.background}
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
                        {value === "" ? <em>Empty string</em> : value}
                      </dd>
                    </div>
                  ))}
              </dl>
            </details>
          ))}

</section>;}

/** Stable caller project/run/case keys; refresh/session/modal close never evicts
 * an owned pending controller or changes its accepted body. */
export function ManualRetestActions({projectId,sourceRunId,testCaseId,canRetest=true,active=true,onRetainedRequestChange,parentRunScope,parentCurrent,parentActivation}:{projectId:string;sourceRunId:string;testCaseId:string;canRetest?:boolean;active?:boolean;onRetainedRequestChange?:(retained:boolean)=>void;parentRunScope?:ManualRunCurrentOrigin|null;parentCurrent?:(()=>boolean)|null;parentActivation?:string;}){
 const [open,setOpen]=useState(false);
 // Shared metadata remains subscribed even if parent factual readiness changes.
 const access=useRetestAccess(projectId,active,false,undefined,true);
 const reader=useManualRetestReviewedAccess(projectId,sourceRunId,testCaseId,{active,organizationId:access.origin?.organizationId,parentRunScope,parentCurrent,parentActivation});
 const [anchors,setAnchors]=useState<Array<string|undefined>>([undefined]);
 const snapshot=reader.current(),page=snapshot&&"links" in snapshot.data?snapshot.data.links:null;
 // Keep the independently guarded getter captured with its actual snapshot,
 // not a changing callback identity. A benign parent state publication must
 // not poison the child's native read; changed snapshots remain revocation.
 const [presentation,setPresentation]=useState(()=>({snapshot,readCurrent:reader.current,active}));
 if(presentation.snapshot!==snapshot||presentation.active!==active)setPresentation({snapshot,readCurrent:reader.current,active});
 const current=useCallback(()=>!!presentation.snapshot&&presentation.readCurrent()===presentation.snapshot&&presentation.active,[presentation]);
 const childRunScope:ManualRunCurrentOrigin|null=snapshot?Object.freeze({projectId:snapshot.origin.projectId,testRunId:snapshot.origin.sourceRunId,organizationId:snapshot.origin.organizationId,clerkActorId:snapshot.origin.clerkActorId,nativeActorId:snapshot.origin.nativeActorId}):null;
 function readLinks(before?:string,position?:number){if(!current()||!reader.read("LINKS",before))return;setAnchors(old=>position===undefined?[undefined]:old.slice(0,position+1));}
 function next(){if(current()&&page?.nextCursor&&reader.read("LINKS",page.nextCursor))setAnchors(old=>[...old,page.nextCursor!]);}
 function back(){if(!current()||anchors.length<2)return;const i=anchors.length-2;readLinks(anchors[i],i);}
 return <section style={{marginTop:12,minWidth:0,overflowWrap:"anywhere"}}>
  {!snapshot?<section><p role="status">Current original native access must be verified. Cached links and private evidence are withheld; retained requests stay unchanged.</p><button type="button" className="btn-secondary" onClick={()=>reader.refresh()}>Recheck native retest access</button></section>
  :<>{canRetest&&access.canWrite&&<button type="button" className="btn-secondary" onClick={()=>{if(current())setOpen(true);}}>Review separate retest</button>}
   <button type="button" className="btn-secondary" disabled={reader.loading} onClick={()=>readLinks()}>Read current retest relationships</button>
   {page?<section><h4>Current retest relationships · page {anchors.length}</h4><p>Captured outcomes are separate from current run labels. This ≤10-row page is not a whole-history count.</p>
    {page.original&&<p>Retest of <a href={link(projectId,page.original.testRunId)} onClick={e=>{if(!current())e.preventDefault();}}>{page.original.testRunId}</a> · captured {page.original.capturedOutcome}</p>}
    {page.retests.length?<ul>{page.retests.map(run=><li key={run.testRunId}><a href={link(projectId,run.testRunId)} onClick={e=>{if(!current())e.preventDefault();}}>{run.testRunId}</a> · current {run.status} · started {new Date(run.startedAt).toLocaleString()}</li>)}</ul>:<p>No related retests were returned on this current page. No global zero is inferred.</p>}
    <button type="button" className="btn-secondary" disabled={anchors.length<2||reader.loading} onClick={back}>Previous relationships</button><button type="button" className="btn-secondary" disabled={!page.nextCursor||reader.loading} onClick={next}>Next relationships</button>
   </section>:<p>Private relationship pages load only on explicit request; project ACCESS does not verify any source relationship.</p>}
  </>}
  <ManualRetestWizard key={`${projectId}:${sourceRunId}:${testCaseId}`} projectId={projectId} sourceRunId={sourceRunId} testCaseId={testCaseId} open={open} onClose={()=>setOpen(false)} readEnabled={open}
   active={active&&canRetest&&access.ready&&access.canWrite} expectedScope={access.origin} parentRunScope={childRunScope} parentCurrent={current} parentActivation={snapshot?.data.readContext.requestId} onRetainedRequestChange={onRetainedRequestChange}/>
 </section>;
}
