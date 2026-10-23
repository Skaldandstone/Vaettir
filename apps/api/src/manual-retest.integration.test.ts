import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { startManualRetest } from "./services/manualRetest.js";
import { boundedRunSnapshot } from "./services/qualityExperienceProfile.js";

import { manualCaseReviewedExactWriteSchema, manualCaseReviewedReadKey } from "./services/manualCaseResultSchema.js";
import { manualCaseReviewedRequestHash } from "./services/manualCaseResultsReviewed.js";
import { reviewedStepWriteInputSchema } from "./services/manualStepExecutionReviewSchema.js";
import { reviewedStepRequestHash, reviewedStepLegacyHash } from "./services/manualStepExecutionReview.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated =
  url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");
describe.skipIf(!isolated)(
  "explicit manual retest relationships (isolated synthetic DB)",
  () => {
    let owner: ReturnType<typeof appRouter.createCaller>,
      viewer: typeof owner,
      readonly: typeof owner,
      outsider: typeof owner;
    let projectId: string,
      otherProjectId: string,
      ownerId: string,
      organizationId: string,
      ownerClerkActorId: string;
    const key = `manual-retest-${Date.now()}-${randomUUID().slice(0, 8)}`;
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
        const authenticatedClerkSubject = `${key}-${suffix}`;
        const user = await prisma.user.create({
          data: {
            email: `${key}-${suffix}@example.com`,
            clerkUserId: authenticatedClerkSubject,
            memberships: { create: { organizationId, role, seatType } },
          },
          include: { memberships: true },
        });
        if (suffix === "owner") { ownerId = user.id; ownerClerkActorId = authenticatedClerkSubject; }
        return appRouter.createCaller({ prisma, user, authenticatedClerkSubject });
      }
      owner = await caller("owner", org.id, "OWNER");
      viewer = await caller("viewer", org.id, "VIEWER");
      readonly = await caller("readonly", org.id, "EDITOR", "READ_ONLY");
      outsider = await caller("outsider", other.id, "OWNER");
      projectId = (
        await owner.project.create({
          organizationId: org.id,
          name: "Synthetic retest project",
        })
      ).id;
      otherProjectId = (
        await outsider.project.create({
          organizationId: other.id,
          name: "Synthetic foreign retest",
        })
      ).id;
    });
    // Real reviewed router calls in the owned disposable DB, not a receipt mock.
    // Caller subjects below are declared synthetic contexts, not JWT verification.
    async function recordCaseOutcome(input: Parameters<typeof owner.manualExecution.recordResult>[0]) {
      const expectedScope = { projectId, organizationId, clerkActorId: ownerClerkActorId };
      const accessInput = { projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, expectedScope, readRequestId: randomUUID() };
      const access = await owner.manualCaseResults.accessReviewed(accessInput);
      expect(access.readContext).toMatchObject({ requestId: accessInput.readRequestId, requested: manualCaseReviewedReadKey(accessInput), projection: "ACCESS", scope: { ...expectedScope, actorId: ownerId } });
      const previewInput = { ...accessInput, expectedNativeActorId: access.readContext.scope.actorId, readRequestId: randomUUID() };
      const preview = await owner.manualCaseResults.previewReviewed(previewInput);
      expect(preview.readContext).toMatchObject({ requestId: previewInput.readRequestId, requested: manualCaseReviewedReadKey(previewInput), projection: "PREVIEW", scope: { ...expectedScope, actorId: ownerId } });
      const request = manualCaseReviewedExactWriteSchema.parse({
        mode: "EXACT", projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, expectedScope, expectedNativeActorId: ownerId,
        expectedFrozenEvidenceHash: preview.frozenEvidenceHash, expectedRevisionId: preview.currentRevisionId, expectedCurrentFingerprint: preview.currentFingerprint,
        status: input.status, note: input.note ?? null, observations: input.observations ?? {},
        correctionReason: preview.current ? "Synthetic explicitly reviewed correction" : null, idempotencyKey: randomUUID(),
      });
      const ack = await owner.manualCaseResults.recordReviewed(request);
      expect(ack).toMatchObject({ mode: "EXACT", scope: { ...expectedScope, actorId: ownerId }, testRunId: input.testRunId, testCaseId: input.testCaseId, idempotencyKey: request.idempotencyKey, requestHash: manualCaseReviewedRequestHash(request), recovered: false });
      expect(await prisma.manualCaseResultRevision.findUniqueOrThrow({ where: { id: ack.revisionId } })).toMatchObject({
        testRunId: input.testRunId, testCaseId: input.testCaseId, actorId: ownerId, actorClerkUserId: expectedScope.clerkActorId,
        status: request.status, note: request.note, observations: request.observations, idempotencyKey: request.idempotencyKey, requestHash: ack.requestHash,
      });
      return ack;
    }

    async function recordReviewedStepOutcome(input: Parameters<typeof owner.manualExecution.recordStepResult>[0]) {
      const pins = { originalOrganizationId: organizationId, expectedClerkActorId: ownerClerkActorId, expectedNativeActorId: ownerId };
      const read = { projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex, ...pins, readRequestId: randomUUID() };
      const preview = await owner.manualStepExecutionReview.preview(read);
      expect(preview).toMatchObject({ projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex, readRequestId: read.readRequestId, scope: { projectId, organizationId, actorId: ownerId, actorClerkUserId: ownerClerkActorId } });
      if (!preview.procedureHash || !preview.currentFingerprint) throw Error("The actual frozen step could not be reviewed; no hash was invented.");
      const request = reviewedStepWriteInputSchema.parse({
        projectId, testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex, ...pins,
        expectedProcedureHash: preview.procedureHash, expectedCurrentFingerprint: preview.currentFingerprint, expectedRevisionId: input.expectedRevisionId,
        status: input.status, note: input.note ?? null, correctionReason: input.correctionReason ?? null, evidenceAttachmentIds: input.evidenceAttachmentIds ?? [],
        observations: { specimen: "", hardwareRevision: "", firmwareVersion: "", environment: "", ...input.observations,
          measurements: (input.observations?.measurements ?? []).map(reading => ({ ...reading, instrument: reading.instrument ?? "" })) },
        idempotencyKey: input.idempotencyKey, confirmed: true,
      });
      const ack = await owner.manualStepExecutionReview.record(request);
      expect(ack).toMatchObject({ scope: preview.scope, idempotencyKey: input.idempotencyKey, requestHash: reviewedStepRequestHash(request), recovered: false, provenance: "REVIEWED_REQUEST_BOUND_AT_WRITE" });
      expect(await prisma.manualStepResultRevision.findUniqueOrThrow({ where: { id: ack.revisionId } })).toMatchObject({
        testRunId: input.testRunId, testCaseId: input.testCaseId, stepIndex: input.stepIndex, status: request.status, note: request.note,
        observations: request.observations, idempotencyKey: input.idempotencyKey, requestHash: reviewedStepLegacyHash(request),
      });
      expect((await prisma.auditLog.findFirstOrThrow({ where: { actorId: ownerId, entityId: input.testRunId, entityType: "ManualStepExecutionReview/v1", metadata: { path: ["idempotencyKey"], equals: input.idempotencyKey } } })).metadata).toMatchObject({ requestHash: ack.requestHash, revisionId: ack.revisionId, scope: preview.scope });
      return ack;
    }

    async function fixture(
      status: "FAIL" | "BLOCKED" = "FAIL",
      withPrerequisite = false,
      seedReviewedOutcome = true,
    ) {
      const c = await owner.testCases.create({
        projectId,
        title: "Synthetic original procedure",
        testType: "FUNCTIONAL",
        background: "Original setup",
        given: ["Original Given"],
        when: ["Original When"],
        then: ["Original Then"],
      });
      let prerequisiteId: string | undefined;
      if (withPrerequisite) {
        prerequisiteId = (
          await owner.testCases.create({
            projectId,
            title: "Synthetic original prerequisite",
            testType: "FUNCTIONAL",
            given: ["Given login"],
            when: ["Login"],
            then: ["Authenticated"],
          })
        ).id;
        await prisma.testCasePrerequisite.create({
          data: {
            projectId,
            dependentId: c.id,
            prerequisiteId,
            createdById: ownerId,
          },
        });
      }
      const run = (
        await owner.manualExecution.start({
          projectId,
          testCaseIds: [c.id],
          executionContext: {
            platform: "Synthetic PC",
            build: "original-build",
            environment: "original-env",
          },
          idempotencyKey: randomUUID(),
        })
      ).testRunId;
      if (prerequisiteId)
        await recordCaseOutcome({
          testRunId: run,
          testCaseId: prerequisiteId,
          status: "PASS",
          note: "Original prerequisite passed",
        });
      if (seedReviewedOutcome) await recordCaseOutcome({
        testRunId: run,
        testCaseId: c.id,
        status,
        note: "Original failure evidence",
        observations: { environment: "Original observed environment" },
      });
      const scope = { projectId, sourceRunId: run, testCaseId: c.id };
      return { ...scope, displayId: c.displayId, prerequisiteId };
    }
    async function reviewed(scope: Awaited<ReturnType<typeof fixture>>) {
      const preview = await owner.manualRetest.preview(scopeOf(scope));
      return {
        scope,
        preview,
        input: {
          projectId,
          sourceRunId: scope.sourceRunId,
          testCaseId: scope.testCaseId,
          expectedReviewHash: preview.reviewHash,
          idempotencyKey: randomUUID(),
        },
      };
    }
    function scopeOf(scope: {
      projectId: string;
      sourceRunId: string;
      testCaseId: string;
    }) {
      return {
        projectId: scope.projectId,
        sourceRunId: scope.sourceRunId,
        testCaseId: scope.testCaseId,
      };
    }
    it("retains original evidence and exactly frozen procedure/configuration despite current body edits", async () => {
      const scope = await fixture();
      const before = await prisma.testRun.findUniqueOrThrow({
        where: { id: scope.sourceRunId },
        include: { results: true },
      });
      const ready = await reviewed(scope);
      await prisma.testCase.update({
        where: { id: scope.testCaseId },
        data: {
          title: "Changed current case",
          given: ["Changed"],
          when: ["Changed"],
          then: ["Changed"],
        },
      });
      const receipt = await owner.manualRetest.start(ready.input);
      const retest = await owner.manualExecution.getForExecution({
        testRunId: receipt.testRunId,
      });
      expect(retest.cases[0]?.displayId).toBe(scope.displayId);
      expect(retest.cases[0]?.given).toEqual(["Original Given"]);
      expect(retest.executionContext?.configuration.build).toBe(
        "original-build",
      );
      expect(retest.cases[0]?.currentResult).toBeNull();
      expect(retest.executionContext?.retest?.sourceResults[0]?.note).toBe(
        "Original failure evidence",
      );
      expect(
        await prisma.testRun.findUniqueOrThrow({
          where: { id: scope.sourceRunId },
          include: { results: true },
        }),
      ).toEqual(before);
      await recordCaseOutcome({
        testRunId: scope.sourceRunId,
        testCaseId: scope.testCaseId,
        status: "PASS",
        note: "Later correction",
      });
      expect(
        (
          await owner.manualExecution.getForExecution({
            testRunId: receipt.testRunId,
          })
        ).executionContext?.retest?.sourceResults[0]?.status,
      ).toBe("FAIL");
      expect(await owner.manualRetest.links(scopeOf(scope))).toMatchObject({
        original: null,
        retests: [{ testRunId: receipt.testRunId }],
      });
      expect(
        await owner.manualRetest.links({
          ...scopeOf(scope),
          sourceRunId: receipt.testRunId,
        }),
      ).toMatchObject({
        original: { testRunId: scope.sourceRunId, capturedOutcome: "FAIL" },
      });
    });
    it("fresh outcome and configuration CAS rejects changes, not overall failed run inference", async () => {
      const scope = await fixture("BLOCKED");
      const ready = await reviewed(scope);
      await recordCaseOutcome({
        testRunId: scope.sourceRunId,
        testCaseId: scope.testCaseId,
        status: "BLOCKED",
        note: "Changed original evidence",
      });
      await expect(owner.manualRetest.start(ready.input)).rejects.toThrow(
        "changed",
      );
      const refreshed = await reviewed(scope);
      const original = await prisma.testRun.findUniqueOrThrow({
        where: { id: scope.sourceRunId },
      });
      const snapshot = boundedRunSnapshot(original.executionContext);
      await prisma.testRun.update({
        where: { id: scope.sourceRunId },
        data: {
          executionContext: {
            ...snapshot,
            configuration: {
              ...snapshot.configuration,
              build: "different-build",
            },
          },
        },
      });
      await expect(owner.manualRetest.start(refreshed.input)).rejects.toThrow(
        "changed",
      );
      await recordCaseOutcome({
        testRunId: scope.sourceRunId,
        testCaseId: scope.testCaseId,
        status: "PASS",
      });
      await prisma.testRun.update({
        where: { id: scope.sourceRunId },
        data: { status: "FAILED" },
      });
      await expect(owner.manualRetest.preview(scopeOf(scope))).rejects.toThrow(
        "recorded Failed or Blocked",
      );
    });
    it("never transfers a passed prerequisite from original or another configuration", async () => {
      const ready = await reviewed(await fixture("FAIL", true));
      const a = await owner.manualRetest.start(ready.input);
      const b = await owner.manualRetest.start({
        ...ready.input,
        idempotencyKey: randomUUID(),
      });
      expect(
        (
          await owner.manualExecution.getForExecution({
            testRunId: a.testRunId,
          })
        ).cases.every((c) => c.currentResult === null),
      ).toBe(true);
      await expect(
        recordCaseOutcome({
          testRunId: a.testRunId,
          testCaseId: ready.scope.testCaseId,
          status: "PASS",
        }),
      ).rejects.toThrow("prerequisite");
      await recordCaseOutcome({
        testRunId: b.testRunId,
        testCaseId: ready.scope.prerequisiteId!,
        status: "PASS",
      });
      await expect(
        recordCaseOutcome({
          testRunId: a.testRunId,
          testCaseId: ready.scope.testCaseId,
          status: "PASS",
        }),
      ).rejects.toThrow("prerequisite");
      await recordCaseOutcome({
        testRunId: a.testRunId,
        testCaseId: ready.scope.prerequisiteId!,
        status: "PASS",
      });
      await recordCaseOutcome({
        testRunId: a.testRunId,
        testCaseId: ready.scope.testCaseId,
        status: "PASS",
      });
      expect(
        await prisma.testResult.findFirst({
          where: {
            testRunId: ready.scope.sourceRunId,
            testCaseId: ready.scope.testCaseId,
          },
        }),
      ).toMatchObject({ status: "FAIL" });
    });
    it("tenant, seat, revoked retry, archived and foreign identity are fail-closed", async () => {
      const ready = await reviewed(await fixture());
      for (const caller of [viewer, readonly, outsider]) {
        await expect(
          caller.manualRetest.preview(scopeOf(ready.scope)),
        ).rejects.toThrow("full editor");
        await expect(caller.manualRetest.start(ready.input)).rejects.toThrow(
          "full editor",
        );
      }
      await expect(
        owner.manualRetest.preview({
          ...scopeOf(ready.scope),
          projectId: otherProjectId,
        }),
      ).rejects.toThrow();
      await expect(
        outsider.manualRetest.links(scopeOf(ready.scope)),
      ).rejects.toThrow("access");
      await prisma.testCase.update({
        where: { id: ready.scope.testCaseId },
        data: { archived: true },
      });
      await expect(owner.manualRetest.start(ready.input)).rejects.toThrow(
        "archived",
      );
      await prisma.testCase.update({
        where: { id: ready.scope.testCaseId },
        data: { archived: false },
      });
      await owner.manualRetest.start(ready.input);
      await prisma.membership.update({
        where: { organizationId_userId: { organizationId, userId: ownerId } },
        data: { role: "VIEWER" },
      });
      try {
        await expect(owner.manualRetest.start(ready.input)).rejects.toThrow(
          "full editor",
        );
      } finally {
        await prisma.membership.update({
          where: { organizationId_userId: { organizationId, userId: ownerId } },
          data: { role: "OWNER" },
        });
      }
    });
    it("rejects missing, duplicate, malformed, oversized and unresolved original evidence", async () => {
      const noSnapshot = await fixture();
      await prisma.testRun.update({
        where: { id: noSnapshot.sourceRunId },
        data: { executionContext: {} },
      });
      await expect(
        owner.manualRetest.preview(scopeOf(noSnapshot)),
      ).rejects.toThrow("snapshot");
      // Historical unsupported-input fixtures only: do not delete or corrupt
      // immutable reviewed observations to simulate preexisting legacy rows.
      const noResult = await fixture("FAIL", false, false);
      await expect(
        owner.manualRetest.preview(scopeOf(noResult)),
      ).rejects.toThrow("recorded Failed");
      const multiple = await fixture("FAIL", false, false);
      await prisma.testResult.createMany({
        data: [
          { testRunId: multiple.sourceRunId, testCaseId: multiple.testCaseId, status: "FAIL" },
          { testRunId: multiple.sourceRunId, testCaseId: multiple.testCaseId, status: "BLOCKED" },
        ],
      });
      await expect(
        owner.manualRetest.preview(scopeOf(multiple)),
      ).rejects.toThrow("Multiple original");
      const large = await fixture("FAIL", false, false);
      await prisma.testResult.create({
        data: { testRunId: large.sourceRunId, testCaseId: large.testCaseId, status: "FAIL", note: "x".repeat(270000) },
      });
      await expect(owner.manualRetest.preview(scopeOf(large))).rejects.toThrow(
        "bounded retest",
      );
      const unresolved = await fixture();
      const run = await prisma.testRun.findUniqueOrThrow({
        where: { id: unresolved.sourceRunId },
      });
      const snapshot = boundedRunSnapshot(run.executionContext);
      snapshot.caseDefinitions[0]!.given = ["Select <unresolved>"];
      await prisma.testRun.update({
        where: { id: run.id },
        data: { executionContext: snapshot },
      });
      await expect(
        owner.manualRetest.preview(scopeOf(unresolved)),
      ).rejects.toThrow("unresolved");
      const invalid = await fixture();
      await prisma.testRun.update({
        where: { id: invalid.sourceRunId },
        data: { manualPrerequisites: { [invalid.testCaseId]: ["foreign"] } },
      });
      await expect(
        owner.manualRetest.preview(scopeOf(invalid)),
      ).rejects.toThrow("original scope");
    });
    it("concurrent retries and lost responses recover one exact actor request even after original changes", async () => {
      const ready = await reviewed(await fixture());
      const [first, second] = await Promise.all([
        owner.manualRetest.start(ready.input),
        owner.manualRetest.start(ready.input),
      ]);
      expect(first.testRunId).toBe(second.testRunId);
      await recordCaseOutcome({
        testRunId: ready.scope.sourceRunId,
        testCaseId: ready.scope.testCaseId,
        status: "PASS",
      });
      expect(await owner.manualRetest.start(ready.input)).toEqual({
        testRunId: first.testRunId,
        recovered: true,
      });
      await expect(
        owner.manualRetest.start({
          ...ready.input,
          expectedReviewHash: "f".repeat(64),
        }),
      ).rejects.toThrow("different request");
      expect(
        await prisma.testRun.count({ where: { id: first.testRunId } }),
      ).toBe(1);
    });
    it("preserves actual completed step revision references and rejects partial step evidence", async () => {
      const c = await owner.testCases.create({
        projectId,
        title: "Synthetic structured retest",
        testType: "FUNCTIONAL",
        steps: [
          { action: "First", expectedResult: "Done" },
          { action: "Second", expectedResult: "Done" },
        ],
      });
      const run = (
        await owner.manualExecution.start({ projectId, testCaseIds: [c.id] })
      ).testRunId;
      const scope = { projectId, sourceRunId: run, testCaseId: c.id };
      const first = await recordReviewedStepOutcome({
        testRunId: run,
        testCaseId: c.id,
        stepIndex: 0,
        status: "FAIL",
        note: "Frozen failed step",
        idempotencyKey: randomUUID(),
        expectedRevisionId: null,
      });
      await expect(owner.manualRetest.preview(scope)).rejects.toThrow(
        "recorded Failed or Blocked",
      );
      await recordReviewedStepOutcome({
        testRunId: run,
        testCaseId: c.id,
        stepIndex: 1,
        status: "PASS",
        idempotencyKey: randomUUID(),
        expectedRevisionId: null,
      });
      const preview = await owner.manualRetest.preview(scope);
      const receipt = await owner.manualRetest.start({
        ...scope,
        expectedReviewHash: preview.reviewHash,
        idempotencyKey: randomUUID(),
      });
      const loaded = await owner.manualExecution.getForExecution({
        testRunId: receipt.testRunId,
      });
      expect(
        loaded.executionContext?.retest?.sourceStepRevisions[0]?.revisionId,
      ).toBe(first.revisionId);
      expect(
        loaded.cases[0]?.stepResults.every((step) => step.current === null),
      ).toBe(true);
    });
    it("keeps dataset row values resolved and links a distinct retest rather than impersonating batch identity", async () => {
      const c = await owner.testCases.create({
        projectId,
        title: "Synthetic <variant>",
        testType: "FUNCTIONAL",
        given: ["Given <variant>"],
        when: ["Use <variant>"],
        then: ["Ready <variant>"],
      });
      await prisma.testCaseDataset.create({
        data: {
          testCaseId: c.id,
          parameterNames: ["variant"],
          rows: [
            {
              name: "Original row",
              values: { variant: "Original concrete value" },
            },
          ],
        },
      });
      const preview = await owner.manualExecution.previewDatasetExecution({
        projectId,
        testCaseId: c.id,
        executionContext: { build: "Dataset original" },
      });
      const batch = await owner.manualExecution.startDatasetExecution({
        projectId,
        testCaseId: c.id,
        executionContext: preview.configuration,
        expectedExpansionHash: preview.expansionHash,
        idempotencyKey: randomUUID(),
      });
      const sourceRunId = batch.runs[0]!.testRunId;
      await recordCaseOutcome({
        testRunId: sourceRunId,
        testCaseId: c.id,
        status: "FAIL",
      });
      const scope = { projectId, sourceRunId, testCaseId: c.id };
      const review = await owner.manualRetest.preview(scope);
      const receipt = await owner.manualRetest.start({
        ...scope,
        expectedReviewHash: review.reviewHash,
        idempotencyKey: randomUUID(),
      });
      const execution = await owner.manualExecution.getForExecution({
        testRunId: receipt.testRunId,
      });
      expect(execution.executionContext?.datasetExecution).toBeUndefined();
      expect(execution.datasetBatchRuns).toEqual([]);
      expect(
        execution.executionContext?.retest?.sourceDatasetExecution?.values,
      ).toEqual({ variant: "Original concrete value" });
      expect(execution.cases[0]?.given).toEqual([
        "Given Original concrete value",
      ]);
    });
    it("paginates direct linked retests with equal timestamps and rejects cross-scope cursor", async () => {
      const ready = await reviewed(await fixture());
      const ids: string[] = [];
      for (let index = 0; index < 12; index++)
        ids.push(
          (
            await owner.manualRetest.start({
              ...ready.input,
              idempotencyKey: randomUUID(),
            })
          ).testRunId,
        );
      await prisma.testRun.updateMany({
        where: { id: { in: ids } },
        data: { startedAt: new Date("2026-10-01T01:00:00Z") },
      });
      const first = await owner.manualRetest.links(scopeOf(ready.scope));
      expect(first.retests).toHaveLength(10);
      const second = await owner.manualRetest.links({
        ...scopeOf(ready.scope),
        before: first.nextCursor!,
      });
      expect(second.retests).toHaveLength(2);
      expect(
        new Set([...first.retests, ...second.retests].map((r) => r.testRunId))
          .size,
      ).toBe(12);
      await expect(
        owner.manualRetest.links({
          ...scopeOf(ready.scope),
          before: ready.scope.sourceRunId,
        }),
      ).rejects.toThrow("cursor");
    });
    it("rolls back a failed creation without mutating the original or storing a retry marker", async () => {
      const ready = await reviewed(await fixture());
      const original = await prisma.testRun.findUniqueOrThrow({
        where: { id: ready.scope.sourceRunId },
        include: { results: true },
      });
      const guarded = new Proxy(prisma, {
        get(target, key) {
          if (key !== "$transaction") return Reflect.get(target, key);
          return async (
            callback: (tx: Prisma.TransactionClient) => unknown,
            options: Prisma.TransactionOptions,
          ) =>
            target.$transaction(
              async (tx) =>
                callback(
                  new Proxy(tx, {
                    get(transaction, property) {
                      if (property !== "testRun")
                        return Reflect.get(transaction, property);
                      return new Proxy(transaction.testRun, {
                        get(delegate, method) {
                          if (method === "create")
                            return () => {
                              throw Error("Synthetic write failure");
                            };
                          return Reflect.get(delegate, method);
                        },
                      });
                    },
                  }),
                ),
              options,
            );
        },
      });
      await expect(
        startManualRetest(guarded, ownerId, ready.input),
      ).rejects.toThrow("Synthetic write failure");
      expect(
        await prisma.testRun.findUniqueOrThrow({
          where: { id: ready.scope.sourceRunId },
          include: { results: true },
        }),
      ).toEqual(original);
      expect((await owner.manualRetest.start(ready.input)).recovered).toBe(
        false,
      );
    });
    it("holds original execution and current membership locks through actual retest commit", async () => {
      for (const mutation of ["source", "membership"] as const) {
        const ready = await reviewed(await fixture());
        let release!: () => void, entered!: () => void;
        const paused = new Promise<void>((resolve) => {
          release = resolve;
        });
        const reached = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const guarded = new Proxy(prisma, {
          get(target, key) {
            if (key !== "$transaction") return Reflect.get(target, key);
            return async (
              callback: (tx: Prisma.TransactionClient) => unknown,
              options: Prisma.TransactionOptions,
            ) =>
              target.$transaction(
                async (tx) =>
                  callback(
                    new Proxy(tx, {
                      get(transaction, property) {
                        if (property !== "testRun")
                          return Reflect.get(transaction, property);
                        return new Proxy(transaction.testRun, {
                          get(delegate, method) {
                            if (method !== "create")
                              return Reflect.get(delegate, method);
                            return async (args: Prisma.TestRunCreateArgs) => {
                              entered();
                              await paused;
                              return delegate.create(args);
                            };
                          },
                        });
                      },
                    }),
                  ),
                options,
              );
          },
        });
        const start = startManualRetest(guarded, ownerId, ready.input);
        await reached;
        let finished = false;
        const change = (
          mutation === "source"
            ? recordCaseOutcome({
                testRunId: ready.scope.sourceRunId,
                testCaseId: ready.scope.testCaseId,
                status: "BLOCKED",
                note: "Concurrent later change",
              })
            : prisma.membership.update({
                where: {
                  organizationId_userId: { organizationId, userId: ownerId },
                },
                data: { role: "VIEWER" },
              })
        ).then((value) => {
          finished = true;
          return value;
        });
        try {
          await new Promise((resolve) => setTimeout(resolve, 80));
          expect(finished).toBe(false);
        } finally {
          release();
        }
        const created = await start;
        await change;
        if (mutation === "source") {
          const evidence = (
            await owner.manualExecution.getForExecution({
              testRunId: created.testRunId,
            })
          ).executionContext?.retest?.sourceResults.find(
            (r) => r.testCaseId === ready.scope.testCaseId,
          );
          expect(evidence).toMatchObject({
            status: "FAIL",
            note: "Original failure evidence",
          });
          expect((await owner.manualRetest.start(ready.input)).testRunId).toBe(
            created.testRunId,
          );
        } else {
          try {
            await expect(owner.manualRetest.start(ready.input)).rejects.toThrow(
              "full editor",
            );
          } finally {
            await prisma.membership.update({
              where: {
                organizationId_userId: { organizationId, userId: ownerId },
              },
              data: { role: "OWNER" },
            });
          }
        }
      }
    });
  },
);
