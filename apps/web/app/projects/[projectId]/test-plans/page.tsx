"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import {
  trpcReact,
  useReadOnlySeat,
  type RouterOutputs,
  type RouterInputs,
} from "@/lib/trpcReact";
import { Drawer } from "@/components/Drawer";
import { Modal } from "@/components/Modal";
import { TestPlanDetailContent } from "@/components/TestPlanDetailContent";
import { resolveQualityExperience } from "@vaettir/core";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { currentSessionScope, sameAuthScope } from "@/lib/auth-query-cache";
import { retainedTraceabilityReceipt } from "@/lib/traceability-receipt";
import { IconButton } from "@/components/ui/IconButton";

const STATUSES = ["DRAFT", "ACTIVE", "IN_REVIEW", "APPROVED"];

/** Manual creation is independent of AI generation and global reference seeds.
 * The legacy create transport has no receipt/UUID: UNKNOWN must not be retried. */
function ManualPlanCreate({projectId,readOnly,onCreated}:{projectId:string;readOnly:boolean;onCreated:()=>Promise<unknown>}) {
  const access=useCaseFieldAccess(projectId),auth=useAuth();
  const typesQuery=trpcReact.testPlans.types.useQuery(undefined,{retry:false,staleTime:0});
  const create=trpcReact.testPlans.create.useMutation();
  const [name,setName]=useState("");
  const [typeId,setTypeId]=useState("");
  const [notice,setNotice]=useState("");
  const [pending,setPending]=useState(false);
  const [unknown,setUnknown]=useState(false);
  const [knownId,setKnownId]=useState("");
  const [privateOwner,setPrivateOwner]=useState<{projectId:string;organizationId:string;nativeActorId:string;clerkActorId:string;sessionId:string}|null>(null);
  const [epoch,publishEpoch]=useState(0);
  const epochRef=useRef(0),generation=useRef(0),inFlight=useRef(false);
  const held=useRef<{input:RouterInputs["testPlans"]["create"];uncertain:boolean}|null>(null);
  const sdk=typeof window==="undefined"?null:currentSessionScope(window.Clerk?.loaded?window.Clerk.session:null);
  const sdkCurrent=sameAuthScope({userId:auth.userId??"",sessionId:auth.sessionId??""},sdk);
  const frame=useMemo(()=>({projectId,organizationId:access.origin?.organizationId??"",nativeActorId:access.fresh?.readScope?.actorId??"",clerkActorId:auth.userId??"",sessionId:auth.sessionId??"",
    eligible:!readOnly&&access.readable&&access.canEdit&&auth.isLoaded&&!!auth.isSignedIn&&sdkCurrent,
  }),[projectId,access.origin?.organizationId,access.fresh?.readScope?.actorId,auth.userId,auth.sessionId,auth.isLoaded,auth.isSignedIn,sdkCurrent,readOnly,access.readable,access.canEdit]);
  const committed=useRef<{frame:typeof frame;epoch:number}|null>(null);
  useLayoutEffect(()=>{const owner={frame,epoch:++epochRef.current};committed.current=owner;publishEpoch(owner.epoch);return()=>{if(committed.current===owner){committed.current=null;epochRef.current=owner.epoch+1;}};},[frame]);
  function sameOwner(original:typeof privateOwner){return !!original&&frame.projectId===original.projectId&&frame.organizationId===original.organizationId&&frame.nativeActorId===original.nativeActorId&&frame.clerkActorId===original.clerkActorId&&frame.sessionId===original.sessionId;}
  function owns(){const current=committed.current;return !!current&&current.epoch===epoch&&epochRef.current===epoch&&current.frame===frame&&frame.eligible&&!!frame.nativeActorId&&(!privateOwner||sameOwner(privateOwner))&&!!access.origin&&access.owns(access.origin,"edit")&&sameAuthScope({userId:frame.clerkActorId,sessionId:frame.sessionId},typeof window==="undefined"?null:currentSessionScope(window.Clerk?.loaded?window.Clerk.session:null));}
  const typesReady=typesQuery.isSuccess&&!typesQuery.error&&!typesQuery.isFetching&&!typesQuery.isPaused;
  const types=typesReady?typesQuery.data:[];
  const event=generation.current;
  function edit(change:()=>void){if(event!==generation.current||inFlight.current||held.current||!owns())return;generation.current++;if(!privateOwner)setPrivateOwner(frame);setKnownId("");setNotice("");change();}
  async function submit(){
    if(event!==generation.current||inFlight.current||held.current)return;
    if(!owns()){setNotice("Current full editor access is required to create a plan. Your draft is retained.");return;}
    if(!name.trim()){setNotice("Enter a plan name before creating it.");return;}
    if(name.trim().length>200){setNotice("Use a plan name of 200 characters or fewer.");return;}
    if(typeId&&(!typesReady||!types.some(type=>type.id===typeId))){setNotice("The selected plan type is unavailable. Refresh types or choose Functional (default).");return;}
    const input:RouterInputs["testPlans"]["create"]=Object.freeze({projectId,name:name.trim(),...(typeId?{testPlanTypeId:typeId}:{})});
    const attempt={input,uncertain:false};held.current=attempt;inFlight.current=true;setPending(true);setNotice("");if(!privateOwner)setPrivateOwner(frame);
    try{
      const result=await create.mutateAsync(input);
      if(!result||Object.keys(result).length!==2||!Object.hasOwn(result,"id")||!Object.hasOwn(result,"name")||typeof result.id!=="string"||!result.id||result.id.length>200||result.name!==input.name)throw Error("Plan acknowledgement did not match the original create.");
      if(!owns()){attempt.uncertain=true;setUnknown(true);return;}
      held.current=null;generation.current++;setName("");setTypeId("");setKnownId(result.id);setNotice("Test plan created.");
      try{await onCreated();}catch{if(owns())setNotice("Test plan created, but the list could not be refreshed. Open the saved plan; do not create it again.");}
    }catch(cause){
      const original=held.current;
      if(original){original.uncertain=original.uncertain||!owns();const retained=retainedTraceabilityReceipt(original,cause);if(retained){held.current=retained;setUnknown(true);}else{held.current=null;generation.current++;}}
      if(owns())setNotice(held.current?"Creation was not acknowledged. Check the plan list before any new creation; this draft will not be automatically resubmitted.":"The plan could not be created. Your name and type are retained; review them before trying again.");
    }finally{inFlight.current=false;setPending(false);}
  }
  const visible=frame.eligible&&(!privateOwner||sameOwner(privateOwner));
  return <section aria-label="Manual test plan creation" style={{margin:"16px 0",minWidth:0}}>
    {visible?<>
      <h2 style={{fontSize:18,marginBottom:10}}>Create test plan</h2>
      <form onSubmit={async event=>{event.preventDefault();await submit();}} style={{display:"flex",flexWrap:"wrap",gap:10,alignItems:"end"}}>
        <label style={{display:"grid",gap:6,flex:"2 1 220px",minWidth:0}}>Plan name<input value={name} maxLength={200} disabled={pending||unknown} onChange={event=>edit(()=>setName(event.target.value))} placeholder="e.g. Release regression" style={{width:"100%",minWidth:0,boxSizing:"border-box"}}/></label>
        <label style={{display:"grid",gap:6,flex:"1 1 190px",minWidth:0}}>Plan type<select value={typeId} disabled={pending||unknown} onChange={event=>edit(()=>setTypeId(event.target.value))} style={{width:"100%",minWidth:0}}><option value="">Functional (default)</option>{typeId&&!types.some(type=>type.id===typeId)&&<option value={typeId}>Selected type (refresh required)</option>}{types.map(type=><option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
        <button type="submit" className="btn-primary" disabled={pending||unknown||!name.trim()||!!typeId&&(!typesReady||!types.some(type=>type.id===typeId))}>{pending?"Creating test plan…":"Create test plan"}</button>
      </form>
      {typesQuery.error?<p role="alert" style={{fontSize:13}}>Plan types could not be loaded. Functional (default) is still available. <button type="button" className="btn-secondary" disabled={typesQuery.isFetching||pending} onClick={()=>{if(owns())void typesQuery.refetch();}}>Retry plan types</button></p>:!typesReady?<p role="status" style={{fontSize:13}}>Checking plan types… Functional (default) is available.</p>:!types.length?<p role="status" style={{fontSize:13}}>No other plan types are available. Functional (default) can be created now.</p>:null}
      <details style={{fontSize:13,marginTop:8}}><summary>Plan type help</summary><p>A manual plan needs a name. Functional is the standard case-planning format; other types add their own fields. Creating a manual plan does not generate AI content or start a test run.</p></details>
      {notice&&<p role={unknown?"alert":"status"}>{notice}</p>}
      {unknown&&!notice&&<p role="alert">The original creation remains unacknowledged. Check the plan list; do not submit this draft again.</p>}
      {knownId&&<a href={`/projects/${encodeURIComponent(projectId)}/test-plans/${encodeURIComponent(knownId)}`}>Open created plan</a>}
    </>:<p role="status">{readOnly?"A full editor seat is required to create test plans.":"Checking original project access…"} Any manual draft or unacknowledged creation is retained and withheld here.</p>}
  </section>;
}

// P4-02: review-before-save panel for an AI-drafted QA strategy. Shows the
// four generated lists as plain text (one item per line, editable) so the
// user can tweak the draft before it becomes a real TestPlan -- generation
// never silently creates data on its own.
function GenerateStrategyModal({
  open,
  onClose,
  projectId,
  projectRepo,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectRepo: { repoUrl: string | null; defaultBranch: string } | null;
  onCreated: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [groundInBuild, setGroundInBuild] = useState(false);
  const [baseRef, setBaseRef] = useState("");
  const [headRef, setHeadRef] = useState("");
  const [draft, setDraft] = useState<
    RouterOutputs["testPlans"]["generateStrategyDraft"] | null
  >(null);
  const [planName, setPlanName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // P1-15: mutateAsync keeps the original sequential generate -> edit -> create
  // flow; these are one-shot AI/create actions, not cached data.
  const generateMutation =
    trpcReact.testPlans.generateStrategyDraft.useMutation();
  const createMutation = trpcReact.testPlans.create.useMutation();

  function linesToArray(text: string): string[] {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async function generate() {
    if (!prompt.trim()) return;
    setError(null);
    try {
      const result = await generateMutation.mutateAsync({
        projectId,
        prompt: prompt.trim(),
        ...(groundInBuild && headRef.trim()
          ? { baseRef: baseRef.trim() || undefined, headRef: headRef.trim() }
          : {}),
      });
      setDraft(result);
      setPlanName(
        prompt.trim().length > 60
          ? `${prompt.trim().slice(0, 57)}…`
          : prompt.trim(),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function createFromDraft() {
    if (!draft || !planName.trim()) return;
    setError(null);
    try {
      const { groundedInCommits: _groundedInCommits, ...customFields } = draft;
      await createMutation.mutateAsync({
        projectId,
        testPlanTypeId: draft.testPlanTypeId,
        name: planName.trim(),
        customFields,
      });
      setPrompt("");
      setDraft(null);
      setPlanName("");
      onClose();
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const generating = generateMutation.isPending;
  const creating = createMutation.isPending;

  return (
    <Modal open={open} onClose={onClose} title="Generate a QA strategy draft">
      <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
        <label>
          What's changing or shipping?
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder="e.g. We're shipping a new payments checkout flow in Q3"
            style={{ width: "100%" }}
          />
        </label>
        {projectRepo?.repoUrl && (
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: 8,
            }}
          >
            <label style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={groundInBuild}
                onChange={(e) => setGroundInBuild(e.target.checked)}
              />{" "}
              Ground in a real build (the actual commits between two refs, e.g.
              "what's in this release")
            </label>
            {groundInBuild && (
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <input
                  value={baseRef}
                  onChange={(e) => setBaseRef(e.target.value)}
                  placeholder={`Base ref (default: ${projectRepo.defaultBranch})`}
                  style={{ flex: 1, fontSize: 13 }}
                />
                <input
                  value={headRef}
                  onChange={(e) => setHeadRef(e.target.value)}
                  placeholder="Head ref (tag, branch, or commit for this build)"
                  style={{ flex: 1, fontSize: 13 }}
                />
              </div>
            )}
          </div>
        )}
        <button
          className="btn-secondary"
          onClick={generate}
          aria-busy={generating}
          disabled={
            generating || creating || !prompt.trim() || (groundInBuild && !headRef.trim())
          }
        >
          {generating ? "Generating…" : "Generate draft"}
        </button>

        {generating && (
          <section className="plan-generation-status" role="status" aria-live="polite" aria-atomic="true">
            <div className="plan-generation-message">
              <span className="loading-indicator" aria-hidden="true" />
              <div>
                <strong>Building your plan draft…</strong>
                <p>This may take up to three minutes.</p>
              </div>
            </div>
            <div className="plan-generation-progress" role="progressbar" aria-label="Plan generation" aria-valuetext="Working; completion percentage is not available.">
              <span aria-hidden="true" />
            </div>
          </section>
        )}
        {error && <p role="alert" style={{ color: "var(--ember)" }}>{error}</p>}
        {draft && !generating && !error && <p role="status">Your plan draft is ready to review.</p>}

        {draft?.groundedInCommits && (
          <details style={{ fontSize: 12 }}>
            <summary>
              Grounded in {draft.groundedInCommits.length} real commit(s)
            </summary>
            <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
              {draft.groundedInCommits.map((c) => (
                <li key={c.sha}>
                  <code>{c.sha}</code> {c.subject}
                </li>
              ))}
            </ul>
          </details>
        )}

        {draft && (
          <>
            <label>
              Plan name
              <input
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                style={{ width: "100%" }}
              />
            </label>
            {(
              [
                ["riskAreas", "Risk areas"],
                ["environments", "Environments"],
                ["entryCriteria", "Entry criteria"],
                ["exitCriteria", "Exit criteria"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}{" "}
                <span className="text-muted" style={{ fontSize: 12 }}>
                  (one per line, edit freely)
                </span>
                <textarea
                  value={draft[key].join("\n")}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: linesToArray(e.target.value) })
                  }
                  rows={3}
                  style={{
                    width: "100%",
                    fontFamily: "monospace",
                    fontSize: 12,
                  }}
                />
              </label>
            ))}
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 8,
              }}
            >
              <button className="btn-secondary" onClick={onClose}>
                Discard
              </button>
              <button
                className="btn-primary"
                onClick={createFromDraft}
                disabled={generating || creating || !planName.trim()}
              >
                {creating ? "Creating…" : "Create QA strategy plan"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// P1-15
export default function TestPlansPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const utils = trpcReact.useUtils();
  const readOnly = useReadOnlySeat(projectId);
  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const experienceQuery = trpcReact.project.experience.useQuery({ projectId });
  const workspace = experienceQuery.data?.experience ? resolveQualityExperience(experienceQuery.data.experience) : null;
  const plansQuery = trpcReact.testPlans.list.useQuery({ projectId });
  const plans = plansQuery.data ?? [];
  const projectRepo = projectQuery.data
    ? {
        repoUrl: projectQuery.data.repoUrl,
        defaultBranch: projectQuery.data.defaultBranch,
      }
    : null;

  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);

  const invalidatePlans = () =>
    utils.testPlans.list.invalidate({ projectId });

  const visiblePlans = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q)) &&
        (!statusFilter || p.status === statusFilter),
    );
  }, [plans, search, statusFilter]);

  const loading = plansQuery.isLoading;
  const pageError = plansQuery.error?.message ?? null;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10}}><h1>Test Plans</h1>
      {workspace&&<IconButton icon="help" label="Test plan guidance" tooltip={<span>{workspace.planGuidance.join(" ")} Open a plan to choose ordered cases and save named configurations, then review each repeat execution. Each run keeps its own case definitions and configuration. Automatic recurring scheduling and domain-specific regulatory review are not enabled.</span>}/>}</div>
      {readOnly && (
        <p className="text-muted" style={{ fontSize: 13 }}>
          You have read-only access to this organization — creating and editing
          plans is hidden.
        </p>
      )}

      <ManualPlanCreate projectId={projectId} readOnly={readOnly} onCreated={invalidatePlans}/>
      {!readOnly && (
        <div style={{marginBottom:16}}>
          <button
            className="btn-secondary"
            onClick={() => setGenerateOpen(true)}
          >
            Generate strategy with AI
          </button>
        </div>
      )}

      {loading && <p>Loading…</p>}
      {pageError && <p style={{ color: "var(--ember)" }}>{pageError}</p>}

      {plans.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search plans…"
            style={{ flex: 1, maxWidth: 300 }}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      <ul>
        {visiblePlans.map((p) => (
          <li key={p.id}>
            <a
              href={`/projects/${projectId}/test-plans/${p.id}`}
              onClick={(e) => {
                e.preventDefault();
                setOpenPlanId(p.id);
              }}
            >
              {p.name}
            </a>{" "}
            <small>
              [{p.testPlanType.name}] {p.status} — {p.acceptanceCriteria.length}{" "}
              acceptance criteria
            </small>
          </li>
        ))}
        {!loading && plans.length === 0 && (
          <p style={{ color: "var(--muted)" }}>No test plans yet.</p>
        )}
        {!loading && plans.length > 0 && visiblePlans.length === 0 && (
          <p style={{ color: "var(--muted)" }}>No test plans match.</p>
        )}
      </ul>

      <Drawer open={openPlanId !== null} onClose={() => setOpenPlanId(null)}>
        {openPlanId && (
          <TestPlanDetailContent
            key={openPlanId}
            id={openPlanId}
            projectId={projectId}
            onChanged={invalidatePlans}
            readOnly={readOnly}
          />
        )}
      </Drawer>

      <GenerateStrategyModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        projectId={projectId}
        projectRepo={projectRepo}
        onCreated={invalidatePlans}
      />
    </div>
  );
}
