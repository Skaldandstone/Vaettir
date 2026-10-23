import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
import { atlassianQualityRouter } from "../routers/atlassianQuality.js";
import { issueForgeConnectionRequest } from "./forgeConnectionRequest.js";
import type { ForgeIdentity } from "./forgeInvocation.js";
const identity: ForgeIdentity = { appId: "ari:cloud:ecosystem::app/743bf96f-0f9f-4fed-981a-ea3fc318d15d",
  environmentId: "ari:cloud:ecosystem::environment/743bf96f-0f9f-4fed-981a-ea3fc318d15d/d2844601-7a1f-4e4e-9b77-e0d4d3682c50",
  installationId: "ari:cloud:ecosystem::installation/10000000-0000-4000-8000-000000000001", cloudId: "10000000-0000-4000-8000-000000000002",
  siteOrigin: "https://company.atlassian.net", product: "jira", targetId: "10", principal: "jira-viewer", moduleKey: "vaettir-project-quality", apiBaseUrl: "https://api.atlassian.com/ex/jira/10000000-0000-4000-8000-000000000002" };
type Row = { id: string; entityId: string; entityType: string; organizationId: string; projectId: string; actorId: string; metadata: Record<string, unknown> };
function fixture() {
  const state = { role: "OWNER", seat: "FULL", clerk: "clerk", suspended: false, moved: false, failReceipt: false, lateRole: false };
  const rows: Row[] = [];
  const actor = { id: "actor", clerkUserId: "clerk", memberships: [{ organizationId: "org", role: "OWNER", seatType: "FULL" }] };
  const db = {
    user: { findUnique: vi.fn(async () => ({ ...actor, clerkUserId: state.clerk, memberships: [{ organizationId: "org", role: state.role, seatType: state.seat }] })) },
    organization: { findUnique: vi.fn(async () => ({ suspendedAt: state.suspended ? new Date() : null })), findMany: vi.fn(async () => state.suspended ? [] : [{ id: "org", name: "Company" }]) },
    project: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, organizationId: state.moved ? "foreign" : "org" })), findMany: vi.fn(async () => [{ id: "project", name: "Synthetic project", organizationId: "org" }]) },
    auditLog: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find(r => r.id === where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter(r => Object.entries(where).every(([k, v]) => r[k as keyof Row] === v))),
      create: vi.fn(async ({ data }: { data: Row }) => { if (state.failReceipt && data.entityType === "ForgeConnectionRequest") throw new Error("Synthetic audit outage"); rows.push(data); return data; }),
    },
    $queryRaw: vi.fn(async (sql: TemplateStringsArray) => {
      if (state.lateRole && sql.join("").includes('"Membership"')) state.role = "VIEWER";
      return sql.join("").includes('"Membership"') ? [{ role: state.role, seatType: state.seat }]
        : sql.join("").includes('"Project"') ? [{ organizationId: state.moved ? "foreign" : "org" }]
        : [{ suspendedAt: state.suspended ? new Date() : null }];
    }),
  };
  const prisma = { ...db, $transaction: async <T>(work: (tx: typeof db) => Promise<T>) => { const saved = [...rows]; try { return await work(db); } catch (e) { rows.splice(0, rows.length, ...saved); throw e; } } };
  const context = { user: actor, authenticatedClerkSubject: "clerk", prisma } as unknown as Context;
  const issued = issueForgeConnectionRequest(identity, "Company (TEST)");
  const requestToken = new URL(issued.connectionUrl).searchParams.get("request")!;
  const input = { requestToken, expectedClerkActorId: "clerk", organizationId: "org", projectId: "project", approveConnection: true as const };
  return { state, rows, db, context, input, caller: atlassianQualityRouter.createCaller(context) };
}
beforeEach(() => { vi.stubEnv("VAETTIR_FORGE_APP_ID", identity.appId); vi.stubEnv("VAETTIR_FORGE_ENVIRONMENT_ID", identity.environmentId); vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64")); vi.stubEnv("WEB_APP_URL", "https://vaettir.example.test"); });
afterEach(() => vi.unstubAllEnvs());
describe("one-project native connection authorization", () => {
  it("lists only current full administrator project metadata, never case/report content", async () => {
    const f = fixture();
    const result = await f.caller.connectionOptions({ requestToken: f.input.requestToken, expectedClerkActorId: "clerk" });
    expect(result.projects).toEqual([{ id: "project", name: "Synthetic project", organizationId: "org" }]);
    expect(f.db.project.findMany.mock.calls[0]![0].where.organizationId.in).toEqual(["org"]);
    expect(f.db.project.findMany.mock.calls[0]![0].select).toEqual({ id: true, name: true, organizationId: true });
    expect(f.rows).toHaveLength(0); expect(JSON.stringify(result)).not.toContain(f.input.requestToken);
    await expect(f.caller.connectionOptions({ requestToken: f.input.requestToken, expectedClerkActorId: "clerk", organizationId: "foreign" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("records one exact destination/project approval and a durable consumption receipt, then replays without another grant", async () => {
    const f = fixture(), first = await f.caller.connectProject(f.input), replay = await f.caller.connectProject(f.input);
    expect(first).toEqual(replay); expect(first.state).toBe("APPROVED"); expect(f.rows).toHaveLength(2);
    const grant = f.rows.find(r => r.entityType === "ForgeQualitySharing")!;
    expect(grant.metadata.binding).toEqual({ appId: identity.appId, installationId: identity.installationId, environmentId: identity.environmentId, cloudId: identity.cloudId, siteOrigin: identity.siteOrigin, product: "jira", targetId: "10" });
    expect(grant.metadata.shareApprovedProjectQuality).toBe(true); expect(grant.metadata.shareTicketTests).toBe(true);
    expect(JSON.stringify(f.rows)).not.toContain(f.input.requestToken); expect(JSON.stringify(f.rows)).not.toContain(identity.principal);
    expect(f.db.$queryRaw.mock.calls.some(call => call[0].join("").includes('"User"') && call[0].join("").includes("FOR SHARE"))).toBe(true);
    await expect(f.caller.connectProject({ ...f.input, projectId: "other-project" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.rows).toHaveLength(2);
  });
  it("never revives a connection that was revoked after the original successful approval", async () => {
    const f = fixture(); await f.caller.connectProject(f.input);
    const grant = f.rows.find(r => r.entityType === "ForgeQualitySharing")!;
    f.rows.push({ ...grant, id: "revocation", metadata: { ...grant.metadata, version: 2, state: "REVOKED" } });
    expect((await f.caller.connectProject(f.input)).state).toBe("REVOKED"); expect(f.rows).toHaveLength(3);
  });
  it("rejects API keys, a remapped identity, stale authority, read-only seats, project moves and suspended workspaces", async () => {
    for (const change of ["machine", "mapping", "role", "seat", "moved", "suspended", "lateRole"] as const) {
      const f = fixture();
      if (change === "machine") f.context.authenticatedClerkSubject = null;
      if (change === "mapping") f.state.clerk = "different";
      if (change === "role") f.state.role = "VIEWER";
      if (change === "seat") f.state.seat = "READ_ONLY";
      if (change === "moved") f.state.moved = true;
      if (change === "suspended") f.state.suspended = true;
      if (change === "lateRole") f.state.lateRole = true;
      await expect(atlassianQualityRouter.createCaller(f.context).connectProject(f.input)).rejects.toThrow();
      expect(f.rows).toHaveLength(0);
    }
  });
  it("rolls back the approval if its consumption/audit receipt cannot be retained", async () => {
    const f = fixture(); f.state.failReceipt = true;
    await expect(f.caller.connectProject(f.input)).rejects.toThrow("Synthetic audit outage"); expect(f.rows).toHaveLength(0);
  });
  it("does not accept a caller's alternate target or a missing explicit approval", async () => {
    const f = fixture();
    await expect(f.caller.connectProject({ ...f.input, binding: { ...identity, targetId: "foreign" } } as never)).rejects.toThrow();
    await expect(f.caller.connectProject({ ...f.input, approveConnection: false } as never)).rejects.toThrow();
    expect(f.rows).toHaveLength(0);
  });
});
