export type ReviewedAttachmentReceipt = {
  phase: "submitted" | "unknown" | "confirmed";
  projectId: string; organizationId: string; nativeActorId: string; clerkSubject: string; sessionId: string;
  input: { id: string; repositoryIds: string[]; catalogVersion: string; approved: true };
};
export function reviewedAttachmentKey(projectId: string, subject: string, sessionId: string) {
  return `vaettir-reviewed-attachment/v1:${JSON.stringify([projectId, subject, sessionId])}`;
}
export function parseReviewedAttachment(value: string | null): ReviewedAttachmentReceipt | null {
  if (!value) return null;
  if (value.length > 20000) throw Error("Stored attachment needs review");
  const parsed = JSON.parse(value);
  const text = (v: unknown, max = 200) => typeof v === "string" && v.length > 0 && v.length <= max;
  if (!parsed || Object.keys(parsed).sort().join() !== "clerkSubject,input,nativeActorId,organizationId,phase,projectId,sessionId" || !["submitted", "unknown", "confirmed"].includes(parsed.phase) ||
    ![parsed.projectId, parsed.organizationId, parsed.nativeActorId, parsed.clerkSubject, parsed.sessionId].every(v => text(v)) ||
    !parsed.input || Object.keys(parsed.input).sort().join() !== "approved,catalogVersion,id,repositoryIds" || !text(parsed.input.id) ||
    typeof parsed.input.catalogVersion !== "string" || !/^[a-f0-9]{64}$/.test(parsed.input.catalogVersion) || parsed.input.approved !== true ||
    !Array.isArray(parsed.input.repositoryIds) || !parsed.input.repositoryIds.length || parsed.input.repositoryIds.length > 100 ||
    !parsed.input.repositoryIds.every((v: unknown) => text(v, 100)) || new Set(parsed.input.repositoryIds).size !== parsed.input.repositoryIds.length)
    throw Error("Stored attachment needs review");
  return parsed;
}
