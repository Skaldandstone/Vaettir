// Explicit synthetic boundaries used only by the local component browser runner.
import React, { useEffect } from "react";
import { defaultCasePresentation, CASE_PRESENTATION_FIELDS } from "@vaettir/core";
const refuse = () => { throw Error("Transport is forbidden in UI component verification"); };
const query = (data: unknown) => ({ useQuery: () => ({ data, isFetchedAfterMount: true, isFetching: false, isPaused: false, error: null, refetch: refuse }) });
const mutation = { useMutation: () => ({ mutateAsync: refuse }) };
const presentation = defaultCasePresentation(null);
for (const key of CASE_PRESENTATION_FIELDS) presentation.fields[key] = "SHOW";
const origin = { projectId: "synthetic-project", organizationId: "synthetic-org", caseId: "synthetic-case", clerkActorId: "synthetic-actor" };
export const trpcReact = { useUtils: () => ({}), project: { experience: query({ experience: null }) }, casePresentation: { get: query({ projectId: origin.projectId, organizationId: origin.organizationId, caseId: null, readScope: { projectId: origin.projectId, organizationId: origin.organizationId, actorId: "synthetic-db-actor", actorClerkUserId: origin.clerkActorId }, configuration: presentation, defaults: presentation }) }, testCases: { list: query([]), create: mutation, update: mutation }, sharedStepGroups: { list: query([]) }, testCaseAttachments: { list: query([]), requestUpload: mutation, confirmUpload: mutation, delete: mutation } };
export const useCaseFieldAccess = () => ({ origin, current: origin, readable: true });
export const useRouter = () => ({ push: refuse });
export const usePathname = () => "/projects/synthetic-project/test-cases";
export const useAuth = () => ({ userId: "synthetic-actor" });
export const GlobalSearch = () => <input aria-label="Project search" placeholder="Search project" style={{ width: "100%" }}/>;
export const QualityExperienceWizard = () => null;
Object.assign(trpcReact.project, {
  byId: { useQuery: () => ({ isSuccess: true, isError: false, data: { id: "synthetic-project", name: "Demo project", organizationId: "synthetic-org" } }) },
  list: { useQuery: () => ({ isSuccess: true, isError: false, data: [{ id: "synthetic-project", name: "Demo project" }] }) },
});
export const collectKnownSuitePaths = () => [];
export const CaseDesignGuide = () => null;
export const CaseTagEditor = () => <div className="text-muted">Tags · synthetic fixture</div>;
export function CaseCustomFieldsForm({ onChange }: { onChange: (value: unknown) => void }) {
  useEffect(() => onChange({ ready: true, customFields: {}, expectedFieldSchemaHash: "synthetic", expectedCustomFieldRevision: "synthetic" }), [onChange]);
  return null;
}
