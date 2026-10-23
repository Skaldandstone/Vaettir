// Protected transport/registration checks only, not native SQL acceptance.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
const services = vi.hoisted(() => ({ access: vi.fn(), page: vi.fn() }));
vi.mock("../services/runHistoryRead.js", () => ({ readRunHistoryAccess: services.access, readRunHistoryPage: services.page }));
import { runHistoryRouter } from "./runHistory.js";
const access = () => ({ projectId: "synthetic-project", originalOrganizationId: "synthetic-org", expectedClerkActorId: "client-pin", requestId: randomUUID() });
const page = () => ({ ...access(), expectedNativeActorId: "client-native-pin", limit: 20, asOf: "2026-09-02T00:00:00.000Z" });
function caller(signedIn = true) {
  const prisma = {};
  const user = signedIn ? { id: "authenticated-native", clerkUserId: "authenticated-clerk", memberships: [] } : null;
  return { prisma, user, api: runHistoryRouter.createCaller({ prisma, user, staff: null } as unknown as Context) };
}
beforeEach(() => { for (const service of Object.values(services)) { service.mockReset(); service.mockRejectedValue(new TRPCError({ code: "PRECONDITION_FAILED", message: "Synthetic admission refused" })); } });
describe("mounted fresh run history transport; no frozen snapshot or native proof", () => {
  it("has a distinct protected read-only namespace without changing the legacy list route", () => {
    const source = readFileSync(new URL("../router.ts", import.meta.url), "utf8");
    expect(source).toContain('import { runHistoryRouter } from "./routers/runHistory.js"');
    expect(source).toContain("runHistory: runHistoryRouter");
    expect(source).toContain("testRuns: testRunsRouter");
    expect(Object.keys(runHistoryRouter._def.procedures).sort()).toEqual(["access", "page"]);
    for (const procedure of Object.values(runHistoryRouter._def.procedures)) expect(procedure._def.type).toBe("query");
  });
  it("blocks signed-out access/page before any reader service", async () => {
    const current = caller(false);
    await expect(current.api.access(access())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(current.api.page(page())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(services.access).not.toHaveBeenCalled(); expect(services.page).not.toHaveBeenCalled();
  });
  it("refuses implicit page limits/native pins and arbitrary extra filters before service dispatch", async () => {
    const current = caller();
    await expect(current.api.page({ ...page(), limit: undefined } as unknown as ReturnType<typeof page>)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(current.api.page({ ...page(), expectedNativeActorId: undefined } as unknown as ReturnType<typeof page>)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(current.api.access({ ...access(), organizationId: "replacement" } as ReturnType<typeof access>)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(services.access).not.toHaveBeenCalled(); expect(services.page).not.toHaveBeenCalled();
  });
  it("passes independently authenticated native/Clerk identity, not the client authority pins", async () => {
    const current = caller(), bootstrap = access(), request = page(), author = { clerkActorId: "authenticated-clerk" };
    await expect(current.api.access(bootstrap)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(current.api.page(request)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(services.access).toHaveBeenCalledExactlyOnceWith(current.prisma, "authenticated-native", bootstrap, author);
    expect(services.page).toHaveBeenCalledExactlyOnceWith(current.prisma, "authenticated-native", request, author);
  });
});
