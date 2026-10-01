import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import {
  previewOrgHardDelete,
  hardDeleteOrganization,
} from "./services/orgHardDelete.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated =
  url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");
describe.skipIf(!isolated)(
  "frozen structured step execution with append-only corrections",
  () => {
    let owner: ReturnType<typeof appRouter.createCaller>,
      viewer: typeof owner,
      outsider: typeof owner,
      readonly: typeof owner;
    let projectId: string,
      organizationId: string,
      ownerId: string,
      otherCaseId: string;
    const key = `step-execution-${Date.now()}`;
    beforeAll(async () => {
      const tier = await prisma.planTier.findUniqueOrThrow({
        where: { key: "free" },
      });
      const org = await prisma.organization.create({
        data: { name: key, slug: key, planTierId: tier.id },
      });
      organizationId = org.id;
      const other = await prisma.organization.create({
        data: {
          name: `${key}-other`,
          slug: `${key}-other`,
          planTierId: tier.id,
        },
      });
      async function caller(
        suffix: string,
        organizationId: string,
        role: "OWNER" | "VIEWER" | "EDITOR",
        seatType: "FULL" | "READ_ONLY" = "FULL",
      ) {
        const user = await prisma.user.create({
          data: {
            email: `${key}-${suffix}@example.com`,
            name: `Synthetic ${suffix}`,
            clerkUserId: `${key}-${suffix}`,
            memberships: { create: { organizationId, role, seatType } },
          },
          include: { memberships: true },
        });
        if (suffix === "owner") ownerId = user.id;
        return appRouter.createCaller({ prisma, user });
      }
      owner = await caller("owner", org.id, "OWNER");
      viewer = await caller("viewer", org.id, "VIEWER");
      readonly = await caller("readonly", org.id, "EDITOR", "READ_ONLY");
      outsider = await caller("outside", other.id, "OWNER");
      projectId = (
        await owner.project.create({
          organizationId: org.id,
          name: "Synthetic step project",
        })
      ).id;
      const outsideProject = (
        await outsider.project.create({
          organizationId: other.id,
          name: "Synthetic outside project",
        })
      ).id;
      otherCaseId = (
        await outsider.testCases.create({
          projectId: outsideProject,
          title: "Outside procedure",
          testType: "FUNCTIONAL",
          steps: [{ action: "Outside step" }],
        })
      ).id;
    });
    async function procedure(stepCount = 2) {
      const c = await owner.testCases.create({
        projectId,
        title: "Synthetic frozen procedure",
        testType: "FUNCTIONAL",
        validationDomain: "HIL",
        steps: Array.from({ length: stepCount }, (_, i) => ({
          action: `Synthetic action ${i}`,
          expectedResult: `Synthetic outcome ${i}`,
        })),
      });
      const run = await owner.manualExecution.start({
        projectId,
        testCaseIds: [c.id],
      });
      return { testRunId: run.testRunId, testCaseId: c.id };
    }
    function input(
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
    function current(scope: { testRunId: string; testCaseId: string }) {
      return owner.manualExecution.getForExecution({
        testRunId: scope.testRunId,
      });
    }

    it("records each frozen step, derives a verdict only when complete, and preserves the saved definition", async () => {
      const scope = await procedure();
      const first = await owner.manualExecution.recordStepResult({
        ...input(scope),
        note: "Observed first action",
      });
      expect(first.caseStatus).toBeNull();
      let state = await current(scope);
      expect(state.cases[0]).toMatchObject({
        stepExecutionAvailable: true,
        currentResult: null,
        stepResults: [
          {
            stepIndex: 0,
            revisionCount: 1,
            current: {
              id: first.revisionId,
              status: "PASS",
              actorName: "Synthetic owner",
              note: "Observed first action",
            },
          },
          { stepIndex: 1, current: null },
        ],
      });
      await prisma.testCaseStep.updateMany({
        where: { testCaseId: scope.testCaseId },
        data: { action: "Later human definition" },
      });
      const second = await owner.manualExecution.recordStepResult(
        input(scope, 1),
      );
      expect(second.caseStatus).toBe("PASS");
      state = await current(scope);
      expect(state.cases[0]?.steps[0]?.action).toBe("Synthetic action 0");
      expect(state.cases[0]?.currentResult?.status).toBe("PASS");
      expect(
        (await owner.manualExecution.complete({ testRunId: scope.testRunId }))
          .status,
      ).toBe("PASSED");
    });

    it("does not conceal an observed FAIL/BLOCKED when other steps remain unrecorded", async () => {
      for (const [status, expected] of [
        ["FAIL", "FAILED"],
        ["BLOCKED", "FAILED"],
        ["PASS", "PARTIAL"],
        ["SKIP", "PARTIAL"],
      ] as const) {
        const scope = await procedure();
        await owner.manualExecution.recordStepResult(input(scope, 0, status));
        expect((await current(scope)).cases[0]?.currentResult).toBeNull();
        expect(
          (await owner.manualExecution.complete({ testRunId: scope.testRunId }))
            .status,
        ).toBe(expected);
      }
    });

    it("aggregates FAIL before BLOCKED before SKIP before PASS", async () => {
      for (const [statuses, expected] of [
        [["BLOCKED", "FAIL"], "FAIL"],
        [["SKIP", "BLOCKED"], "BLOCKED"],
        [["PASS", "SKIP"], "SKIP"],
      ] as const) {
        const scope = await procedure();
        await owner.manualExecution.recordStepResult(
          input(scope, 0, statuses[0]),
        );
        expect(
          (
            await owner.manualExecution.recordStepResult(
              input(scope, 1, statuses[1]),
            )
          ).caseStatus,
        ).toBe(expected);
      }
    });

    it("retains justified correction history, rejects stale edits and recovers actor-bound original receipts", async () => {
      const scope = await procedure(1);
      const original = {
        ...input(scope, 0, "FAIL"),
        note: "Original observation",
      };
      const first = await owner.manualExecution.recordStepResult(original);
      const correction = {
        ...input(scope),
        expectedRevisionId: first.revisionId,
        correctionReason: "Operator corrected a mistyped verdict",
        note: "Corrected observation",
      };
      await expect(
        owner.manualExecution.recordStepResult({
          ...correction,
          correctionReason: " ",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const second = await owner.manualExecution.recordStepResult(correction);
      await expect(
        owner.manualExecution.recordStepResult({
          ...correction,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const history = await owner.manualExecution.stepResultHistory({
        ...scope,
        stepIndex: 0,
        limit: 1,
      });
      expect(history.revisions[0]).toMatchObject({
        id: second.revisionId,
        status: "PASS",
        correctionReason: correction.correctionReason,
        previousRevisionId: first.revisionId,
      });
      expect(history.nextCursor).toBe(second.revisionId);
      const old = await owner.manualExecution.stepResultHistory({
        ...scope,
        stepIndex: 0,
        cursor: history.nextCursor!,
        limit: 1,
      });
      expect(old.revisions[0]).toMatchObject({
        id: first.revisionId,
        note: "Original observation",
        status: "FAIL",
        correctionReason: null,
      });
      expect(await owner.manualExecution.recordStepResult(original)).toEqual(
        first,
      );
      await expect(
        owner.manualExecution.recordStepResult({
          ...original,
          note: "Changed payload",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await owner.manualExecution.complete({ testRunId: scope.testRunId });
      expect(await owner.manualExecution.recordStepResult(correction)).toEqual(
        second,
      );
      await expect(
        owner.manualExecution.recordStepResult({
          ...correction,
          idempotencyKey: randomUUID(),
          expectedRevisionId: second.revisionId,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        await prisma.manualStepResultRevision.count({
          where: { testRunId: scope.testRunId },
        }),
      ).toBe(2);
    });

    it("serializes simultaneous retries and lets only one competing correction advance the head", async () => {
      const scope = await procedure(1);
      const firstInput = input(scope);
      const receipts = await Promise.all([
        owner.manualExecution.recordStepResult(firstInput),
        owner.manualExecution.recordStepResult(firstInput),
      ]);
      expect(receipts[0]).toEqual(receipts[1]);
      const corrections = await Promise.allSettled(
        ["FAIL", "BLOCKED"].map((status) =>
          owner.manualExecution.recordStepResult({
            ...input(scope),
            status: status as "FAIL" | "BLOCKED",
            expectedRevisionId: receipts[0]!.revisionId,
            correctionReason: "Synthetic justified correction",
          }),
        ),
      );
      expect(corrections.filter((r) => r.status === "fulfilled")).toHaveLength(
        1,
      );
      expect(corrections.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "CONFLICT" },
      });
      expect(
        await prisma.manualStepResultRevision.count({
          where: { testRunId: scope.testRunId },
        }),
      ).toBe(2);
    });

    it("does not replace case-level results or permit a case-level override after step activation", async () => {
      const existing = await procedure();
      await owner.manualExecution.recordResult({
        ...existing,
        status: "PASS",
        note: "Keep existing verdict",
      });
      await expect(
        owner.manualExecution.recordStepResult(input(existing)),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await current(existing)).cases[0]).toMatchObject({
        stepExecutionAvailable: false,
        currentResult: { status: "PASS", note: "Keep existing verdict" },
      });
      const scoped = await procedure();
      await owner.manualExecution.recordStepResult(input(scoped));
      await expect(
        owner.manualExecution.recordResult({ ...scoped, status: "PASS" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("does not masquerade legacy live or BDD definitions as frozen structured steps", async () => {
      const scope = await procedure();
      const legacy = await prisma.testRun.create({
        data: {
          projectId,
          ciProvider: "manual",
          commitSha: "manual",
          branch: "manual",
          startedAt: new Date(),
          manualTestCaseIds: [scope.testCaseId],
        },
      });
      await expect(
        owner.manualExecution.recordStepResult(
          input({ ...scope, testRunId: legacy.id }),
        ),
      ).rejects.toThrow("frozen structured");
      expect(
        (await owner.manualExecution.getForExecution({ testRunId: legacy.id }))
          .cases[0],
      ).toMatchObject({ stepExecutionAvailable: false, stepResults: [] });
      await expect(
        owner.manualExecution.recordStepResult(input(scope, 2)),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("guards measured PASS and keeps every value with its step revision", async () => {
      const scope = await procedure(1);
      const observations = {
        measurements: [
          {
            name: "Synthetic voltage",
            unit: "V",
            value: 4,
            lowerLimit: 1,
            upperLimit: 3,
            instrument: "Synthetic meter",
          },
        ],
      };
      await expect(
        owner.manualExecution.recordStepResult({
          ...input(scope),
          observations,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await owner.manualExecution.recordStepResult({
        ...input(scope, 0, "FAIL"),
        observations,
      });
      expect(
        (await current(scope)).cases[0]?.stepResults[0]?.current?.observations
          .measurements[0],
      ).toMatchObject(observations.measurements[0]!);
    });

    it("requires passed prerequisites and protects their historical premise after partial dependent execution", async () => {
      const p = await procedure(1),
        d = await procedure(2);
      await prisma.testCasePrerequisite.create({
        data: {
          projectId,
          dependentId: d.testCaseId,
          prerequisiteId: p.testCaseId,
          createdById: ownerId,
        },
      });
      const run = await owner.manualExecution.start({
        projectId,
        testCaseIds: [d.testCaseId],
      });
      const prerequisite = {
          testRunId: run.testRunId,
          testCaseId: p.testCaseId,
        },
        dependent = { testRunId: run.testRunId, testCaseId: d.testCaseId };
      await expect(
        owner.manualExecution.recordStepResult(input(dependent)),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const pass = await owner.manualExecution.recordStepResult(
        input(prerequisite),
      );
      const performed = await owner.manualExecution.recordStepResult(
        input(dependent),
      );
      expect(
        (await current(dependent)).cases.find(
          (c) => c.testCaseId === d.testCaseId,
        )?.currentResult,
      ).toBeNull();
      await expect(
        owner.manualExecution.recordStepResult({
          ...input(prerequisite, 0, "FAIL"),
          expectedRevisionId: pass.revisionId,
          correctionReason: "Attempted correction",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await owner.manualExecution.recordStepResult({
        ...input(dependent, 0, "BLOCKED"),
        expectedRevisionId: performed.revisionId,
        correctionReason: "Later fixture marked blocked",
      });
      await expect(
        owner.manualExecution.recordStepResult({
          ...input(prerequisite, 0, "FAIL"),
          expectedRevisionId: pass.revisionId,
          correctionReason: "Still invalidates historical execution",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("restricts completed evidence to this project and snapshots safe labels without fetching bytes", async () => {
      const scope = await procedure(1);
      const verifiedAt = new Date().toISOString();
      const data = {
        fileName: "Synthetic evidence.txt",
        contentType: "text/plain",
        storageUrl: "s3://synthetic-only/evidence.txt",
        sizeBytes: 24,
        uploadedById: ownerId,
      };
      const confirmed = await prisma.testCaseAttachment.create({
        data: {
          ...data,
          testCaseId: scope.testCaseId,
          uploadCompletedAt: new Date(verifiedAt),
          uploadVerification: {
            etag: "synthetic-etag",
            versionId: null,
            verifiedAt,
          },
        },
      });
      const pending = await prisma.testCaseAttachment.create({
        data: { ...data, testCaseId: scope.testCaseId },
      });
      const foreign = await prisma.testCaseAttachment.create({
        data: {
          ...data,
          testCaseId: otherCaseId,
          uploadCompletedAt: new Date(verifiedAt),
          uploadVerification: {
            etag: "synthetic-etag",
            versionId: null,
            verifiedAt,
          },
        },
      });
      expect(
        (
          await owner.manualExecution.listStepEvidence({
            testRunId: scope.testRunId,
          })
        ).attachments,
      ).toContainEqual({
        id: confirmed.id,
        fileName: "Synthetic evidence.txt",
      });
      for (const id of [pending.id, foreign.id, "missing-evidence"])
        await expect(
          owner.manualExecution.recordStepResult({
            ...input(scope),
            evidenceAttachmentIds: [id],
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await owner.manualExecution.recordStepResult({
        ...input(scope),
        evidenceAttachmentIds: [confirmed.id],
      });
      expect(
        (await current(scope)).cases[0]?.stepResults[0]?.current
          ?.evidenceAttachments,
      ).toEqual([{ id: confirmed.id, fileName: "Synthetic evidence.txt" }]);
      const revision = await prisma.manualStepResultRevision.findFirstOrThrow({
        where: { testRunId: scope.testRunId },
      });
      expect(revision.evidenceAttachments).toEqual([
        {
          id: confirmed.id,
          fileName: "Synthetic evidence.txt",
          contentType: "text/plain",
          sizeBytes: 24,
          verification: { etag: "synthetic-etag", versionId: null, verifiedAt },
        },
      ]);
    });

    it("rechecks live tenant/editor/full-seat/suspension access even for recovered receipts", async () => {
      const scope = await procedure(1),
        request = input(scope);
      const saved = await owner.manualExecution.recordStepResult(request);
      for (const caller of [viewer, readonly, outsider])
        await expect(
          caller.manualExecution.recordStepResult(request),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        outsider.manualExecution.stepResultHistory({ ...scope, stepIndex: 0 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        outsider.manualExecution.listStepEvidence({
          testRunId: scope.testRunId,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const membership = await prisma.membership.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId, userId: ownerId } },
      });
      await prisma.membership.update({
        where: { id: membership.id },
        data: { seatType: "READ_ONLY" },
      });
      await expect(
        owner.manualExecution.recordStepResult(request),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await prisma.membership.update({
        where: { id: membership.id },
        data: { seatType: "FULL" },
      });
      await prisma.organization.update({
        where: { id: organizationId },
        data: { suspendedAt: new Date() },
      });
      await expect(
        owner.manualExecution.recordStepResult(request),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await prisma.organization.update({
        where: { id: organizationId },
        data: { suspendedAt: null },
      });
      expect(await owner.manualExecution.recordStepResult(request)).toEqual(
        saved,
      );
    });

    it("prevents case deletion from cascading away evidence used by another case's retained revisions", async () => {
      const scope = await procedure(1);
      const source = await owner.testCases.create({
        projectId,
        title: "Synthetic evidence owner",
        testType: "FUNCTIONAL",
        steps: [{ action: "Source procedure" }],
      });
      const verifiedAt = new Date().toISOString();
      const attachment = await prisma.testCaseAttachment.create({
        data: {
          testCaseId: source.id,
          fileName: "Cross-case evidence.txt",
          contentType: "text/plain",
          storageUrl: "s3://synthetic-only/cross-case.txt",
          sizeBytes: 24,
          uploadedById: ownerId,
          uploadCompletedAt: new Date(verifiedAt),
          uploadVerification: {
            etag: "synthetic",
            versionId: null,
            verifiedAt,
          },
        },
      });
      await owner.manualExecution.recordStepResult({
        ...input(scope),
        evidenceAttachmentIds: [attachment.id],
      });
      await expect(
        owner.testCases.delete({ id: source.id }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        await owner.testCases.bulkDelete({ projectId, ids: [source.id] }),
      ).toEqual({ deletedCount: 0, blockedCount: 1 });
      expect(
        await prisma.testCaseAttachment.count({ where: { id: attachment.id } }),
      ).toBe(1);
      expect(await prisma.testCase.count({ where: { id: source.id } })).toBe(1);
    });

    it("retains frozen step media when its owning case has no verdict or step observations", async () => {
      const scope = await procedure(1);
      const attachment = await prisma.testCaseAttachment.create({
        data: {
          testCaseId: scope.testCaseId,
          fileName: "Frozen setup.png",
          contentType: "image/png",
          storageUrl: "s3://synthetic-only/setup.png",
          sizeBytes: 24,
          uploadedById: ownerId,
        },
      });
      await prisma.testCaseStep.updateMany({
        where: { testCaseId: scope.testCaseId },
        data: { mediaAttachmentIds: [attachment.id] },
      });
      await owner.manualExecution.start({
        projectId,
        testCaseIds: [scope.testCaseId],
      });
      await expect(
        owner.testCases.delete({ id: scope.testCaseId }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        await owner.testCases.bulkDelete({
          projectId,
          ids: [scope.testCaseId],
        }),
      ).toEqual({ deletedCount: 0, blockedCount: 1 });
      expect(
        await prisma.testCaseAttachment.count({ where: { id: attachment.id } }),
      ).toBe(1);
    });

    it("inventories and removes revision chains only in explicitly authorized disposable organization erasure", async () => {
      const preview = await previewOrgHardDelete(prisma, organizationId);
      expect(preview.rowCounts.ManualStepResultRevision).toBeGreaterThan(0);
      expect(preview.rowCounts.ManualStepResultHead).toBeGreaterThan(0);
      const result = await hardDeleteOrganization(
        prisma,
        organizationId,
        ownerId,
        "Synthetic disposable fixture teardown",
      );
      expect(result.rowCounts.ManualStepResultRevision).toBe(
        preview.rowCounts.ManualStepResultRevision,
      );
      expect(result.rowCounts.ManualStepResultHead).toBe(
        preview.rowCounts.ManualStepResultHead,
      );
      expect(await prisma.testCase.count({ where: { id: otherCaseId } })).toBe(
        1,
      );
    });
  },
);
