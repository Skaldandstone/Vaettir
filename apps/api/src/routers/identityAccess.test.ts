import { describe, expect, it, vi } from "vitest";
import { identityAccessRouter } from "./identityAccess.js";
import type { Context } from "../trpc.js";
import { identityConfigurationSchema, validateIdentityReferences } from "@vaettir/core";

const configuration = () => ({ schemaVersion: 1 as const,
  roles: [{ id: "reader", name: "Case reviewer", permissions: ["cases.read" as const] }],
  groups: [{ id: "team", name: "Reviewers", userIds: ["user"], roleIds: ["reader"], scope: { kind: "projects" as const, projectIds: ["project"] } }],
});
function fixture() {
  const member = { organizationId: "org", userId: "user", role: "ADMIN", seatType: "FULL" };
  const db = {
    user: { findUnique: vi.fn().mockResolvedValue({ clerkUserId: "verified-subject" }) },
    membership: { findUnique: vi.fn().mockResolvedValue(member), findMany: vi.fn().mockResolvedValue([{ userId: "user", user: { id: "user", name: "Synthetic", email: "synthetic@example.invalid" } }]) },
    organization: { findUnique: vi.fn().mockResolvedValue({ suspendedAt: null }) },
    project: { findMany: vi.fn().mockResolvedValue([{ id: "project", name: "Synthetic project" }]) },
    identityAccessDraft: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async callback => callback(db));
  const ctx = { prisma: db, user: { id: "user", memberships: [member] }, authenticatedClerkSubject: "verified-subject", workspaceOrganizationId: "org" } as unknown as Context;
  return { db, ctx, caller: identityAccessRouter.createCaller(ctx) };
}
const save = (revision = 0) => ({ organizationId: "org", expectedRevision: revision, configuration: configuration() });

describe("identity access draft router (synthetic transaction double)", () => {
  it("reads an explicit inactive preparation state without writing", async () => {
    const { caller, db } = fixture();
    expect(await caller.configuration({ organizationId: "org" })).toMatchObject({ revision: 0, activation: "PREPARATION_ONLY", configuration: { roles: [], groups: [] } });
    expect(db.identityAccessDraft.create).not.toHaveBeenCalled();
  });
  it("creates an audited draft inside a serializable transaction", async () => {
    const { caller, db } = fixture();
    expect(await caller.saveDraft(save())).toEqual({ revision: 1 });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: "org", actorId: "user", entityType: "IdentityAccessDraft", metadata: expect.objectContaining({ activation: "PREPARATION_ONLY" }) }) }));
  });
  it("uses revision compare-and-swap", async () => {
    const { caller, db } = fixture();
    await caller.saveDraft(save(4));
    expect(db.identityAccessDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org", revision: 4 } }));
    db.identityAccessDraft.updateMany.mockResolvedValue({ count: 0 });
    await expect(caller.saveDraft(save(4))).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("does not acknowledge an unaudited save", async () => {
    const { caller, db } = fixture(); db.auditLog.create.mockRejectedValue(new Error("audit unavailable"));
    await expect(caller.saveDraft(save())).rejects.toThrow("audit unavailable");
  });
  it.each([null, undefined])("rejects a missing verified human session (%s)", async subject => {
    const { ctx, db } = fixture(); ctx.authenticatedClerkSubject = subject;
    await expect(identityAccessRouter.createCaller(ctx).saveDraft(save())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.identityAccessDraft.create).not.toHaveBeenCalled();
  });
  it("rejects an email-rebound subject", async () => {
    const { caller, db } = fixture(); db.user.findUnique.mockResolvedValue({ clerkUserId: "replacement-subject" });
    await expect(caller.saveDraft(save())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["VIEWER", "EDITOR", "COMPLIANCE_AUDITOR"])("rechecks revoked administrator access: %s", async role => {
    const { caller, db } = fixture(); db.membership.findUnique.mockResolvedValue({ organizationId: "org", userId: "user", role, seatType: "FULL" });
    await expect(caller.saveDraft(save())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects read-only seats", async () => {
    const { caller, db } = fixture(); db.membership.findUnique.mockResolvedValue({ role: "ADMIN", seatType: "READ_ONLY" });
    await expect(caller.saveDraft(save())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects a suspended workspace", async () => {
    const { caller, db } = fixture(); db.organization.findUnique.mockResolvedValue({ suspendedAt: new Date() });
    await expect(caller.configuration({ organizationId: "org" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not accept another workspace at this host", async () => {
    const { caller, db } = fixture();
    await expect(caller.saveDraft({ ...save(), organizationId: "other" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.identityAccessDraft.create).not.toHaveBeenCalled();
  });
  it("rejects members and projects outside the current tenant", async () => {
    const { caller, db } = fixture(); db.membership.findMany.mockResolvedValue([]);
    await expect(caller.saveDraft(save())).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.identityAccessDraft.create).not.toHaveBeenCalled();
  });
});

describe("identity configuration validation", () => {
  it("accepts a fully referenced draft", () => {
    const config = identityConfigurationSchema.parse(configuration());
    expect(() => validateIdentityReferences(config, { userIds: ["user"], projectIds: ["project"] })).not.toThrow();
  });
  it("rejects an unrecognized activation field", () => expect(identityConfigurationSchema.safeParse({ ...configuration(), enabled: true }).success).toBe(false));
  it("rejects privilege escalation permissions", () => {
    const config = configuration(); config.roles[0]!.permissions = ["identity.admin" as never];
    expect(identityConfigurationSchema.safeParse(config).success).toBe(false);
  });
  it("rejects role removal while referenced by a group", () => expect(identityConfigurationSchema.safeParse({ ...configuration(), roles: [] }).success).toBe(false));
  it("rejects duplicate names ignoring case", () => {
    const config = configuration(); config.roles.push({ ...config.roles[0]!, id: "second", name: "CASE REVIEWER" });
    expect(identityConfigurationSchema.safeParse(config).success).toBe(false);
  });
  it("rejects empty project scope", () => {
    const config = configuration(); config.groups[0]!.scope.projectIds = [];
    expect(identityConfigurationSchema.safeParse(config).success).toBe(false);
  });
  it("rejects cross-tenant project references", () => expect(() => validateIdentityReferences(configuration(), { userIds: ["user"], projectIds: ["other"] })).toThrow(/project/));
});
