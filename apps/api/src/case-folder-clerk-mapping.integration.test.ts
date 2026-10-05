// Authored native regressions; root executes on a fresh owned disposable DB.
// Stale independently authenticated ctx A versus native Clerk B on the same
// eligible User. This is not freshly authenticated B adopting A's intent.
// Strict reads have no expectedScope field. Scoped writer/replay cases are
// existing refusal controls, not invented read scopes or altered legacy hashes.
// Unaccepted copyWrite is intentionally excluded: its field CAS already binds
// the review actor. Genuine accepted copy replay must still authenticate ctx.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import { qualityProfileHash } from "./services/qualityExperienceProfile.js";

describe("folder reads reviewed moves inverses and accepted copies independently authenticate Clerk", () => {
  const tag = `folder-clerk-${randomUUID()}`;
  let organizationId: string;
  let userA: Prisma.UserGetPayload<{ include: { memberships: true } }>;
  let callerA: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    organizationId = (await prisma.organization.create({
      data: { slug: tag, name: tag, planTierId: tier.id },
    })).id;
    const user = await prisma.user.create({ data: {
      email: `${tag}@example.com`, clerkUserId: `${tag}-authenticated-a`,
      memberships: { create: { organizationId, role: "OWNER", seatType: "FULL" } },
    } });
    userA = await prisma.user.findUniqueOrThrow({
      where: { id: user.id }, include: { memberships: true },
    });
    expect(userA.memberships).toEqual(expect.arrayContaining([
      expect.objectContaining({ organizationId, role: "OWNER", seatType: "FULL" }),
    ]));
    callerA = appRouter.createCaller({ prisma, user: userA });
  });

  afterAll(async () => {
    if (!organizationId || !userA) return;
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (organization.slug !== tag) throw Error("Owned synthetic folder-Clerk organization required");
    const native = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
    if (native.clerkUserId !== userA.clerkUserId)
      throw Error("Original synthetic Clerk mapping must be restored before teardown");
    await hardDeleteOrganization(prisma, organizationId, userA.id, "Owned synthetic folder-Clerk fixture teardown");
    expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: userA.id } })).toBe(1);
    // Retain the native erasure receipt and its dedicated synthetic actor FK.
  });

  const scope = () => ({ organizationId, clerkActorId: userA.clerkUserId });
  const literal = {
    background: "Independent setup | literal\nsecond precondition",
    given: ["Given | literal", "Given\nsecond line"],
    when: ["When | literal"], then: ["Then\nexact outcome"],
    steps: [{ action: "Action | literal\nsecond line", expectedActionOrData: "Data | literal",
      expectedResult: "Result\nexact second line", expectedResponse: "Response | literal" }],
    tags: ["synthetic", "literal|tag"], priority: "HIGH" as const,
    testType: "FUNCTIONAL" as const,
  };

  async function approvedChange(
    projectId: string, action: "CREATE" | "MOVE", toPath: string,
    fromPath?: string, scoped = false,
  ) {
    const review = { projectId, action, toPath, ...(fromPath ? { fromPath } : {}) };
    const preview = await callerA.caseFolders.preview(review);
    expect(preview).toMatchObject({ projectId, ...scope(), action });
    expect(preview.expectedHash).toMatch(/^[a-f0-9]{64}$/);
    return { review, preview, input: {
      ...review, expectedHash: preview.expectedHash, confirmed: true as const,
      requestId: randomUUID(), reason: "Reviewed synthetic exact folder placement",
      ...(scoped ? { expectedScope: scope() } : {}),
    } };
  }

  async function fixture() {
    const project = await callerA.project.create({
      organizationId, name: `${tag}-${randomUUID()}`,
      caseKey: `f${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    });
    const first = await callerA.testCases.create({
      projectId: project.id, ...literal, title: "Synthetic original | first\ncase", suitePath: "Source/Child",
    });
    const second = await callerA.testCases.create({
      projectId: project.id, ...literal, title: "Synthetic original | second", suitePath: "Source/Zeta",
    });
    const sentinel = await callerA.testCases.create({
      projectId: project.id, ...literal, title: "Synthetic untouched | sibling", suitePath: "Retained",
    });
    for (const path of ["Destination", "Source/Empty"]) {
      const change = await approvedChange(project.id, "CREATE", path);
      expect((await callerA.caseFolders.write(change.input)).recovered).toBe(false);
    }
    const tree = await callerA.caseFolders.list({ projectId: project.id });
    expect(tree).toMatchObject({ projectId: project.id, ...scope(), canEdit: true });
    expect(tree.paths).toEqual(expect.arrayContaining([
      "Destination", "Source", "Source/Child", "Source/Zeta", "Source/Empty", "Retained",
    ]));
    expect(tree.folders).toEqual(expect.arrayContaining([expect.objectContaining({ path: "Source/Empty" })]));
    for (const c of [first, second, sentinel]) {
      const saved = await prisma.testCase.findUniqueOrThrow({
        where: { id: c.id }, include: { versions: true, steps: true },
      });
      expect(saved.versions).toHaveLength(1);
      expect(saved).toMatchObject({ ...literal, steps: [expect.objectContaining({ ...literal.steps[0], order: 0 })] });
    }
    return { project, first, second, sentinel, tree };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;

  async function retained(f: Fixture) {
    return {
      project: await prisma.project.findUniqueOrThrow({ where: { id: f.project.id } }),
      folderState: await prisma.caseFolderState.findUnique({ where: { projectId: f.project.id } }),
      folderWrites: await prisma.caseFolderWrite.findMany({ where: { projectId: f.project.id }, orderBy: { id: "asc" } }),
      cases: await prisma.testCase.findMany({
        where: { projectId: f.project.id }, orderBy: { id: "asc" },
        include: {
          steps: { orderBy: [{ order: "asc" }, { id: "asc" }] },
          versions: { orderBy: [{ versionNumber: "asc" }, { id: "asc" }] },
          source: true, dataset: true, prerequisites: { orderBy: { prerequisiteId: "asc" } },
          attachments: { orderBy: { id: "asc" } }, automationDrafts: { orderBy: { id: "asc" } },
          results: { orderBy: { id: "asc" } },
        },
      }),
      audits: await prisma.auditLog.findMany({ where: { projectId: f.project.id }, orderBy: { id: "asc" } }),
      count: await prisma.testCase.count({ where: { projectId: f.project.id } }),
    };
  }

  async function refuseWhileRemapped(f: Fixture, operation: () => Promise<unknown>, label: string) {
    const before = await retained(f);
    const clerkB = `${tag}-native-b-${randomUUID()}`;
    await prisma.user.update({ where: { id: userA.id }, data: { clerkUserId: clerkB } });
    try {
      const native = await prisma.user.findUniqueOrThrow({ where: { id: userA.id }, include: { memberships: true } });
      expect(native).toMatchObject({ id: userA.id, clerkUserId: clerkB });
      expect(native.memberships).toEqual(userA.memberships);
      expect(userA.clerkUserId).not.toBe(native.clerkUserId);
      // Real router caller keeps its original independent authentication ctx.
      // Do not repin scopes/hashes, forge receipts or fake a service outcome.
      const outcome = await operation().then(
        () => ({ accepted: true as const }),
        (error: unknown) => ({ accepted: false as const, error }),
      );
      expect.soft(outcome.accepted, `${label}: stale ctx A must receive FORBIDDEN before private body or replay`).toBe(false);
      if (!outcome.accepted) expect.soft(outcome.error).toMatchObject({ code: "FORBIDDEN" });
      expect.soft(await retained(f), `${label}: full tree identity counters procedures histories and native evidence unchanged`).toEqual(before);
    } finally {
      await prisma.user.update({ where: { id: userA.id }, data: { clerkUserId: userA.clerkUserId } });
    }
  }

  async function move(f: Fixture, scoped = false) {
    const change = await approvedChange(f.project.id, "MOVE", "Destination/Source", "Source", scoped);
    expect(change.preview.caseCount).toBe(2);
    expect(change.preview.cases.map(c => c.id).sort()).toEqual([f.first.id, f.second.id].sort());
    return change;
  }
  async function moved(f: Fixture) {
    const change = await move(f);
    const accepted = await callerA.caseFolders.write(change.input);
    expect(accepted.recovered).toBe(false);
    await exactReceipt(f, change.input, accepted.receiptId, 1, "MOVE");
    const after = await retained(f);
    expect(after.cases.find(c => c.id === f.first.id)?.suitePath).toBe("Destination/Source/Child");
    expect(after.cases.find(c => c.id === f.second.id)?.suitePath).toBe("Destination/Source/Zeta");
    expect(after.cases.find(c => c.id === f.sentinel.id)?.suitePath).toBe("Retained");
    return { change, accepted };
  }
  async function recovery(f: Fixture, originalReceiptId: string, scoped = false) {
    const review = { projectId: f.project.id, originalReceiptId };
    const preview = await callerA.caseFolders.recoveryPreview(review);
    expect(preview).toMatchObject({
      projectId: f.project.id, ...scope(), originalReceiptId, caseCount: 2,
      fromPath: "Destination/Source", toPath: "Source",
    });
    expect(preview.cases.map(c => c.id).sort()).toEqual([f.first.id, f.second.id].sort());
    expect(preview.expectedHash).toMatch(/^[a-f0-9]{64}$/);
    return { review, preview, input: {
      ...review, expectedHash: preview.expectedHash, requestId: randomUUID(),
      confirmed: true as const, reason: "Reviewed inverse of exact retained synthetic MOVE",
      ...(scoped ? { expectedScope: scope() } : {}),
    } };
  }
  async function copy(f: Fixture, scoped = false) {
    const review = { projectId: f.project.id, fromPath: "Source", toPath: "Copied" };
    const preview = await callerA.caseFolders.copyPreview(review);
    expect(preview).toMatchObject({
      projectId: f.project.id, ...scope(), caseCount: 2,
      copyInternalPrerequisites: false, copyParameterDatasets: false, internalPrerequisites: [], datasets: [],
    });
    expect(preview.cases.map(c => c.sourceId).sort()).toEqual([f.first.id, f.second.id].sort());
    expect(preview.destinationPaths).toContain("Copied/Empty");
    for (const c of preview.cases) expect(c.definition).toMatchObject({
      background: literal.background, given: literal.given, when: literal.when, then: literal.then,
      steps: [expect.objectContaining({ ...literal.steps[0], order: 0 })],
    });
    return { review, preview, input: {
      ...review, expectedHash: preview.expectedHash, requestId: randomUUID(),
      confirmed: true as const, reason: "Reviewed exact independent synthetic folder copy",
      ...(scoped ? { expectedScope: scope() } : {}),
    } };
  }
  async function exactReceipt(
    f: Fixture, input: { requestId: string }, receiptId: string, schemaVersion: number, action: string,
  ) {
    const receipt = await prisma.caseFolderWrite.findUniqueOrThrow({ where: {
      projectId_actorId_requestId: { projectId: f.project.id, actorId: userA.id, requestId: input.requestId },
    } });
    expect(receipt).toMatchObject({ id: receiptId, projectId: f.project.id, actorId: userA.id,
      requestId: input.requestId, inputHash: qualityProfileHash(input) });
    expect(receipt.receipt).toMatchObject({ schemaVersion, action, organizationId });
    expect(await prisma.caseFolderWrite.count({ where: { projectId: f.project.id, actorId: userA.id, requestId: input.requestId } })).toBe(1);
    return receipt;
  }

  for (const route of ["list", "preview", "recoveryOptions", "recoveryCatalog", "recoveryPreview", "copyPreview"] as const) {
    it(`${route} withholds genuinely eligible native folder evidence from stale independent ctx A`, async () => {
      const f = await fixture();
      let read: () => Promise<unknown>;
      if (route === "list") read = () => callerA.caseFolders.list({ projectId: f.project.id });
      else if (route === "preview") {
        const change = await move(f);
        read = () => callerA.caseFolders.preview(change.review);
      } else if (route === "copyPreview") {
        const change = await copy(f);
        read = () => callerA.caseFolders.copyPreview(change.review);
      } else {
        const original = await moved(f);
        const inverse = await recovery(f, original.accepted.receiptId);
        const catalog = await callerA.caseFolders.recoveryCatalog({ projectId: f.project.id });
        expect(catalog).toMatchObject({ projectId: f.project.id, ...scope() });
        expect(catalog.items).toEqual(expect.arrayContaining([expect.objectContaining({
          id: original.accepted.receiptId, action: "MOVE", fromPath: "Source", toPath: "Destination/Source",
        })]));
        expect(await callerA.caseFolders.recoveryOptions({ projectId: f.project.id })).toEqual(catalog.items);
        if (route === "recoveryPreview") read = () => callerA.caseFolders.recoveryPreview(inverse.review);
        else if (route === "recoveryOptions") read = () => callerA.caseFolders.recoveryOptions({ projectId: f.project.id });
        else read = () => callerA.caseFolders.recoveryCatalog({ projectId: f.project.id });
      }
      const positive = await read(), before = await retained(f);
      await refuseWhileRemapped(f, read, route);
      expect(await read()).toEqual(positive);
      expect(await retained(f)).toEqual(before);
    });
  }

  for (const scoped of [false, true]) {
    const label = scoped ? "explicit original A scope (existing refusal control)" : "legacy omitted expectedScope";
    it(`unaccepted populated MOVE refuses stale ctx A without changing procedure history: ${label}`, async () => {
      const f = await fixture(), change = await move(f, scoped), before = await retained(f);
      expect(await prisma.caseFolderWrite.count({ where: { projectId: f.project.id, requestId: change.input.requestId } })).toBe(0);
      await refuseWhileRemapped(f, () => callerA.caseFolders.write(change.input), `unaccepted MOVE ${label}`);
      const accepted = await callerA.caseFolders.write(change.input);
      // A refused request is still unaccepted: keep this false, even before fix.
      expect.soft(accepted.recovered).toBe(false);
      await exactReceipt(f, change.input, accepted.receiptId, 1, "MOVE");
      const after = await retained(f);
      expect(after.count).toBe(before.count);
      expect(after.cases.find(c => c.id === f.sentinel.id)).toEqual(before.cases.find(c => c.id === f.sentinel.id));
      expect(await callerA.caseFolders.write(change.input)).toEqual({ ...accepted, recovered: true });
      expect(await retained(f)).toEqual(after);
    });

    it(`unaccepted exact reviewed inverse refuses stale ctx A without changing retained MOVE evidence: ${label}`, async () => {
      const f = await fixture(), original = await moved(f);
      const inverse = await recovery(f, original.accepted.receiptId, scoped);
      const before = await retained(f);
      expect(await prisma.caseFolderWrite.count({ where: { projectId: f.project.id, requestId: inverse.input.requestId } })).toBe(0);
      await refuseWhileRemapped(f, () => callerA.caseFolders.recoveryWrite(inverse.input), `unaccepted inverse ${label}`);
      const accepted = await callerA.caseFolders.recoveryWrite(inverse.input);
      expect.soft(accepted.recovered).toBe(false);
      expect(accepted.destinationPath).toBe("Source");
      await exactReceipt(f, inverse.input, accepted.receiptId, 2, "RESTORE");
      const after = await retained(f);
      expect(after.cases.find(c => c.id === f.first.id)?.suitePath).toBe("Source/Child");
      expect(after.cases.find(c => c.id === f.second.id)?.suitePath).toBe("Source/Zeta");
      expect(after.cases.find(c => c.id === f.sentinel.id)).toEqual(before.cases.find(c => c.id === f.sentinel.id));
      expect(await callerA.caseFolders.recoveryWrite(inverse.input)).toEqual({ ...accepted, recovered: true });
      expect(await retained(f)).toEqual(after);
    });

    for (const route of ["write", "recoveryWrite", "copyWrite"] as const) {
      it(`genuine accepted ${route} exact UUID replay refuses stale ctx A and recovers unchanged under A: ${label}`, async () => {
        const f = await fixture();
        let replay: () => Promise<unknown>;
        let accepted: { recovered: boolean; receiptId: string };
        let receipt: Awaited<ReturnType<typeof exactReceipt>>;
        if (route === "write") {
          const change = await move(f, scoped);
          accepted = await callerA.caseFolders.write(change.input);
          receipt = await exactReceipt(f, change.input, accepted.receiptId, 1, "MOVE");
          replay = () => callerA.caseFolders.write(change.input);
        } else if (route === "recoveryWrite") {
          const original = await moved(f), inverse = await recovery(f, original.accepted.receiptId, scoped);
          accepted = await callerA.caseFolders.recoveryWrite(inverse.input);
          receipt = await exactReceipt(f, inverse.input, accepted.receiptId, 2, "RESTORE");
          replay = () => callerA.caseFolders.recoveryWrite(inverse.input);
        } else {
          const change = await copy(f, scoped);
          const copied = await callerA.caseFolders.copyWrite(change.input);
          accepted = copied;
          expect(copied.copies).toHaveLength(2);
          expect(new Set(copied.copies.map(c => c.caseId)).size).toBe(2);
          for (const c of copied.copies) {
            expect([f.first.id, f.second.id]).toContain(c.sourceId);
            expect([f.first.id, f.second.id, f.sentinel.id]).not.toContain(c.caseId);
            const native = await prisma.testCase.findUniqueOrThrow({ where: { id: c.caseId }, include: {
              steps: { orderBy: { order: "asc" } }, versions: true, dataset: true, prerequisites: true, results: true,
            } });
            expect(native).toMatchObject({ projectId: f.project.id, displayId: c.displayId,
              background: literal.background, given: literal.given, when: literal.when, then: literal.then,
              steps: [expect.objectContaining({ ...literal.steps[0], order: 0 })], dataset: null, prerequisites: [], results: [],
            });
            expect(native.versions).toHaveLength(1);
            expect(native.versions[0]?.versionNumber).toBe(1);
          }
          expect((await callerA.caseFolders.list({ projectId: f.project.id })).paths).toContain("Copied/Empty");
          receipt = await exactReceipt(f, change.input, accepted.receiptId, 3, "COPY");
          replay = () => callerA.caseFolders.copyWrite(change.input);
        }
        expect(accepted.recovered).toBe(false);
        const positive = await replay(), before = await retained(f);
        expect(positive).toEqual({ ...accepted, recovered: true });
        await refuseWhileRemapped(f, replay, `accepted ${route} replay ${label}`);
        expect(await replay()).toEqual(positive);
        expect(await retained(f)).toEqual(before);
        expect(await prisma.caseFolderWrite.findUniqueOrThrow({ where: { id: receipt.id } })).toEqual(receipt);
      });
    }
  }
});
