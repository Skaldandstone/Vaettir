// Protected transport/registration source checks only; no native SQL or files.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
const services = vi.hoisted(() => ({ history: vi.fn(), evidence: vi.fn() }));
vi.mock("../services/manualStepExecutionResources.js", () => ({
  readStepResourceHistory: services.history, readStepResourceEvidence: services.evidence,
}));
import { manualStepExecutionResourcesRouter } from "./manualStepExecutionResources.js";

const request = () => ({ projectId: "synthetic-project", testRunId: "synthetic-run", testCaseId: "synthetic-case", stepIndex: 0,
  originalOrganizationId: "synthetic-org", expectedNativeActorId: "client-native-pin", expectedClerkActorId: "client-clerk-pin",
  readRequestId: randomUUID(), cursor: null, limit: 10 });
function caller(signedIn = true, subject: string | null | undefined = "verified-transport-clerk") {
  const prisma = {};
  const user = signedIn ? { id: "authenticated-native", clerkUserId: "authenticated-clerk", memberships: [] } : null;
  return { prisma, user, api: manualStepExecutionResourcesRouter.createCaller({ prisma, user, authenticatedClerkSubject: subject, staff: null } as unknown as Context) };
}
beforeEach(() => {
  for (const service of Object.values(services)) {
    service.mockReset();
    service.mockRejectedValue(new TRPCError({ code: "PRECONDITION_FAILED", message: "Synthetic resource admission refused" }));
  }
});
describe("mounted step resource protected transport, not native acceptance", () => {
  it("is registered as a distinct read-only namespace", () => {
    const source = readFileSync(new URL("../router.ts", import.meta.url), "utf8");
    expect(source).toContain('import { manualStepExecutionResourcesRouter } from "./routers/manualStepExecutionResources.js"');
    expect(source).toContain("manualStepExecutionResources: manualStepExecutionResourcesRouter");
    expect(Object.keys(manualStepExecutionResourcesRouter._def.procedures).sort()).toEqual(["evidence", "history"]);
    for (const procedure of Object.values(manualStepExecutionResourcesRouter._def.procedures)) expect(procedure._def.type).toBe("query");
  });
  it("signed-out callers cannot dispatch either private resource read", async () => {
    const current = caller(false);
    await expect(current.api.history(request())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(current.api.evidence({ ...request(), search: "" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(services.history).not.toHaveBeenCalled(); expect(services.evidence).not.toHaveBeenCalled();
  });
  it("rejects missing native pins, implicit limits and file-open extras before service dispatch", async () => {
    const current = caller();
    await expect(current.api.history({ ...request(), expectedNativeActorId: undefined } as unknown as ReturnType<typeof request>)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(current.api.history({ ...request(), limit: undefined } as unknown as ReturnType<typeof request>)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(current.api.evidence({ ...request(), search: "", url: "https://example.invalid" } as ReturnType<typeof request> & { search: string })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(services.history).not.toHaveBeenCalled(); expect(services.evidence).not.toHaveBeenCalled();
  });
  it("dispatches independently authenticated native/Clerk identity, never promotes client pins into authority", async () => {
    const current = caller(), history = request(), evidence = { ...request(), search: " literal file label " };
    await expect(current.api.history(history)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(current.api.evidence(evidence)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const actor = { id: current.user!.id, clerkUserId: "verified-transport-clerk" };
    expect(services.history).toHaveBeenCalledExactlyOnceWith(current.prisma, actor, history);
    expect(services.evidence).toHaveBeenCalledExactlyOnceWith(current.prisma, actor, evidence);
    expect(current.user?.clerkUserId).not.toBe(history.expectedClerkActorId);
  });
  it.each([null, ""])("missing independent session proof %s cannot promote native Clerk metadata", async subject => {
    const current = caller(true, subject);
    await expect(current.api.history(request())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(current.api.evidence({ ...request(), search: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(services.history).not.toHaveBeenCalled(); expect(services.evidence).not.toHaveBeenCalled();
  });
  it("omitted internal provenance also fails closed, with no API-key/native mapping fallback", async () => {
    const current = caller();
    const api = manualStepExecutionResourcesRouter.createCaller({ prisma: current.prisma, user: current.user, staff: null } as unknown as Context);
    await expect(api.history(request())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.evidence({ ...request(), search: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(services.history).not.toHaveBeenCalled(); expect(services.evidence).not.toHaveBeenCalled();
  });
});
