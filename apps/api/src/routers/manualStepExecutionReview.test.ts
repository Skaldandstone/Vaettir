// Transport mocks only. Native scope locks, receipts and rollback are separate.
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
const services = vi.hoisted(() => ({ preview: vi.fn(), record: vi.fn() }));
vi.mock("../services/manualStepExecutionReview.js", () => ({ previewReviewedStep: services.preview, recordReviewedStep: services.record }));
import { manualStepExecutionReviewRouter } from "./manualStepExecutionReview.js";
const ref = { projectId: "p", testRunId: "r", testCaseId: "c", stepIndex: 0 };
const preview = () => ({ ...ref, readRequestId: randomUUID() });
const record = () => ({ ...ref, originalOrganizationId: "o", expectedClerkActorId: "client-pin", expectedNativeActorId: "n",
  expectedProcedureHash: "a".repeat(64), expectedCurrentFingerprint: "b".repeat(64), expectedRevisionId: null,
  status: "PASS" as const, note: " exact\n text ", observations: { specimen: "", hardwareRevision: "", firmwareVersion: "", environment: "", measurements: [] },
  evidenceAttachmentIds: [], correctionReason: null, idempotencyKey: randomUUID(), confirmed: true as const });
function fixture(subject: string | null | undefined, signedIn = true) {
  const prisma = {}, user = signedIn ? { id: "n", clerkUserId: "native-mapping-not-proof", memberships: [] } : null;
  const context = { prisma, user, staff: null, ...(subject === undefined ? {} : { authenticatedClerkSubject: subject }) } as unknown as Context;
  return { prisma, api: manualStepExecutionReviewRouter.createCaller(context) };
}
beforeEach(() => { for (const mock of Object.values(services)) { mock.mockReset(); mock.mockRejectedValue(new TRPCError({ code: "PRECONDITION_FAILED", message: "Synthetic native admission refusal" })); } });
describe("reviewed step original verified human transport", () => {
  it.each([undefined, null, ""])("provenance %s cannot infer authority from native mapping or client pins", async subject => {
    const h = fixture(subject);
    await expect(h.api.preview(preview())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.api.record(record())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(services.preview).not.toHaveBeenCalled(); expect(services.record).not.toHaveBeenCalled();
  });
  it("signed-out calls refuse before either service", async () => {
    const h = fixture("verified", false);
    await expect(h.api.preview(preview())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(h.api.record(record())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(services.preview).not.toHaveBeenCalled(); expect(services.record).not.toHaveBeenCalled();
  });
  it("passes actual independent subject and native ID, preserving raw reviewed request", async () => {
    const h = fixture("verified"), read = preview(), write = record();
    await expect(h.api.preview(read)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(h.api.record(write)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(services.preview).toHaveBeenCalledExactlyOnceWith(h.prisma, { id: "n", clerkUserId: "verified" }, read);
    expect(services.record).toHaveBeenCalledExactlyOnceWith(h.prisma, { id: "n", clerkUserId: "verified" }, write);
  });
});
