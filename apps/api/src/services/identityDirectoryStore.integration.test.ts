import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Prisma, type PrismaClient, ConstraintCheckedPrismaClient } from "@vaettir/db";
import { createIdentityDirectoryStore, DirectoryObservationConflict, DirectoryObservationUnavailable } from "./identityDirectoryStore.js";
import { publishIdentityDraft, readPublishedLocalAccess, readPublishedIdentityAccess } from "./identityAccessPolicy.js";
import { directorySettings, updateDirectorySettings } from "./identityDirectorySettings.js";
import { testPlansRouter } from "../routers/testPlans.js";
import { testPlanGovernanceRouter } from "../routers/testPlanGovernance.js";
import { requirementsRouter } from "../routers/requirements.js";
import { architectureRouter } from "../routers/architecture.js";
import { testCasesRouter } from "../routers/testCases.js";
import { caseFieldsRouter } from "../routers/caseFields.js";
import { reportSnapshotsRouter } from "../routers/reportSnapshots.js";
import type { Context } from "../trpc.js";

// Do not widen the shared test database admission helper or use its default port.
// This file only runs against the exact cluster created by the dedicated runner.
function fixtureAdmission() {
  const configured = process.env.VAETTIR_IDENTITY_POSTGRES_FIXTURE;
  if (!configured) return false;
  const fixture = realpathSync(configured);
  const local = realpathSync(resolve(process.cwd(), "../../.local"));
  if (!fixture.startsWith(`${local}\\identity-postgres-`)) throw Error("Owned identity fixture required");
  const marker = JSON.parse(readFileSync(join(fixture, "owner.json"), "utf8"));
  const url = new URL(process.env.DATABASE_URL ?? "");
  const pid = readFileSync(join(fixture, "data/postmaster.pid"), "utf8").split(/\r?\n/);
  if (marker.purpose !== "identity-directory-postgres-fixture" || realpathSync(marker.fixture) !== fixture
    || realpathSync(marker.data) !== realpathSync(join(fixture, "data"))
    || !/^vaettir_identity_test_[0-9]{13}$/.test(marker.database)
    || url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.username !== "postgres" || url.password
    || url.pathname !== `/${marker.database}` || url.port !== String(marker.port) || marker.port === 5432
    || url.search !== "?schema=public&connection_limit=5" || url.hash
    || realpathSync(pid[1]!) !== marker.data || pid[3] !== String(marker.port)) throw Error("Owned identity fixture required");
  return true;
}
const admitted = fixtureAdmission();
function afterSubjectRead(client: PrismaClient, reached: () => Promise<void>): PrismaClient {
  return { $transaction: <T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options: { isolationLevel: Prisma.TransactionIsolationLevel }) =>
    client.$transaction(tx => work(new Proxy(tx, { get(target, property) {
      if (property === "identityDirectorySubject") return new Proxy(tx.identityDirectorySubject, { get(delegate, operation) {
        if (operation === "findUnique") return async (args: Prisma.IdentityDirectorySubjectFindUniqueArgs) => {
          const value = await tx.identityDirectorySubject.findUnique(args); await reached(); return value;
        };
        return Reflect.get(delegate, operation);
      } });
      return Reflect.get(target, property);
    } })), options) } as unknown as PrismaClient;
}
describe.skipIf(!admitted)("directory journal on owned PostgreSQL", () => {
  const db = new ConstraintCheckedPrismaClient();
  const second = new ConstraintCheckedPrismaClient();
  let tierId: string;
  beforeAll(async () => {
    const version = await db.$queryRaw<{ server_version_num: string }[]>`SHOW server_version_num`;
    expect(Number(version[0]!.server_version_num)).toBeGreaterThanOrEqual(170000);
    expect(Number(version[0]!.server_version_num)).toBeLessThan(180000);
    const actual = await db.$queryRaw<{ database: string; port: number }[]>`SELECT current_database() AS database, inet_server_port() AS port`;
    const url = new URL(process.env.DATABASE_URL!);
    expect(actual).toEqual([{ database: url.pathname.slice(1), port: Number(url.port) }]);
    const tier = await db.planTier.create({ data: { key: randomUUID(), name: "Synthetic identity fixture", sortOrder: 0, minFullSeats: 0 } });
    tierId = tier.id;
  });
  afterAll(async () => { await db.$disconnect(); await second.$disconnect(); });

  async function fixture() {
    const key = randomUUID();
    const org = await db.organization.create({ data: { name: "Synthetic identity fixture", slug: key, planTierId: tierId } });
    const user = await db.user.create({ data: { clerkUserId: key, email: `${key}@example.invalid`,
      memberships: { create: { organizationId: org.id, role: "VIEWER", seatType: "READ_ONLY" } } } });
    const connection = await db.identityDirectoryConnection.create({ data: { organizationId: org.id,
      providerInstanceId: key, providerConnectionId: `connection-${key}`, providerDirectoryId: `directory-${key}`, enabled: true } });
    const subject = await db.identityDirectorySubject.create({ data: { organizationId: org.id, connectionId: connection.id,
      userId: user.id, clerkSubject: key, externalSubjectId: `subject-${key}`, enabled: true } });
    let now = Date.now();
    const store = createIdentityDirectoryStore(db, () => now);
    const target = { organizationId: org.id, subjectId: subject.id };
    const observation = { providerInstanceId: key, providerConnectionId: connection.providerConnectionId,
      providerDirectoryId: connection.providerDirectoryId, clerkSubject: key, externalSubjectId: subject.externalSubjectId,
      complete: true as const, active: true, externalGroupIds: ["synthetic-group-b", "synthetic-group-a"] };
    return { org, user, connection, subject, store, target, observation, advance: (ms: number) => { now += ms; } };
  }
  it("persists a source observation and receipt without changing native seats or roles", async () => {
    const f = await fixture(); const ticket = await f.store.reserve(f.target); await f.store.commit(ticket, f.observation);
    expect(await createIdentityDirectoryStore(second).readCurrent(f.target)).toMatchObject({ active: true, generation: 1,
      externalGroupIds: ["synthetic-group-a", "synthetic-group-b"] });
    expect(await second.identityDirectoryReceipt.findMany({ where: { subjectId: f.subject.id } })).toHaveLength(1);
    expect(await second.membership.findUnique({ where: { organizationId_userId: { organizationId: f.org.id, userId: f.user.id } } }))
      .toMatchObject({ role: "VIEWER", seatType: "READ_ONLY" });
  });
  it("rolls back the subject update when the receipt violates a real SQL constraint", async () => {
    const f = await fixture(); const ticket = await f.store.reserve(f.target);
    const fault = { $transaction: <T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options: { isolationLevel: Prisma.TransactionIsolationLevel }) =>
      db.$transaction(tx => work(new Proxy(tx, { get(target, property) {
        if (property === "identityDirectoryReceipt") return { create: (args: Prisma.IdentityDirectoryReceiptCreateArgs) =>
          tx.identityDirectoryReceipt.create({ ...args, data: { ...args.data, groupCount: -1 } }) };
        return Reflect.get(target, property);
      } })), options) } as unknown as PrismaClient;
    await expect(createIdentityDirectoryStore(fault).commit(ticket, f.observation)).rejects.toThrow();
    expect(await second.identityDirectorySubject.findUnique({ where: { id: f.subject.id } })).toMatchObject({
      appliedGeneration: 0, active: false, externalGroupIds: [], observedAt: null, expiresAt: null,
    });
    expect(await second.identityDirectoryReceipt.count({ where: { subjectId: f.subject.id } })).toBe(0);
  });
  it("allows one concurrent commit and rejects its replay across separate connections", async () => {
    const f = await fixture(); const ticket = await f.store.reserve(f.target);
    let arrived = 0; let release = () => {};
    const hold = new Promise<void>(done => { release = done; });
    // Both transactions read the same generation before either can update it.
    const reached = async () => { if (++arrived === 2) release(); await hold; };
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; release(); }, 2000);
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled([
        createIdentityDirectoryStore(afterSubjectRead(db, reached)).commit(ticket, f.observation),
        createIdentityDirectoryStore(afterSubjectRead(second, reached)).commit(ticket, f.observation),
      ]);
    } finally { clearTimeout(timeout); release(); }
    expect(timedOut).toBe(false);
    expect(arrived).toBe(2);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(DirectoryObservationConflict);
    expect(await db.identityDirectoryReceipt.count({ where: { subjectId: f.subject.id } })).toBe(1);
  });
  it("rejects an older fetch after a newer revocation and permits a freshly observed reactivation", async () => {
    const f = await fixture(); const old = await f.store.reserve(f.target); const latest = await f.store.reserve(f.target);
    await f.store.commit(latest, { ...f.observation, active: false });
    await expect(f.store.commit(old, f.observation)).rejects.toBeInstanceOf(DirectoryObservationConflict);
    expect(await f.store.readCurrent(f.target)).toMatchObject({ active: false, externalGroupIds: [] });
    await f.store.commit(await f.store.reserve(f.target), f.observation);
    expect(await f.store.readCurrent(f.target)).toMatchObject({ active: true, generation: 3 });
  });
  it("invalidates observations and in-flight work when configuration changes", async () => {
    const f = await fixture(); await f.store.commit(await f.store.reserve(f.target), f.observation);
    const ticket = await f.store.reserve(f.target);
    await second.identityDirectoryConnection.update({ where: { id: f.connection.id }, data: { revision: { increment: 1 } } });
    expect(await f.store.readCurrent(f.target)).toBeNull();
    await expect(f.store.commit(ticket, f.observation)).rejects.toBeInstanceOf(DirectoryObservationConflict);
  });
  it("denies old evidence when a configuration change races a paused commit", async () => {
    const f = await fixture(); const ticket = await f.store.reserve(f.target);
    let notifyRead = () => {}; let release = () => {};
    const loaded = new Promise<void>(done => { notifyRead = done; });
    const hold = new Promise<void>(done => { release = done; });
    const pending = createIdentityDirectoryStore(afterSubjectRead(db, async () => { notifyRead(); await hold; }))
      .commit(ticket, f.observation).then(() => "committed", error => {
        expect(error).toBeInstanceOf(DirectoryObservationConflict); return "conflict";
      });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; release(); }, 2000);
    try {
      await loaded;
      await second.identityDirectoryConnection.update({ where: { id: f.connection.id }, data: { revision: { increment: 1 } } });
    } finally { clearTimeout(timeout); release(); }
    await pending;
    expect(timedOut).toBe(false);
    // A serializable ordering may place the journal commit before the config
    // change, but current evaluation must never admit that old revision.
    expect(await createIdentityDirectoryStore(second).readCurrent(f.target)).toBeNull();
  });
  it("rejects actual native subject rebinding without altering manual membership", async () => {
    const f = await fixture(); const ticket = await f.store.reserve(f.target);
    await second.user.update({ where: { id: f.user.id }, data: { clerkUserId: randomUUID() } });
    await expect(f.store.commit(ticket, f.observation)).rejects.toBeInstanceOf(DirectoryObservationUnavailable);
    expect(await db.membership.count({ where: { organizationId: f.org.id, userId: f.user.id } })).toBe(1);
  });
  it("does not keep evidence alive when a newer fetch is reserved", async () => {
    const f = await fixture(); await f.store.commit(await f.store.reserve(f.target), f.observation);
    f.advance(299000); await f.store.reserve(f.target); f.advance(1000);
    expect(await f.store.readCurrent(f.target)).toBeNull();
  });
  it("enforces tenant foreign keys and global provider-directory uniqueness", async () => {
    const a = await fixture(); const b = await fixture();
    await expect(db.identityDirectorySubject.create({ data: { organizationId: b.org.id, connectionId: a.connection.id,
      userId: b.user.id, clerkSubject: b.user.clerkUserId, externalSubjectId: "cross-tenant" } })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.identityDirectorySubject.create({ data: { organizationId: a.org.id, connectionId: a.connection.id,
      userId: b.user.id, clerkSubject: b.user.clerkUserId, externalSubjectId: "cross-membership" } })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.identityDirectoryConnection.create({ data: { organizationId: b.org.id, providerInstanceId: a.connection.providerInstanceId,
      providerConnectionId: "other", providerDirectoryId: a.connection.providerDirectoryId } })).rejects.toMatchObject({ code: "P2002" });
  });
  it("protects retained subject provenance against implicit membership deletion", async () => {
    const f = await fixture();
    await expect(db.membership.delete({ where: { organizationId_userId: { organizationId: f.org.id, userId: f.user.id } } })).rejects.toMatchObject({ code: "P2003" });
    expect(await db.identityDirectorySubject.count({ where: { id: f.subject.id } })).toBe(1);
  });

  async function localRulesFixture() {
    const f = await fixture(); const key = randomUUID();
    const admin = await db.user.create({ data: { clerkUserId: key, email: `${key}@example.invalid`, memberships: { create: { organizationId: f.org.id, role: "ADMIN", seatType: "FULL" } } } });
    await db.membership.update({ where: { organizationId_userId: { organizationId: f.org.id, userId: f.user.id } }, data: { seatType: "FULL" } });
    const project = await db.project.create({ data: { organizationId: f.org.id, name: "Scoped plan fixture", slug: key } });
    const configuration = { schemaVersion: 1, roles: [{ id: "author", name: "Plan author", permissions: ["plans.write"] }],
      groups: [{ id: "authors", name: "Authors", userIds: [f.user.id], roleIds: ["author"], scope: { kind: "projects", projectIds: [project.id] } }] };
    await db.identityAccessDraft.create({ data: { organizationId: f.org.id, configuration } });
    const administrator = { userId: admin.id, clerkSubject: admin.clerkUserId, workspaceOrganizationId: f.org.id };
    const actor = { userId: f.user.id, clerkSubject: f.user.clerkUserId, workspaceOrganizationId: f.org.id };
    const caller = async () => testPlansRouter.createCaller({ prisma: db, user: await db.user.findUniqueOrThrow({ where: { id: f.user.id }, include: { memberships: true } }),
      authenticatedClerkSubject: f.user.clerkUserId, workspaceOrganizationId: f.org.id, staff: null } as Context);
    return { ...f, project, configuration, administrator, actor, caller };
  }
  it("publishes scoped rules, creates a real plan, then revokes the custom action without altering native role/seat", async () => {
    const f = await localRulesFixture();
    await expect((await f.caller()).create({ projectId: f.project.id, name: "Before publication" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 1, expectedPolicyRevision: 0 });
    const created = await (await f.caller()).create({ projectId: f.project.id, name: "Scoped custom plan" });
    expect(await second.testPlan.findUnique({ where: { id: created.id } })).toMatchObject({ name: "Scoped custom plan", createdById: f.user.id });
    expect(await second.auditLog.count({ where: { organizationId: f.org.id, entityType: "IdentityAccessPolicy" } })).toBe(1);
    await db.identityAccessDraft.update({ where: { organizationId: f.org.id }, data: { revision: 2, configuration: { ...f.configuration, groups: [] } } });
    // Draft changes alone do not change published access.
    expect((await readPublishedLocalAccess(second, f.actor, f.org.id, f.project.id)).permissions).toEqual(["plans.write"]);
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 2, expectedPolicyRevision: 1 });
    await expect((await f.caller()).create({ projectId: f.project.id, name: "After revocation" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await second.membership.findUnique({ where: { organizationId_userId: { organizationId: f.org.id, userId: f.user.id } } })).toMatchObject({ role: "VIEWER", seatType: "FULL" });
    expect(await second.testPlan.count({ where: { projectId: f.project.id } })).toBe(1);
  });
  it("honors scoped roles throughout governed plan editing and denies receipt replay after revocation", async () => {
    const f = await localRulesFixture();
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 1, expectedPolicyRevision: 0 });
    const plan = await (await f.caller()).create({ projectId: f.project.id, name: "Original plan" });
    const caller = testPlanGovernanceRouter.createCaller({ prisma: db,
      user: await db.user.findUniqueOrThrow({ where: { id: f.user.id }, include: { memberships: true } }),
      authenticatedClerkSubject: f.user.clerkUserId, workspaceOrganizationId: f.org.id, staff: null } as Context);
    const scope = { projectId: f.project.id, testPlanId: plan.id, originalOrganizationId: f.org.id, expectedClerkActorId: f.user.clerkUserId };
    const preview = await caller.preview(scope);
    expect(preview.canEdit).toBe(true);
    const edit = { ...scope, requestId: randomUUID(), expectedPlanRevision: preview.planRevision, reason: "Synthetic permission verification", confirmed: true as const, name: "Reviewed scoped plan" };
    const saved = await caller.editPlanHeader(edit);
    expect(saved.replayed).toBe(false);
    expect((await caller.editPlanHeader(edit)).replayed).toBe(true);
    await expect(caller.editPlanHeader({ ...edit, requestId: randomUUID(), name: "Stale edit" })).rejects.toMatchObject({ code: "CONFLICT" });
    const changed = await caller.setPlanStatus({ ...scope, requestId: randomUUID(), expectedPlanRevision: saved.afterRevision,
      reason: "Synthetic status verification", confirmed: true, expectedStatus: "DRAFT", status: "ACTIVE", intent: "CHANGE" });
    expect(changed.operation).toBe("SET_PLAN_STATUS");
    await db.identityAccessDraft.update({ where: { organizationId: f.org.id }, data: { revision: 2, configuration: { ...f.configuration, groups: [] } } });
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 2, expectedPolicyRevision: 1 });
    expect((await caller.preview(scope)).canEdit).toBe(false);
    await expect(caller.editPlanHeader(edit)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await second.testPlan.findUnique({ where: { id: plan.id } })).toMatchObject({ name: "Reviewed scoped plan", status: "ACTIVE" });
  });
  it("rolls back publication when its audit fails a real foreign-key constraint", async () => {
    const f = await localRulesFixture();
    const fault = { $transaction: <T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options: { isolationLevel: Prisma.TransactionIsolationLevel }) =>
      db.$transaction(tx => work(new Proxy(tx, { get(target, property) {
        if (property === "auditLog") return { create: (args: Prisma.AuditLogCreateArgs) => tx.auditLog.create({ data: { ...args.data, actorId: "missing-synthetic-actor" } as Prisma.AuditLogUncheckedCreateInput }) };
        return Reflect.get(target, property);
      } })), options) } as unknown as PrismaClient;
    await expect(publishIdentityDraft(fault, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 1, expectedPolicyRevision: 0 })).rejects.toMatchObject({ code: "P2003" });
    expect(await second.identityAccessPolicy.findUnique({ where: { organizationId: f.org.id } })).toBeNull();
    expect(await second.auditLog.count({ where: { organizationId: f.org.id, entityType: "IdentityAccessPolicy" } })).toBe(0);
  });
  it("maps observed groups to scoped actions, invalidates old evidence and preserves independent local grants", async () => {
    const f = await localRulesFixture();
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 1, expectedPolicyRevision: 0 });
    await f.store.commit(await f.store.reserve(f.target), f.observation);
    const mappings = [{ externalGroupId: "synthetic-group-a", roleId: "author", scope: { kind: "projects" as const, projectIds: [f.project.id] } }];
    const update = (revision: number, change: Parameters<typeof updateDirectorySettings>[2]["change"]) => updateDirectorySettings(db, f.administrator,
      { organizationId: f.org.id, connectionId: f.connection.id, expectedRevision: revision, change });
    const old = await f.store.reserve(f.target);
    expect(await update(1, { kind: "mappings", mappings })).toEqual({ revision: 2 });
    await expect(f.store.commit(old, f.observation)).rejects.toBeInstanceOf(DirectoryObservationConflict);
    let access = await readPublishedIdentityAccess(second, f.actor, f.org.id, f.project.id);
    expect(access.directorySources).toEqual([]);
    expect(access.permissions).toEqual(["plans.write"]); // Independent local group remains.
    await f.store.commit(await f.store.reserve(f.target), f.observation);
    access = await readPublishedIdentityAccess(second, f.actor, f.org.id, f.project.id);
    expect(access.directorySources).toEqual([{ connectionId: f.connection.id, externalGroupId: "synthetic-group-a", roleId: "author", permission: "plans.write" }]);
    const outside = await db.project.create({ data: { organizationId: f.org.id, name: "Outside directory scope", slug: randomUUID() } });
    expect((await readPublishedIdentityAccess(second, f.actor, f.org.id, outside.id)).permissions).toEqual([]);
    // Remove independent local contribution: the directory is now the only source.
    await db.identityAccessDraft.update({ where: { organizationId: f.org.id }, data: { revision: 2, configuration: { ...f.configuration, groups: [] } } });
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 2, expectedPolicyRevision: 1 });
    await (await f.caller()).create({ projectId: f.project.id, name: "Directory-authored plan" });
    await f.store.commit(await f.store.reserve(f.target), { ...f.observation, externalGroupIds: [] });
    await expect((await f.caller()).create({ projectId: f.project.id, name: "Removed group denied" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await f.store.commit(await f.store.reserve(f.target), f.observation);
    await (await f.caller()).create({ projectId: f.project.id, name: "Fresh reactivation plan" });
    await update(2, { kind: "disable" });
    await expect((await f.caller()).create({ projectId: f.project.id, name: "Disabled directory denied" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await second.membership.findUnique({ where: { organizationId_userId: { organizationId: f.org.id, userId: f.user.id } } })).toMatchObject({ role: "VIEWER", seatType: "FULL" });
    expect(await second.auditLog.count({ where: { organizationId: f.org.id, entityType: "IdentityDirectoryConnection" } })).toBe(2);
    expect((await directorySettings(second, f.administrator, f.org.id))[0]).toMatchObject({ enabled: false, activeMembers: 0, revision: 3 });
  });
  it("rejects unavailable mapping references, non-admins, tenant mismatch and stale retries", async () => {
    const f = await localRulesFixture();
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 1, expectedPolicyRevision: 0 });
    await f.store.commit(await f.store.reserve(f.target), f.observation);
    const input = { organizationId: f.org.id, connectionId: f.connection.id, expectedRevision: 1, change: { kind: "disable" as const } };
    await expect(updateDirectorySettings(db, f.actor, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateDirectorySettings(db, { ...f.administrator, workspaceOrganizationId: "other" }, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const mapping of [
      { externalGroupId: "not-observed", roleId: "author", scope: { kind: "workspace" as const } },
      { externalGroupId: "synthetic-group-a", roleId: "missing-role", scope: { kind: "workspace" as const } },
      { externalGroupId: "synthetic-group-a", roleId: "author", scope: { kind: "projects" as const, projectIds: ["other-tenant-project"] } },
    ]) await expect(updateDirectorySettings(db, f.administrator, { ...input, change: { kind: "mappings", mappings: [mapping] } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const results = await Promise.allSettled([db, second].map(client => updateDirectorySettings(client, f.administrator, input)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    await expect(updateDirectorySettings(db, f.administrator, input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await second.auditLog.count({ where: { organizationId: f.org.id, entityType: "IdentityDirectoryConnection" } })).toBe(1);
  });
  it("rolls back a directory disable when the audit cannot commit", async () => {
    const f = await localRulesFixture();
    const fault = { $transaction: <T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options: { isolationLevel: Prisma.TransactionIsolationLevel }) =>
      db.$transaction(tx => work(new Proxy(tx, { get(target, property) {
        if (property === "auditLog") return { create: (args: Prisma.AuditLogCreateArgs) => tx.auditLog.create({ data: { ...args.data, actorId: "missing-synthetic-actor" } as Prisma.AuditLogUncheckedCreateInput }) };
        return Reflect.get(target, property);
      } })), options) } as unknown as PrismaClient;
    await expect(updateDirectorySettings(fault, f.administrator, { organizationId: f.org.id, connectionId: f.connection.id,
      expectedRevision: 1, change: { kind: "disable" } })).rejects.toMatchObject({ code: "P2003" });
    expect(await second.identityDirectoryConnection.findUnique({ where: { id: f.connection.id } })).toMatchObject({ revision: 1, enabled: true });
  });
  it("permits only scoped requirement CRUD and free architecture mapping, never AI processing, then revokes both", async () => {
    const f = await localRulesFixture();
    const config = { ...f.configuration, roles: [{ id: "author", name: "Design reviewer", permissions: ["requirements.write", "architecture.write"] }] };
    await db.identityAccessDraft.update({ where: { organizationId: f.org.id }, data: { configuration: config } });
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 1, expectedPolicyRevision: 0 });
    const context = { prisma: db, user: await db.user.findUniqueOrThrow({ where: { id: f.user.id }, include: { memberships: true } }),
      authenticatedClerkSubject: f.user.clerkUserId, workspaceOrganizationId: f.org.id, staff: null } as Context;
    const requirements = requirementsRouter.createCaller(context);
    const created = await requirements.create({ projectId: f.project.id, title: "Synthetic requirement" });
    await requirements.update({ id: created.id, title: "Reviewed requirement" });
    expect(await second.requirement.findUnique({ where: { id: created.id } })).toMatchObject({ title: "Reviewed requirement" });
    const temporary = await requirements.create({ projectId: f.project.id, title: "Disposable synthetic requirement" });
    await requirements.delete({ id: temporary.id });
    expect(await second.requirement.findUnique({ where: { id: temporary.id } })).toBeNull();
    const testCase = await db.testCase.create({ data: { projectId: f.project.id, title: "Synthetic transfer", testType: "FUNCTIONAL", origin: "AUTHORED", given: [], when: [], then: [], steps: { create: { order: 0, action: "Transfer" } } } });
    const architecture = architectureRouter.createCaller(context);
    const input = { projectId: f.project.id, organizationId: f.org.id, fileName: "synthetic.puml", content: "@startuml\ncomponent API\ndatabase Store\nAPI --> Store\n@enduml" };
    const preview = await architecture.preview(input);
    expect(preview.canMap).toBe(true); expect(preview.canSpend).toBe(false);
    const mapping = { ...input, expectedScopeHash: preview.scopeHash, caseId: testCase.id, elementId: preview.document.elements[0]!.id, decision: "CONFIRMED" as const, requestId: randomUUID() };
    await architecture.decide(mapping); await architecture.decide(mapping);
    const reopened = await architecture.preview(input);
    expect(reopened.decisions).toHaveLength(1);
    expect(await second.auditLog.count({ where: { projectId: f.project.id, entityType: "ArchitectureDocument" } })).toBe(1);
    await expect(architecture.analyzeBatch({ ...input, expectedScopeHash: preview.scopeHash, batchIndex: 0, approvedMaximumCredits: 0, approveAiProcessing: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect((await f.caller()).create({ projectId: f.project.id, name: "Wrong action denied" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.identityAccessDraft.update({ where: { organizationId: f.org.id }, data: { revision: 2, configuration: { ...config, groups: [] } } });
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 2, expectedPolicyRevision: 1 });
    await expect(requirements.update({ id: created.id, title: "Denied edit" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requirements.delete({ id: created.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(architecture.decide(mapping)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await architecture.preview(input)).canMap).toBe(false);
    expect(await second.requirement.findUnique({ where: { id: created.id } })).toMatchObject({ title: "Reviewed requirement" });
  });
  it("scopes manual case creation and edits without promoting generic editor, import, AI or schema authority", async () => {
    const f = await localRulesFixture();
    const configuration = { ...f.configuration, roles: [{ id: "author", name: "Case author", permissions: ["cases.write"] }] };
    await db.identityAccessDraft.update({ where: { organizationId: f.org.id }, data: { configuration } });
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 1, expectedPolicyRevision: 0 });
    const context = { prisma: db, user: await db.user.findUniqueOrThrow({ where: { id: f.user.id }, include: { memberships: true } }),
      authenticatedClerkSubject: f.user.clerkUserId, workspaceOrganizationId: f.org.id, staff: null } as Context;
    const cases = testCasesRouter.createCaller(context), fields = caseFieldsRouter.createCaller(context);
    expect((await fields.get({ projectId: f.project.id })).canEdit).toBe(false);
    const defaults = await fields.get({ projectId: f.project.id, authoringAction: "cases.write" });
    expect(defaults.canEdit).toBe(true); expect(defaults.canConfigure).toBe(false);
    const body = { title: "Synthetic scoped case", testType: "FUNCTIONAL", steps: [{ action: "Exercise the synthetic endpoint", expectedResult: "Synthetic result" }] };
    const administratorPlans = testPlansRouter.createCaller({ ...context,
      user: await db.user.findUniqueOrThrow({ where: { id: f.administrator.userId }, include: { memberships: true } }),
      authenticatedClerkSubject: f.administrator.clerkSubject });
    const plan = await administratorPlans.create({ projectId: f.project.id, name: "Independent plan" });
    await expect(cases.create({ ...body, projectId: f.project.id, testPlanId: plan.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const created = await cases.create({ ...body, projectId: f.project.id, customFields: {}, expectedFieldSchemaHash: defaults.expectedSchemaHash });
    const read = await cases.byId({ id: created.id });
    const metadata = await fields.get({ projectId: f.project.id, caseId: created.id, authoringAction: "cases.write" });
    const edit = { ...body, title: "Reviewed scoped case", id: created.id, expectedCaseRevision: read.caseRevision,
      expectedStepRevision: read.stepRevision, customFields: {}, expectedFieldSchemaHash: metadata.expectedSchemaHash, expectedCustomFieldRevision: metadata.expectedValueHash };
    await expect(cases.update({ ...edit, testPlanId: plan.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await cases.update(edit);
    expect(await second.testCase.findUnique({ where: { id: created.id } })).toMatchObject({ title: "Reviewed scoped case" });
    await expect(cases.importCsv({ projectId: f.project.id, csvText: "Title,Steps\nDenied,Denied" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(fields.reviewSchema({ projectId: f.project.id, schema: defaults.schema })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect((await f.caller()).create({ projectId: f.project.id, name: "Not a plan author" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.identityAccessDraft.update({ where: { organizationId: f.org.id }, data: { revision: 2, configuration: { ...configuration, groups: [] } } });
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 2, expectedPolicyRevision: 1 });
    expect((await fields.get({ projectId: f.project.id, authoringAction: "cases.write" })).canEdit).toBe(false);
    await expect(cases.create({ ...body, projectId: f.project.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(cases.update(edit)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await second.testCase.count({ where: { projectId: f.project.id } })).toBe(1);
    expect(await second.membership.findUnique({ where: { organizationId_userId: { organizationId: f.org.id, userId: f.user.id } } })).toMatchObject({ role: "VIEWER", seatType: "FULL" });
  });
  it("permits private report authoring without sharing authority and denies replay after revocation", async () => {
    const f = await localRulesFixture();
    const configuration = { ...f.configuration, roles: [{ id: "author", name: "Report author", permissions: ["reports.create"] }] };
    await db.identityAccessDraft.update({ where: { organizationId: f.org.id }, data: { configuration } });
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 1, expectedPolicyRevision: 0 });
    const context = { prisma: db, user: await db.user.findUniqueOrThrow({ where: { id: f.user.id }, include: { memberships: true } }),
      authenticatedClerkSubject: f.user.clerkUserId, workspaceOrganizationId: f.org.id, staff: null } as Context;
    const reports = reportSnapshotsRouter.createCaller(context);
    const definition = { audience: "quality" as const, windowDays: 30 as const, sections: ["inventory" as const], summary: "Synthetic review", risks: "", nextActions: "" };
    const save = { projectId: f.project.id, requestId: randomUUID(), name: "Scoped private definition", definition };
    const saved = await reports.saveDefinition(save);
    const capture = { projectId: f.project.id, requestId: randomUUID(), title: "Scoped private capture", definition, definitionId: saved.id };
    const preview = await reports.preview(capture);
    expect(preview.payload.state).toBe("preview");
    expect((await reports.preview(capture)).id).toBe(preview.id);
    await expect(reports.approve({ projectId: f.project.id, previewId: preview.id, approveSharing: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.identityAccessDraft.update({ where: { organizationId: f.org.id }, data: { revision: 2, configuration: { ...configuration, groups: [] } } });
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 2, expectedPolicyRevision: 1 });
    await expect(reports.saveDefinition(save)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reports.preview(capture)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await reports.get({ projectId: f.project.id, id: preview.id })).payload.state).toBe("preview");
    expect(await second.projectReportSnapshot.count({ where: { projectId: f.project.id } })).toBe(1);
  });
  it("denies custom plan creation after a seat downgrade, subject rebind or scope mismatch", async () => {
    const f = await localRulesFixture();
    await publishIdentityDraft(db, f.administrator, { organizationId: f.org.id, expectedDraftRevision: 1, expectedPolicyRevision: 0 });
    const outside = await db.project.create({ data: { organizationId: f.org.id, name: "Outside scope", slug: randomUUID() } });
    await expect((await f.caller()).create({ projectId: outside.id, name: "Denied scope" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.membership.update({ where: { organizationId_userId: { organizationId: f.org.id, userId: f.user.id } }, data: { seatType: "READ_ONLY" } });
    await expect((await f.caller()).create({ projectId: f.project.id, name: "Denied seat" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.membership.update({ where: { organizationId_userId: { organizationId: f.org.id, userId: f.user.id } }, data: { seatType: "FULL" } });
    await db.user.update({ where: { id: f.user.id }, data: { clerkUserId: randomUUID() } });
    await expect((await f.caller()).create({ projectId: f.project.id, name: "Denied rebound" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.testPlan.count({ where: { projectId: { in: [f.project.id, outside.id] } } })).toBe(0);
  });
  it("competing policy publications cannot overwrite the winner from the same reviewed revision", async () => {
    const f = await localRulesFixture();
    const results = await Promise.allSettled([db, second].map(client => publishIdentityDraft(client, f.administrator,
      { organizationId: f.org.id, expectedDraftRevision: 1, expectedPolicyRevision: 0 })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await second.identityAccessPolicy.findUnique({ where: { organizationId: f.org.id } })).toMatchObject({ revision: 1 });
    expect(await second.auditLog.count({ where: { organizationId: f.org.id, entityType: "IdentityAccessPolicy" } })).toBe(1);
  });
});
