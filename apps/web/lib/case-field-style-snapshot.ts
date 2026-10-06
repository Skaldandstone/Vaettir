import { caseFieldPresentationSchema, type CaseFieldPresentation } from "../../api/src/services/caseFieldPresentationSchema";
import type { CaseFieldOrigin } from "./case-field-origin";

type PresentationRead = {
  projectId: string;
  organizationId: string;
  caseId: null;
  readScope: { projectId: string; organizationId: string; actorId: string; actorClerkUserId: string };
  definitionSupported: boolean;
  fieldAuthoringSchemaHash: string | null;
  configurationSupported: boolean;
  configuration?: unknown;
  warnings: string[];
};
/** Style admission only. This function never reads, resets or publishes case
 * values. A project read cannot substitute for current case-edit permission. */
export function fieldStylesForSnapshot(read: PresentationRead | undefined, origin: CaseFieldOrigin | null, schemaHash: string) : { configuration: CaseFieldPresentation | undefined; warning: string | null } {
  if (!read || !origin || read.projectId !== origin.projectId || read.organizationId !== origin.organizationId || read.caseId !== null || read.readScope.projectId !== origin.projectId || read.readScope.organizationId !== origin.organizationId || !read.readScope.actorId || read.readScope.actorClerkUserId !== origin.clerkActorId)
    return { configuration: undefined, warning: "Field presentation could not be matched to this original project and signed-in actor. Compatible native controls are used; no case values were reset." };
  if (!read.definitionSupported || read.fieldAuthoringSchemaHash !== schemaHash || !read.configurationSupported)
    return { configuration: undefined, warning: "Field presentation is unsupported or belongs to different native definitions. Compatible native controls are used without repairing saved settings." };
  if (!Object.hasOwn(read, "configuration")) return { configuration: undefined, warning: read.warnings[0] ?? null };
  const checked = caseFieldPresentationSchema.safeParse(read.configuration);
  if (!checked.success) return { configuration: undefined, warning: "Saved field presentation is unsupported and remains unchanged. Compatible native controls are used." };
  // Keep the admitted raw snapshot rather than inject parsed/default settings.
  return { configuration: read.configuration as CaseFieldPresentation, warning: read.warnings[0] ?? null };
}
