// Protected transport/source checks. Recovery service/native locks are tested
// separately; these mocks do not execute PostgreSQL or establish deployment.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
vi.mock("../services/manualStepExecution.js", async importOriginal => ({
  ...await importOriginal<typeof import("../services/manualStepExecution.js")>(), recordManualStepResult: vi.fn(),
}));
vi.mock("../services/flakyDetection.js", async importOriginal => ({
  ...await importOriginal<typeof import("../services/flakyDetection.js")>(), recomputeFlaky: vi.fn(),
}));
vi.mock("../services/healingSuggestion.js", async importOriginal => ({
  ...await importOriginal<typeof import("../services/healingSuggestion.js")>(), resolveHealingSuggestionsOnPass: vi.fn(),
}));
import { manualExecutionRouter } from "./manualExecution.js";
import { recordManualStepResult } from "../services/manualStepExecution.js";
import { recomputeFlaky } from "../services/flakyDetection.js";
import { resolveHealingSuggestionsOnPass } from "../services/healingSuggestion.js";
function fixture(signedIn = true, subject: string | null | undefined = "transport-clerk") {
  const user = signedIn ? { id: "transport-native", clerkUserId: "transport-clerk", name: "Synthetic actor", memberships: [{ organizationId: "org", role: "OWNER", seatType: "FULL" }] } : null;
  const db = {};
  return { user, db, caller: manualExecutionRouter.createCaller({ prisma: db, user, authenticatedClerkSubject: subject, staff: null } as unknown as Context), input: { testRunId: "run", testCaseId: "case", stepIndex: 0, status: "PASS" as const, expectedRevisionId: null, idempotencyKey: randomUUID(), note: " exact\n legacy text " } };
}
describe("legacy step protected compatibility transport, not a new write endpoint", () => {
  it("returns the original small ACK through the old parser with independently authenticated actor, never healing or recomputing", async () => {
    vi.clearAllMocks(); const h = fixture();
    vi.mocked(recordManualStepResult).mockResolvedValue({ revisionId: "accepted-original", caseStatus: "PASS", recovered: true });
    expect(await h.caller.recordStepResult(h.input)).toEqual({ revisionId: "accepted-original", caseStatus: "PASS" });
    expect(recordManualStepResult).toHaveBeenCalledWith(h.db, { id: h.user!.id, name: h.user!.name, clerkUserId: "transport-clerk" }, expect.objectContaining({ note: "exact\n legacy text", evidenceAttachmentIds: [], idempotencyKey: h.input.idempotencyKey }));
    expect(recomputeFlaky).not.toHaveBeenCalled(); expect(resolveHealingSuggestionsOnPass).not.toHaveBeenCalled();
  });
  it("signed-out and invalid/extra client actor fields fail before the adapter", async () => {
    vi.clearAllMocks(); const h = fixture(false);
    await expect(h.caller.recordStepResult(h.input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const current = fixture();
    await expect(current.caller.recordStepResult({ ...current.input, status: "INVENTED" as "PASS" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(current.caller.recordStepResult({ ...current.input, expectedClerkActorId: "client-actor" } as typeof current.input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(recordManualStepResult).not.toHaveBeenCalled();
  });
  it.each(["FORBIDDEN", "CONFLICT", "PRECONDITION_FAILED"])("adapter %s refusal is propagated without post-record side effects", async code => {
    vi.clearAllMocks(); const h = fixture();
    const { TRPCError } = await import("@trpc/server");
    vi.mocked(recordManualStepResult).mockRejectedValue(new TRPCError({ code: code as "FORBIDDEN", message: "Retain the exact original request" }));
    await expect(h.caller.recordStepResult(h.input)).rejects.toMatchObject({ code });
    expect(recomputeFlaky).not.toHaveBeenCalled(); expect(resolveHealingSuggestionsOnPass).not.toHaveBeenCalled();
  });
  it("API-key or provenance-less contexts cannot infer human session proof from a populated native Clerk mapping", async () => {
    vi.clearAllMocks();
    const api = fixture(true, null);
    await expect(api.caller.recordStepResult(api.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const h = fixture();
    const caller = manualExecutionRouter.createCaller({ prisma: h.db, user: h.user, staff: null } as unknown as Context);
    await expect(caller.recordStepResult(h.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(recordManualStepResult).not.toHaveBeenCalled();
  });
  it("binds the verified transport subject rather than silently substituting the native mapping", async () => {
    vi.clearAllMocks(); const h = fixture(true, "verified-original-subject");
    vi.mocked(recordManualStepResult).mockResolvedValue({ revisionId: "accepted-original", caseStatus: "PASS", recovered: true });
    await h.caller.recordStepResult(h.input);
    expect(recordManualStepResult).toHaveBeenCalledWith(h.db, { id: h.user!.id, name: h.user!.name, clerkUserId: "verified-original-subject" }, expect.anything());
  });
  it("actual source binds the legacy route directly to recovery, with no alternate new write/healing branch", () => {
    const source = readFileSync(new URL("./manualExecution.ts", import.meta.url), "utf8");
    const endpoint = source.slice(source.indexOf("recordStepResult: protectedProcedure"), source.indexOf("stepResultHistory: protectedProcedure"));
    expect(endpoint).toContain("if (!ctx.authenticatedClerkSubject)");
    expect(endpoint).toContain("clerkUserId: ctx.authenticatedClerkSubject");
    expect(endpoint).not.toContain("ctx.user.clerkUserId");
    expect(endpoint).not.toMatch(/recomputeFlaky|resolveHealing|\.create\(|\.update\(|result\.recovered/);
  });
});
