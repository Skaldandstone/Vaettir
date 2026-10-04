import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, prisma } from "@vaettir/db";
import { createCaseQueriesRouter } from "./routers/caseQueries.js";
import { defaultCaseQuery } from "./services/caseQuerySchema.js";
import { hardDeleteOrganization, previewOrgHardDelete } from "./services/orgHardDelete.js";

// Authored during the source-only night increment. Requires generated client,
// latest additive migrations and a fresh seeded synthetic loopback DB in morning.
const router = createCaseQueriesRouter({ PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(32, 41).toString("base64") });
describe("saved typed queries (disposable synthetic PostgreSQL)", () => {
  let projectId: string, orgId: string, foreignOrg: string, ownerId: string, editorId: string;
  let owner: ReturnType<typeof router.createCaller>, editor: typeof owner, viewer: typeof owner, outsider: typeof owner;
  const orgs: string[] = [], users: string[] = [];
  const ownedOrganizationSlugs = new Map<string, string>();
  const definition = (name = "Synthetic high risk", visibility: "PRIVATE" | "SHARED" = "PRIVATE") => ({
    name, visibility, query: { ...defaultCaseQuery(), groups: [{ match: "all" as const,
      rules: [{ field: "riskScore" as const, operator: "atLeast" as const, value: 60 }] }] },
    columns: ["title", "risk", "suite"] as Array<"title" | "risk" | "suite">,
  });
  const create = (name?: string, visibility?: "PRIVATE" | "SHARED") => ({ operation: "CREATE" as const,
    projectId, requestId: randomUUID(), definition: definition(name, visibility) });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host"))
      throw Error("Unique disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    for (let n = 0; n < 2; n++) {
      const key = `saved-query-${randomUUID()}`;
      const org = await prisma.organization.create({ data: { name: key, slug: key, planTierId: tier.id } });
      orgs.push(org.id);
      ownedOrganizationSlugs.set(org.id, key);
      if (!n) orgId = org.id; else foreignOrg = org.id;
    }
    const project = await prisma.project.create({ data: { organizationId: orgId, name: "Synthetic", slug: randomUUID() } });
    projectId = project.id;
    for (const role of ["OWNER", "EDITOR", "VIEWER", "OUTSIDER"] as const) {
      const user = await prisma.user.create({ data: { email: `saved-${randomUUID()}@example.com`, clerkUserId: randomUUID(),
        memberships: { create: { organizationId: role === "OUTSIDER" ? foreignOrg : orgId,
          role: role === "OUTSIDER" ? "EDITOR" : role, seatType: "FULL" } } }, include: { memberships: true } });
      users.push(user.id);
      const caller = router.createCaller({ prisma, user });
      if (role === "OWNER") { owner = caller; ownerId = user.id; }
      else if (role === "EDITOR") { editor = caller; editorId = user.id; }
      else if (role === "VIEWER") viewer = caller;
      else outsider = caller;
    }
  });
  afterAll(async () => {
    if (orgs.length && (!ownerId || !users.includes(ownerId)))
      throw Error("Initialized owned synthetic actor required before fixture erasure");
    for (const id of orgs) {
      const owned = await prisma.organization.findUniqueOrThrow({ where: { id }, select: { slug: true } });
      if (owned.slug !== ownedOrganizationSlugs.get(id)) throw Error("Owned synthetic saved-query organization mismatch");
      const before = await previewOrgHardDelete(prisma, id);
      const erased = await hardDeleteOrganization(prisma, id, ownerId, "Owned disposable saved-query fixture erasure");
      expect(erased.rowCounts.SavedTypedCaseQuery).toBe(before.rowCounts.SavedTypedCaseQuery);
      expect(erased.rowCounts.SavedTypedCaseQueryWrite).toBe(before.rowCounts.SavedTypedCaseQueryWrite);
      expect(await prisma.savedTypedCaseQuery.count({ where: { organizationId: id } })).toBe(0);
      expect(await prisma.savedTypedCaseQueryWrite.count({ where: { organizationId: id } })).toBe(0);
    }
    // Retain dedicated synthetic users: deletion receipts intentionally retain their actor FK.
    for (const organizationId of orgs)
      expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: ownerId } })).toBe(1);
  });
  it("saves and loads exact typed criteria and ordered columns without changing cases", async () => {
    const input = create();
    const before = await prisma.testCase.count({ where: { projectId } });
    const receipt = await owner.savedWrite(input);
    const loaded = await owner.savedById({ projectId, id: receipt.value.id });
    expect(loaded.value.query).toEqual(input.definition.query);
    expect(loaded.value.columns).toEqual(["title", "risk", "suite"]);
    expect(loaded.value.createdById).toBe(ownerId);
    expect(loaded.value.version).toBe(1);
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(before);
    await expect(editor.savedById({ projectId, id: receipt.value.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await editor.savedList({ projectId })).items.some(v => v.id === receipt.value.id)).toBe(false);
  });
  it("recovers identical create/update/delete responses once and rejects UUID payload reuse", async () => {
    const input = create("Synthetic retry");
    const first = await owner.savedWrite(input);
    expect(await owner.savedWrite(input)).toEqual(first);
    await expect(owner.savedWrite({ ...input, definition: definition("Changed payload") })).rejects.toMatchObject({ code: "CONFLICT" });
    const update = { operation: "UPDATE" as const, projectId, requestId: randomUUID(), id: first.value.id,
      expectedVersion: 1, definition: { ...definition("Renamed retry"), columns: ["suite", "title"] as Array<"suite" | "title"> } };
    const renamed = await owner.savedWrite(update);
    expect(await owner.savedWrite(update)).toEqual(renamed);
    expect(renamed.value.version).toBe(2);
    expect(renamed.value.columns).toEqual(["suite", "title"]);
    const deletion = { operation: "DELETE" as const, projectId, id: first.value.id, expectedVersion: 2, requestId: randomUUID() };
    const deleted = await owner.savedWrite(deletion);
    expect(await owner.savedWrite(deletion)).toEqual(deleted);
    expect(deleted.value.deleted).toBe(true);
    expect(deleted.value.version).toBe(3);
    await expect(owner.savedById({ projectId, id: deleted.value.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.savedTypedCaseQueryWrite.count({ where: { queryId: first.value.id } })).toBe(3);
  });
  it("shares read access but reserves edits for full editors and personal conversion for creator", async () => {
    const shared = await owner.savedWrite(create("Synthetic shared", "SHARED"));
    expect((await viewer.savedById({ projectId, id: shared.value.id })).value.query).toEqual(shared.value.query);
    expect((await viewer.savedList({ projectId })).canWrite).toBe(false);
    await expect(viewer.savedWrite(create("Viewer mutation"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const update = { operation: "UPDATE" as const, projectId, id: shared.value.id, expectedVersion: 1, requestId: randomUUID(),
      definition: definition("Editor rename", "SHARED") };
    const changed = await editor.savedWrite(update);
    expect(changed.value.version).toBe(2);
    expect(changed.value.createdById).toBe(ownerId);
    await expect(editor.savedWrite({ ...update, expectedVersion: 2, requestId: randomUUID(),
      definition: definition("Cannot privatize") })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const personal = await owner.savedWrite({ ...update, expectedVersion: 2, requestId: randomUUID(), definition: definition("Personal again") });
    expect(personal.value.visibility).toBe("PRIVATE");
    await expect(editor.savedWrite(update)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(viewer.savedById({ projectId, id: personal.value.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("concurrent identical requests recover one committed definition and actor receipts cannot be reused", async () => {
    const input = create("Concurrent receipt");
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => owner.savedWrite(input)));
    expect(attempts.some(attempt => attempt.status === "fulfilled")).toBe(true);
    const recovered = await owner.savedWrite(input);
    expect(await owner.savedWrite(input)).toEqual(recovered);
    expect(await prisma.savedTypedCaseQuery.count({ where: { projectId, createdById: ownerId, name: input.definition.name } })).toBe(1);
    expect(await prisma.savedTypedCaseQueryWrite.count({ where: { projectId, actorId: ownerId, requestId: input.requestId } })).toBe(1);
    const otherActor = await editor.savedWrite(input);
    expect(otherActor.value.id).not.toBe(recovered.value.id);
    expect(otherActor.value.createdById).toBe(editorId);
    await expect(editor.savedById({ projectId, id: recovered.value.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rejects stale CAS, foreign tenants and changed editor seats despite cached context", async () => {
    const saved = await editor.savedWrite(create("Editor personal"));
    const update = { operation: "UPDATE" as const, projectId, id: saved.value.id, expectedVersion: 1,
      requestId: randomUUID(), definition: definition("Current edit") };
    await editor.savedWrite(update);
    await expect(editor.savedWrite({ ...update, requestId: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(outsider.savedList({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: editorId } }, data: { seatType: "READ_ONLY" } });
    await expect(editor.savedWrite(update)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await editor.savedById({ projectId, id: saved.value.id })).canEdit).toBe(false);
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: editorId } }, data: { seatType: "FULL" } });
  });
  it("rolls back the definition if its durable receipt cannot be stored", async () => {
    let injections = 0;
    const fault = prisma.$extends({ query: { savedTypedCaseQueryWrite: { async create() {
      injections++; throw Error("Synthetic receipt persistence failure");
    } } } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, include: { memberships: true } });
    const caller = router.createCaller({ prisma: fault as unknown as typeof prisma, user });
    const before = await prisma.savedTypedCaseQuery.count({ where: { projectId } });
    await expect(caller.savedWrite(create("Must rollback"))).rejects.toThrow();
    expect(injections).toBe(1);
    expect(await prisma.savedTypedCaseQuery.count({ where: { projectId } })).toBe(before);
  });
  it("fails closed on unavailable stored criteria instead of dropping unsupported fields", async () => {
    const saved = await owner.savedWrite(create("Unsupported stored query"));
    await prisma.savedTypedCaseQuery.update({ where: { id: saved.value.id },
      data: { definition: { ...defaultCaseQuery(), rawSql: "never execute" } as Prisma.InputJsonValue } });
    await expect(owner.savedById({ projectId, id: saved.value.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("bounds current catalog pages and never includes another actor's personal definition", async () => {
    const bulk = Array.from({ length: 52 }, (_, n) => ({ projectId, organizationId: orgId, createdById: ownerId,
      name: `Page fixture ${String(n).padStart(3, "0")}`, visibility: "SHARED",
      definition: defaultCaseQuery() as Prisma.InputJsonValue, columns: ["title"] as Prisma.InputJsonValue }));
    await prisma.savedTypedCaseQuery.createMany({ data: bulk });
    const first = await viewer.savedList({ projectId, offset: 0 });
    const second = await viewer.savedList({ projectId, offset: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(new Set([...first.items, ...second.items].map(v => v.id)).size).toBe(first.items.length + second.items.length);
    expect([...first.items, ...second.items].every(v => v.visibility === "SHARED")).toBe(true);
    await expect(viewer.savedList({ projectId, offset: 151 })).rejects.toThrow();
  });
  it("rejects suspended organizations and reparented definitions under the original organization", async () => {
    const saved = await owner.savedWrite(create("Original tenant"));
    await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: new Date() } });
    await expect(owner.savedList({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: null } });
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: foreignOrg } });
    await expect(owner.savedById({ projectId, id: saved.value.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.savedById({ projectId, id: saved.value.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: orgId } });
  });
});
