// SOURCE ONLY, NOT RUN. Requires fresh owned loopback DB and additive0800
// plus actual compatible legacy/erasure integration validation in morning.
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma, Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import type { Context } from "./trpc.js";
import { manualCaseResultsRouter } from "./routers/manualCaseResults.js";
import {
  previewManualCaseResult,
  recordManualCaseResult,
  recordReviewedManualCaseResult,
} from "./services/manualCaseResults.js";
import {
  manualCaseResultWriteSchema,
  manualCaseExactObservationsSchema,
  type ManualCaseReviewedExactWrite,
} from "./services/manualCaseResultSchema.js";
import {
  admitManualCaseFixtureSource,
  manualCaseFixtureEnabled,
  reviewedManualCaseFixture,
  seedSyntheticUnversionedManualCase,
  seedSyntheticAcceptedLegacyManualCase,
  type ManualCaseFixtureOwnership,
} from "./manual-case-reviewed-test-helper.js";
import {
  eraseManualCaseResultHistory,
  previewManualCaseResultErasure,
} from "./services/manualCaseResultErasure.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
describe.skipIf(!manualCaseFixtureEnabled())(
  "immutable whole-case manual observation history (authored, native NOT RUN)",
  () => {
    const prefix = `manual-case-revision-${Date.now()}-${randomUUID()}`;
    const organizations: Array<{ id: string; slug: string }> = [],
      userIds: string[] = [];
    const ownedErasureReceipts: Array<{
      id: string;
      organizationId: string;
      organizationSlug: string;
      deletedById: string;
      reason: string;
    }> = [];
    let orgId: string,
      otherOrg: string,
      projectId: string,
      actorId: string,
      clerk: string;
    let owner: ReturnType<typeof appRouter.createCaller>,
      api: ReturnType<typeof manualCaseResultsRouter.createCaller>,
      viewer: typeof api,
      switched: typeof api;
    let viewerClerk: string, viewerId: string, switchedClerk: string;
    const callerContext = (
      user: NonNullable<Context["user"]>,
      fixtureDeclaredSubject: string,
    ): Context => ({
      prisma,
      user,
      authenticatedClerkSubject: fixtureDeclaredSubject,
      staff: null,
      securityLogger: { warn: () => {} },
      staffAttempt: {
        tokenConfigured: false,
        tokenPresented: false,
        actorHeaderPresented: false,
      },
    });
    beforeAll(async () => {
      admitManualCaseFixtureSource(); // Exact local route + explicit opt-in BEFORE first DB call.
      const tier = await prisma.planTier.findUniqueOrThrow({
        where: { key: "free" },
      });
      for (const suffix of ["original", "other"]) {
        const slug = `${prefix}-${suffix}`,
          org = await prisma.organization.create({
            data: { slug, name: slug, planTierId: tier.id },
          });
        organizations.push({ id: org.id, slug });
        if (suffix === "original") orgId = org.id;
        else otherOrg = org.id;
      }
      for (const suffix of ["owner", "viewer", "switch"]) {
        const fixtureDeclaredSubject = `${prefix}-${suffix}`;
        const user = await prisma.user.create({
          data: {
            clerkUserId: fixtureDeclaredSubject,
            email: `${prefix}-${suffix}@example.com`,
            name: "Synthetic human recorder",
            memberships: {
              create: {
                organizationId: orgId,
                role: suffix === "viewer" ? "VIEWER" : "OWNER",
                seatType: suffix === "viewer" ? "READ_ONLY" : "FULL",
              },
            },
          },
          include: { memberships: true },
        });
        userIds.push(user.id);
        const caller = manualCaseResultsRouter.createCaller(
          callerContext(user, fixtureDeclaredSubject),
        );
        if (suffix === "owner") {
          owner = appRouter.createCaller(
            callerContext(user, fixtureDeclaredSubject),
          );
          api = caller;
          actorId = user.id;
          clerk = fixtureDeclaredSubject;
        } else if (suffix === "viewer") {
          viewer = caller;
          viewerClerk = fixtureDeclaredSubject;
          viewerId = user.id;
        } else {
          switched = caller;
          switchedClerk = fixtureDeclaredSubject;
        }
      }
      await prisma.membership.create({
        data: {
          organizationId: otherOrg,
          userId: actorId,
          role: "OWNER",
          seatType: "FULL",
        },
      });
      projectId = (
        await owner.project.create({ organizationId: orgId, name: prefix })
      ).id;
    });
    afterAll(async () => {
      // Retain rows, failed evidence and explicitly created deletion receipts.
      // No broad cleanup, organization erasure, user or log deletion in teardown.
      await prisma.$disconnect();
    });
    function ownership(read: {
      projectId: string;
      testRunId: string;
      testCaseId: string;
      expectedScope: {
        projectId: string;
        organizationId: string;
        clerkActorId: string;
      };
    }): ManualCaseFixtureOwnership {
      const organization = organizations.find(
        (value) => value.id === read.expectedScope.organizationId,
      );
      if (!organization || !userIds.includes(actorId))
        throw Error("Exact synthetic fixture owner missing");
      return {
        prefix,
        organizationId: organization.id,
        organizationSlug: organization.slug,
        projectId: read.projectId,
        actorId,
        clerkActorId: clerk,
        testRunId: read.testRunId,
        testCaseId: read.testCaseId,
      };
    }
    const refresh = (read: Parameters<typeof reviewedManualCaseFixture>[1]) =>
      reviewedManualCaseFixture(api, read, actorId);
    const history = (f: Awaited<ReturnType<typeof refresh>>, limit = 10) =>
      api.historyReviewed({
        ...f.reviewedRead,
        readRequestId: randomUUID(),
        limit,
      });
    async function fixture(legacy = false) {
      const c = await owner.testCases.create({
        projectId,
        title: `${prefix} case`,
        testType: "FUNCTIONAL",
        given: ["Given"],
        when: ["When"],
        then: ["Then"],
      });
      const run = await owner.manualExecution.start({
        projectId,
        testCaseIds: [c.id],
        idempotencyKey: randomUUID(),
      });
      const read = {
        projectId,
        testRunId: run.testRunId,
        testCaseId: c.id,
        expectedScope: {
          projectId,
          organizationId: orgId,
          clerkActorId: clerk,
        },
      };
      if (legacy)
        await seedSyntheticUnversionedManualCase(prisma, ownership(read), {
          status: "FAIL",
          note: "Exact unversioned note",
          observations: {
            specimen: "",
            hardwareRevision: "",
            firmwareVersion: "",
            environment: "Original environment",
            measurements: [],
          },
        });
      return refresh(read);
    }
    const request = (
      f: Awaited<ReturnType<typeof fixture>>,
      status: "FAIL" | "PASS" | "BLOCKED" | "SKIP" = "FAIL",
    ): ManualCaseReviewedExactWrite => ({
      ...f.read,
      mode: "EXACT",
      expectedNativeActorId: actorId,
      expectedFrozenEvidenceHash: f.preview.frozenEvidenceHash,
      expectedRevisionId: f.preview.currentRevisionId,
      expectedCurrentFingerprint: f.preview.currentFingerprint,
      status,
      note: "Observed revised note",
      observations: { environment: "Reviewed environment" },
      correctionReason: f.preview.current
        ? "A human evidence correction"
        : null,
      idempotencyKey: randomUUID(),
    });
    it("initial native observation creates exactly one immutable revision and stable result without prior-history invention", async () => {
      const f = await fixture(),
        ack = await api.recordReviewed(request(f));
      expect(ack).toMatchObject({
        revisionNumber: 1,
        recovered: false,
        scope: { ...f.read.expectedScope, actorId },
      });
      const page = await history(f);
      expect(page.revisions).toHaveLength(1);
      expect(page.revisions[0]).toMatchObject({
        previousRevisionId: null,
        legacyPrior: null,
        correctionReason: null,
      });
      expect(
        (
          await prisma.testResult.findUniqueOrThrow({
            where: { id: ack.resultId },
          })
        ).status,
      ).toBe("FAIL");
      expect(
        await prisma.manualStepResultRevision.count({
          where: { testRunId: f.read.testRunId },
        }),
      ).toBe(0);
    });
    it("first legacy correction retains exact prior mutable evidence with explicitly unknown recorder/time", async () => {
      const f = await fixture(true),
        before = await prisma.testResult.findFirstOrThrow({
          where: { testRunId: f.read.testRunId, testCaseId: f.read.testCaseId },
        });
      expect(f.preview.tracked).toBe(false);
      await expect(
        api.recordReviewed({ ...request(f), correctionReason: null }),
      ).rejects.toThrow("reason");
      const ack = await api.recordReviewed(request(f)),
        row = await prisma.manualCaseResultRevision.findUniqueOrThrow({
          where: { id: ack.revisionId },
        });
      expect(row.legacyPrior).toEqual({
        basis: "UNVERSIONED_OBSERVATION_CAPTURED_NOW",
        originalRecorder: null,
        originalRecordedAt: null,
        captured: {
          resultId: before.id,
          status: before.status,
          note: before.note,
          observations: before.observations,
        },
      });
      expect(ack.resultId).toBe(before.id);
      expect(row.previousRevisionId).toBeNull();
      expect(row.revisionNumber).toBe(1);
      expect((await history(f)).revisions[0]?.legacyPrior).toMatchObject({
        originalRecordedAt: null,
      });
    });
    it("current-head CAS and reason preserve previous payload and stable native identity", async () => {
      const f = await fixture(),
        first = await api.recordReviewed(request(f)),
        current = await refresh(f.read);
      await expect(
        api.recordReviewed({ ...request(current), correctionReason: null }),
      ).rejects.toThrow("reason");
      const second = await api.recordReviewed({
        ...request(current, "BLOCKED"),
        note: "Literal corrected\nnote",
        correctionReason: "Independent human clarification",
      });
      expect(second.resultId).toBe(first.resultId);
      expect(second.revisionNumber).toBe(2);
      expect(
        (
          await prisma.manualCaseResultRevision.findUniqueOrThrow({
            where: { id: second.revisionId },
          })
        ).previousRevisionId,
      ).toBe(first.revisionId);
      expect(
        (
          await prisma.manualCaseResultRevision.findUniqueOrThrow({
            where: { id: first.revisionId },
          })
        ).note,
      ).toBe("Observed revised note");
      await expect(
        api.recordReviewed({
          ...request(current),
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
    it("identical concurrent/lost response retry returns one actor-bound receipt even after completion", async () => {
      const f = await fixture(),
        input = request(f),
        outcomes = await Promise.allSettled([
          api.recordReviewed(input),
          api.recordReviewed(input),
        ]);
      const accepted = outcomes.flatMap((outcome) =>
        outcome.status === "fulfilled" ? [outcome.value] : [],
      );
      expect(accepted.length).toBeGreaterThanOrEqual(1);
      for (const outcome of outcomes)
        if (outcome.status === "rejected")
          expect(outcome.reason).toMatchObject({ code: "CONFLICT" });
      const a = accepted[0]!;
      expect(accepted.every((ack) => ack.revisionId === a.revisionId)).toBe(
        true,
      );
      // Native serialization may refuse a racing transaction. No service auto-
      // retry is claimed: explicit SAME input/UUID recovery proves one receipt.
      expect(await api.recordReviewed(input)).toMatchObject({
        revisionId: a.revisionId,
        recovered: true,
      });
      await owner.manualExecution.complete({ testRunId: f.read.testRunId });
      expect((await api.recordReviewed(input)).revisionId).toBe(a.revisionId);
      expect(
        await prisma.manualCaseResultRevision.count({
          where: { testRunId: f.read.testRunId },
        }),
      ).toBe(1);
      await expect(
        api.recordReviewed({ ...input, note: "Different reviewed text" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
    it("retired legacy writer refuses before and after tracking; native immutable projection also refuses overwrite", async () => {
      const f = await fixture(true);
      const retired = {
        testRunId: f.read.testRunId,
        testCaseId: f.read.testCaseId,
        status: "PASS" as const,
        note: "Unsafe legacy overwrite",
      };
      await expect(
        owner.manualExecution.recordResult(retired),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      const ack = await api.recordReviewed(request(f));
      await expect(
        owner.manualExecution.recordResult(retired),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(
        prisma.manualCaseResultRevision.update({
          where: { id: ack.revisionId },
          data: { note: "Forbidden revision rewrite" },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.testResult.update({
          where: { id: ack.resultId },
          data: { note: "No stored revision backs this" },
        }),
      ).rejects.toThrow();
      expect(
        (
          await prisma.testResult.findUniqueOrThrow({
            where: { id: ack.resultId },
          })
        ).note,
      ).toBe("Observed revised note");
    });
    it("Viewer can read scoped history only; changed transport actor and fresh seat/suspension fail before receipt replay", async () => {
      const f = await fixture(),
        input = request(f);
      await api.recordReviewed(input);
      const viewerRead = {
        ...f.read,
        expectedScope: { ...f.read.expectedScope, clerkActorId: viewerClerk },
      };
      expect(
        (
          await viewer.historyReviewed({
            ...viewerRead,
            expectedNativeActorId: viewerId,
            readRequestId: randomUUID(),
          })
        ).readContext.canRecover,
      ).toBe(false);
      await expect(
        viewer.recordReviewed({
          ...input,
          expectedScope: viewerRead.expectedScope,
          expectedNativeActorId: viewerId,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        switched.previewReviewed(f.reviewedRead),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      // Historical adapter transport/native actor mismatch remains an OLD-wire
      // assertion, not accidentally a strict new parser failure.
      const {
        mode: _mode,
        expectedNativeActorId: _native,
        expectedFrozenEvidenceHash: _frozen,
        ...oldWire
      } = input;
      await expect(
        recordManualCaseResult(
          prisma,
          { id: actorId, clerkUserId: switchedClerk },
          manualCaseResultWriteSchema.parse(oldWire),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await prisma.membership.update({
        where: {
          organizationId_userId: { organizationId: orgId, userId: actorId },
        },
        data: { seatType: "READ_ONLY" },
      });
      try {
        await expect(api.recordReviewed(input)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      } finally {
        await prisma.membership.update({
          where: {
            organizationId_userId: { organizationId: orgId, userId: actorId },
          },
          data: { seatType: "FULL" },
        });
      }
      await prisma.organization.update({
        where: { id: orgId },
        data: { suspendedAt: new Date() },
      });
      try {
        await expect(history(f)).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await prisma.organization.update({
          where: { id: orgId },
          data: { suspendedAt: null },
        });
      }
    });
    it("owner in both organizations cannot reparent tracked evidence and erasure refuses foreign-original tuples", async () => {
      const f = await fixture(),
        input = request(f);
      await api.recordReviewed(input);
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: otherOrg },
      });
      try {
        await expect(api.previewReviewed(f.reviewedRead)).rejects.toMatchObject(
          { code: "FORBIDDEN" },
        );
        await expect(api.recordReviewed(input)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        const rebound = {
          ...f.read,
          expectedScope: { ...f.read.expectedScope, organizationId: otherOrg },
        };
        await expect(
          api.historyReviewed({
            ...rebound,
            expectedNativeActorId: actorId,
            readRequestId: randomUUID(),
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(
          (
            await prisma.$transaction((tx) =>
              previewManualCaseResultErasure(tx, orgId),
            )
          ).blocked,
        ).toBe(true);
        await expect(
          prisma.$transaction((tx) => eraseManualCaseResultHistory(tx, orgId)),
        ).rejects.toThrow("reparented");
      } finally {
        await prisma.project.update({
          where: { id: projectId },
          data: { organizationId: orgId },
        });
      }
      expect((await api.recordReviewed(input)).recovered).toBe(true);
    });
    it("refuses imported CI, step-derived and duplicate native projections rather than silently merging evidence", async () => {
      const f = await fixture();
      await prisma.testRun.update({
        where: { id: f.read.testRunId },
        data: { ciProvider: "synthetic-ci" },
      });
      try {
        await expect(api.previewReviewed(f.reviewedRead)).rejects.toThrow(
          "native manual",
        );
      } finally {
        await prisma.testRun.update({
          where: { id: f.read.testRunId },
          data: { ciProvider: "manual" },
        });
      }
      await prisma.testResult.createMany({
        data: [1, 2].map(() => ({
          testRunId: f.read.testRunId,
          testCaseId: f.read.testCaseId,
          status: "FAIL" as const,
        })),
      });
      await expect(api.previewReviewed(f.reviewedRead)).rejects.toThrow(
        "Duplicate",
      );
      const c = await owner.testCases.create({
        projectId,
        title: `${prefix} step-only case`,
        testType: "FUNCTIONAL",
        steps: [
          {
            action: "Synthetic action",
            expectedResult: "Synthetic expected result",
          },
        ],
      });
      const run = await owner.manualExecution.start({
        projectId,
        testCaseIds: [c.id],
        idempotencyKey: randomUUID(),
      });
      await owner.manualExecution.recordStepResult({
        testRunId: run.testRunId,
        testCaseId: c.id,
        stepIndex: 0,
        status: "FAIL",
        expectedRevisionId: null,
        idempotencyKey: randomUUID(),
        evidenceAttachmentIds: [],
      });
      const step = await refresh({
        ...f.read,
        testRunId: run.testRunId,
        testCaseId: c.id,
      });
      expect(step.preview.canWrite).toBe(false);
      await expect(api.recordReviewed(request(step))).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
    it("out-of-limit readings and already-executed prerequisites cannot be reinterpreted as Pass", async () => {
      const f = await fixture();
      await expect(
        api.recordReviewed({
          ...request(f, "PASS"),
          observations: {
            measurements: [
              {
                name: "Synthetic",
                unit: "units",
                value: 2,
                lowerLimit: 0,
                upperLimit: 1,
                instrument: "Synthetic",
              },
            ],
          },
        }),
      ).rejects.toThrow("limits");
      expect(
        await prisma.manualCaseResultRevision.count({
          where: { testRunId: f.read.testRunId },
        }),
      ).toBe(0);
      const cases = await Promise.all(
        ["Prerequisite", "Dependent"].map((title) =>
          owner.testCases.create({
            projectId,
            title: `${prefix} ${title}`,
            testType: "FUNCTIONAL",
            given: ["Given"],
            when: ["When"],
            then: ["Then"],
          }),
        ),
      );
      await prisma.testCasePrerequisite.create({
        data: {
          projectId,
          dependentId: cases[1]!.id,
          prerequisiteId: cases[0]!.id,
          createdById: actorId,
        },
      });
      const run = await owner.manualExecution.start({
        projectId,
        testCaseIds: [cases[1]!.id],
        idempotencyKey: randomUUID(),
      });
      const read = {
        ...f.read,
        testRunId: run.testRunId,
        testCaseId: cases[0]!.id,
      };
      await api.recordReviewed(request(await refresh(read), "PASS"));
      await api.recordReviewed(
        request(await refresh({ ...read, testCaseId: cases[1]!.id }), "PASS"),
      );
      await expect(
        api.recordReviewed({
          ...request(await refresh(read), "FAIL"),
          correctionReason: "A prerequisite correction",
        }),
      ).rejects.toThrow("dependent");
    });
    it("deferred full consistency prevents orphaned/half-projected revisions while exact owned erasure remains possible", async () => {
      const f = await fixture(),
        ack = await api.recordReviewed(request(f));
      await expect(
        prisma.$transaction((tx) =>
          tx.manualCaseResultHead.delete({
            where: {
              testRunId_testCaseId: {
                testRunId: f.read.testRunId,
                testCaseId: f.read.testCaseId,
              },
            },
          }),
        ),
      ).rejects.toThrow();
      expect(
        await prisma.manualCaseResultRevision.count({
          where: { id: ack.revisionId },
        }),
      ).toBe(1);
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.manualCaseResultHead.delete({
            where: {
              testRunId_testCaseId: {
                testRunId: f.read.testRunId,
                testCaseId: f.read.testCaseId,
              },
            },
          });
          await tx.manualCaseResultRevision.deleteMany({
            where: {
              testRunId: f.read.testRunId,
              testCaseId: f.read.testCaseId,
            },
          });
        }),
      ).rejects.toThrow(); // Native result and original organization remain: no history pruning.
      expect(
        await prisma.testResult.count({ where: { id: ack.resultId } }),
      ).toBe(1);
      expect(
        await prisma.manualCaseResultRevision.count({
          where: { id: ack.revisionId },
        }),
      ).toBe(1);
      const previous = await prisma.manualCaseResultRevision.findUniqueOrThrow({
        where: { id: ack.revisionId },
      });
      await expect(
        prisma.$transaction((tx) =>
          tx.manualCaseResultRevision.create({
            data: {
              organizationId: orgId,
              projectId,
              testRunId: f.read.testRunId,
              testCaseId: f.read.testCaseId,
              testResultId: ack.resultId,
              revisionNumber: 2,
              status: previous.status,
              note: previous.note,
              observations: previous.observations as Prisma.InputJsonValue,
              correctionReason: "Authored synthetic half-projection diagnostic",
              actorId,
              actorClerkUserId: clerk,
              actorLabel: previous.actorLabel,
              previousRevisionId: ack.revisionId,
              idempotencyKey: randomUUID(),
              requestHash: "a".repeat(64),
              payloadBytes: previous.payloadBytes + 2048,
            },
          }),
        ),
      ).rejects.toThrow();
      // No teardown erasure. A separate explicit destructive fixture preserves
      // the owned erasure scenario; neither has been executed.
      await expect(
        previewManualCaseResult(
          prisma,
          { id: actorId, clerkUserId: clerk },
          {
            ...f.read,
            expectedScope: {
              ...f.read.expectedScope,
              projectId: "foreign-project",
            },
          },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const raw = await prisma.testResult.findUniqueOrThrow({
        where: { id: ack.resultId },
      });
      expect(raw.observations).not.toEqual(Prisma.DbNull);
    });
    it.skipIf(!manualCaseFixtureEnabled(process.env, true))(
      "full explicitly owned original-organization erasure removes heads/tips/native evidence in the same transaction (separate destructive opt-in)",
      async () => {
        admitManualCaseFixtureSource(process.env, true); // Separate named destructive admission BEFORE this scenario's DB calls.
        // This is NOT standalone pruning and requires root-reviewed actual hook integration.
        const tier = await prisma.planTier.findUniqueOrThrow({
          where: { key: "free" },
        });
        const slug = `${prefix}-full-erasure`,
          org = await prisma.organization.create({
            data: { slug, name: slug, planTierId: tier.id },
          });
        organizations.push({ id: org.id, slug });
        await prisma.membership.create({
          data: {
            organizationId: org.id,
            userId: actorId,
            role: "OWNER",
            seatType: "FULL",
          },
        });
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: actorId },
          include: { memberships: true },
        });
        const native = appRouter.createCaller(callerContext(user, clerk)),
          fresh = manualCaseResultsRouter.createCaller(
            callerContext(user, clerk),
          );
        const p = await native.project.create({
          organizationId: org.id,
          name: slug,
        });
        const c = await native.testCases.create({
          projectId: p.id,
          title: `${prefix} erasure case`,
          testType: "FUNCTIONAL",
          given: ["Given"],
          when: ["When"],
          then: ["Then"],
        });
        const r = await native.manualExecution.start({
          projectId: p.id,
          testCaseIds: [c.id],
          idempotencyKey: randomUUID(),
        });
        const read = {
          projectId: p.id,
          testRunId: r.testRunId,
          testCaseId: c.id,
          expectedScope: {
            projectId: p.id,
            organizationId: org.id,
            clerkActorId: clerk,
          },
        };
        const f = await reviewedManualCaseFixture(fresh, read, actorId),
          first = await fresh.recordReviewed({
            ...request(f),
            note: "Owned erasure observation",
            observations: {},
          });
        const reason =
          "Owned synthetic whole-case history full-erasure fixture";
        // Exact scenario ownership immediately before the actual erasure route.
        const admitted = await prisma.organization.findUniqueOrThrow({
          where: { id: org.id },
          select: { slug: true },
        });
        expect(admitted.slug).toBe(slug);
        expect(slug.startsWith(`${prefix}-`)).toBe(true);
        expect(
          organizations.some(
            (value) => value.id === org.id && value.slug === slug,
          ),
        ).toBe(true);
        expect(userIds.includes(actorId)).toBe(true);
        const log = await hardDeleteOrganization(
          prisma,
          org.id,
          actorId,
          reason,
        );
        ownedErasureReceipts.push({
          id: log.deletionLogId,
          organizationId: org.id,
          organizationSlug: slug,
          deletedById: actorId,
          reason,
        });
        expect(log.rowCounts.ManualCaseResultHead).toBe(1);
        expect(log.rowCounts.ManualCaseResultRevision).toBe(1);
        expect(await prisma.organization.count({ where: { id: org.id } })).toBe(
          0,
        );
        expect(
          await prisma.testResult.count({ where: { id: first.resultId } }),
        ).toBe(0);
        expect(
          await prisma.manualCaseResultRevision.count({
            where: { id: first.revisionId },
          }),
        ).toBe(0);
        expect(await prisma.organization.count({ where: { id: orgId } })).toBe(
          1,
        );
        expect(
          await prisma.organizationDeletionLog.count({
            where: ownedErasureReceipts[ownedErasureReceipts.length - 1],
          }),
        ).toBe(1); // Retained, not teardown-deleted.
      },
    );
    it("partial first-step observations and direct older head writes cannot coexist with whole-case history", async () => {
      const c = await owner.testCases.create({
        projectId,
        title: `${prefix} mixed observation case`,
        testType: "FUNCTIONAL",
        steps: [
          {
            action: "First synthetic action",
            expectedResult: "First expected outcome",
          },
          {
            action: "Second synthetic action",
            expectedResult: "Second expected outcome",
          },
        ],
      });
      const run = await owner.manualExecution.start({
        projectId,
        testCaseIds: [c.id],
        idempotencyKey: randomUUID(),
      });
      const read = {
        projectId,
        testRunId: run.testRunId,
        testCaseId: c.id,
        expectedScope: {
          projectId,
          organizationId: orgId,
          clerkActorId: clerk,
        },
      };
      const first = await api.recordReviewed(request(await refresh(read)));
      await expect(
        owner.manualExecution.recordStepResult({
          testRunId: run.testRunId,
          testCaseId: c.id,
          stepIndex: 0,
          status: "FAIL",
          expectedRevisionId: null,
          idempotencyKey: randomUUID(),
          evidenceAttachmentIds: [],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      // This deliberately invalid step revision FK must be refused by the BEFORE
      // mode guard first, not accidentally pass solely because of a later FK check.
      const directError =
        await prisma.$executeRaw`INSERT INTO "ManualStepResultHead" ("testRunId","testCaseId","stepIndex","currentRevisionId","revisionCount","currentPayloadBytes")
      VALUES (${run.testRunId},${c.id},0,${first.revisionId},1,2048)`.then(
          () => null,
          (error) => error,
        );
      expect(directError).not.toBeNull();
      expect(JSON.stringify(directError)).toContain(
        "Step observations cannot coexist",
      );
      expect(
        await prisma.manualStepResultHead.count({
          where: { testRunId: run.testRunId, testCaseId: c.id },
        }),
      ).toBe(0);
      expect(
        await prisma.manualCaseResultRevision.count({
          where: { testRunId: run.testRunId, testCaseId: c.id },
        }),
      ).toBe(1);
    });
    it("stored incoming payload metadata includes actual PostgreSQL JSON bytes and per-revision overhead", async () => {
      const f = await fixture(),
        measurements = Array.from({ length: 100 }, (_, i) => ({
          name: `Synthetic reading ${i}`,
          unit: "units",
          value: i,
          lowerLimit: 0,
          upperLimit: 200,
          instrument: "Synthetic instrument",
        }));
      const ack = await api.recordReviewed({
        ...request(f),
        observations: {
          environment: "Synthetic measured environment",
          measurements,
        },
      });
      const [size] = await prisma.$queryRaw<
        Array<{ payloadBytes: number; actual: bigint }>
      >`SELECT "payloadBytes",(octet_length(concat(note,observations::text,"legacyPrior"::text,"actorLabel","correctionReason"))+2048)::bigint AS actual FROM "ManualCaseResultRevision" WHERE id=${ack.revisionId}`;
      expect(size?.payloadBytes).toBe(Number(size!.actual));
      const observations = (await history(f, 1)).revisions[0]?.result
        .observations;
      expect(
        manualCaseExactObservationsSchema.parse(observations).measurements,
      ).toHaveLength(100);
    });
    it("complete erasure inventory exceeding the bounded population refuses before any child delete", async () => {
      // Synthetic metadata injection, NOT a100001-row actual population proof.
      const deletes: string[] = [];
      const tx = {
        $queryRaw: async () => [
          { heads: 1, revisions: 100001, unsupported: 0 },
        ],
        manualCaseResultHead: {
          deleteMany: async () => {
            deletes.push("heads");
            return { count: 1 };
          },
        },
        manualCaseResultRevision: {
          deleteMany: async () => {
            deletes.push("revisions");
            return { count: 0 };
          },
        },
      } as unknown as Prisma.TransactionClient;
      expect(await previewManualCaseResultErasure(tx, orgId)).toMatchObject({
        ManualCaseResultHead: 1,
        ManualCaseResultRevision: 100001,
        overBound: true,
        blocked: true,
      });
      await expect(eraseManualCaseResultHistory(tx, orgId)).rejects.toThrow(
        "complete erasure bound",
      );
      expect(deletes).toEqual([]);
    });
    it("fault-injected cumulative metadata cap refuses new spend-free revisions but preserves exact accepted replay", async () => {
      // Inject only true transaction metadata boundary; this is NOT a claim that
      // a real16MiB population was populated/measured. Actual-volume gate remains.
      const f = await fixture(),
        oldPreview = await api.preview(f.read);
      // Explicit accepted historical v1 seed, using the ORIGINAL parsed wire and
      // hash. This does not claim a retired production writer ran today.
      const input = manualCaseResultWriteSchema.parse({
        ...f.read,
        expectedRevisionId: null,
        expectedCurrentFingerprint: oldPreview.currentFingerprint,
        status: "FAIL",
        note: "Historical accepted v1 note",
        observations: { environment: "Historical environment" },
        correctionReason: null,
        idempotencyKey: randomUUID(),
      });
      const original = await seedSyntheticAcceptedLegacyManualCase(
        prisma,
        ownership(f.read),
        input,
      );
      const guarded = new Proxy(prisma, {
        get(target, key) {
          if (key !== "$transaction") return Reflect.get(target, key);
          return (
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options: {
              maxWait?: number;
              timeout?: number;
              isolationLevel?: Prisma.TransactionIsolationLevel;
            },
          ) =>
            target.$transaction(
              (tx) =>
                callback(
                  new Proxy(tx, {
                    get(transaction, property) {
                      if (property !== "$queryRaw")
                        return Reflect.get(transaction, property);
                      return (...args: unknown[]) => {
                        const text = Array.isArray(args[0])
                          ? args[0].join("")
                          : "";
                        if (
                          text.includes(
                            'FROM "ManualCaseResultRevision" WHERE "testRunId"=',
                          ) &&
                          text.includes("2048")
                        )
                          return Promise.resolve([{ count: 10000, bytes: 0n }]);
                        return Reflect.apply(
                          transaction.$queryRaw,
                          transaction,
                          args,
                        );
                      };
                    },
                  }),
                ),
              options,
            );
        },
      });
      const actor = { id: actorId, clerkUserId: clerk };
      const recovered = await recordManualCaseResult(guarded, actor, input);
      expect(recovered).toMatchObject({
        revisionId: original.revisionId,
        resultId: original.resultId,
        requestHash: original.requestHash,
        idempotencyKey: input.idempotencyKey,
        recovered: true,
        scope: { ...input.expectedScope, actorId },
      });
      expect(recovered).not.toHaveProperty("mode"); // Legacy ACK shape remains unchanged.
      const next = request(await refresh(f.read));
      await expect(
        recordReviewedManualCaseResult(guarded, actor, next),
      ).rejects.toThrow("cumulative");
      expect(
        await prisma.manualCaseResultRevision.count({
          where: { testRunId: f.read.testRunId },
        }),
      ).toBe(1);
    });
  },
);
