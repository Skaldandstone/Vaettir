// SOURCE ONLY, NOT RUN. Requires fresh owned loopback DB and additive0800
// plus actual compatible legacy/erasure integration validation in morning.
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma, Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { manualCaseResultsRouter } from "./routers/manualCaseResults.js";
import { previewManualCaseResult, recordManualCaseResult } from "./services/manualCaseResults.js";
import { eraseManualCaseResultHistory, previewManualCaseResultErasure } from "./services/manualCaseResultErasure.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname) && /test/i.test(url.pathname) && !url.searchParams.has("host");
describe.skipIf(!isolated)("immutable whole-case manual observation history", () => {
  const prefix = `manual-case-revision-${Date.now()}-${randomUUID()}`;
  const organizations: Array<{ id: string; slug: string }> = [], userIds: string[] = [];
  let orgId: string, otherOrg: string, projectId: string, actorId: string, clerk: string;
  let owner: ReturnType<typeof appRouter.createCaller>, api: ReturnType<typeof manualCaseResultsRouter.createCaller>, viewer: typeof api, switched: typeof api;
  let viewerClerk: string, switchedClerk: string;
  beforeAll(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    for (const suffix of ["original", "other"]) {
      const slug = `${prefix}-${suffix}`, org = await prisma.organization.create({ data: { slug, name: slug, planTierId: tier.id } });
      organizations.push({ id: org.id, slug }); if (suffix === "original") orgId = org.id; else otherOrg = org.id;
    }
    for (const suffix of ["owner", "viewer", "switch"]) {
      const user = await prisma.user.create({ data: { clerkUserId: `${prefix}-${suffix}`, email: `${prefix}-${suffix}@example.com`, name: "Synthetic human recorder", memberships: { create: {
        organizationId: orgId, role: suffix === "viewer" ? "VIEWER" : "OWNER", seatType: suffix === "viewer" ? "READ_ONLY" : "FULL" } } }, include: { memberships: true } });
      userIds.push(user.id); const caller = manualCaseResultsRouter.createCaller({ prisma, user });
      if (suffix === "owner") { owner = appRouter.createCaller({ prisma, user }); api = caller; actorId = user.id; clerk = user.clerkUserId; }
      else if (suffix === "viewer") { viewer = caller; viewerClerk = user.clerkUserId; } else { switched = caller; switchedClerk = user.clerkUserId; }
    }
    await prisma.membership.create({ data: { organizationId: otherOrg, userId: actorId, role: "OWNER", seatType: "FULL" } });
    projectId = (await owner.project.create({ organizationId: orgId, name: prefix })).id;
  });
  afterAll(async () => {
    for (const fixture of organizations) {
      if (!actorId) continue;
      const org = await prisma.organization.findUnique({ where: { id: fixture.id }, select: { slug: true } });
      if (!org) continue;
      if (org.slug !== fixture.slug || !org.slug.startsWith(prefix)) throw Error("Refusing unowned history fixture erasure");
      // Requires root-reviewed pending erasure hook in this exact existing FULL
      // tenant transaction. Standalone history-prune commits are deliberately denied.
      await hardDeleteOrganization(prisma, fixture.id, actorId, "Owned synthetic manual-case history fixture erasure");
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds }, clerkUserId: { startsWith: prefix } } });
  });
  async function fixture(legacy = false) {
    const c = await owner.testCases.create({ projectId, title: `${prefix} case`, testType: "FUNCTIONAL", given: ["Given"], when: ["When"], then: ["Then"] });
    const run = await owner.manualExecution.start({ projectId, testCaseIds: [c.id], idempotencyKey: randomUUID() });
    if (legacy) await owner.manualExecution.recordResult({ testRunId: run.testRunId, testCaseId: c.id, status: "FAIL", note: "Exact unversioned note", observations: { environment: "Original environment" } });
    const read = { projectId, testRunId: run.testRunId, testCaseId: c.id, expectedScope: { projectId, organizationId: orgId, clerkActorId: clerk } };
    return { read, preview: await api.preview(read) };
  }
  const request = (f: Awaited<ReturnType<typeof fixture>>, status: "FAIL" | "PASS" | "BLOCKED" | "SKIP" = "FAIL") => ({ ...f.read,
    expectedRevisionId: f.preview.currentRevisionId, expectedCurrentFingerprint: f.preview.currentFingerprint, status, note: "Observed revised note", observations: { environment: "Reviewed environment" },
    correctionReason: f.preview.current ? "A human evidence correction" : null, idempotencyKey: randomUUID() });
  it("initial native observation creates exactly one immutable revision and stable result without prior-history invention", async () => {
    const f = await fixture(), ack = await api.record(request(f));
    expect(ack).toMatchObject({ revisionNumber: 1, recovered: false, scope: { ...f.read.expectedScope, actorId } });
    const page = await api.history({ ...f.read, limit: 10 });
    expect(page.revisions).toHaveLength(1); expect(page.revisions[0]).toMatchObject({ previousRevisionId: null, legacyPrior: null, correctionReason: null });
    expect((await prisma.testResult.findUniqueOrThrow({ where: { id: ack.resultId } })).status).toBe("FAIL");
    expect(await prisma.manualStepResultRevision.count({ where: { testRunId: f.read.testRunId } })).toBe(0);
  });
  it("first legacy correction retains exact prior mutable evidence with explicitly unknown recorder/time", async () => {
    const f = await fixture(true), before = await prisma.testResult.findFirstOrThrow({ where: { testRunId: f.read.testRunId, testCaseId: f.read.testCaseId } });
    expect(f.preview.tracked).toBe(false);
    await expect(api.record({ ...request(f), correctionReason: null })).rejects.toThrow("reason");
    const ack = await api.record(request(f)), row = await prisma.manualCaseResultRevision.findUniqueOrThrow({ where: { id: ack.revisionId } });
    expect(row.legacyPrior).toEqual({ basis: "UNVERSIONED_OBSERVATION_CAPTURED_NOW", originalRecorder: null, originalRecordedAt: null,
      captured: { resultId: before.id, status: before.status, note: before.note, observations: before.observations } });
    expect(ack.resultId).toBe(before.id); expect(row.previousRevisionId).toBeNull(); expect(row.revisionNumber).toBe(1);
    expect((await api.history({ ...f.read, limit: 10 })).revisions[0]?.legacyPrior?.originalRecordedAt).toBeNull();
  });
  it("current-head CAS and reason preserve previous payload and stable native identity", async () => {
    const f = await fixture(), first = await api.record(request(f)), current = { ...f, preview: await api.preview(f.read) };
    await expect(api.record({ ...request(current), correctionReason: null })).rejects.toThrow("reason");
    const second = await api.record({ ...request(current, "BLOCKED"), note: "Literal corrected\nnote", correctionReason: "Independent human clarification" });
    expect(second.resultId).toBe(first.resultId); expect(second.revisionNumber).toBe(2);
    expect((await prisma.manualCaseResultRevision.findUniqueOrThrow({ where: { id: second.revisionId } })).previousRevisionId).toBe(first.revisionId);
    expect((await prisma.manualCaseResultRevision.findUniqueOrThrow({ where: { id: first.revisionId } })).note).toBe("Observed revised note");
    await expect(api.record({ ...request(current), idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("identical concurrent/lost response retry returns one actor-bound receipt even after completion", async () => {
    const f = await fixture(), input = request(f), [a, b] = await Promise.all([api.record(input), api.record(input)]);
    expect(a.revisionId).toBe(b.revisionId); expect([a.recovered, b.recovered].sort()).toEqual([false, true]);
    await owner.manualExecution.complete({ testRunId: f.read.testRunId });
    expect((await api.record(input)).revisionId).toBe(a.revisionId);
    expect(await prisma.manualCaseResultRevision.count({ where: { testRunId: f.read.testRunId } })).toBe(1);
    await expect(api.record({ ...input, note: "Different reviewed text" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("legacy writer works before tracking but cannot overwrite immutable projection afterward", async () => {
    const f = await fixture(true), ack = await api.record(request(f));
    await expect(owner.manualExecution.recordResult({ testRunId: f.read.testRunId, testCaseId: f.read.testCaseId, status: "PASS", note: "Unsafe legacy overwrite" })).rejects.toThrow();
    await expect(prisma.manualCaseResultRevision.update({ where: { id: ack.revisionId }, data: { note: "Forbidden revision rewrite" } })).rejects.toThrow();
    await expect(prisma.testResult.update({ where: { id: ack.resultId }, data: { note: "No stored revision backs this" } })).rejects.toThrow();
    expect((await prisma.testResult.findUniqueOrThrow({ where: { id: ack.resultId } })).note).toBe("Observed revised note");
  });
  it("Viewer can read scoped history only; changed transport actor and fresh seat/suspension fail before receipt replay", async () => {
    const f = await fixture(), input = request(f); await api.record(input);
    const viewerRead = { ...f.read, expectedScope: { ...f.read.expectedScope, clerkActorId: viewerClerk } };
    expect((await viewer.history(viewerRead)).canWrite).toBe(false);
    await expect(viewer.record({ ...input, expectedScope: viewerRead.expectedScope })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(switched.preview(f.read)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordManualCaseResult(prisma, { id: actorId, clerkUserId: switchedClerk }, input as Parameters<typeof recordManualCaseResult>[2])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: actorId } }, data: { seatType: "READ_ONLY" } });
    try { await expect(api.record(input)).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: actorId } }, data: { seatType: "FULL" } }); }
    await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: new Date() } });
    try { await expect(api.history(f.read)).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: null } }); }
  });
  it("owner in both organizations cannot reparent tracked evidence and erasure refuses foreign-original tuples", async () => {
    const f = await fixture(), input = request(f); await api.record(input);
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: otherOrg } });
    try {
      await expect(api.preview(f.read)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(api.record(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
      const rebound = { ...f.read, expectedScope: { ...f.read.expectedScope, organizationId: otherOrg } };
      await expect(api.history(rebound)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await prisma.$transaction(tx => previewManualCaseResultErasure(tx, orgId))).blocked).toBe(true);
      await expect(prisma.$transaction(tx => eraseManualCaseResultHistory(tx, orgId))).rejects.toThrow("reparented");
    } finally { await prisma.project.update({ where: { id: projectId }, data: { organizationId: orgId } }); }
    expect((await api.record(input)).recovered).toBe(true);
  });
  it("refuses imported CI, step-derived and duplicate native projections rather than silently merging evidence", async () => {
    const f = await fixture();
    await prisma.testRun.update({ where: { id: f.read.testRunId }, data: { ciProvider: "synthetic-ci" } });
    try { await expect(api.preview(f.read)).rejects.toThrow("native manual"); }
    finally { await prisma.testRun.update({ where: { id: f.read.testRunId }, data: { ciProvider: "manual" } }); }
    await prisma.testResult.createMany({ data: [1, 2].map(() => ({ testRunId: f.read.testRunId, testCaseId: f.read.testCaseId, status: "FAIL" as const })) });
    await expect(api.preview(f.read)).rejects.toThrow("Duplicate");
    const c = await owner.testCases.create({ projectId, title: "Owned synthetic step-only case", testType: "FUNCTIONAL", steps: [{ action: "Synthetic action", expectedResult: "Synthetic expected result" }] });
    const run = await owner.manualExecution.start({ projectId, testCaseIds: [c.id], idempotencyKey: randomUUID() });
    await owner.manualExecution.recordStepResult({ testRunId: run.testRunId, testCaseId: c.id, stepIndex: 0, status: "FAIL", expectedRevisionId: null, idempotencyKey: randomUUID(), evidenceAttachmentIds: [] });
    await expect(api.preview({ ...f.read, testRunId: run.testRunId, testCaseId: c.id })).rejects.toThrow("step revisions");
  });
  it("out-of-limit readings and already-executed prerequisites cannot be reinterpreted as Pass", async () => {
    const f = await fixture();
    await expect(api.record({ ...request(f, "PASS"), observations: { measurements: [{ name: "Synthetic", unit: "units", value: 2, lowerLimit: 0, upperLimit: 1, instrument: "Synthetic" }] } })).rejects.toThrow("limits");
    expect(await prisma.manualCaseResultRevision.count({ where: { testRunId: f.read.testRunId } })).toBe(0);
    const cases = await Promise.all(["Prerequisite", "Dependent"].map(title => owner.testCases.create({ projectId, title: `Owned synthetic ${title}`, testType: "FUNCTIONAL", given: ["Given"], when: ["When"], then: ["Then"] })));
    await prisma.testCasePrerequisite.create({ data: { projectId, dependentId: cases[1]!.id, prerequisiteId: cases[0]!.id, createdById: actorId } });
    const run = await owner.manualExecution.start({ projectId, testCaseIds: [cases[1]!.id], idempotencyKey: randomUUID() });
    const read = { ...f.read, testRunId: run.testRunId, testCaseId: cases[0]!.id };
    await api.record(request({ read, preview: await api.preview(read) }, "PASS"));
    await owner.manualExecution.recordResult({ testRunId: run.testRunId, testCaseId: cases[1]!.id, status: "PASS" });
    await expect(api.record({ ...request({ read, preview: await api.preview(read) }, "FAIL"), correctionReason: "A prerequisite correction" })).rejects.toThrow("dependent");
  });
  it("deferred full consistency prevents orphaned/half-projected revisions while exact owned erasure remains possible", async () => {
    const f = await fixture(), ack = await api.record(request(f));
    await expect(prisma.$transaction(tx => tx.manualCaseResultHead.delete({ where: { testRunId_testCaseId: { testRunId: f.read.testRunId, testCaseId: f.read.testCaseId } } }))).rejects.toThrow();
    expect(await prisma.manualCaseResultRevision.count({ where: { id: ack.revisionId } })).toBe(1);
    await expect(prisma.$transaction(async tx => {
      await tx.manualCaseResultHead.delete({ where: { testRunId_testCaseId: { testRunId: f.read.testRunId, testCaseId: f.read.testCaseId } } });
      await tx.manualCaseResultRevision.deleteMany({ where: { testRunId: f.read.testRunId, testCaseId: f.read.testCaseId } });
    })).rejects.toThrow(); // Native result and original organization remain: no history pruning.
    expect(await prisma.testResult.count({ where: { id: ack.resultId } })).toBe(1);
    expect(await prisma.manualCaseResultRevision.count({ where: { id: ack.revisionId } })).toBe(1);
    const previous = await prisma.manualCaseResultRevision.findUniqueOrThrow({ where: { id: ack.revisionId } });
    await expect(prisma.$transaction(tx => tx.manualCaseResultRevision.create({ data: { organizationId: orgId, projectId, testRunId: f.read.testRunId, testCaseId: f.read.testCaseId,
      testResultId: ack.resultId, revisionNumber: 2, status: previous.status, note: previous.note, observations: previous.observations as Prisma.InputJsonValue,
      correctionReason: "Authored synthetic half-projection diagnostic", actorId, actorClerkUserId: clerk, actorLabel: previous.actorLabel, previousRevisionId: ack.revisionId,
      idempotencyKey: randomUUID(), requestHash: "a".repeat(64), payloadBytes: previous.payloadBytes + 2048 } }))).rejects.toThrow();
    // Exact owned org erasure (all heads -> descending tips -> native result) occurs only in guarded afterAll; never invoked tonight.
    await expect(previewManualCaseResult(prisma, { id: actorId, clerkUserId: clerk }, { ...f.read, expectedScope: { ...f.read.expectedScope, projectId: "foreign-project" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const raw = await prisma.testResult.findUniqueOrThrow({ where: { id: ack.resultId } });
    expect(raw.observations).not.toEqual(Prisma.DbNull);
  });
  it("full explicitly owned original-organization erasure removes heads/tips/native evidence in the same transaction", async () => {
    // This is NOT standalone pruning and requires root-reviewed actual hook integration.
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const slug = `${prefix}-full-erasure`, org = await prisma.organization.create({ data: { slug, name: slug, planTierId: tier.id } });
    organizations.push({ id: org.id, slug });
    await prisma.membership.create({ data: { organizationId: org.id, userId: actorId, role: "OWNER", seatType: "FULL" } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: actorId }, include: { memberships: true } });
    const native = appRouter.createCaller({ prisma, user }), fresh = manualCaseResultsRouter.createCaller({ prisma, user });
    const p = await native.project.create({ organizationId: org.id, name: slug });
    const c = await native.testCases.create({ projectId: p.id, title: "Owned erasure case", testType: "FUNCTIONAL", given: ["Given"], when: ["When"], then: ["Then"] });
    const r = await native.manualExecution.start({ projectId: p.id, testCaseIds: [c.id], idempotencyKey: randomUUID() });
    const read = { projectId: p.id, testRunId: r.testRunId, testCaseId: c.id, expectedScope: { projectId: p.id, organizationId: org.id, clerkActorId: clerk } };
    const preview = await fresh.preview(read), first = await fresh.record({ ...read, expectedRevisionId: null, expectedCurrentFingerprint: preview.currentFingerprint,
      status: "FAIL", note: "Owned erasure observation", observations: {}, correctionReason: null, idempotencyKey: randomUUID() });
    const log = await hardDeleteOrganization(prisma, org.id, actorId, "Owned synthetic whole-case history full-erasure fixture");
    expect(log.rowCounts.ManualCaseResultHead).toBe(1); expect(log.rowCounts.ManualCaseResultRevision).toBe(1);
    expect(await prisma.organization.count({ where: { id: org.id } })).toBe(0);
    expect(await prisma.testResult.count({ where: { id: first.resultId } })).toBe(0);
    expect(await prisma.manualCaseResultRevision.count({ where: { id: first.revisionId } })).toBe(0);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(1);
  });
  it("partial first-step observations and direct older head writes cannot coexist with whole-case history", async () => {
    const c = await owner.testCases.create({ projectId, title: "Owned synthetic mixed observation case", testType: "FUNCTIONAL", steps: [
      { action: "First synthetic action", expectedResult: "First expected outcome" }, { action: "Second synthetic action", expectedResult: "Second expected outcome" },
    ] });
    const run = await owner.manualExecution.start({ projectId, testCaseIds: [c.id], idempotencyKey: randomUUID() });
    const read = { projectId, testRunId: run.testRunId, testCaseId: c.id, expectedScope: { projectId, organizationId: orgId, clerkActorId: clerk } };
    const first = await api.record(request({ read, preview: await api.preview(read) }));
    await expect(owner.manualExecution.recordStepResult({ testRunId: run.testRunId, testCaseId: c.id, stepIndex: 0, status: "FAIL", expectedRevisionId: null, idempotencyKey: randomUUID(), evidenceAttachmentIds: [] })).rejects.toMatchObject({ code: "CONFLICT" });
    // This deliberately invalid step revision FK must be refused by the BEFORE
    // mode guard first, not accidentally pass solely because of a later FK check.
    const directError = await prisma.$executeRaw`INSERT INTO "ManualStepResultHead" ("testRunId","testCaseId","stepIndex","currentRevisionId","revisionCount","currentPayloadBytes")
      VALUES (${run.testRunId},${c.id},0,${first.revisionId},1,2048)`
      .then(() => null, error => error);
    expect(directError).not.toBeNull();
    expect(JSON.stringify(directError)).toContain("Step observations cannot coexist");
    expect(await prisma.manualStepResultHead.count({ where: { testRunId: run.testRunId, testCaseId: c.id } })).toBe(0);
    expect(await prisma.manualCaseResultRevision.count({ where: { testRunId: run.testRunId, testCaseId: c.id } })).toBe(1);
  });
  it("stored incoming payload metadata includes actual PostgreSQL JSON bytes and per-revision overhead", async () => {
    const f = await fixture(), measurements = Array.from({ length: 100 }, (_, i) => ({ name: `Synthetic reading ${i}`, unit: "units", value: i, lowerLimit: 0, upperLimit: 200, instrument: "Synthetic instrument" }));
    const ack = await api.record({ ...request(f), observations: { environment: "Synthetic measured environment", measurements } });
    const [size] = await prisma.$queryRaw<Array<{ payloadBytes: number; actual: bigint }>>`SELECT "payloadBytes",(octet_length(concat(note,observations::text,"legacyPrior"::text,"actorLabel","correctionReason"))+2048)::bigint AS actual FROM "ManualCaseResultRevision" WHERE id=${ack.revisionId}`;
    expect(size?.payloadBytes).toBe(Number(size!.actual));
    expect((await api.history({ ...f.read, limit: 1 })).revisions[0]?.result.observations.measurements).toHaveLength(100);
  });
  it("complete erasure inventory exceeding the bounded population refuses before any child delete", async () => {
    // Synthetic metadata injection, NOT a100001-row actual population proof.
    const deletes: string[] = [];
    const tx = { $queryRaw: async () => [{ heads: 1, revisions: 100001, unsupported: 0 }],
      manualCaseResultHead: { deleteMany: async () => { deletes.push("heads"); return { count: 1 }; } },
      manualCaseResultRevision: { deleteMany: async () => { deletes.push("revisions"); return { count: 0 }; } },
    } as unknown as Prisma.TransactionClient;
    expect(await previewManualCaseResultErasure(tx, orgId)).toMatchObject({ ManualCaseResultHead: 1, ManualCaseResultRevision: 100001, overBound: true, blocked: true });
    await expect(eraseManualCaseResultHistory(tx, orgId)).rejects.toThrow("complete erasure bound");
    expect(deletes).toEqual([]);
  });
  it("fault-injected cumulative metadata cap refuses new spend-free revisions but preserves exact accepted replay", async () => {
    // Inject only true transaction metadata boundary; this is NOT a claim that
    // a real16MiB population was populated/measured. Actual-volume gate remains.
    const f = await fixture(), input = request(f), original = await api.record(input);
    const guarded = new Proxy(prisma, { get(target, key) {
      if (key !== "$transaction") return Reflect.get(target, key);
      return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: Prisma.TransactionOptions) => target.$transaction(tx => callback(new Proxy(tx, { get(transaction, property) {
        if (property !== "$queryRaw") return Reflect.get(transaction, property);
        return (...args: unknown[]) => {
          const text = Array.isArray(args[0]) ? args[0].join("") : "";
          if (text.includes('FROM "ManualCaseResultRevision" WHERE "testRunId"=') && text.includes("2048")) return Promise.resolve([{ count: 10000, bytes: 0n }]);
          return Reflect.apply(transaction.$queryRaw, transaction, args);
        };
      } })), options);
    } });
    const actor = { id: actorId, clerkUserId: clerk };
    expect((await recordManualCaseResult(guarded, actor, input as Parameters<typeof recordManualCaseResult>[2])).revisionId).toBe(original.revisionId);
    const next = request({ ...f, preview: await api.preview(f.read) });
    await expect(recordManualCaseResult(guarded, actor, next as Parameters<typeof recordManualCaseResult>[2])).rejects.toThrow("cumulative");
    expect(await prisma.manualCaseResultRevision.count({ where: { testRunId: f.read.testRunId } })).toBe(1);
  });
});
