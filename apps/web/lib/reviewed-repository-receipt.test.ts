import { expect, it } from "vitest";
import { parseReviewedAttachment, reviewedAttachmentKey } from "./reviewed-repository-receipt";
const receipt = { projectId: "project", organizationId: "org", nativeActorId: "native", clerkSubject: "subject", sessionId: "session",
  input: { id: "connection", repositoryIds: ["repo"], catalogVersion: "a".repeat(64), approved: true } };
it("retains exact approval and scopes storage by project, subject and session", () => {
  expect(parseReviewedAttachment(JSON.stringify(receipt))).toEqual(receipt);
  expect(parseReviewedAttachment(null)).toBe(null);
  const key = reviewedAttachmentKey("project", "subject", "session");
  for (const values of [["other", "subject", "session"], ["project", "other", "session"], ["project", "subject", "other"]])
    expect(reviewedAttachmentKey(values[0]!, values[1]!, values[2]!)).not.toBe(key);
});
it("rejects corrupted, broadened, oversized and credential-bearing storage", () => {
  for (const value of [{ ...receipt, credential: "not-allowed" }, { ...receipt, projectId: "" }, { ...receipt, input: { ...receipt.input, approved: false } },
    { ...receipt, input: { ...receipt.input, repositoryIds: ["repo", "repo"] } }, { ...receipt, input: { ...receipt.input, catalogVersion: "new" } },
    { ...receipt, input: { ...receipt.input, repositoryIds: Array.from({ length: 101 }, (_, n) => String(n)) } }])
    expect(() => parseReviewedAttachment(JSON.stringify(value))).toThrow();
  expect(() => parseReviewedAttachment("invalid-json")).toThrow();
});
