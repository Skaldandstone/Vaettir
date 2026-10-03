import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated =
  url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");

describe.skipIf(!isolated)(
  "mixed-version manual step database write guards",
  () => {
    let owner: ReturnType<typeof appRouter.createCaller>;
    let projectId: string;
    beforeAll(async () => {
      const key = `step-write-guard-${randomUUID()}`;
      const tier = await prisma.planTier.findUniqueOrThrow({
        where: { key: "free" },
      });
      const org = await prisma.organization.create({
        data: { name: key, slug: key, planTierId: tier.id },
      });
      const user = await prisma.user.create({
        data: {
          email: `${key}@example.invalid`,
          clerkUserId: key,
          name: "Synthetic owner",
          memberships: {
            create: { organizationId: org.id, role: "OWNER", seatType: "FULL" },
          },
        },
        include: { memberships: true },
      });
      owner = appRouter.createCaller({ prisma, user });
      projectId = (
        await owner.project.create({
          organizationId: org.id,
          name: "Synthetic guard project",
        })
      ).id;
    });
    async function procedure(steps = 2) {
      const c = await owner.testCases.create({
        projectId,
        title: "Synthetic procedure",
        testType: "FUNCTIONAL",
        steps: Array.from({ length: steps }, (_, i) => ({
          action: `Action ${i}`,
          expectedResult: `Expected ${i}`,
        })),
      });
      const r = await owner.manualExecution.start({
        projectId,
        testCaseIds: [c.id],
      });
      return { testRunId: r.testRunId, testCaseId: c.id };
    }
    function step(
      scope: { testRunId: string; testCaseId: string },
      stepIndex = 0,
      status: "PASS" | "FAIL" | "BLOCKED" | "SKIP" = "PASS",
    ) {
      return {
        ...scope,
        stepIndex,
        status,
        expectedRevisionId: null,
        idempotencyKey: randomUUID(),
        evidenceAttachmentIds: [],
      };
    }
    // API33's database write shape, intentionally bypassing the current router's
    // head check. The independent rehearsal additionally uses its generated client.
    function legacyWrite(
      scope: { testRunId: string; testCaseId: string },
      action: "create" | "update" | "delete" | "finalize",
    ) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "TestRun" WHERE id = ${scope.testRunId} FOR UPDATE`;
        if (action === "finalize")
          return tx.testRun.update({
            where: { id: scope.testRunId },
            data: { status: "PARTIAL", finishedAt: new Date() },
          });
        const existing = await tx.testResult.findFirst({ where: scope });
        if (action === "create")
          return tx.testResult.create({
            data: { ...scope, status: "PASS", note: "Legacy overwrite" },
          });
        if (!existing) throw new Error("Synthetic expected result missing");
        if (action === "delete")
          return tx.testResult.delete({ where: { id: existing.id } });
        return tx.testResult.update({
          where: { id: existing.id },
          data: { status: "PASS", note: "Legacy overwrite" },
        });
      });
    }
    async function denied(write: Promise<unknown>, message: string) {
      await expect(write).rejects.toThrow(message);
    }
    it("blocks old result insert after partial steps and preserves partial failure on old finalization", async () => {
      const scope = await procedure();
      await owner.manualExecution.recordStepResult(step(scope, 0, "FAIL"));
      await denied(legacyWrite(scope, "create"), "executed per step");
      await denied(legacyWrite(scope, "finalize"), "step outcomes");
      expect(await prisma.testResult.count({ where: scope })).toBe(0);
      expect(
        (
          await prisma.testRun.findUniqueOrThrow({
            where: { id: scope.testRunId },
          })
        ).status,
      ).toBe("RUNNING");
      expect(
        (await owner.manualExecution.complete({ testRunId: scope.testRunId }))
          .status,
      ).toBe("FAILED");
    });
    it("blocks old updates/deletes and identity moves without losing derived verdicts or history", async () => {
      const scope = await procedure(1);
      const saved = await owner.manualExecution.recordStepResult(
        step(scope, 0, "FAIL"),
      );
      await denied(legacyWrite(scope, "update"), "executed per step");
      await denied(legacyWrite(scope, "delete"), "executed per step");
      const result = await prisma.testResult.findFirstOrThrow({ where: scope });
      const other = await procedure(1);
      await denied(
        prisma.testResult.update({
          where: { id: result.id },
          data: { testRunId: other.testRunId },
        }),
        "executed per step",
      );
      expect(
        (
          await prisma.testResult.findUniqueOrThrow({
            where: { id: result.id },
          })
        ).status,
      ).toBe("FAIL");
      expect(
        await prisma.manualStepResultRevision.count({
          where: { id: saved.revisionId },
        }),
      ).toBe(1);
    });
    it("allows current all-status projections, reviewed corrections, durable retries and truthful finalization", async () => {
      for (const status of ["PASS", "FAIL", "BLOCKED", "SKIP"] as const) {
        const scope = await procedure(1),
          request = step(scope, 0, status);
        const saved = await owner.manualExecution.recordStepResult(request);
        expect(saved.caseStatus).toBe(status);
        expect(await owner.manualExecution.recordStepResult(request)).toEqual(
          saved,
        );
        const correction = {
          ...step(scope),
          expectedRevisionId: saved.revisionId,
          correctionReason: "Synthetic reviewed correction",
        };
        const revised =
          await owner.manualExecution.recordStepResult(correction);
        expect(revised.caseStatus).toBe("PASS");
        expect(
          (await owner.manualExecution.complete({ testRunId: scope.testRunId }))
            .status,
        ).toBe("PASSED");
        expect(
          await owner.manualExecution.recordStepResult(correction),
        ).toEqual(revised);
        expect(
          await prisma.manualStepResultRevision.count({
            where: { testRunId: scope.testRunId },
          }),
        ).toBe(2);
      }
    });
    it("leaves legacy and CI results mutable and unrelated finalization unchanged", async () => {
      for (const ciProvider of ["manual", "synthetic-ci"]) {
        const scope = await procedure();
        if (ciProvider !== "manual")
          await prisma.testRun.update({
            where: { id: scope.testRunId },
            data: { ciProvider },
          });
        await legacyWrite(scope, "create");
        await legacyWrite(scope, "update");
        await legacyWrite(scope, "delete");
        await legacyWrite(scope, "finalize");
        expect(await prisma.testResult.count({ where: scope })).toBe(0);
        expect(
          (
            await prisma.testRun.findUniqueOrThrow({
              where: { id: scope.testRunId },
            })
          ).status,
        ).toBe("PARTIAL");
      }
    });
    it("serializes competing first step and API33-style first case verdict; only one mode wins", async () => {
      for (let i = 0; i < 4; i++) {
        const scope = await procedure();
        const outcomes = await Promise.allSettled([
          owner.manualExecution.recordStepResult(step(scope)),
          legacyWrite(scope, "create"),
        ]);
        expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(
          1,
        );
        const heads = await prisma.manualStepResultHead.count({ where: scope });
        const cases = await prisma.testResult.count({ where: scope });
        expect(heads + cases).toBe(1);
        if (heads) expect(cases).toBe(0);
      }
    });
    it("propagates original projection SQL failures and recovers the same receipt after rollback without leaking selectors", async () => {
      const scope = await procedure(1),
        request = step(scope, 0, "FAIL");
      const faultName = `step_guard_fault_${randomUUID().replaceAll("-", "")}`;
      // Local synthetic fault targets only this generated case, never another suite.
      expect(scope.testCaseId).toMatch(/^[a-z0-9]+$/);
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION ${faultName}() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW."testCaseId" = '${scope.testCaseId}' THEN RAISE EXCEPTION 'Synthetic projection failure' USING ERRCODE = '23514'; END IF; RETURN NEW; END; $$`,
      );
      try {
        await prisma.$executeRawUnsafe(
          `CREATE TRIGGER ${faultName} BEFORE INSERT OR UPDATE ON "TestResult" FOR EACH ROW EXECUTE FUNCTION ${faultName}()`,
        );
        await expect(
          owner.manualExecution.recordStepResult(request),
        ).rejects.toThrow("Synthetic projection failure");
        expect(
          await prisma.manualStepResultRevision.count({
            where: { testRunId: scope.testRunId },
          }),
        ).toBe(0);
        expect(await prisma.manualStepResultHead.count({ where: scope })).toBe(
          0,
        );
      } finally {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS ${faultName} ON "TestResult"`,
        );
        await prisma.$executeRawUnsafe(`DROP FUNCTION ${faultName}()`);
      }
      const recovered = await owner.manualExecution.recordStepResult(request);
      expect(recovered.caseStatus).toBe("FAIL");
      expect(await owner.manualExecution.recordStepResult(request)).toEqual(
        recovered,
      );
      await denied(legacyWrite(scope, "update"), "executed per step");
      expect(
        await prisma.manualStepResultRevision.count({
          where: { testRunId: scope.testRunId },
        }),
      ).toBe(1);
    });

    it("propagates original finalization SQL errors, retains the active run and clears local selectors on rollback", async () => {
      const scope = await procedure();
      await owner.manualExecution.recordStepResult(step(scope, 0, "BLOCKED"));
      const faultName = `step_guard_fault_${randomUUID().replaceAll("-", "")}`;
      expect(scope.testRunId).toMatch(/^[a-z0-9]+$/);
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION ${faultName}() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${scope.testRunId}' AND NEW.status <> 'RUNNING' THEN RAISE EXCEPTION 'Synthetic finalization failure' USING ERRCODE = '23514'; END IF; RETURN NEW; END; $$`,
      );
      try {
        await prisma.$executeRawUnsafe(
          `CREATE TRIGGER ${faultName} BEFORE UPDATE ON "TestRun" FOR EACH ROW EXECUTE FUNCTION ${faultName}()`,
        );
        await expect(
          owner.manualExecution.complete({ testRunId: scope.testRunId }),
        ).rejects.toThrow("Synthetic finalization failure");
        expect(
          (
            await prisma.testRun.findUniqueOrThrow({
              where: { id: scope.testRunId },
            })
          ).status,
        ).toBe("RUNNING");
      } finally {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS ${faultName} ON "TestRun"`,
        );
        await prisma.$executeRawUnsafe(`DROP FUNCTION ${faultName}()`);
      }
      await denied(legacyWrite(scope, "finalize"), "step outcomes");
      expect(
        (await owner.manualExecution.complete({ testRunId: scope.testRunId }))
          .status,
      ).toBe("FAILED");
    });

    it("transaction-local selectors cannot leak to pooled sessions or authorize other scopes", async () => {
      const a = await procedure(),
        b = await procedure();
      await owner.manualExecution.recordStepResult(step(a));
      await owner.manualExecution.recordStepResult(step(b));
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`SELECT set_config('vaettir.manual_step_projection', ${JSON.stringify([a.testRunId, a.testCaseId])}, true)`;
      });
      await denied(legacyWrite(a, "create"), "executed per step");
      await denied(
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('vaettir.manual_step_projection', ${JSON.stringify([a.testRunId, a.testCaseId])}, true)`;
          await tx.testResult.create({ data: { ...b, status: "PASS" } });
        }),
        "executed per step",
      );
      await denied(
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('vaettir.manual_step_finalize', ${a.testRunId}, true)`;
          await tx.testRun.update({
            where: { id: b.testRunId },
            data: { status: "PASSED", finishedAt: new Date() },
          });
        }),
        "step outcomes",
      );
    });
  },
);
