import { beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import {
  reviewedStepWriteInputSchema,
  reviewedStepWriteKey,
  type ReviewedStepWriteInput,
  type ReviewedStepAck,
} from "./services/manualStepExecutionReviewSchema.js";
import {
  manualCaseReviewedExactWriteSchema,
  manualCaseReviewedReadKey,
  manualCaseReviewedWriteKey,
} from "./services/manualCaseResultSchema.js";
import { observationsSchema } from "./services/physicalValidation.js";
import { qualityProfileHash } from "./services/qualityExperienceProfile.js";
import { recordStepResultInputSchema } from "./services/manualStepExecution.js";
import { lockManualRetestAccess } from "./services/manualRetestScope.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
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
      ownerSubject: string,
      otherCaseId: string;
    const key = `step-execution-${Date.now()}`;
    beforeAll(async () => {
      assertOwnedTestDatabase(process.env.DATABASE_URL);
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
        // Independently declared synthetic transport provenance precedes the
        // native row. It is not inferred from a mutable cached User mapping.
        const authenticatedClerkSubject = `${key}-${suffix}`;
        const user = await prisma.user.create({
          data: {
            email: `${key}-${suffix}@example.com`,
            name: `Synthetic ${suffix}`,
            clerkUserId: authenticatedClerkSubject,
            memberships: { create: { organizationId, role, seatType } },
          },
          include: { memberships: true },
        });
        if (suffix === "owner") {
          ownerId = user.id;
          ownerSubject = authenticatedClerkSubject;
        }
        return appRouter.createCaller({
          prisma,
          user,
          authenticatedClerkSubject,
        });
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
    type StepDraft = Parameters<
      typeof owner.manualExecution.recordStepResult
    >[0];
    const preparedSteps = new Map<string, Promise<ReviewedStepWriteInput>>();
    const acknowledgements: ReviewedStepAck[] = [];
    function freeze<T>(value: T): T {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
      return value;
    }
    function fields(raw: StepDraft) {
      return {
        testRunId: raw.testRunId,
        testCaseId: raw.testCaseId,
        stepIndex: raw.stepIndex,
        status: raw.status,
        expectedRevisionId: raw.expectedRevisionId,
        note: raw.note ?? null,
        correctionReason: raw.correctionReason ?? null,
        evidenceAttachmentIds: [...(raw.evidenceAttachmentIds ?? [])],
        observations: {
          specimen: raw.observations?.specimen ?? "",
          hardwareRevision: raw.observations?.hardwareRevision ?? "",
          firmwareVersion: raw.observations?.firmwareVersion ?? "",
          environment: raw.observations?.environment ?? "",
          measurements: (raw.observations?.measurements ?? []).map((row) => ({
            ...row,
            instrument: row.instrument ?? "",
          })),
        },
      };
    }
    async function prepareStep(raw: StepDraft) {
      let prepared = preparedSteps.get(raw.idempotencyKey);
      if (!prepared) {
        prepared = (async () => {
          const readRequestId = randomUUID(),
            preview = await owner.manualStepExecutionReview.preview({
              projectId,
              testRunId: raw.testRunId,
              testCaseId: raw.testCaseId,
              stepIndex: raw.stepIndex,
              originalOrganizationId: organizationId,
              expectedClerkActorId: ownerSubject,
              expectedNativeActorId: ownerId,
              readRequestId,
            });
          expect(preview.readRequestId).toBe(readRequestId);
          expect(preview.scope).toEqual({
            projectId,
            organizationId,
            actorId: ownerId,
            actorClerkUserId: ownerSubject,
          });
          expect(preview.supported).toBe(true);
          expect(preview.procedureHash).not.toBeNull();
          expect(preview.currentFingerprint).not.toBeNull();
          return freeze(
            reviewedStepWriteInputSchema.parse({
              projectId,
              ...fields(raw),
              originalOrganizationId: organizationId,
              expectedClerkActorId: ownerSubject,
              expectedNativeActorId: ownerId,
              expectedProcedureHash: preview.procedureHash,
              expectedCurrentFingerprint: preview.currentFingerprint,
              idempotencyKey: raw.idempotencyKey,
              confirmed: true,
            }),
          );
        })();
        preparedSteps.set(raw.idempotencyKey, prepared); // One immutable preview/envelope for concurrent retries.
      }
      const original = await prepared,
        candidate = reviewedStepWriteInputSchema.parse({
          ...original,
          ...fields(raw),
        });
      // Deliberately changed negative payloads retain the ORIGINAL baseline;
      // they exercise the server's hash/CAS refusal, never acquire a fresh one.
      return reviewedStepWriteKey(candidate) === reviewedStepWriteKey(original)
        ? original
        : freeze(candidate);
    }
    async function recordStep(raw: StepDraft, caller = owner) {
      const request = await prepareStep(raw),
        ack = await caller.manualStepExecutionReview.record(request);
      expect(ack).toMatchObject({
        projectId,
        testRunId: request.testRunId,
        testCaseId: request.testCaseId,
        stepIndex: request.stepIndex,
        idempotencyKey: request.idempotencyKey,
        scope: {
          projectId,
          organizationId,
          actorId: ownerId,
          actorClerkUserId: ownerSubject,
        },
        requestHash: createHash("sha256")
          .update(reviewedStepWriteKey(request))
          .digest("hex"),
        provenance: "REVIEWED_REQUEST_BOUND_AT_WRITE",
      });
      expect(typeof ack.recovered).toBe("boolean");
      acknowledgements.push(ack);
      // Explicit old-wire comparison view; full scoped ACK is checked above.
      return { revisionId: ack.revisionId, caseStatus: ack.caseStatus };
    }
    async function prepareCase(
      scope: { testRunId: string; testCaseId: string },
      status: "PASS" | "FAIL",
      note: string | null,
    ) {
      const read = {
        projectId,
        ...scope,
        expectedScope: {
          projectId,
          organizationId,
          clerkActorId: ownerSubject,
        },
        expectedNativeActorId: ownerId,
        readRequestId: randomUUID(),
      };
      const access = await owner.manualCaseResults.accessReviewed(read);
      expect(access.readContext).toMatchObject({
        projection: "ACCESS",
        requestId: read.readRequestId,
        requested: manualCaseReviewedReadKey(read),
        scope: { ...read.expectedScope, actorId: ownerId },
      });
      const previewRead = { ...read, readRequestId: randomUUID() },
        preview = await owner.manualCaseResults.previewReviewed(previewRead);
      expect(preview.readContext).toMatchObject({
        projection: "PREVIEW",
        requestId: previewRead.readRequestId,
        requested: manualCaseReviewedReadKey(previewRead),
        scope: { ...read.expectedScope, actorId: ownerId },
      });
      return freeze(
        manualCaseReviewedExactWriteSchema.parse({
          projectId,
          ...scope,
          expectedScope: read.expectedScope,
          expectedNativeActorId: ownerId,
          mode: "EXACT",
          expectedFrozenEvidenceHash: preview.frozenEvidenceHash,
          expectedRevisionId: preview.currentRevisionId,
          expectedCurrentFingerprint: preview.currentFingerprint,
          status,
          note,
          observations: {},
          correctionReason: preview.current
            ? "Synthetic reviewed correction"
            : null,
          idempotencyKey: randomUUID(),
        }),
      );
    }
    async function recordCase(
      request: Awaited<ReturnType<typeof prepareCase>>,
    ) {
      const ack = await owner.manualCaseResults.recordReviewed(request);
      expect(ack).toMatchObject({
        mode: "EXACT",
        testRunId: request.testRunId,
        testCaseId: request.testCaseId,
        idempotencyKey: request.idempotencyKey,
        scope: { ...request.expectedScope, actorId: ownerId },
        requestHash: createHash("sha256")
          .update(manualCaseReviewedWriteKey(request))
          .digest("hex"),
      });
      return ack;
    }
    async function seedHistoricalLegacy(raw: StepDraft) {
      // An explicitly owned FIRST historical normalized-wire row, not a call to
      // a retired writer and not a reviewed UUID relabeled as legacy provenance.
      const admission = assertOwnedTestDatabase(process.env.DATABASE_URL);
      const request = recordStepResultInputSchema.parse(raw);
      expect(request.stepIndex).toBe(0);
      expect(request.expectedRevisionId).toBeNull();
      expect(request.evidenceAttachmentIds).toEqual([]);
      expect(request.correctionReason?.trim() || null).toBeNull();
      const preview = await owner.manualStepExecutionReview.preview({
        projectId,
        testRunId: request.testRunId,
        testCaseId: request.testCaseId,
        stepIndex: 0,
        originalOrganizationId: organizationId,
        expectedClerkActorId: ownerSubject,
        expectedNativeActorId: ownerId,
        readRequestId: randomUUID(),
      });
      expect(preview.supported).toBe(true);
      expect(preview.canRecord).toBe(true);
      const observations = observationsSchema.parse(request.observations ?? {}),
        note = request.note?.trim() || null;
      const requestHash = qualityProfileHash({
        testCaseId: request.testCaseId,
        stepIndex: 0,
        status: request.status,
        note,
        observations,
        evidenceAttachmentIds: [],
        expectedRevisionId: null,
        correctionReason: null,
      });
      const actorName = "Synthetic owned historical owner";
      const payloadBytes =
        Buffer.byteLength(
          JSON.stringify({
            note,
            observations,
            evidenceAttachments: [],
            actorName,
            correctionReason: null,
          }),
          "utf8",
        ) + 2048;
      expect(payloadBytes).toBeLessThanOrEqual(262144);
      return prisma.$transaction(
        async (tx) => {
          const [route] = await tx.$queryRaw<
            Array<{ database: string; schema: string }>
          >`SELECT current_database() AS database,current_schema() AS schema`;
          expect(route).toEqual({
            database: admission.database,
            schema: "public",
          });
          const scope = await lockManualRetestAccess(
            tx,
            ownerId,
            {
              projectId,
              sourceRunId: request.testRunId,
              testCaseId: request.testCaseId,
              expectedScope: {
                projectId,
                organizationId,
                clerkActorId: ownerSubject,
              },
            },
            true,
            ownerSubject,
            true,
          );
          expect(scope).toEqual({
            projectId,
            organizationId,
            actorId: ownerId,
            clerkActorId: ownerSubject,
          });
          expect(
            (
              await tx.organization.findUniqueOrThrow({
                where: { id: organizationId },
              })
            ).slug,
          ).toBe(key);
          expect(
            (
              await tx.testCase.findUniqueOrThrow({
                where: { id: request.testCaseId },
              })
            ).projectId,
          ).toBe(projectId);
          const [run] = await tx.$queryRaw<
            Array<{
              projectId: string;
              ciProvider: string;
              status: string;
              manualTestCaseIds: string[];
              manualPrerequisites: unknown;
              exact: boolean;
              steps: number;
            }>
          >`
          SELECT "projectId","ciProvider",status::text AS status,"manualTestCaseIds","manualPrerequisites",
          ("executionContext"->'caseDefinitions' IS NOT DISTINCT FROM ${JSON.stringify([preview.frozenDefinition])}::jsonb) AS exact,
          jsonb_array_length("executionContext"->'caseDefinitions'->0->'steps') AS steps FROM "TestRun" WHERE id=${request.testRunId} FOR UPDATE`;
          expect(run).toEqual({
            projectId,
            ciProvider: "manual",
            status: "RUNNING",
            manualTestCaseIds: [request.testCaseId],
            manualPrerequisites: { [request.testCaseId]: [] },
            exact: true,
            steps: 2,
          });
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ManualStepExecutionReview/v1'),hashtext(${qualityProfileHash({ actorId: ownerId, idempotencyKey: request.idempotencyKey })}))::text`;
          const where = {
            testRunId: request.testRunId,
            testCaseId: request.testCaseId,
          };
          expect(
            await Promise.all([
              tx.testResult.count({ where }),
              tx.manualStepResultHead.count({ where }),
              tx.manualStepResultRevision.count({ where }),
              tx.manualCaseResultHead.count({ where }),
              tx.manualCaseResultRevision.count({ where }),
              tx.manualStepResultRevision.count({
                where: {
                  actorId: ownerId,
                  idempotencyKey: request.idempotencyKey,
                },
              }),
            ]),
          ).toEqual([0, 0, 0, 0, 0, 0]);
          const [namespace] = await tx.$queryRaw<
            Array<{ count: bigint }>
          >`SELECT count(*) AS count FROM "AuditLog" WHERE "entityType" LIKE 'ManualStepExecutionReview/%' AND "actorId"=${ownerId} AND metadata->>'idempotencyKey'=${request.idempotencyKey}`;
          expect(namespace?.count).toBe(0n);
          const revision = await tx.manualStepResultRevision.create({
            data: {
              ...where,
              stepIndex: 0,
              revisionNumber: 1,
              status: request.status,
              caseStatusAtRecord: null,
              note,
              observations,
              evidenceAttachmentIds: [],
              evidenceAttachments: [],
              actorId: ownerId,
              actorName,
              correctionReason: null,
              previousRevisionId: null,
              idempotencyKey: request.idempotencyKey,
              requestHash,
            },
          });
          await tx.manualStepResultHead.create({
            data: {
              ...where,
              stepIndex: 0,
              currentRevisionId: revision.id,
              revisionCount: 1,
              currentPayloadBytes: payloadBytes,
            },
          });
          return { revisionId: revision.id, caseStatus: null };
        },
        { isolationLevel: "RepeatableRead", timeout: 20000, maxWait: 5000 },
      );
    }

    it("refuses new retired writes but recovers only an explicitly owned historical legacy receipt", async () => {
      const scope = await procedure(),
        legacy = input(scope, 0, "FAIL");
      await expect(
        owner.manualExecution.recordStepResult(legacy),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(
        owner.manualExecution.recordResult({ ...scope, status: "PASS" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(
        await prisma.manualStepResultRevision.count({ where: scope }),
      ).toBe(0);
      expect(await prisma.testResult.count({ where: scope })).toBe(0);
      const originalReviewedBaseline = await prepareStep(legacy);
      const saved = await seedHistoricalLegacy(legacy);
      expect(await owner.manualExecution.recordStepResult(legacy)).toEqual(
        saved,
      );
      await expect(
        owner.manualExecution.recordStepResult({
          ...legacy,
          note: "Different wire",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        owner.manualStepExecutionReview.record(originalReviewedBaseline),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(
        await prisma.manualStepResultRevision.count({ where: scope }),
      ).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: {
            entityType: { startsWith: "ManualStepExecutionReview/" },
            actorId: ownerId,
            metadata: {
              path: ["idempotencyKey"],
              equals: legacy.idempotencyKey,
            },
          },
        }),
      ).toBe(0);
    });

    it("records each frozen step, derives a verdict only when complete, and preserves the saved definition", async () => {
      const scope = await procedure();
      const first = await recordStep({
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
      const second = await recordStep(input(scope, 1));
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
        await recordStep(input(scope, 0, status));
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
        await recordStep(input(scope, 0, statuses[0]));
        expect(
          (await recordStep(input(scope, 1, statuses[1]))).caseStatus,
        ).toBe(expected);
      }
    });

    it("retains justified correction history, rejects stale edits and recovers actor-bound original receipts", async () => {
      const scope = await procedure(1);
      const original = {
        ...input(scope, 0, "FAIL"),
        note: "Original observation",
      };
      const first = await recordStep(original);
      const correction = {
        ...input(scope),
        expectedRevisionId: first.revisionId,
        correctionReason: "Operator corrected a mistyped verdict",
        note: "Corrected observation",
      };
      await expect(
        recordStep({
          ...correction,
          correctionReason: " ",
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const second = await recordStep(correction);
      await expect(
        recordStep({
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
      expect(await recordStep(original)).toEqual(first);
      await expect(
        recordStep({
          ...original,
          note: "Changed payload",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await owner.manualExecution.complete({ testRunId: scope.testRunId });
      expect(await recordStep(correction)).toEqual(second);
      await expect(
        recordStep({
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
        recordStep(firstInput),
        recordStep(firstInput),
      ]);
      expect(receipts[0]).toEqual(receipts[1]);
      const correctionInputs = ["FAIL", "BLOCKED"].map((status) => ({
        ...input(scope),
        status: status as "FAIL" | "BLOCKED",
        expectedRevisionId: receipts[0]!.revisionId,
        correctionReason: "Synthetic justified correction",
      }));
      // Both actors review the SAME captured head before either write starts.
      await Promise.all(correctionInputs.map(prepareStep));
      const corrections = await Promise.allSettled(
        correctionInputs.map((raw) => recordStep(raw)),
      );
      const retries = acknowledgements.filter(
        (ack) => ack.idempotencyKey === firstInput.idempotencyKey,
      );
      expect(retries.map((ack) => ack.recovered).sort()).toEqual([false, true]);
      expect(new Set(retries.map((ack) => ack.requestHash)).size).toBe(1);
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
      const existingStep = input(existing);
      await prepareStep(existingStep);
      await recordCase(
        await prepareCase(existing, "PASS", "Keep existing verdict"),
      );
      await expect(recordStep(existingStep)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect((await current(existing)).cases[0]).toMatchObject({
        stepExecutionAvailable: false,
        currentResult: { status: "PASS", note: "Keep existing verdict" },
      });
      const scoped = await procedure();
      const wholeCase = await prepareCase(scoped, "PASS", null);
      await recordStep(input(scoped));
      await expect(recordCase(wholeCase)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    it("does not masquerade legacy live or BDD definitions as frozen structured steps", async () => {
      const scope = await procedure();
      const prepared = await prepareStep(input(scope));
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
        owner.manualStepExecutionReview.record({
          ...prepared,
          testRunId: legacy.id,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow("frozen structured");
      expect(
        (await owner.manualExecution.getForExecution({ testRunId: legacy.id }))
          .cases[0],
      ).toMatchObject({ stepExecutionAvailable: false, stepResults: [] });
      await expect(
        owner.manualStepExecutionReview.record({
          ...prepared,
          stepIndex: 2,
          idempotencyKey: randomUUID(),
        }),
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
        recordStep({
          ...input(scope),
          observations,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await recordStep({
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
      await expect(recordStep(input(dependent))).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      const pass = await recordStep(input(prerequisite));
      const performed = await recordStep(input(dependent));
      expect(
        (await current(dependent)).cases.find(
          (c) => c.testCaseId === d.testCaseId,
        )?.currentResult,
      ).toBeNull();
      await expect(
        recordStep({
          ...input(prerequisite, 0, "FAIL"),
          expectedRevisionId: pass.revisionId,
          correctionReason: "Attempted correction",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await recordStep({
        ...input(dependent, 0, "BLOCKED"),
        expectedRevisionId: performed.revisionId,
        correctionReason: "Later fixture marked blocked",
      });
      await expect(
        recordStep({
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
          recordStep({
            ...input(scope),
            evidenceAttachmentIds: [id],
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await recordStep({
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
      const saved = await recordStep(request);
      for (const caller of [viewer, readonly, outsider])
        await expect(recordStep(request, caller)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
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
      await expect(recordStep(request)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await prisma.membership.update({
        where: { id: membership.id },
        data: { seatType: "FULL" },
      });
      await prisma.organization.update({
        where: { id: organizationId },
        data: { suspendedAt: new Date() },
      });
      await expect(recordStep(request)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await prisma.organization.update({
        where: { id: organizationId },
        data: { suspendedAt: null },
      });
      expect(await recordStep(request)).toEqual(saved);
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
      await recordStep({
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
