// Native synthetic scenarios; root reviews and executes on a fresh owned DB.
// The controlled post-COMMIT P2028 models caller acknowledgement loss, not an
// assertion that Prisma always commits after a timeout. No transaction options
// or constraints change, and no database operation returns fabricated success.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, prisma } from "@vaettir/db";
import { hardDeleteOrganization, type OrgHardDeleteResult } from "./services/orgHardDelete.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";

describe("exact native erasure receipt reconciles only its own committed acknowledgement", () => {
  const tag = `erasure-ack-${randomUUID()}`;
  const owned = new Map<string, { actorId: string; slug: string }>();
  const reason = "Reviewed owned synthetic erasure acknowledgement";

  beforeAll(() => { assertOwnedTestDatabase(process.env.DATABASE_URL); });
  afterAll(async () => {
    for (const [organizationId, owner] of owned) {
      const org = await prisma.organization.findUnique({ where: { id: organizationId } });
      if (org) {
        if (org.slug !== owner.slug || !org.slug.startsWith(tag))
          throw Error("Exact owned erasure acknowledgement fixture required");
        await hardDeleteOrganization(prisma, organizationId, owner.actorId, "Owned erasure acknowledgement fixture cleanup");
      }
    }
    // Keep each exact synthetic permanent receipt and its dedicated FK actor
    // in the disposable database; no global receipt/user cleanup or erasure.
  });

  async function cohort() {
    const suffix = `${tag}-${randomUUID()}`;
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const actor = await prisma.user.create({ data: { clerkUserId: suffix, email: `${suffix}@example.com` } });
    const org = await prisma.organization.create({ data: { name: suffix, slug: suffix, planTierId: tier.id } });
    owned.set(org.id, { actorId: actor.id, slug: org.slug });
    const membership = await prisma.membership.create({ data: { organizationId: org.id, userId: actor.id, role: "OWNER", seatType: "FULL" } });
    const project = await prisma.project.create({ data: { organizationId: org.id, slug: suffix, name: "Synthetic native acknowledgement project", caseKey: `a${randomUUID().replaceAll("-", "").slice(0, 14)}` } });
    const testCase = await prisma.testCase.create({ data: {
      projectId: project.id, title: "Original | case", testType: "FUNCTIONAL",
      background: "Independent setup | literal\nsecond condition", given: ["Given | literal\nsecond line"],
      when: ["When | literal"], then: ["Then\nexact outcome"],
    } });
    const step = await prisma.testCaseStep.create({ data: { testCaseId: testCase.id, order: 7,
      action: "Original | action\nsecond line", expectedActionOrData: "Original data",
      expectedResult: "Original result", expectedResponse: "Original | response" } });
    const run = await prisma.testRun.create({ data: { projectId: project.id, ciProvider: "synthetic-offline", branch: "fixture", commitSha: "synthetic-not-source", startedAt: new Date("2020-01-01T00:00:00Z") } });
    const result = await prisma.testResult.create({ data: { testRunId: run.id, testCaseId: testCase.id, status: "FAIL", note: "Original | observation\nsecond line", observations: { synthetic: true } } });
    const artifact = await prisma.testResultArtifact.create({ data: { testResultId: result.id, type: "SCREENSHOT", storageUrl: "s3://synthetic-offline/ack-fixture" } });
    return { actor, org, membership, project, testCase, step, run, result, artifact };
  }
  type Cohort = Awaited<ReturnType<typeof cohort>>;
  async function snapshot(f: Cohort) {
    return {
      org: await prisma.organization.findUnique({ where: { id: f.org.id } }),
      membership: await prisma.membership.findUnique({ where: { id: f.membership.id } }),
      project: await prisma.project.findUnique({ where: { id: f.project.id } }),
      testCase: await prisma.testCase.findUnique({ where: { id: f.testCase.id } }),
      step: await prisma.testCaseStep.findUnique({ where: { id: f.step.id } }),
      run: await prisma.testRun.findUnique({ where: { id: f.run.id } }),
      result: await prisma.testResult.findUnique({ where: { id: f.result.id } }),
      artifact: await prisma.testResultArtifact.findUnique({ where: { id: f.artifact.id } }),
      receipts: await prisma.organizationDeletionLog.findMany({ where: { organizationId: f.org.id }, orderBy: { id: "asc" } }),
    };
  }
  const erased = { org: null, membership: null, project: null, testCase: null, step: null, run: null, result: null, artifact: null };
  function acknowledgementFault() {
    return new Prisma.PrismaClientKnownRequestError("Controlled synthetic COMMIT acknowledgement unavailable", {
      code: "P2028", clientVersion: "5.22.0",
    });
  }

  function faultBoundary(options: {
    rollback?: boolean;
    afterCommit?: (result: OrgHardDeleteResult) => Promise<void>;
    lookupFailure?: boolean;
    receiptCollisionId?: string;
  } = {}) {
    const originalError = acknowledgementFault();
    const state = { attempts: 0, callbackCompleted: false, committed: false, lookupAttempts: 0,
      result: null as OrgHardDeleteResult | null };
    // Only this private proxy changes behavior; the global checked client and
    // every delegate remain installed native methods. No method restoration is
    // needed because nothing on the original client is assigned or replaced.
    const db = new Proxy(prisma, { get(target, key) {
      if (key === "$transaction") return async (...args: unknown[]) => {
        state.attempts++;
        if (state.attempts !== 1 || typeof args[0] !== "function")
          throw Error("Exactly one installed native erasure transaction required");
        const callback = args[0] as (tx: Prisma.TransactionClient) => Promise<OrgHardDeleteResult>;
        const wrapped = async (tx: Prisma.TransactionClient) => {
          const transaction = options.receiptCollisionId ? new Proxy(tx, { get(native, member) {
            if (member === "organizationDeletionLog") return new Proxy(native.organizationDeletionLog, { get(delegate, operation) {
              if (operation === "create") return (input: Prisma.OrganizationDeletionLogCreateArgs) =>
                delegate.create({ ...input, data: { ...input.data, id: options.receiptCollisionId } });
              const value = Reflect.get(delegate, operation);
              return typeof value === "function" ? value.bind(delegate) : value;
            } });
            const value = Reflect.get(native, member);
            return typeof value === "function" ? value.bind(native) : value;
          } }) : tx;
          const result = await callback(transaction);
          state.callbackCompleted = true;
          state.result = result;
          if (options.rollback) throw originalError;
          return result;
        };
        // The checked wrapper still validates deferred constraints before its
        // real COMMIT. Forward all existing options without changing 5000ms.
        const result = await Reflect.apply(target.$transaction, target, [wrapped, ...args.slice(1)]) as OrgHardDeleteResult;
        state.committed = true;
        state.result = result;
        await options.afterCommit?.(result);
        throw originalError;
      };
      if (key === "$queryRaw") return (...args: unknown[]) => {
        // Match only the recovery SELECT's static SQL text, never its bound
        // parameters or unrelated preflight reads. Support raw tagged templates
        // and Prisma.sql without executing a parser or exposing credentials.
        const query = args[0];
        const strings = Array.isArray(query) ? query :
          query && typeof query === "object" && "strings" in query ? query.strings : undefined;
        const text = Array.isArray(strings) && strings.every(value => typeof value === "string")
          ? strings.join("") : "";
        if (state.committed && /\bSELECT\b/i.test(text) && /\bFROM\s+"OrganizationDeletionLog"/i.test(text)) {
          state.lookupAttempts++;
          if (options.lookupFailure) throw Error("Controlled synthetic read-only reconciliation unavailable");
        }
        return Reflect.apply(target.$queryRaw, target, args);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    return { db, state, originalError };
  }
  async function nativeReceipt(f: Cohort, result: OrgHardDeleteResult) {
    const receipt = await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: result.deletionLogId } });
    expect(receipt).toMatchObject({ organizationId: f.org.id, organizationName: f.org.name,
      organizationSlug: f.org.slug, deletedById: f.actor.id, reason, rowCounts: result.rowCounts });
    expect(receipt.rowCounts).toEqual(result.rowCounts);
    expect(await prisma.organizationDeletionLog.count({ where: { organizationId: f.org.id } })).toBe(1);
    expect(await prisma.user.count({ where: { id: f.actor.id } })).toBe(1);
    return receipt;
  }

  it("recovers the exact original result only after a real checked COMMIT then controlled caller error", async () => {
    const f = await cohort(), foreign = await cohort(), foreignBefore = await snapshot(foreign);
    const fault = faultBoundary();
    const outcome = await hardDeleteOrganization(fault.db, f.org.id, f.actor.id, reason).then(
      result => ({ result }), (error: unknown) => ({ error }),
    );
    // Establish the actual committed native state even on the expected pre-fix
    // caller failure, before requiring repaired acknowledgement behavior.
    expect(fault.state).toMatchObject({ attempts: 1, callbackCompleted: true, committed: true });
    const originalResult = fault.state.result!;
    expect(originalResult.rowCounts).toMatchObject({ Project: 1, Membership: 1, TestCase: 1, TestCaseStep: 1, TestRun: 1, TestResult: 1, TestResultArtifact: 1 });
    const receipt = await nativeReceipt(f, originalResult);
    expect(await snapshot(f)).toEqual({ ...erased, receipts: [receipt] });
    expect(await snapshot(foreign)).toEqual(foreignBefore);
    expect.soft(fault.state.lookupAttempts).toBe(1);
    expect(outcome).toEqual({ result: originalResult });
  });

  it("preserves the original fault after callback receipt creation followed by actual rollback", async () => {
    const f = await cohort(), foreign = await cohort();
    const before = await snapshot(f), foreignBefore = await snapshot(foreign);
    const fault = faultBoundary({ rollback: true });
    await expect(hardDeleteOrganization(fault.db, f.org.id, f.actor.id, reason)).rejects.toBe(fault.originalError);
    expect(fault.state).toMatchObject({ attempts: 1, callbackCompleted: true, committed: false });
    expect(fault.state.result?.deletionLogId).toBeTruthy();
    expect(await snapshot(f)).toEqual(before);
    expect(await snapshot(foreign)).toEqual(foreignBefore);
    expect(await prisma.organizationDeletionLog.count({ where: { id: fault.state.result!.deletionLogId } })).toBe(0);
  });

  it("does not recover an unrelated receipt when its own real receipt INSERT fails", async () => {
    const f = await cohort(), foreign = await cohort(), before = await snapshot(f);
    const foreignReceipt = await prisma.organizationDeletionLog.create({ data: {
      organizationId: foreign.org.id, organizationName: foreign.org.name, organizationSlug: foreign.org.slug,
      deletedById: foreign.actor.id, reason: "Owned synthetic unrelated marker, not an erasure", rowCounts: {},
    } });
    const foreignBefore = await snapshot(foreign);
    const fault = faultBoundary({ receiptCollisionId: foreignReceipt.id });
    await expect(hardDeleteOrganization(fault.db, f.org.id, f.actor.id, reason)).rejects.toMatchObject({ code: "P2002" });
    expect(fault.state).toMatchObject({ attempts: 1, callbackCompleted: false, committed: false, result: null });
    expect(await snapshot(f)).toEqual(before);
    expect(await snapshot(foreign)).toEqual(foreignBefore);
  });

  it("keeps the original acknowledgement fault when post-commit read-only lookup fails", async () => {
    const f = await cohort(), foreign = await cohort(), foreignBefore = await snapshot(foreign);
    const fault = faultBoundary({ lookupFailure: true });
    await expect(hardDeleteOrganization(fault.db, f.org.id, f.actor.id, reason)).rejects.toBe(fault.originalError);
    expect(fault.state).toMatchObject({ attempts: 1, callbackCompleted: true, committed: true, lookupAttempts: 1 });
    const receipt = await nativeReceipt(f, fault.state.result!);
    expect(await snapshot(f)).toEqual({ ...erased, receipts: [receipt] });
    expect(await snapshot(foreign)).toEqual(foreignBefore);
  });

  for (const field of ["organizationId", "organizationName", "organizationSlug", "deletedById", "reason", "rowCounts"] as const) {
    it(`refuses a genuinely committed but subsequently mismatched exact receipt ${field}`, async () => {
      const f = await cohort(), foreign = await cohort(), foreignBefore = await snapshot(foreign);
      let original: Awaited<ReturnType<typeof nativeReceipt>> | undefined;
      const fault = faultBoundary({ afterCommit: async (result) => {
        original = await nativeReceipt(f, result);
        const data: Prisma.OrganizationDeletionLogUpdateInput = field === "rowCounts"
          ? { rowCounts: { ...result.rowCounts, TestResult: result.rowCounts.TestResult! + 1 } }
          : field === "deletedById" ? { deletedBy: { connect: { id: foreign.actor.id } } }
          : { [field]: field === "organizationId" ? foreign.org.id : `${original[field]}-changed` };
        await prisma.organizationDeletionLog.update({ where: { id: result.deletionLogId }, data });
      } });
      try {
        await expect(hardDeleteOrganization(fault.db, f.org.id, f.actor.id, reason)).rejects.toBe(fault.originalError);
        expect(fault.state).toMatchObject({ attempts: 1, callbackCompleted: true, committed: true, lookupAttempts: 1 });
        expect(await prisma.organization.count({ where: { id: f.org.id } })).toBe(0);
        expect(await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: fault.state.result!.deletionLogId } })).not.toEqual(original);
      } finally {
        if (original) await prisma.organizationDeletionLog.update({ where: { id: original.id }, data: {
          organizationId: original.organizationId, organizationName: original.organizationName,
          organizationSlug: original.organizationSlug, deletedById: original.deletedById,
          reason: original.reason, rowCounts: original.rowCounts as Prisma.InputJsonValue,
        } });
      }
      expect(await snapshot(foreign)).toEqual(foreignBefore);
      const receipt = await nativeReceipt(f, fault.state.result!);
      expect(await snapshot(f)).toEqual({ ...erased, receipts: [receipt] });
    });
  }

  it("refuses reconciliation if the original native organization is present despite a matching receipt", async () => {
    const f = await cohort(), foreign = await cohort(), foreignBefore = await snapshot(foreign);
    const fault = faultBoundary({ afterCommit: async () => {
      await prisma.organization.create({ data: { id: f.org.id, name: f.org.name, slug: f.org.slug, planTierId: f.org.planTierId } });
    } });
    await expect(hardDeleteOrganization(fault.db, f.org.id, f.actor.id, reason)).rejects.toBe(fault.originalError);
    expect(fault.state).toMatchObject({ attempts: 1, callbackCompleted: true, committed: true, lookupAttempts: 1 });
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).toMatchObject({ id: f.org.id, slug: f.org.slug });
    await nativeReceipt(f, fault.state.result!);
    expect(await snapshot(foreign)).toEqual(foreignBefore);
  });
});
