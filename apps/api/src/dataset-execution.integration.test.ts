import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { runConfigurationSchema } from "./services/qualityExperienceProfile.js";
import {
  startDatasetExecution,
  prepareDatasetExecution,
} from "./services/datasetExecution.js";

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
  "reviewed per-row manual run batches (isolated synthetic DB)",
  () => {
    let owner: ReturnType<typeof appRouter.createCaller>,
      viewer: typeof owner,
      readonly: typeof owner,
      outsider: typeof owner;
    let projectId: string, ownerId: string, otherProjectId: string, organizationId: string, ownerClerkActorId: string;
    const key = `dataset-execution-${Date.now()}-${randomUUID().slice(0, 8)}`;
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
        role: "OWNER" | "EDITOR" | "VIEWER",
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
          name: "Synthetic dataset project",
        })
      ).id;
      otherProjectId = (
        await outsider.project.create({
          organizationId: other.id,
          name: "Synthetic foreign dataset project",
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

    const context = runConfigurationSchema.parse({
      platform: "Synthetic console",
      build: "synthetic-1",
    });
    async function fixture(prerequisite = false) {
      const c = await owner.testCases.create({
        projectId,
        title: "Synthetic variant <variant>",
        testType: "FUNCTIONAL",
        background: "Prepare <variant>",
        given: ["Given <variant>"],
        when: ["Select <variant>"],
        then: ["Ready <variant>"],
        steps: [
          {
            action: "Use <variant>",
            expectedActionOrData: "<variant>",
            expectedResult: "Ready <variant>",
            expectedResponse: "Response <variant>",
          },
        ],
      });
      const dataset = await prisma.testCaseDataset.create({
        data: {
          testCaseId: c.id,
          parameterNames: ["variant"],
          rows: [
            { name: "Mobile", values: { variant: "Mobile" } },
            { name: "Desktop", values: { variant: "Desktop" } },
          ],
        },
      });
      let prerequisiteId: string | undefined;
      if (prerequisite) {
        prerequisiteId = (
          await owner.testCases.create({
            projectId,
            title: "Synthetic prerequisite <variant>",
            testType: "FUNCTIONAL",
            steps: [
              {
                action: "Login <variant>",
                expectedResult: "Success <variant>",
              },
            ],
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
      return {
        testCaseId: c.id,
        datasetId: dataset.id,
        prerequisiteId,
        projectId,
        executionContext: context,
      };
    }
    async function reviewed(scope: Awaited<ReturnType<typeof fixture>>) {
      const input = {
        projectId,
        testCaseId: scope.testCaseId,
        executionContext: scope.executionContext,
      };
      const preview =
        await owner.manualExecution.previewDatasetExecution(input);
      return {
        input,
        preview,
        start: {
          ...input,
          expectedExpansionHash: preview.expansionHash,
          idempotencyKey: randomUUID(),
        },
      };
    }
    it("previews all formats without writes and creates separate immutable row runs", async () => {
      const scope = await fixture(true),
        { preview, start } = await reviewed(scope);
      expect(preview.rowCount).toBe(2);
      expect(preview.plannedCaseInstances).toBe(4);
      expect(preview.credits).toBe(0);
      expect(preview.rows[0]!.caseDefinitions.at(-1)!.given).toEqual([
        "Given Mobile",
      ]);
      expect(await prisma.testRun.count({ where: { projectId } })).toBe(0);
      const batch = await owner.manualExecution.startDatasetExecution(start);
      expect(new Set(batch.runs.map((row) => row.testRunId)).size).toBe(2);
      // Batch row metadata is not read authority. The native read input is strict.
      await expect(
        owner.manualExecution.getForExecution({ ...batch.runs[0]!, projectId }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const first = await owner.manualExecution.getForExecution({
        projectId,
        testRunId: batch.runs[0]!.testRunId,
      });
      const second = await owner.manualExecution.getForExecution(
        { projectId, testRunId: batch.runs[1]!.testRunId },
      );
      expect(first.cases.at(-1)!.steps[0]!.action).toBe("Use Mobile");
      expect(second.cases.at(-1)!.steps[0]!.action).toBe("Use Desktop");
      expect(first.executionContext!.datasetExecution!.sourceDisplayId).toBe(
        preview.displayId,
      );
      expect(first.datasetBatchRuns).toHaveLength(2);
      await prisma.testCase.update({
        where: { id: scope.testCaseId },
        data: { given: ["Later human edit"] },
      });
      await prisma.testCaseDataset.update({
        where: { id: scope.datasetId },
        data: { rows: [{ name: "Changed", values: { variant: "Changed" } }] },
      });
      expect(
        (await owner.manualExecution.getForExecution({
          projectId,
          testRunId: batch.runs[0]!.testRunId,
        })).cases.at(
          -1,
        )!.given,
      ).toEqual(["Given Mobile"]);
      expect(
        (await owner.manualExecution.startDatasetExecution(start)).runs,
      ).toEqual(batch.runs);
    });
    it("materializes an owned shared procedure per row and freezes it against later library edits", async () => {
      const scope = await fixture();
      const group = await prisma.sharedStepGroup.create({
        data: {
          projectId,
          name: "Synthetic row library",
          steps: [
            {
              order: 0,
              action: "Shared action <variant>",
              expectedResult: "Shared result <variant>",
              mediaAttachmentIds: [],
            },
          ],
        },
      });
      await prisma.testCase.update({
        where: { id: scope.testCaseId },
        data: { sharedStepGroupId: group.id },
      });
      const { preview, start } = await reviewed(scope);
      expect(preview.rows[0]!.caseDefinitions[0]!.steps[0]!.action).toBe(
        "Shared action Mobile",
      );
      const batch = await owner.manualExecution.startDatasetExecution(start);
      const libraryReview = await owner.sharedStepGroups.review({ projectId, id: group.id });
      await owner.sharedStepGroups.update({ projectId, id: group.id, action: "UPDATE", expectedRevisionHash: libraryReview.revisionHash, requestId: randomUUID(), confirmed: true, reason: "Synthetic frozen dataset procedure regression", content: { name: libraryReview.snapshot.name, description: libraryReview.snapshot.description, steps: [{ order: 0, action: "Later human library edit" }] } });
      expect(
        (await owner.manualExecution.getForExecution({
          projectId,
          testRunId: batch.runs[0]!.testRunId,
        })).cases[0]!
          .steps[0]!.action,
      ).toBe("Shared action Mobile");
      expect(
        (await owner.manualExecution.getForExecution({
          projectId,
          testRunId: batch.runs[1]!.testRunId,
        })).cases[0]!
          .steps[0]!.action,
      ).toBe("Shared action Desktop");
    });
    it("never borrows prerequisite passes between rows/configurations; results are independent", async () => {
      const scope = await fixture(true),
        { start } = await reviewed(scope),
        batch = await owner.manualExecution.startDatasetExecution(start);
      const one = batch.runs[0]!.testRunId,
        two = batch.runs[1]!.testRunId;
      await recordReviewedStepOutcome({
        testRunId: one,
        testCaseId: scope.prerequisiteId!,
        stepIndex: 0,
        status: "PASS",
        expectedRevisionId: null,
        idempotencyKey: randomUUID(),
      });
      await recordReviewedStepOutcome({
        testRunId: one,
        testCaseId: scope.testCaseId,
        stepIndex: 0,
        status: "PASS",
        expectedRevisionId: null,
        idempotencyKey: randomUUID(),
      });
      await expect(
        recordReviewedStepOutcome({
          testRunId: two,
          testCaseId: scope.testCaseId,
          stepIndex: 0,
          status: "PASS",
          expectedRevisionId: null,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        (
          await owner.manualExecution.getForExecution({ testRunId: two })
        ).cases.every((c) => c.currentResult === null),
      ).toBe(true);
      await owner.manualExecution.complete({ testRunId: one });
      expect(
        (await owner.manualExecution.startDatasetExecution(start)).runs,
      ).toEqual(batch.runs);
      const another = await reviewed({
        ...scope,
        executionContext: runConfigurationSchema.parse({
          platform: "Different device",
        }),
      });
      const newBatch = await owner.manualExecution.startDatasetExecution(
        another.start,
      );
      await expect(
        recordCaseOutcome({
          testRunId: newBatch.runs[0]!.testRunId,
          testCaseId: scope.testCaseId,
          status: "PASS",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
    it("rejects stale dataset/procedure/configuration scope and re-used keys for changed requests", async () => {
      const scope = await fixture(),
        { start } = await reviewed(scope);
      await prisma.testCase.update({
        where: { id: scope.testCaseId },
        data: { background: "Human edit <variant>" },
      });
      await expect(
        owner.manualExecution.startDatasetExecution(start),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const current = await reviewed(scope),
        batch = await owner.manualExecution.startDatasetExecution(
          current.start,
        );
      await expect(
        owner.manualExecution.startDatasetExecution({
          ...current.start,
          executionContext: runConfigurationSchema.parse({
            platform: "Changed",
          }),
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        (await owner.manualExecution.startDatasetExecution(current.start)).runs,
      ).toEqual(batch.runs);
    });
    it("rechecks tenant/role/full-seat permission, including retry receipts", async () => {
      const scope = await fixture(),
        { input, start } = await reviewed(scope);
      for (const caller of [viewer, readonly, outsider]) {
        await expect(
          caller.manualExecution.previewDatasetExecution(input),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          caller.manualExecution.startDatasetExecution(start),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      await owner.manualExecution.startDatasetExecution(start);
      const membership = await prisma.membership.findFirstOrThrow({
        where: {
          userId: ownerId,
          organization: { projects: { some: { id: projectId } } },
        },
      });
      await prisma.membership.update({
        where: { id: membership.id },
        data: { role: "VIEWER" },
      });
      try {
        await expect(
          owner.manualExecution.startDatasetExecution(start),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await prisma.membership.update({
          where: { id: membership.id },
          data: { role: "OWNER" },
        });
      }
    });
    it("fails visibly for missing parameters, excess rows and unreviewed prerequisite row-pairing", async () => {
      const scope = await fixture(true);
      await prisma.testCase.update({
        where: { id: scope.testCaseId },
        data: { when: ["Unknown <missing>"] },
      });
      await expect(reviewed(scope)).rejects.toThrow(
        "Missing dataset parameter",
      );
      await prisma.testCase.update({
        where: { id: scope.testCaseId },
        data: { when: ["Action <variant>"] },
      });
      await prisma.testCaseDataset.update({
        where: { id: scope.datasetId },
        data: {
          rows: Array.from({ length: 51 }, (_, index) => ({
            name: `Row ${index}`,
            values: { variant: "Synthetic" },
          })),
        },
      });
      await expect(reviewed(scope)).rejects.toThrow("50 rows");
      await prisma.testCaseDataset.update({
        where: { id: scope.datasetId },
        data: { rows: [{ name: "One", values: { variant: "Synthetic" } }] },
      });
      await prisma.testCaseDataset.create({
        data: {
          testCaseId: scope.prerequisiteId!,
          parameterNames: ["variant"],
          rows: [{ name: "Unpaired", values: { variant: "Different" } }],
        },
      });
      await expect(reviewed(scope)).rejects.toThrow("Explicit row pairing");
      expect(
        await prisma.testRun.count({
          where: { projectId, manualTestCaseIds: { has: scope.testCaseId } },
        }),
      ).toBe(0);
    });
    it("refuses generic new runs for dataset cases/prerequisites but still reads existing legacy runs", async () => {
      const scope = await fixture(true);
      await expect(
        owner.manualExecution.start({
          projectId,
          testCaseIds: [scope.testCaseId],
        }),
      ).rejects.toThrow("Use Run dataset rows");
      const dependent = await owner.testCases.create({
        projectId,
        title: "Synthetic non-dataset dependent",
        testType: "FUNCTIONAL",
        steps: [{ action: "Concrete step" }],
      });
      await prisma.testCasePrerequisite.create({
        data: {
          projectId,
          dependentId: dependent.id,
          prerequisiteId: scope.testCaseId,
          createdById: ownerId,
        },
      });
      await expect(
        owner.manualExecution.start({ projectId, testCaseIds: [dependent.id] }),
      ).rejects.toThrow("Use Run dataset rows");
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
      const loaded = await owner.manualExecution.getForExecution({
        testRunId: legacy.id,
      });
      expect(loaded.executionContext).toBeNull();
      expect(loaded.datasetBatchRuns).toEqual([]);
      expect(loaded.cases[0]!.given).toEqual(["Given <variant>"]);
    });
    it("bounds total instance count, encoded dataset size and resolved procedure bytes before writes", async () => {
      const scope = await fixture();
      await prisma.testCaseDataset.update({
        where: { id: scope.datasetId },
        data: {
          rows: Array.from({ length: 50 }, (_, index) => ({
            name: `Row ${index}`,
            values: { variant: "Synthetic" },
          })),
        },
      });
      for (let index = 0; index < 10; index++) {
        const prerequisite = (
          await owner.testCases.create({
            projectId,
            title: `Synthetic bound prerequisite ${index}`,
            testType: "FUNCTIONAL",
            steps: [
              {
                action: "Concrete prerequisite",
                expectedResult: "Recorded outcome",
              },
            ],
          })
        ).id;
        await prisma.testCasePrerequisite.create({
          data: {
            projectId,
            dependentId: scope.testCaseId,
            prerequisiteId: prerequisite,
            createdById: ownerId,
          },
        });
      }
      await expect(reviewed(scope)).rejects.toThrow(
        "500 planned case instances",
      );
      const large = await fixture();
      await prisma.testCaseDataset.update({
        where: { id: large.datasetId },
        data: {
          rows: Array.from({ length: 27 }, (_, index) => ({
            name: `Row ${index}`,
            values: { variant: "x".repeat(10000) },
          })),
        },
      });
      await expect(reviewed(large)).rejects.toThrow("256 KiB");
      await prisma.testCaseDataset.update({
        where: { id: large.datasetId },
        data: {
          rows: Array.from({ length: 10 }, (_, index) => ({
            name: `Row ${index}`,
            values: { variant: "Concrete" },
          })),
        },
      });
      await prisma.testCase.update({
        where: { id: large.testCaseId },
        data: { given: Array.from({ length: 50 }, () => "x".repeat(10000)) },
      });
      await expect(reviewed(large)).rejects.toThrow("4 MiB");
      expect(
        await prisma.testRun.count({
          where: { projectId, manualTestCaseIds: { has: large.testCaseId } },
        }),
      ).toBe(0);
    });
    it("checks shared-library ownership and legacy byte limits before materializing procedure bodies", async () => {
      async function guarded(scope: Awaited<ReturnType<typeof fixture>>) {
        let bodyRead = false;
        const work = prisma.$transaction(async (tx) => {
          const guardedTx = new Proxy(tx, {
            get(target, key) {
              if (key !== "testCase") return Reflect.get(target, key);
              return new Proxy(target.testCase, {
                get(delegate, method) {
                  if (method !== "findMany")
                    return Reflect.get(delegate, method);
                  return async (args: Prisma.TestCaseFindManyArgs) => {
                    if (args.select?.steps || args.include?.steps) {
                      bodyRead = true;
                      throw Error("Synthetic body-read guard reached");
                    }
                    return delegate.findMany(args);
                  };
                },
              });
            },
          });
          return prepareDatasetExecution(guardedTx, ownerId, {
            projectId,
            testCaseId: scope.testCaseId,
            executionContext: context,
          });
        });
        return { work, read: () => bodyRead };
      }
      const oversized = await fixture();
      await prisma.testCase.update({
        where: { id: oversized.testCaseId },
        data: { given: Array.from({ length: 22 }, () => "x".repeat(100000)) },
      });
      const large = await guarded(oversized);
      await expect(large.work).rejects.toThrow("2 MiB source");
      expect(large.read()).toBe(false);
      const foreign = await fixture();
      const group = await prisma.sharedStepGroup.create({
        data: {
          projectId: otherProjectId,
          name: "Synthetic foreign body",
          steps: [
            { order: 0, action: "Foreign synthetic procedure must never load" },
          ],
        },
      });
      await prisma.testCase.update({
        where: { id: foreign.testCaseId },
        data: { sharedStepGroupId: group.id },
      });
      const denied = await guarded(foreign);
      await expect(denied.work).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(denied.read()).toBe(false);
      await prisma.testCase.update({
        where: { id: foreign.testCaseId },
        data: { sharedStepGroupId: null },
      });
    });
    it("holds live member/project authorization until the batch commits, then rejects revoked retries", async () => {
      const scope = await fixture(),
        { start } = await reviewed(scope);
      const membership = await prisma.membership.findFirstOrThrow({
        where: {
          userId: ownerId,
          organization: { projects: { some: { id: projectId } } },
        },
      });
      const profile = await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { qualityProfile: true },
      });
      let release!: () => void, arrive!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve)),
        entered = new Promise<void>((resolve) => (arrive = resolve));
      const intercepted = new Proxy(prisma, {
        get(target, key, receiver) {
          if (key !== "$transaction") return Reflect.get(target, key, receiver);
          return (
            callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options: {
              timeout?: number;
              maxWait?: number;
              isolationLevel?: Prisma.TransactionIsolationLevel;
            },
          ) =>
            target.$transaction(async (tx) => {
              const wrapped = new Proxy(tx, {
                get(inner, field) {
                  if (field !== "testRun") return Reflect.get(inner, field);
                  return new Proxy(inner.testRun, {
                    get(delegate, method) {
                      if (method !== "create")
                        return Reflect.get(delegate, method);
                      return async (args: Prisma.TestRunCreateArgs) => {
                        arrive();
                        await gate;
                        return delegate.create(args);
                      };
                    },
                  });
                },
              });
              return callback(wrapped);
            }, options);
        },
      });
      const running = startDatasetExecution(intercepted, ownerId, start);
      await Promise.race([
        entered,
        running.then(() => {
          throw Error("Synthetic interception did not run");
        }),
      ]);
      let revoked = false,
        projectChanged = false;
      const revoke = prisma.membership
        .update({ where: { id: membership.id }, data: { role: "VIEWER" } })
        .then((result) => {
          revoked = true;
          return result;
        });
      const change = prisma.project
        .update({
          where: { id: projectId },
          data: {
            qualityProfile: { syntheticRace: "changed after batch lock" },
          },
        })
        .then((result) => {
          projectChanged = true;
          return result;
        });
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(revoked).toBe(false);
        expect(projectChanged).toBe(false);
        release();
        const batch = await running;
        await Promise.all([revoke, change]);
        expect(batch.runs).toHaveLength(2);
        await expect(
          owner.manualExecution.startDatasetExecution(start),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        release();
        await running.catch(() => {});
        await Promise.all([revoke, change]);
        await prisma.membership.update({
          where: { id: membership.id },
          data: { role: "OWNER" },
        });
        await prisma.project.update({
          where: { id: projectId },
          data: { qualityProfile: profile.qualityProfile as never },
        });
      }
    });
    it("atomically rolls back a mid-batch database failure; concurrent retry recovers one batch", async () => {
      const scope = await fixture(),
        { start } = await reviewed(scope);
      const faulty = new Proxy(prisma, {
        get(target, key, receiver) {
          if (key !== "$transaction") return Reflect.get(target, key, receiver);
          return (
            callback: Parameters<typeof prisma.$transaction>[0],
            options: unknown,
          ) =>
            prisma.$transaction(async (tx) => {
              let creates = 0;
              const wrapped = new Proxy(tx, {
                get(inner, field) {
                  if (field !== "testRun") return Reflect.get(inner, field);
                  return new Proxy(inner.testRun, {
                    get(delegate, method) {
                      if (method !== "create")
                        return Reflect.get(delegate, method);
                      return async (...args: unknown[]) => {
                        if (++creates === 2)
                          throw new Error("Synthetic mid-batch failure");
                        return (
                          delegate.create as (
                            ...args: unknown[]
                          ) => Promise<unknown>
                        )(...args);
                      };
                    },
                  });
                },
              });
              return (
                callback as unknown as (tx: typeof wrapped) => Promise<unknown>
              )(wrapped);
            }, options as never);
        },
      });
      await expect(
        startDatasetExecution(faulty, ownerId, start),
      ).rejects.toThrow("Synthetic mid-batch failure");
      expect(
        await prisma.testRun.count({
          where: { projectId, manualTestCaseIds: { has: scope.testCaseId } },
        }),
      ).toBe(0);
      const [a, b] = await Promise.all([
        owner.manualExecution.startDatasetExecution(start),
        owner.manualExecution.startDatasetExecution(start),
      ]);
      expect(a.runs).toEqual(b.runs);
      expect(
        await prisma.testRun.count({
          where: { projectId, manualTestCaseIds: { has: scope.testCaseId } },
        }),
      ).toBe(2);
    });
  },
);
