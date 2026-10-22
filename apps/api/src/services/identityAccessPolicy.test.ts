import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@vaettir/db";
import { publishIdentityDraft, readPublishedLocalAccess, requirePublishedLocalAction } from "./identityAccessPolicy.js";

const config = () => ({ schemaVersion: 1, roles: [{ id: "author", name: "Author", permissions: ["cases.read", "cases.write"] }],
  groups: [{ id: "team", name: "Team", userIds: ["user"], roleIds: ["author"], scope: { kind: "projects", projectIds: ["project"] } }] });
function fixture() {
  const actor = { userId: "user", clerkSubject: "clerk-user", workspaceOrganizationId: "org" };
  const db = {
    user: { findUnique: vi.fn().mockResolvedValue({ clerkUserId: "clerk-user", apiKeyIdentity: null }) },
    membership: { findUnique: vi.fn().mockResolvedValue({ role: "ADMIN", seatType: "FULL" }), findMany: vi.fn().mockResolvedValue([{ userId: "user" }]) },
    organization: { findUnique: vi.fn().mockResolvedValue({ suspendedAt: null }) },
    project: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org" }), findMany: vi.fn().mockResolvedValue([{ id: "project" }, { id: "other" }]) },
    identityAccessDraft: { findUnique: vi.fn().mockResolvedValue({ revision: 2, configuration: config() }) },
    identityAccessPolicy: { findUnique: vi.fn().mockResolvedValue({ revision: 3, configuration: config() }), create: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: vi.fn() }, $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(work => work(db));
  const tx = db as unknown as Prisma.TransactionClient;
  const prisma = db as unknown as PrismaClient;
  return { actor, db, tx, prisma, publish: () => publishIdentityDraft(prisma, actor, { organizationId: "org", expectedDraftRevision: 2, expectedPolicyRevision: 3 }) };
}
describe("published local access (transaction doubles; not provider acceptance)", () => {
  it("reads published rules, not unsaved or saved drafts, with exact source attribution", async () => {
    const f = fixture(); f.db.identityAccessDraft.findUnique.mockResolvedValue({ revision: 9, configuration: { schemaVersion: 1, roles: [], groups: [] } });
    expect(await readPublishedLocalAccess(f.tx, f.actor, "org", "project")).toEqual({ revision: 3, permissions: ["cases.read", "cases.write"],
      sources: [{ permission: "cases.read", groupId: "team", roleId: "author" }, { permission: "cases.write", groupId: "team", roleId: "author" }] });
    expect(f.db.identityAccessDraft.findUnique).not.toHaveBeenCalled();
  });
  it("does not promote a custom author to integrations or another project", async () => {
    const f = fixture(); await expect(requirePublishedLocalAction(f.tx, f.actor, "org", "project", "integrations.manage")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requirePublishedLocalAction(f.tx, f.actor, "org", "other", "cases.write")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("reads removal and role reduction on the next evaluation", async () => {
    const f = fixture(); await requirePublishedLocalAction(f.tx, f.actor, "org", "project", "cases.write");
    const reduced = config(); reduced.roles[0]!.permissions = ["cases.read"];
    f.db.identityAccessPolicy.findUnique.mockResolvedValue({ revision: 4, configuration: reduced });
    await expect(requirePublishedLocalAction(f.tx, f.actor, "org", "project", "cases.write")).rejects.toMatchObject({ code: "FORBIDDEN" });
    reduced.groups = [];
    expect((await readPublishedLocalAccess(f.tx, f.actor, "org", "project")).permissions).toEqual([]);
  });
  it("preserves independent group sources when one group is removed", async () => {
    const f = fixture(); const independent = config(); independent.groups.push({ ...independent.groups[0]!, id: "second", name: "Second" });
    independent.groups.shift(); f.db.identityAccessPolicy.findUnique.mockResolvedValue({ revision: 4, configuration: independent });
    expect((await readPublishedLocalAccess(f.tx, f.actor, "org", "project")).sources.every(source => source.groupId === "second")).toBe(true);
  });
  it("does not let custom writes override a read-only seat", async () => {
    const f = fixture(); f.db.membership.findUnique.mockResolvedValue({ role: "VIEWER", seatType: "READ_ONLY" });
    expect((await readPublishedLocalAccess(f.tx, f.actor, "org", "project")).permissions).toEqual(["cases.read"]);
  });
  it.each([null, undefined, "rebound"])("rejects missing/rebound transport subject %s", async clerkSubject => {
    const f = fixture(); await expect(readPublishedLocalAccess(f.tx, { ...f.actor, clerkSubject }, "org", "project")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects service identities even with a supplied subject", async () => {
    const f = fixture(); f.db.user.findUnique.mockResolvedValue({ clerkUserId: "clerk-user", apiKeyIdentity: { id: "api" } });
    await expect(readPublishedLocalAccess(f.tx, f.actor, "org", "project")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects cross-tenant host, project and missing membership", async () => {
    const f = fixture(); await expect(readPublishedLocalAccess(f.tx, { ...f.actor, workspaceOrganizationId: "other" }, "org", "project")).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.db.project.findUnique.mockResolvedValue({ organizationId: "other" });
    await expect(readPublishedLocalAccess(f.tx, f.actor, "org", "project")).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.db.membership.findUnique.mockResolvedValue(null);
    await expect(f.publish()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects suspended workspaces and invalid policy rather than falling back", async () => {
    const f = fixture(); f.db.organization.findUnique.mockResolvedValue({ suspendedAt: new Date() });
    await expect(readPublishedLocalAccess(f.tx, f.actor, "org", "project")).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.db.organization.findUnique.mockResolvedValue({ suspendedAt: null });
    f.db.identityAccessPolicy.findUnique.mockResolvedValue({ revision: 3, configuration: {} });
    await expect(readPublishedLocalAccess(f.tx, f.actor, "org", "project")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("publishes the saved draft and audit in one serializable revision-CAS transaction", async () => {
    const f = fixture(); expect(await f.publish()).toMatchObject({ revision: 4, sourceDraftRevision: 2 });
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(f.db.identityAccessPolicy.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org", revision: 3 }, data: expect.objectContaining({ configuration: config(), revision: 4 }) }));
    expect(f.db.auditLog.create).toHaveBeenCalled();
  });
  it("refuses stale draft, stale policy and unaudited publication", async () => {
    const f = fixture(); f.db.identityAccessDraft.findUnique.mockResolvedValue({ revision: 3, configuration: config() });
    await expect(f.publish()).rejects.toMatchObject({ code: "CONFLICT" });
    f.db.identityAccessDraft.findUnique.mockResolvedValue({ revision: 2, configuration: config() });
    f.db.identityAccessPolicy.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.publish()).rejects.toMatchObject({ code: "CONFLICT" });
    f.db.identityAccessPolicy.updateMany.mockResolvedValue({ count: 1 }); f.db.auditLog.create.mockRejectedValue(new Error("audit unavailable"));
    await expect(f.publish()).rejects.toThrow("audit unavailable");
  });
  it("only a fresh full-seat native admin may publish", async () => {
    const f = fixture(); for (const role of ["VIEWER", "EDITOR", "COMPLIANCE_AUDITOR"]) {
      f.db.membership.findUnique.mockResolvedValue({ role, seatType: "FULL" }); await expect(f.publish()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    f.db.membership.findUnique.mockResolvedValue({ role: "ADMIN", seatType: "READ_ONLY" }); await expect(f.publish()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects stale references at publication and prunes them during subsequent reads", async () => {
    const f = fixture(); f.db.membership.findMany.mockResolvedValue([]);
    await expect(f.publish()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await readPublishedLocalAccess(f.tx, f.actor, "org", "project")).permissions).toEqual([]);
  });
});
