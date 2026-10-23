import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { casePresentationPreset } from "@vaettir/core";
const locks = vi.hoisted(() => ({ project: vi.fn(), actor: vi.fn(), read: vi.fn() }));
vi.mock("./caseFields.js", () => ({ lockCaseFieldProject: locks.project }));
vi.mock("./caseFieldReadScope.js", async original => ({ ...await original<typeof import("./caseFieldReadScope.js")>(), lockCurrentCaseFieldActor: locks.actor, lockCaseFieldReadScope: locks.read }));
import { casePresentationConfigureInput, casePresentationGetInput, casePresentationRequestHash, mergeCasePresentation, getCasePresentation, configureCasePresentation } from "./casePresentation.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
const originalProfile = { objective: "Synthetic scope", unknownSibling: { version: 7, retained: ["original", false] }, experience: { version: 1, offerings: ["SOFTWARE"] } };
const input = () => ({ projectId: "synthetic-project", originalOrganizationId: "synthetic-org", expectedClerkActorId: "synthetic-clerk", expectedProfileHash: qualityProfileHash(originalProfile), configuration: casePresentationPreset("SOFTWARE"), requestId: randomUUID(), reason: "Synthetic presentation review", confirmed: true as const });
function fakeDb({ role = "ADMIN", seatType = "FULL", receipt = null as unknown, written = 1 } = {}) {
  const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn().mockResolvedValue([{ bytes: 1000 }]), project: { findUniqueOrThrow: vi.fn().mockResolvedValue({ organizationId: "synthetic-org", qualityProfile: originalProfile }), updateMany: vi.fn().mockResolvedValue({ count: written }) }, membership: { findUniqueOrThrow: vi.fn().mockResolvedValue({ role, seatType }) }, auditLog: { findFirst: vi.fn().mockResolvedValue(receipt), create: vi.fn() } };
  return { tx, db: { $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) } };
}
describe("built-in preference source authorization and CAS contracts (mocked, not database proof)", () => {
  beforeEach(() => { locks.project.mockReset(); locks.actor.mockReset().mockResolvedValue("synthetic-clerk"); locks.read.mockReset(); });
  it("strict inputs retain scope pins and prevent unsupported choices or unconfirmed writes", () => {
    const request = input();
    expect(casePresentationConfigureInput.parse(request)).toEqual(request);
    expect(casePresentationConfigureInput.safeParse({ ...request, confirmed: false }).success).toBe(false);
    expect(casePresentationConfigureInput.safeParse({ ...request, expectedClerkActorId: undefined }).success).toBe(false);
    expect(casePresentationGetInput.safeParse({ projectId: request.projectId, originalOrganizationId: request.originalOrganizationId }).success).toBe(false);
    expect(casePresentationConfigureInput.safeParse({ ...request, configuration: { ...request.configuration, domains: ["FOOD_SAFETY"] } }).success).toBe(false);
  });
  it("merges only the preference sibling and leaves strict experience and unknown values intact", () => {
    const merged = mergeCasePresentation(originalProfile, input().configuration);
    expect(merged.unknownSibling).toBe(originalProfile.unknownSibling);
    expect(merged.experience).toBe(originalProfile.experience);
    expect(merged.objective).toBe(originalProfile.objective);
    expect(Object.hasOwn(originalProfile, "casePresentation")).toBe(false);
  });
  it("READ_ONLY members read only after current scope lock and receive no raw project profile", async () => {
    const request = input(), f = fakeDb({ role: "VIEWER", seatType: "READ_ONLY" });
    const scope = { projectId: request.projectId, organizationId: request.originalOrganizationId, actorId: "synthetic-user", actorClerkUserId: request.expectedClerkActorId };
    locks.read.mockResolvedValueOnce(scope);
    const result = await getCasePresentation(f.db as never, "synthetic-user", { projectId: request.projectId, originalOrganizationId: request.originalOrganizationId, expectedClerkActorId: request.expectedClerkActorId }, { clerkActorId: "synthetic-clerk" });
    expect(result.canConfigure).toBe(false); expect(result.readScope).toEqual(scope); expect(result).not.toHaveProperty("raw");
    expect(locks.read).toHaveBeenCalledBefore(f.tx.project.findUniqueOrThrow);
    const denied = fakeDb(); locks.read.mockRejectedValueOnce(new Error("Current read access revoked"));
    await expect(getCasePresentation(denied.db as never, "synthetic-user", { projectId: request.projectId }, { clerkActorId: "synthetic-clerk" })).rejects.toThrow("revoked");
    expect(denied.tx.project.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("current full Admin write checks complete raw JSON CAS and records one scoped receipt", async () => {
    const f = fakeDb(), request = input();
    const result = await configureCasePresentation(f.db as never, "synthetic-user", request, { clerkActorId: "synthetic-clerk" });
    expect(locks.project).toHaveBeenCalledBefore(locks.actor);
    expect(result).toMatchObject({ requestId: request.requestId, replayed: false, organizationId: request.originalOrganizationId, actorClerkUserId: request.expectedClerkActorId });
    expect(f.tx.project.updateMany.mock.calls[0]?.[0]).toMatchObject({ where: { organizationId: request.originalOrganizationId, qualityProfile: { equals: originalProfile } }, data: { qualityProfile: { ...originalProfile, casePresentation: request.configuration } } });
    expect(f.tx.auditLog.create).toHaveBeenCalledOnce();
  });
  it("revoked identity, READ_ONLY Admin and full Editor cannot save or replay", async () => {
    for (const roleSeat of [{ role: "ADMIN", seatType: "READ_ONLY" }, { role: "EDITOR", seatType: "FULL" }]) {
      const f = fakeDb(roleSeat); await expect(configureCasePresentation(f.db as never, "synthetic-user", input(), { clerkActorId: "synthetic-clerk" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.tx.project.updateMany).not.toHaveBeenCalled(); expect(f.tx.auditLog.findFirst).not.toHaveBeenCalled();
    }
    const f = fakeDb(); locks.actor.mockRejectedValueOnce(new Error("Synthetic current identity revoked"));
    await expect(configureCasePresentation(f.db as never, "synthetic-user", input(), { clerkActorId: "synthetic-clerk" })).rejects.toThrow("revoked");
    expect(f.tx.project.updateMany).not.toHaveBeenCalled();
  });
  it("unknown-ACK exact replay never updates again; changed content or original scope is refused", async () => {
    const request = input();
    const f = fakeDb({ receipt: { organizationId: request.originalOrganizationId, metadata: { requestHash: casePresentationRequestHash(request) } } });
    expect((await configureCasePresentation(f.db as never, "synthetic-user", request, { clerkActorId: "synthetic-clerk" })).replayed).toBe(true);
    expect(f.tx.project.updateMany).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    await expect(configureCasePresentation(f.db as never, "synthetic-user", { ...request, reason: "Different text" }, { clerkActorId: "synthetic-clerk" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(configureCasePresentation(f.db as never, "synthetic-user", { ...request, originalOrganizationId: "reparented-org" }, { clerkActorId: "synthetic-clerk" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("exact ACK replay checks current scope/role but does not decode a later unsupported or oversized profile", async () => {
    const request = input();
    const f = fakeDb({ receipt: { organizationId: request.originalOrganizationId, metadata: { requestHash: casePresentationRequestHash(request) } } });
    f.tx.project.findUniqueOrThrow.mockImplementation(async (args: { select: { qualityProfile?: boolean } }) => {
      if (args.select.qualityProfile) throw Error("Later profile must not be decoded for exact receipt recovery");
      return { organizationId: "synthetic-org", qualityProfile: { unsupportedVersion: 99 } } as never;
    });
    expect((await configureCasePresentation(f.db as never, "synthetic-user", request, { clerkActorId: "synthetic-clerk" })).replayed).toBe(true);
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.tx.membership.findUniqueOrThrow).toHaveBeenCalledBefore(f.tx.auditLog.findFirst);
  });
  it("native jsonb-text size of the merged profile is checked before any write", async () => {
    const f = fakeDb();
    f.tx.$queryRaw.mockResolvedValueOnce([{ bytes: 262000 }]).mockResolvedValueOnce([{ bytes: 263000 }]);
    await expect(configureCasePresentation(f.db as never, "synthetic-user", input(), { clerkActorId: "synthetic-clerk" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.tx.project.updateMany).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    expect(f.tx.$queryRaw.mock.calls[1]?.[0].join("")).toContain("::jsonb::text");
  });
  it("stale complete profile or failed row CAS cannot produce a preference receipt", async () => {
    const f = fakeDb();
    await expect(configureCasePresentation(f.db as never, "synthetic-user", { ...input(), expectedProfileHash: "a".repeat(64) }, { clerkActorId: "synthetic-clerk" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.tx.project.updateMany).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
    const raced = fakeDb({ written: 0 });
    await expect(configureCasePresentation(raced.db as never, "synthetic-user", input(), { clerkActorId: "synthetic-clerk" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(raced.tx.auditLog.create).not.toHaveBeenCalled();
  });
});
