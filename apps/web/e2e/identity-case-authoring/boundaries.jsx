// Explicit synthetic transport, not a provider/session authentication proof.
import { useMemo, useSyncExternalStore } from "react";
const listeners = new Set();
let revision = 0;
const initial = {
  projectId: "synthetic-project", organizationId: "synthetic-org", userId: "synthetic-actor", sessionId: "synthetic-session",
  role: "VIEWER", seatType: "FULL", permissions: ["cases.write"], fetching: false, error: false,
  fieldFetching: false, fieldError: false, fieldEditable: true, fieldOrganizationId: null,
  actionProjectId: null, actionSubject: null, actionOrganizationId: null, failSave: false,
};
let state = { ...initial, ...(location.search === "?denied=1" ? { permissions: [], seatType: "LIGHT" } : {}) };
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
function useRevision() { return useSyncExternalStore(subscribe, () => revision); }
const calls = [], navigations = [], reads = [];
function patch(next) { state = { ...state, ...next }; revision++; for (const fn of listeners) fn(); }
window.Clerk = { loaded: true, session: { id: initial.sessionId, user: { id: initial.userId } } };
window.fixture = {
  patch,
  session(userId, sessionId) { window.Clerk.session = { id: sessionId, user: { id: userId } }; patch({ userId, sessionId }); },
  liveSession(userId, sessionId) { window.Clerk.session = { id: sessionId, user: { id: userId } }; patch({}); },
  snapshot: () => structuredClone({ state, calls, navigations, reads }),
};
export function useAuth() { useRevision(); return { isLoaded: true, isSignedIn: true, userId: state.userId, sessionId: state.sessionId }; }
export function useParams() { useRevision(); return { projectId: state.projectId, id: "synthetic-case" }; }
const router = { push: href => navigations.push(href) };
export const useRouter = () => router;
const scope = (projectId, organizationId = state.organizationId) => ({ projectId, organizationId, actorId: "synthetic-native-actor", actorClerkUserId: state.userId });
const caseRow = () => ({ id: "synthetic-case", projectId: state.projectId, title: "Synthetic retained case", background: "Synthetic fixture only",
  testType: "FUNCTIONAL", validationDomain: "SOFTWARE", verificationProfile: { setup: "", safety: "", instruments: "", acceptanceCriteria: "" },
  priority: "HIGH", tags: ["synthetic"], suitePath: "Identity / Manual authoring", given: [], when: [], then: [], sharedStepGroupId: null,
  caseRevision: "case-r1", stepRevision: "steps-r1", steps: [{ action: "Open isolated fixture", expectedResult: "Fixture visible", expectedActionOrData: null, expectedResponse: null, mediaAttachmentIds: [] }] });
function query(name, get, flags = () => ({})) { return { useQuery(input, options) {
  const version = useRevision(), key = JSON.stringify(input);
  const data = useMemo(() => get(input), [version, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const status = flags(), enabled = options?.enabled !== false;
  if (!reads.some(read => read.name === name && JSON.stringify(read.input) === key)) reads.push({ name, input });
  return { data, isSuccess: enabled && !status.error, isError: !!status.error, isPending: !enabled,
    isFetchedAfterMount: enabled, isFetching: !!status.fetching, isPaused: false,
    error: status.error ? new Error("Synthetic access response unavailable") : null,
    refetch: async () => { patch({ error: false, fetching: false, fieldError: false, fieldFetching: false }); return { data }; } };
} }; }
const mutation = name => ({ useMutation: () => ({ isPending: false, mutateAsync: async input => {
  calls.push({ name, input: structuredClone(input) });
  if (name !== "create" && name !== "update") throw Error("Out-of-scope mutation attempted");
  if (state.failSave) throw Error("Synthetic save failed; draft retained");
  return { id: "synthetic-case" };
} }) });
const invalidate = async () => {};
export const trpcReact = {
  useUtils: () => ({ testCases: { list: { invalidate }, byId: { invalidate } }, caseFields: { get: { invalidate } }, testCaseAttachments: { list: { invalidate } } }),
  project: { byId: query("project", () => ({ id: state.projectId, organizationId: state.organizationId })), experience: query("experience", () => undefined) },
  organization: { mine: query("membership", () => [{ id: state.organizationId, role: state.role, seatType: state.seatType }]) },
  identityAccess: { projectActions: query("actions", () => ({ projectId: state.actionProjectId ?? state.projectId, organizationId: state.actionOrganizationId ?? state.organizationId,
    clerkSubject: state.actionSubject ?? state.userId, permissions: state.permissions, policyRevision: 1 }), () => state) },
  testCases: { byId: query("case", caseRow), list: query("cases", () => []), create: mutation("create"), update: mutation("update") },
  sharedStepGroups: { list: query("shared", () => []) },
  testCaseAttachments: { list: query("attachments", () => []), requestUpload: mutation("upload"), confirmUpload: mutation("confirm"), delete: mutation("delete") },
  caseFields: { get: query("fields", input => ({ projectId: input.projectId, caseId: input.caseId ?? null,
    organizationId: state.fieldOrganizationId ?? state.organizationId, readScope: scope(input.projectId, state.fieldOrganizationId ?? state.organizationId),
    canEdit: state.fieldEditable && (state.role === "EDITOR" || (input.authoringAction === "cases.write" && state.permissions.includes("cases.write"))), canConfigure: false,
    expectedSchemaHash: "schema-r1", expectedValueHash: "values-r1", values: input.caseId ? { evidence: "Original synthetic evidence" } : {},
    schema: { fields: [{ key: "evidence", label: "Evidence reference", type: "TEXT", required: true, retired: false, options: [] }] },
  }), () => ({ fetching: state.fieldFetching, error: state.fieldError })) },
  caseFieldPresentation: { get: query("fieldPresentation", input => ({ projectId: input.projectId, organizationId: state.organizationId, caseId: null,
    readScope: scope(input.projectId), definitionSupported: true, fieldAuthoringSchemaHash: "schema-r1", configurationSupported: true, warnings: [] })) },
  casePresentation: { get: query("presentation", () => undefined) },
};
