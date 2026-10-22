import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Context } from "../trpc.js";
const policy = vi.hoisted(() => ({ lock: vi.fn() }));
vi.mock("../services/identityAccessPolicy.js", () => ({ lockPublishedIdentityAction: policy.lock }));
import { repositoryConnectionsRouter } from "./repositoryConnections.js";

beforeEach(() => { policy.lock.mockReset(); policy.lock.mockResolvedValue({ permissions: ["integrations.manage"] }); });
function fixture() {
  const now = new Date();
  const catalog = [{ id: "repo", name: "Synthetic repository", url: "https://gitlab.example.invalid/team/repo", defaultBranch: "main" }];
  const original = { id: "connection", actorId: "actor", organizationId: "org", projectId: "project", provider: "gitlab", origin: "https://gitlab.example.invalid",
    configurationId: null, status: "VERIFIED", encryptedToken: { synthetic: true }, encryptedVerifier: { accessMethod: "gitlab-token/v1", requestHash: "a".repeat(64) },
    tokenExpiresAt: new Date(now.getTime() + 3600000), catalogAt: now, catalog, verifiedAt: now };
  const state = { member: { role: "VIEWER", seatType: "FULL" }, suspendedAt: null as Date | null, organizationId: "org", subject: "subject", current: { ...original }, taken: false, phase: 0 };
  const events: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes('FROM "Organization"')) { events.push("organization"); return [{ suspendedAt: state.suspendedAt }]; }
      if (sql.includes('FROM "Membership"')) { events.push("membership"); return [state.member]; }
      if (sql.includes('FROM "Project"')) { events.push("project"); return [{ organizationId: state.organizationId }]; }
      if (sql.includes('FROM "User"')) { events.push("subject"); return [{ clerkUserId: state.subject }]; }
      if (sql.includes('FROM "RepositoryConnection"')) { events.push("connection"); return [{ id: original.id }]; }
      throw Error("Unexpected query");
    }),
    membership: { findUnique: vi.fn(async () => state.member) },
    repositoryConnection: { findFirst: vi.fn(async (input: { where: { id: string; actorId: string } }) => input.where.actorId === original.actorId ? original : null), findUniqueOrThrow: vi.fn(async () => state.current) },
    projectRepository: { findUnique: vi.fn(async () => state.taken ? { externalId: "repo", connectionId: "other", connection: { actorId: "other" } } : null),
      findMany: vi.fn(async () => []), create: vi.fn(async () => { events.push("write"); }), update: vi.fn() },
  };
  const db = { ...tx, project: { findUnique: vi.fn(async () => ({ id: "project", organizationId: state.organizationId })) },
    organization: { findUnique: vi.fn(async () => ({ suspendedAt: state.suspendedAt })) },
    repositoryProviderConfiguration: { findFirst: vi.fn(() => { throw Error("Provider configuration must not be read in this token catalogue fixture"); }) },
    $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => { state.phase++; return work(tx); }),
  };
  const ctx = { prisma: db, user: { id: "actor", clerkUserId: "subject", memberships: [{ organizationId: "org", role: "VIEWER", seatType: "FULL" }] },
    authenticatedClerkSubject: "subject", workspaceOrganizationId: "org", staff: null } as unknown as Context;
  const input = { id: original.id, repositoryIds: ["repo"], approved: true as const,
    catalogVersion: createHash("sha256").update(JSON.stringify([original.id,now.toISOString(),catalog.map(r => [r.id,r.name,r.url,r.defaultBranch])])).digest("hex") };
  const caller = () => repositoryConnectionsRouter.createCaller(ctx);
  return { state, tx, db, ctx, input, caller, events };
}
it("attaches only the current actor's reviewed catalogue with an action-specific grant and locked recheck", async () => {
  const f = fixture();
  expect(await f.caller().connectSelected(f.input)).toEqual({ connected: 1 });
  expect(policy.lock).toHaveBeenCalledTimes(2);
  expect(policy.lock).toHaveBeenLastCalledWith(f.tx, { userId: "actor", clerkSubject: "subject", workspaceOrganizationId: "org" }, "org", "project", "integrations.manage");
  expect(f.events).toEqual(["organization","membership","project","subject","organization","membership","project","subject","connection","write"]);
  expect(f.db.repositoryProviderConfiguration.findFirst).not.toHaveBeenCalled();
});
it.each(["revocation", "seat", "subject", "suspension", "project", "binding", "catalogue", "expired", "taken"])("rejects %s before any attachment after initial authorization", async fault => {
  const f = fixture();
  policy.lock.mockImplementation(async () => {
    if (f.state.phase === 1) {
      if (fault === "seat") f.state.member.seatType = "READ_ONLY";
      if (fault === "subject") f.state.subject = "rebound";
      if (fault === "suspension") f.state.suspendedAt = new Date();
      if (fault === "project") f.state.organizationId = "moved";
      if (fault === "binding") f.state.current.actorId = "other";
      if (fault === "catalogue") f.state.current.catalog = [];
      if (fault === "expired") f.state.current.tokenExpiresAt = new Date(0);
      if (fault === "taken") f.state.taken = true;
    } else if (fault === "revocation") throw new TRPCError({ code: "FORBIDDEN" });
    return { permissions: ["integrations.manage"] };
  });
  await expect(f.caller().connectSelected(f.input)).rejects.toBeInstanceOf(TRPCError);
  expect(f.tx.projectRepository.create).not.toHaveBeenCalled(); expect(f.tx.projectRepository.update).not.toHaveBeenCalled();
});
it.each(["missing", "mismatch", "workspace", "owner"])("rejects unavailable or wrong original authority: %s", async fault => {
  const f = fixture();
  if (fault === "missing") f.ctx.authenticatedClerkSubject = null;
  if (fault === "mismatch") f.ctx.authenticatedClerkSubject = "other";
  if (fault === "workspace") f.ctx.workspaceOrganizationId = "other";
  if (fault === "owner") f.ctx.user!.id = "other";
  await expect(f.caller().connectSelected(f.input)).rejects.toBeInstanceOf(TRPCError);
  expect(policy.lock).not.toHaveBeenCalled(); expect(f.tx.projectRepository.create).not.toHaveBeenCalled();
});
it("does not turn the management action into provider catalogue, credential or OAuth authority", async () => {
  const f = fixture();
  await expect(f.caller().list({ id: "connection" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(f.caller().begin({ projectId: "project", configurationId: "configuration", approveMetadataAccess: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(f.caller().configureGitlab({ projectId: "project", origin: "https://gitlab.example.invalid", clientId: "synthetic", clientSecret: "synthetic" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(policy.lock).not.toHaveBeenCalled();
});
it("preserves native full-editor selection without consuming a custom grant", async () => {
  const f = fixture(); f.state.member.role = "EDITOR"; f.ctx.user!.memberships[0]!.role = "EDITOR";
  expect(await f.caller().connectSelected(f.input)).toEqual({ connected: 1 });
  expect(policy.lock).not.toHaveBeenCalled();
});
