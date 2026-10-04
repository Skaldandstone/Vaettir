// Native receipt failures must roll back native tenant erasure. Disposable only.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, prisma } from "@vaettir/db";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";

describe("organization deletion receipt shares the destructive transaction", () => {
  const tag = `erasure-receipt-${randomUUID()}`;
  const owned = new Map<string, { actorId: string; slug: string }>();

  beforeAll(() => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
  });

  afterAll(async () => {
    for (const [organizationId, owner] of owned) {
      const current = await prisma.organization.findUnique({ where: { id: organizationId } });
      if (current) {
        if (current.slug !== owner.slug || !current.slug.startsWith(tag)) throw Error("Synthetic receipt fixture ownership mismatch");
        await hardDeleteOrganization(prisma, organizationId, owner.actorId, "Owned deletion receipt fixture cleanup");
      }
    }
    // Durable synthetic deletion receipts and their FK actors remain in this
    // disposable DB. No blanket receipt removal or production audit exception.
  });

  async function cohort() {
    const suffix = `${tag}-${randomUUID()}`;
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const actor = await prisma.user.create({ data: { clerkUserId: suffix, email: `${suffix}@example.com` } });
    const org = await prisma.organization.create({ data: { name: suffix, slug: suffix, planTierId: tier.id } });
    owned.set(org.id, { actorId: actor.id, slug: org.slug });
    const membership = await prisma.membership.create({ data: { organizationId: org.id, userId: actor.id, role: "OWNER", seatType: "FULL" } });
    const project = await prisma.project.create({ data: { organizationId: org.id, slug: suffix, name: "Synthetic receipt project", caseKey: `r${randomUUID().replaceAll("-", "").slice(0, 14)}` } });
    const testCase = await prisma.testCase.create({ data: { projectId: project.id, title: "Synthetic original case", testType: "FUNCTIONAL", given: ["Original setup"], when: ["Original action"], then: ["Original outcome"] } });
    const step = await prisma.testCaseStep.create({ data: { testCaseId: testCase.id, order: 0, action: "Original preserved step", expectedResponse: "Original preserved response" } });
    const run = await prisma.testRun.create({ data: { projectId: project.id, ciProvider: "synthetic-offline", commitSha: "synthetic-not-source", branch: "fixture", startedAt: new Date("2020-01-01T00:00:00Z") } });
    const result = await prisma.testResult.create({ data: { testRunId: run.id, testCaseId: testCase.id, status: "FAIL", note: "Original recorded observation", observations: { synthetic: true } } });
    const artifact = await prisma.testResultArtifact.create({ data: { testResultId: result.id, type: "SCREENSHOT", storageUrl: "s3://synthetic-offline/receipt-fixture" } });
    return { actor, org, membership, project, testCase, step, run, result, artifact };
  }

  async function snapshot(fixture: Awaited<ReturnType<typeof cohort>>) {
    return {
      org: await prisma.organization.findUnique({ where: { id: fixture.org.id } }),
      membership: await prisma.membership.findUnique({ where: { id: fixture.membership.id } }),
      project: await prisma.project.findUnique({ where: { id: fixture.project.id } }),
      testCase: await prisma.testCase.findUnique({ where: { id: fixture.testCase.id } }),
      step: await prisma.testCaseStep.findUnique({ where: { id: fixture.step.id } }),
      run: await prisma.testRun.findUnique({ where: { id: fixture.run.id } }),
      result: await prisma.testResult.findUnique({ where: { id: fixture.result.id } }),
      artifact: await prisma.testResultArtifact.findUnique({ where: { id: fixture.artifact.id } }),
    };
  }

  function receiptBoundary(work: (
    tx: Prisma.TransactionClient,
    input: Prisma.OrganizationDeletionLogCreateArgs,
    original: (input: Prisma.OrganizationDeletionLogCreateArgs) => ReturnType<Prisma.TransactionClient["organizationDeletionLog"]["create"]>,
  ) => Promise<unknown>) {
    return new Proxy(prisma, { get(target, key) {
      if (key === "$transaction") return (...args: unknown[]) => {
        const callback = args[0];
        if (typeof callback !== "function") throw Error("Real interactive transaction required");
        const wrapped = (tx: Prisma.TransactionClient) => callback(new Proxy(tx, { get(transaction, member) {
          if (member === "organizationDeletionLog") return new Proxy(transaction.organizationDeletionLog, { get(delegate, operation) {
            if (operation === "create") return (input: Prisma.OrganizationDeletionLogCreateArgs) => work(transaction, input, original => delegate.create(original));
            const value = Reflect.get(delegate, operation);
            return typeof value === "function" ? value.bind(delegate) : value;
          } });
          const value = Reflect.get(transaction, member);
          return typeof value === "function" ? value.bind(transaction) : value;
        } }));
        // Delegate to the installed checked Prisma client, preserving its final
        // deferred-constraint check and the unchanged product timeout/options.
        return Reflect.apply(target.$transaction, target, [wrapped, ...args.slice(1)]);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  }

  it("returns one durable exact native receipt, created after erasure but before commit", async () => {
    const fixture = await cohort();
    let attempts = 0;
    const db = receiptBoundary(async (tx, input, original) => {
      attempts++;
      expect(await tx.organization.count({ where: { id: fixture.org.id } })).toBe(0);
      expect(await tx.testResult.count({ where: { id: fixture.result.id } })).toBe(0);
      expect(input.data).toMatchObject({ organizationId: fixture.org.id, deletedById: fixture.actor.id });
      return original(input);
    });
    const reason = "Owned synthetic durable receipt success";
    const deleted = await hardDeleteOrganization(db, fixture.org.id, fixture.actor.id, reason);
    expect(attempts).toBe(1);
    expect(deleted.rowCounts).toMatchObject({ Project: 1, TestCase: 1, TestCaseStep: 1, TestRun: 1, TestResult: 1, TestResultArtifact: 1, Membership: 1 });
    expect(await snapshot(fixture)).toEqual({ org: null, membership: null, project: null, testCase: null, step: null, run: null, result: null, artifact: null });
    expect(await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: deleted.deletionLogId } })).toMatchObject({ organizationId: fixture.org.id, organizationName: fixture.org.name, organizationSlug: fixture.org.slug, deletedById: fixture.actor.id, reason, rowCounts: deleted.rowCounts });
    expect(await prisma.organizationDeletionLog.count({ where: { organizationId: fixture.org.id } })).toBe(1);
    expect(await prisma.user.count({ where: { id: fixture.actor.id } })).toBe(1);
  });

  it("native missing receipt actor FK failure rolls back all org/project/child deletions", async () => {
    const fixture = await cohort(), before = await snapshot(fixture);
    const missingActorId = `missing-synthetic-${randomUUID()}`;
    expect(await prisma.user.count({ where: { id: missingActorId } })).toBe(0);
    await expect(hardDeleteOrganization(prisma, fixture.org.id, missingActorId, "Owned synthetic missing receipt actor refusal")).rejects.toMatchObject({ code: "P2003" });
    expect(await snapshot(fixture)).toEqual(before);
    expect(await prisma.organizationDeletionLog.count({ where: { organizationId: fixture.org.id } })).toBe(0);
  });

  it("injected real receipt unique-key failure rolls back deletions and preserves foreign receipt", async () => {
    const fixture = await cohort(), before = await snapshot(fixture);
    const foreign = await prisma.organizationDeletionLog.create({ data: { organizationId: `${tag}-foreign-snapshot`, organizationName: "Synthetic historical collision marker", organizationSlug: `${tag}-foreign-snapshot`, deletedById: fixture.actor.id, reason: "Synthetic native receipt failure marker only", rowCounts: {} } });
    let attempts = 0;
    const db = receiptBoundary(async (tx, input, original) => {
      attempts++;
      expect(await tx.organization.count({ where: { id: fixture.org.id } })).toBe(0);
      expect(await tx.testResult.count({ where: { id: fixture.result.id } })).toBe(0);
      // Delegate a real native DB INSERT, forcing its exact primary-key failure.
      return original({ ...input, data: { ...input.data, id: foreign.id } });
    });
    await expect(hardDeleteOrganization(db, fixture.org.id, fixture.actor.id, "Owned synthetic receipt write collision refusal")).rejects.toMatchObject({ code: "P2002" });
    expect(attempts).toBe(1);
    expect(await snapshot(fixture)).toEqual(before);
    expect(await prisma.organizationDeletionLog.count({ where: { organizationId: fixture.org.id } })).toBe(0);
    expect(await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: foreign.id } })).toEqual(foreign);
  });
});
