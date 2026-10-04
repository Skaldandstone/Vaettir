// Native database boundary, not a claim that the API permits mixed execution modes.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

function barrier() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function boundedBarrier(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("Synthetic native lock barrier exceeded 1500ms")), 1500);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
function outcome<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
}

describe("set-based manual-step native result DELETE protection", () => {
  const tag = `step-delete-set-${randomUUID()}`;
  let organizationId: string, projectId: string, actorId: string;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) ||
        !/test/i.test(url.pathname) || url.searchParams.has("host")) throw Error("Owned disposable loopback DB required");
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const actor = await prisma.user.create({ data: { clerkUserId: tag, email: `${tag}@example.invalid`, name: "Synthetic delete guard actor" } });
    actorId = actor.id;
    const organization = await prisma.organization.create({ data: { name: tag, slug: tag, planTierId: tier.id } });
    organizationId = organization.id;
    const project = await prisma.project.create({ data: {
      organizationId, name: tag, slug: tag, caseKey: `e${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    } });
    projectId = project.id;
  });
  afterAll(async () => {
    if (!organizationId) return;
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (organization.slug !== tag) throw Error("Native delete guard fixture ownership mismatch");
    const erased = await hardDeleteOrganization(prisma, organizationId, actorId, "Owned manual-step DELETE guard regression cleanup");
    expect(await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: erased.deletionLogId } })).toMatchObject({ organizationId, deletedById: actorId });
    // The real permanent deletion receipt and its synthetic FK actor remain.
  });
  async function scope(ciProvider = "manual") {
    const testCase = await prisma.testCase.create({ data: { projectId, title: `${tag}-${randomUUID()}`, testType: "FUNCTIONAL" } });
    const run = await prisma.testRun.create({ data: {
      projectId, ciProvider, commitSha: "synthetic-not-source", branch: "synthetic",
      startedAt: new Date("2026-01-01T00:00:00Z"), manualTestCaseIds: ciProvider === "manual" ? [testCase.id] : [],
    } });
    const result = await prisma.testResult.create({ data: { testRunId: run.id, testCaseId: testCase.id, status: "FAIL", note: "Retain exact synthetic native observation" } });
    return { testRunId: run.id, testCaseId: testCase.id, result };
  }
  type Scope = Awaited<ReturnType<typeof scope>>;
  async function firstHead(tx: Prisma.TransactionClient, s: Scope) {
    // Same project-advisory -> run UPDATE lock order as recordManualStepResult.
    // Native adversarial first-head DML intentionally tests mixed-version DB
    // enforcement; the normal API refuses an existing legacy case verdict.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))::text`;
    await tx.$queryRaw`SELECT id FROM "TestRun" WHERE id=${s.testRunId} FOR UPDATE`;
    const revision = await tx.manualStepResultRevision.create({ data: {
      testRunId: s.testRunId, testCaseId: s.testCaseId, stepIndex: 0, revisionNumber: 1,
      status: "FAIL", caseStatusAtRecord: null, actorId, actorName: "Synthetic delete guard actor",
      idempotencyKey: randomUUID(), requestHash: "a".repeat(64), note: "Synthetic native first step",
    } });
    const head = await tx.manualStepResultHead.create({ data: {
      testRunId: s.testRunId, testCaseId: s.testCaseId, stepIndex: 0,
      currentRevisionId: revision.id, revisionCount: 1, currentPayloadBytes: 512,
    } });
    return { revision, head };
  }
  async function boundedStatements(tx: Prisma.TransactionClient) {
    // Reduce statement/lock bounds; never increase product transaction timeout.
    await tx.$executeRaw`SET LOCAL statement_timeout='2000ms'`;
    await tx.$executeRaw`SET LOCAL lock_timeout='1500ms'`;
  }
  async function backendPid(tx: Prisma.TransactionClient) {
    const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    if (!row || !Number.isInteger(row.pid)) throw Error("Expected actual backend PID");
    return row.pid;
  }
  async function waitBlocked(waiter: number, blocker: number) {
    expect(waiter).not.toBe(blocker);
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      // Fresh implicit transactions avoid RepeatableRead pg_stat_activity cache.
      const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT ${blocker}::int=ANY(pg_blocking_pids(${waiter}::int)) AS blocked`;
      if (row?.blocked === true) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw Error("Expected actual independent-session TestRun lock contention");
  }

  it("allows actual CI multirow and zero-row DELETE, including RepeatableRead", async () => {
    const a = await scope("synthetic-ci"), b = await scope("synthetic-ci"), sentinel = await scope("synthetic-ci");
    expect(await prisma.$executeRaw`DELETE FROM "TestResult" WHERE id IN (${a.result.id},${b.result.id})`).toBe(2);
    expect(await prisma.$executeRaw`DELETE FROM "TestResult" WHERE id IN (${a.result.id},${b.result.id})`).toBe(0);
    const rr = await scope("synthetic-ci");
    await prisma.$transaction(async (tx) => {
      expect(await tx.$executeRaw`DELETE FROM "TestResult" WHERE id=${rr.result.id}`).toBe(1);
      expect(await tx.$executeRaw`DELETE FROM "TestResult" WHERE id=${rr.result.id}`).toBe(0);
    }, { isolationLevel: "RepeatableRead" });
    expect(await prisma.testResult.findUniqueOrThrow({ where: { id: sentinel.result.id } })).toEqual(sentinel.result);
  });

  it("refuses manual head DELETE even with the exact transaction-local projection selector", async () => {
    const s = await scope(), saved = await prisma.$transaction((tx) => firstHead(tx, s));
    await expect(prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('vaettir.manual_step_projection',${JSON.stringify([s.testRunId, s.testCaseId])},true)`;
      await tx.$executeRaw`DELETE FROM "TestResult" WHERE id=${s.result.id}`;
    })).rejects.toThrow("executed per step");
    expect(await prisma.testResult.findUniqueOrThrow({ where: { id: s.result.id } })).toEqual(s.result);
    expect(await prisma.manualStepResultHead.findUniqueOrThrow({ where: { testRunId_testCaseId_stepIndex: { testRunId: s.testRunId, testCaseId: s.testCaseId, stepIndex: 0 } } })).toEqual(saved.head);
    expect(await prisma.manualStepResultRevision.findUniqueOrThrow({ where: { id: saved.revision.id } })).toEqual(saved.revision);
  });

  it("rolls an entire mixed CI/manual DELETE statement back without dropping either result", async () => {
    const manual = await scope(), ci = await scope("synthetic-ci");
    await prisma.$transaction((tx) => firstHead(tx, manual));
    await expect(prisma.$executeRaw`DELETE FROM "TestResult" WHERE id IN (${ci.result.id},${manual.result.id})`).rejects.toThrow("executed per step");
    expect(await prisma.testResult.findUniqueOrThrow({ where: { id: ci.result.id } })).toEqual(ci.result);
    expect(await prisma.testResult.findUniqueOrThrow({ where: { id: manual.result.id } })).toEqual(manual.result);
  });

  it("refuses mixed nonempty manual DELETE at both fixed isolation levels even before step activation", async () => {
    for (const isolationLevel of ["RepeatableRead", "Serializable"] as const) {
      const manual = await scope(), ci = await scope("synthetic-ci");
      expect(await prisma.manualStepResultHead.count({ where: { testRunId: manual.testRunId } })).toBe(0);
      await expect(prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('vaettir.manual_step_projection',${JSON.stringify([manual.testRunId, manual.testCaseId])},true)`;
        return tx.$executeRaw`DELETE FROM "TestResult" WHERE id IN (${ci.result.id},${manual.result.id})`;
      }, { isolationLevel })).rejects.toMatchObject({ code: "P2010", meta: { code: "40001" } });
      expect(await prisma.testResult.findUniqueOrThrow({ where: { id: ci.result.id } })).toEqual(ci.result);
      expect(await prisma.testResult.findUniqueOrThrow({ where: { id: manual.result.id } })).toEqual(manual.result);
    }
  });

  it("sees a concurrent committed first head after the DELETE actually waits on the writer run lock", async () => {
    const s = await scope(), ready = barrier(), release = barrier(), deleteReady = barrier();
    let writerPid = 0, deletePid = 0;
    const writer = outcome(prisma.$transaction(async (tx) => {
      await boundedStatements(tx);
      writerPid = await backendPid(tx);
      const saved = await firstHead(tx, s);
      ready.release();
      await boundedBarrier(release.promise);
      return saved;
    }));
    let deletion: ReturnType<typeof outcome<number>> | undefined;
    try {
      await boundedBarrier(ready.promise);
      deletion = outcome(prisma.$transaction(async (tx) => {
        await boundedStatements(tx);
        deletePid = await backendPid(tx);
        deleteReady.release();
        return tx.$executeRaw`DELETE FROM "TestResult" WHERE id=${s.result.id}`;
      }));
      await boundedBarrier(deleteReady.promise);
      await waitBlocked(deletePid, writerPid);
    } finally { release.release(); }
    expect((await writer).status).toBe("fulfilled");
    if (!deletion) throw Error("Expected actual native DELETE transaction");
    const result = await deletion;
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw Error("Native DELETE incorrectly accepted a newly committed manual head");
    expect(result.reason).toMatchObject({ code: "P2010", meta: { code: "23514" } });
    expect(await prisma.testResult.findUniqueOrThrow({ where: { id: s.result.id } })).toEqual(s.result);
    expect(await prisma.manualStepResultHead.count({ where: { testRunId: s.testRunId, testCaseId: s.testCaseId } })).toBe(1);
  });

  it("allows DELETE-first commit before the independent first-head writer acquires the ordered run lock", async () => {
    const s = await scope(), deleted = barrier(), release = barrier(), writerReady = barrier();
    let deletePid = 0, writerPid = 0;
    const deletion = outcome(prisma.$transaction(async (tx) => {
      await boundedStatements(tx);
      deletePid = await backendPid(tx);
      const count = await tx.$executeRaw`DELETE FROM "TestResult" WHERE id=${s.result.id}`;
      deleted.release();
      await boundedBarrier(release.promise);
      return count;
    }));
    let writer: ReturnType<typeof outcome<Awaited<ReturnType<typeof firstHead>>>> | undefined;
    try {
      await boundedBarrier(deleted.promise);
      writer = outcome(prisma.$transaction(async (tx) => {
        await boundedStatements(tx);
        writerPid = await backendPid(tx);
        writerReady.release();
        return firstHead(tx, s);
      }));
      await boundedBarrier(writerReady.promise);
      await waitBlocked(writerPid, deletePid);
    } finally { release.release(); }
    expect(await deletion).toEqual({ status: "fulfilled", value: 1 });
    if (!writer) throw Error("Expected actual independent head writer");
    expect((await writer).status).toBe("fulfilled");
    expect(await prisma.testResult.count({ where: { id: s.result.id } })).toBe(0);
    expect(await prisma.manualStepResultHead.count({ where: { testRunId: s.testRunId, testCaseId: s.testCaseId } })).toBe(1);
  });

  it("refuses a stale RepeatableRead manual DELETE with actual SQLSTATE40001 even if its old snapshot has no head", async () => {
    const s = await scope(), snapshotReady = barrier(), continueDelete = barrier();
    let deletePid = 0, writerPid = 0;
    const deletion = outcome(prisma.$transaction(async (tx) => {
      await boundedStatements(tx);
      deletePid = await backendPid(tx);
      expect(await tx.manualStepResultHead.count({ where: { testRunId: s.testRunId } })).toBe(0);
      snapshotReady.release();
      await boundedBarrier(continueDelete.promise);
      // Mere SELECT FOR UPDATE cannot refresh this fixed snapshot. The new
      // transition guard must explicitly refuse manual DELETE at fixed isolation.
      return tx.$executeRaw`DELETE FROM "TestResult" WHERE id=${s.result.id}`;
    }, { isolationLevel: "RepeatableRead" }));
    try {
      await boundedBarrier(snapshotReady.promise);
      await prisma.$transaction(async (tx) => {
        await boundedStatements(tx);
        writerPid = await backendPid(tx);
        await firstHead(tx, s);
      });
      expect(writerPid).not.toBe(deletePid);
    } finally { continueDelete.release(); }
    const result = await deletion;
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw Error("Stale fixed-snapshot manual DELETE was accepted");
    expect(result.reason).toMatchObject({ code: "P2010", meta: { code: "40001" } });
    expect(await prisma.testResult.findUniqueOrThrow({ where: { id: s.result.id } })).toEqual(s.result);
    expect(await prisma.manualStepResultHead.count({ where: { testRunId: s.testRunId, testCaseId: s.testCaseId } })).toBe(1);
  });
});
