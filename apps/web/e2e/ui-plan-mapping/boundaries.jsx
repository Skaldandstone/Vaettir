// Synthetic transport only. Production components and plan authorization/draft
// controllers remain real. This fixture never talks to a hosted service.
import React, { useMemo, useState } from "react";
import { planGovernanceRequestHash } from "../../lib/plan-governance-receipt";
export const scope = { projectId: "synthetic-project", organizationId: "synthetic-org", actorId: "synthetic-native", actorClerkUserId: "synthetic-clerk" };
const cases = [
  { id: "case-checkout", displayId: "SYN-01", title: "Checkout API persists an accepted order and returns its confirmation", reviewStatus: "APPROVED", archived: false },
  { id: "case-retry", displayId: "SYN-02", title: "Retrying the same order does not create a duplicate charge", reviewStatus: "APPROVED", archived: false },
  { id: "case-errors", displayId: "SYN-03", title: "A rejected payment leaves no persisted order", reviewStatus: "PENDING_REVIEW", archived: false },
];
let template = {}, revision = "a".repeat(64), saveCount = 0, decisions = [], savedSource = false;
const savedRequests = new Map();
const sentRequests = [], responseListeners = new Set();
const complianceReads = [], projectCreations = [], projectRoutes = [];
let pendingResponse = null;
const controlled = new URLSearchParams(location.search).has("controlled");
const bulk = new URLSearchParams(location.search).has("bulk");
const uploadPreviews = [], uploadSaves = [], retainedUploads = new Set();
let failBulkAck = bulk;
function respondLater(value) {
  if (!controlled) return value;
  return new Promise((resolve, reject) => {
    pendingResponse = { resolve: () => resolve(value), reject: () => reject(Error("Synthetic lost response")) };
    responseListeners.forEach(notify => notify());
  });
}
export function ResponseControls() {
  const [, refresh] = useState(0);
  React.useEffect(() => { const notify = () => refresh(v => v + 1); responseListeners.add(notify); return () => responseListeners.delete(notify); }, []);
  function settle(action) { const response = pendingResponse; pendingResponse = null; response?.[action](); refresh(v => v + 1); }
  return controlled && <div className="workspace-toolbar" aria-label="Synthetic response controls">
    <button disabled={!pendingResponse} onClick={() => settle("resolve")}>Deliver synthetic response</button>
    <button disabled={!pendingResponse} onClick={() => settle("reject")}>Lose synthetic response</button>
  </div>;
}
const reject = () => { throw Error("Provider calls and unrelated writes are forbidden in this fixture"); };
export const useAuth = () => ({ userId: scope.actorClerkUserId, sessionId: "synthetic-session", isLoaded: true, isSignedIn: true });
export const useRouter = () => ({ push: value => {
  if (value !== "/projects/synthetic-created/compliance?setup=1") return reject();
  projectRoutes.push(value);
} });
export const usePathname = () => "/projects/synthetic-project/architecture";
export const CaseCustomFieldsForm = () => null;
function query(resolve) {
  return { useQuery(input) {
    const [refresh, setRefresh] = useState(0);
    const data = useMemo(() => resolve(input), [JSON.stringify(input), refresh]);
    return { data, isSuccess: true, isFetchedAfterMount: true, isFetching: false, isPaused: false, isLoading: false, error: null, refetch: async () => { setRefresh(value => value + 1); return { data: resolve(input) }; } };
  } };
}
function mutation(resolve) {
  return { useMutation() {
    const [isPending, setPending] = useState(false);
    return { isPending, mutateAsync: async input => { setPending(true); try { return await resolve(input); } finally { setPending(false); } } };
  } };
}
const preview = input => ({
  requestId: input.requestId, scope, canRecover: true, canEdit: true, editBlockedReason: null,
  planRevision: revision, metadataSchema: { fieldSchemaHash: "c".repeat(64), canEdit: true },
  statusActions: { canChange: true, canReopen: false },
  snapshot: { id: "synthetic-plan", projectId: scope.projectId, name: "Checkout release validation", status: "DRAFT", executionTemplate: template },
});
const document = {
  fileName: "synthetic-checkout.puml", hash: "d".repeat(64), format: "PLANTUML", warnings: [],
  elements: [
    { id: "storefront", label: "Storefront", kind: "COMPONENT", quote: 'component "Storefront"', line: 2 },
    { id: "checkout", label: "Checkout API", kind: "COMPONENT", quote: 'component "Checkout API"', line: 3 },
    { id: "orders", label: "Order Store", kind: "COMPONENT", quote: 'database "Order Store"', line: 4 },
    { id: "submit", label: "Submit order", kind: "INTERACTION", from: "storefront", to: "checkout", quote: "Storefront --> CheckoutAPI : submits order", line: 5 },
  ],
};
const uploadHash = input => (input.fileName === "bulk-second.puml" ? "2" : "1").repeat(64);
const architecturePreview = input => ({
  ...scope, organizationId: scope.organizationId, actorClerkUserId: scope.actorClerkUserId,
  scopeHash: "e".repeat(64), document: bulk ? (uploadPreviews.push(input.fileName), { ...document, fileName: input.fileName, hash: uploadHash(input) }) : document, cases, decisions: [...decisions], results: [], unprocessed: [],
  canSpend: true, maximumCredits: 12, batchCount: 1, balance: 0,
});
export const trpcReact = {
  useUtils: () => ({project:{list:{invalidate:async()=>{}}}}),
  compliance: {
    catalog: query(input => {
      if (input !== undefined) throw Error("Catalog takes no project input");
      complianceReads.push({route:"catalog"});
      return [{id:"music-rights-us",name:"Music and performance rights",version:"synthetic-1",category:"Content & rights",summary:"Synthetic public rights prompts",controls:1,catalogVersion:"synthetic"}];
    }),
    listFrameworks: query(input => {
      if (input.organizationId !== scope.organizationId) throw Error("Wrong catalog workspace");
      complianceReads.push({route:"listFrameworks",input:structuredClone(input)});
      return [
        {id:"synthetic-owned-framework",name:"Music and performance rights",version:"workspace-1",workspaceOwned:true,controlCount:1,revision:1},
        {id:"synthetic-unowned-framework",name:"Unowned legacy definition",version:null,workspaceOwned:false,controlCount:1,revision:1},
      ];
    }),
  },
  organization: { mine: query(() => [{ id: scope.organizationId, name: "Synthetic workspace", role: "OWNER", seatType: "FULL" }]) },
  testPlanGovernance: {
    preview: query(preview),
    saveExecutionTemplate: mutation(async input => {
      sentRequests.push(structuredClone(input));
      if (savedRequests.has(input.requestId)) return respondLater({ ...savedRequests.get(input.requestId), replayed: true });
      if (input.expectedPlanRevision !== revision) throw Error("Plan changed");
      const before = revision;
      template = structuredClone(input.template); revision = "b".repeat(64); saveCount++;
      const ack = { scope, requestId: input.requestId, requestHash: await planGovernanceRequestHash("SAVE_EXECUTION_TEMPLATE", input), operation: "SAVE_EXECUTION_TEMPLATE", testPlanId: "synthetic-plan", criterionId: null, releaseId: null, beforeRevision: before, afterRevision: revision, versionId: "version-2", versionNumber: 2, replayed: false };
      savedRequests.set(input.requestId, ack);
      return respondLater(ack);
    }),
  },
  planExecutionReads: { page: query(input => ({
    readContext: { requestId: input.requestId, scope },
    plan: { id: "synthetic-plan", projectId: scope.projectId },
    candidates: cases.filter(c => `${c.displayId} ${c.title}`.toLowerCase().includes(input.search.toLowerCase())),
    selected: (template.testCaseIds ?? []).map(id => ({ testCaseId: id, metadata: cases.find(c => c.id === id) })),
    nextCursor: null,
  })) },
  project: {
    byId: query(() => ({ id: scope.projectId, organizationId: scope.organizationId })),
    list: query(() => [
      { id: "synthetic-checkout", name: "Checkout platform", repoUrl: null },
      { id: "synthetic-mobile", name: "Mobile experience", repoUrl: null },
      { id: "synthetic-identity", name: "Identity & access", repoUrl: null },
      { id: "synthetic-long", name: "Order fulfillment and inventory reconciliation", repoUrl: null },
    ]),
    create: {useMutation(options) {
      const [isPending,setPending]=useState(false);
      return {isPending,mutate:async input=>{
        setPending(true);
        try {
          if(input.organizationId!==scope.organizationId)throw Error("Wrong creation workspace");
          projectCreations.push(structuredClone(input));
          options.onSuccess?.({id:"synthetic-created",name:input.name});
        } catch(error) {options.onError?.(error);} finally {setPending(false);}
      }};
    }}, update: mutation(reject), delete: mutation(reject),
  },
  caseFields: { get: query(() => ({ projectId: scope.projectId, caseId: null, readScope: scope, canEdit: true })) },
  repositoryIntelligence: {
    projectReleases: query(input => ({ projectId: input.projectId, offset: input.offset, repositories: [], nextOffset: null })),
  },
  architecture: {
    documents: query(() => savedSource ? [{ ...document, savedAt: "2026-10-20T12:00:00Z" }] : []),
    preview: mutation(architecturePreview),
    openDocument: mutation(() => ({ fileName: document.fileName, content: "@startuml\ncomponent CheckoutAPI\n@enduml" })),
    saveDocument: mutation(input => {
      savedSource = true;
      if (!bulk) return { hash: document.hash };
      uploadSaves.push(structuredClone(input)); retainedUploads.add(uploadHash(input));
      if (input.fileName === "bulk-second.puml" && failBulkAck) { failBulkAck = false; throw Error("Synthetic lost save acknowledgement"); }
      return { hash: uploadHash(input) };
    }),
    analyzeBatch: mutation(reject), saveDraft: mutation(reject),
    decide: mutation(input => {
      sentRequests.push(structuredClone(input));
      if (savedRequests.has(input.requestId)) return respondLater(savedRequests.get(input.requestId));
      savedSource = true;
      decisions = [...decisions.filter(d => d.caseId !== input.caseId || d.elementId !== input.elementId), { ...input, revision: decisions.length + 1, createdAt: "2026-10-20T12:00:00Z" }];
      const ack = { saved: true };
      savedRequests.set(input.requestId, ack);
      return respondLater(ack);
    }),
  },
};
export function Evidence() {
  const [, refresh] = useState(0);
  return <details><summary onClick={() => refresh(v => v + 1)}>Synthetic transport evidence</summary><pre data-testid="transport-evidence">{JSON.stringify({ complianceReads, projectCreations, projectRoutes, template, saveCount, decisions, savedSource, sentRequests, uploadPreviews, uploadSaves, retainedUploadCount: retainedUploads.size })}</pre></details>;
}
