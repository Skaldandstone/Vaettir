import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Prisma, type PrismaClient, ConstraintCheckedPrismaClient } from "@vaettir/db";
import { createIdentityDirectoryStore, DirectoryObservationConflict, DirectoryObservationUnavailable } from "./identityDirectoryStore.js";
import { publishIdentityDraft, readPublishedLocalAccess } from "./identityAccessPolicy.js";
import { testPlansRouter } from "../routers/testPlans.js";
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
