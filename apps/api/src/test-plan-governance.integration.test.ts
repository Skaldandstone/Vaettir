// Authored native fixture only. Do not run against deployed/customer databases.
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated =
  process.env.VAETTIR_PLAN_GOVERNANCE_NATIVE_FIXTURE === "1" &&
  url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");
describe.skipIf(!isolated)(
  "native governed criterion text and unassigned-plan CAS",
  () => {
    let caller: ReturnType<typeof appRouter.createCaller>,
      viewer: ReturnType<typeof appRouter.createCaller>;
    let scope: {
      projectId: string;
      testPlanId: string;
      originalOrganizationId: string;
      expectedClerkActorId: string;
    };
    let criterionId: string, releaseId: string, ownerId: string;
    beforeAll(async () => {
      assertOwnedTestDatabase(process.env.DATABASE_URL);
      const key = `synthetic-plan-governance-${randomUUID()}`;
      // Independent synthetic transport declarations, not JWT verification or
      // subjects inferred from a later mutable native User mapping.
      const ownerSubject = key, viewerSubject = `${key}-read`;
      const tier = await prisma.planTier.findUniqueOrThrow({
        where: { key: "free" },
      });
      const org = await prisma.organization.create({
        data: { name: key, slug: key, planTierId: tier.id },
      });
      const owner = await prisma.user.create({
        data: {
          email: `${key}@example.com`,
          clerkUserId: ownerSubject,
          memberships: { create: { organizationId: org.id, role: "OWNER", seatType: "FULL" } },
        },
        include: { memberships: true },
      });
      const read = await prisma.user.create({
        data: {
          email: `${key}-read@example.com`,
          clerkUserId: viewerSubject,
          memberships: {
            create: {
              organizationId: org.id,
              role: "VIEWER",
              seatType: "READ_ONLY",
            },
          },
        },
        include: { memberships: true },
      });
      const project = await prisma.project.create({
        data: { name: key, slug: key, organizationId: org.id },
      });
      const type = await prisma.testPlanType.create({
        data: {
          name: key,
          key,
          category: "RELEASE_READINESS",
          fieldSchema: {},
        },
      });
      const plan = await prisma.testPlan.create({
        data: {
          projectId: project.id,
          testPlanTypeId: type.id,
          name: key,
          customFields: { retained: [1, false] },
          acceptanceCriteria: {
            create: { description: "Synthetic original", status: "AT_RISK" },
          },
        },
        include: { acceptanceCriteria: true },
      });
      releaseId = (
        await prisma.release.create({
          data: { projectId: project.id, name: key },
        })
      ).id;
      scope = {
        projectId: project.id,
        testPlanId: plan.id,
        originalOrganizationId: org.id,
        expectedClerkActorId: ownerSubject,
      };
      criterionId = plan.acceptanceCriteria[0]!.id;
      ownerId = owner.id;
      caller = appRouter.createCaller({ prisma, user: owner, authenticatedClerkSubject: ownerSubject });
      viewer = appRouter.createCaller({ prisma, user: read, authenticatedClerkSubject: viewerSubject });
    });
    it("native edit and lost-ACK replay retain a single complete history/version and raw verdict", async () => {
      const baseline = await caller.testPlanGovernance.preview(scope);
      const nativeScope = { projectId: scope.projectId, organizationId: scope.originalOrganizationId, actorId: ownerId, actorClerkUserId: scope.expectedClerkActorId };
      expect(baseline.scope).toEqual(nativeScope);
      const input = {
        ...scope,
        criterionId,
        expectedPlanRevision: baseline.planRevision,
        expectedCriterionRevision: baseline.criterionRevisions[criterionId]!,
        description: "Synthetic reviewed",
        reason: "Synthetic clarity",
        confirmed: true as const,
        requestId: randomUUID(),
      };
      const first =
        await caller.testPlanGovernance.editCriterionDescription(input);
      expect(first.scope).toEqual(nativeScope);
      expect(
        await caller.testPlanGovernance.editCriterionDescription(input),
      ).toEqual({ ...first, replayed: true });
      expect(
        await prisma.acceptanceCriterion.findUniqueOrThrow({
          where: { id: criterionId },
        }),
      ).toMatchObject({ description: "Synthetic reviewed", status: "AT_RISK" });
      expect(
        await prisma.testPlanVersion.count({
          where: { testPlanId: scope.testPlanId },
        }),
      ).toBe(1);
      const history = await caller.testPlanGovernance.history({ ...scope, take: 5 });
      expect(history.scope).toEqual(nativeScope);
      expect(history.entries[0]?.receipt.before.criteria[0]?.description).toBe("Synthetic original");
      await expect(
        viewer.testPlanGovernance.editCriterionDescription(input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("only one concurrent assignment wins without reassigning or losing the original receipt", async () => {
      const baseline = await caller.testPlanGovernance.preview(scope);
      const base = {
        ...scope,
        releaseId,
        expectedReleaseId: null,
        expectedPlanRevision: baseline.planRevision,
        reason: "Synthetic assignment",
        confirmed: true as const,
      };
      const attempts = await Promise.allSettled([
        caller.testPlanGovernance.attachUnassignedPlan({
          ...base,
          requestId: randomUUID(),
        }),
        caller.testPlanGovernance.attachUnassignedPlan({
          ...base,
          requestId: randomUUID(),
        }),
      ]);
      expect(
        attempts.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        attempts.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      expect(
        (
          await prisma.testPlan.findUniqueOrThrow({
            where: { id: scope.testPlanId },
          })
        ).releaseId,
      ).toBe(releaseId);
    });
    it("native verdict-only writes retain current words and replay one audited decision", async () => {
      const baseline = await caller.testPlanGovernance.preview(scope);
      const input = {
        ...scope,
        criterionId,
        expectedPlanRevision: baseline.planRevision,
        expectedCriterionRevision: baseline.criterionRevisions[criterionId]!,
        status: "MET" as const,
        reason: "Synthetic evidence reviewed",
        confirmed: true as const,
        requestId: randomUUID(),
      };
      const first = await caller.testPlanGovernance.setCriterionVerdict(input);
      expect(
        await caller.testPlanGovernance.setCriterionVerdict(input),
      ).toEqual({ ...first, replayed: true });
      expect(
        await prisma.acceptanceCriterion.findUniqueOrThrow({
          where: { id: criterionId },
        }),
      ).toMatchObject({ description: "Synthetic reviewed", status: "MET" });
      const receipt = (
        await caller.testPlanGovernance.history({ ...scope, take: 5 })
      ).entries.find(
        (row) => row.receipt.ack.requestId === input.requestId,
      )!.receipt;
      expect(receipt.before.criteria[0]!.status).toBe("AT_RISK");
      expect(receipt.after.criteria[0]!.status).toBe("MET");
      await expect(
        caller.testPlans.updateAcceptanceCriterion({
          id: criterionId,
          description: "Stale/intentional words",
          status: "NOT_MET",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
    it("native add/link/delete retains raw rows with exact receipts and same-project requirement choices", async () => {
      const requirement = await prisma.requirement.create({
        data: {
          projectId: scope.projectId,
          title: `Synthetic governed requirement ${randomUUID()}`,
        },
      });
      const baseline = await caller.testPlanGovernance.preview(scope),
        newId = randomUUID(),
        raw = "  Synthetic criterion\nwith exact formatting.  \n";
      const addition = {
        ...scope,
        criterionId: newId,
        description: raw,
        requirementId: requirement.id,
        requestId: randomUUID(),
        expectedPlanRevision: baseline.planRevision,
        reason: "Synthetic addition",
        confirmed: true as const,
      };
      const added = await caller.testPlanGovernance.addCriterion(addition);
      expect(await caller.testPlanGovernance.addCriterion(addition)).toEqual({
        ...added,
        replayed: true,
      });
      expect(
        await prisma.acceptanceCriterion.findUniqueOrThrow({
          where: { id: newId },
        }),
      ).toMatchObject({
        description: raw,
        status: "PENDING",
        requirementId: requirement.id,
      });
      const choices = await caller.testPlanGovernance.requirementChoices({
        ...scope,
        search: requirement.id,
      });
      expect(choices.choices).toEqual([
        { id: requirement.id, title: requirement.title },
      ]);
      const review = await caller.testPlanGovernance.preview(scope),
        original = review.snapshot.criteria.find((c) => c.id === criterionId)!;
      await caller.testPlanGovernance.setCriterionRequirement({
        ...scope,
        criterionId,
        expectedPlanRevision: review.planRevision,
        expectedCriterionRevision: review.criterionRevisions[criterionId]!,
        expectedRequirementId: original.requirementId,
        requirementId: requirement.id,
        requestId: randomUUID(),
        reason: "Synthetic association",
        confirmed: true,
      });
      const removing = await caller.testPlanGovernance.preview(scope),
        target = removing.snapshot.criteria.find((c) => c.id === newId)!;
      const deletion = {
        ...scope,
        criterionId: newId,
        expectedPlanRevision: removing.planRevision,
        expectedCriterionRevision: removing.criterionRevisions[newId]!,
        expectedRequirementId: target.requirementId,
        requestId: randomUUID(),
        reason: "Synthetic removal",
        confirmed: true as const,
      };
      const removed = await caller.testPlanGovernance.deleteCriterion(deletion);
      expect(await caller.testPlanGovernance.deleteCriterion(deletion)).toEqual(
        { ...removed, replayed: true },
      );
      expect(
        await prisma.acceptanceCriterion.findUnique({ where: { id: newId } }),
      ).toBeNull();
      const receipt = (
        await caller.testPlanGovernance.history({ ...scope, take: 5 })
      ).entries.find(
        (row) => row.receipt.ack.requestId === deletion.requestId,
      )!.receipt;
      expect(
        receipt.before.criteria.find((c) => c.id === newId)!.description,
      ).toBe(raw);
      expect(receipt.after.criteria.some((c) => c.id === newId)).toBe(false);
    });
    it("native header edits retain NULL/empty/absent distinctions and exact receipts without changing governed scope", async () => {
      const before = await caller.testPlanGovernance.preview(scope),
        original = before.snapshot;
      const input = {
        ...scope,
        expectedPlanRevision: before.planRevision,
        requestId: randomUUID(),
        reason: "Synthetic header review",
        confirmed: true as const,
        name: "  Exact native header name  ",
        description: null,
      };
      const saved = await caller.testPlanGovernance.editPlanHeader(input);
      expect(await caller.testPlanGovernance.editPlanHeader(input)).toEqual({
        ...saved,
        replayed: true,
      });
      const after = await caller.testPlanGovernance.preview(scope);
      expect(after.snapshot).toMatchObject({
        name: input.name,
        description: null,
        status: original.status,
        customFields: original.customFields,
        executionTemplate: original.executionTemplate,
        releaseId: original.releaseId,
        criteria: original.criteria,
      });
      await caller.testPlanGovernance.editPlanHeader({
        ...scope,
        expectedPlanRevision: after.planRevision,
        requestId: randomUUID(),
        reason: "Synthetic empty description",
        confirmed: true,
        description: "",
      });
      const empty = await caller.testPlanGovernance.preview(scope);
      expect(empty.snapshot.description).toBe("");
      expect(empty.snapshot.name).toBe(input.name);
    });
    it("native JSONB precision canary refuses new snapshots/metadata without rewriting native numbers (AUTHORED NOT RUN)", async () => {
      const unique = `synthetic-json-codec-${randomUUID()}`;
      const type = await prisma.testPlanType.create({
        data: {
          key: unique,
          name: unique,
          category: "CUSTOM",
          fieldSchema: {
            type: "object",
            properties: { objective: { type: "string" } },
          },
        },
      });
      for (const column of ["customFields", "executionTemplate"] as const) {
        const plan = await prisma.testPlan.create({
          data: {
            projectId: scope.projectId,
            testPlanTypeId: type.id,
            name: `${unique}-${column}`,
            customFields: { objective: "old" },
          },
        });
        // Seed only a dedicated synthetic native row with an exact JSONB literal;
        // constructing this number in JS would defeat the precision canary.
        if (column === "customFields")
          await prisma.$executeRaw`UPDATE "TestPlan" SET "customFields"=${'{"objective":"old","unknown":{"large":9007199254740993}}'}::jsonb WHERE id=${plan.id}`;
        else
          await prisma.$executeRaw`UPDATE "TestPlan" SET "executionTemplate"=${'{"unknown":{"large":9007199254740993}}'}::jsonb WHERE id=${plan.id}`;
        const selected = { ...scope, testPlanId: plan.id };
        const before = await prisma.$queryRaw<
          Array<{ fields: string; template: string; status: string }>
        >`SELECT "customFields"::text AS fields,"executionTemplate"::text AS template,status::text AS status FROM "TestPlan" WHERE id=${plan.id}`;
        expect(
          before[0]![column === "customFields" ? "fields" : "template"],
        ).toContain("9007199254740993");
        const reviewed = await caller.testPlanGovernance.preview(selected);
        const base = {
          ...selected,
          expectedPlanRevision: reviewed.planRevision,
          reason: "Synthetic native precision boundary",
          confirmed: true as const,
        };
        await expect(
          caller.testPlanGovernance.setPlanStatus({
            ...base,
            requestId: randomUUID(),
            expectedStatus: "DRAFT",
            status: "ACTIVE",
            intent: "CHANGE",
          }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        await expect(
          caller.testPlanGovernance.editPlanCustomFields({
            ...base,
            requestId: randomUUID(),
            expectedFieldSchemaHash: reviewed.metadataSchema.fieldSchemaHash!,
            changes: [{ operation: "SET", key: "objective", value: "new" }],
          }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(
          await prisma.$queryRaw`SELECT "customFields"::text AS fields,"executionTemplate"::text AS template,status::text AS status FROM "TestPlan" WHERE id=${plan.id}`,
        ).toEqual(before);
        expect(
          await prisma.testPlanVersion.count({
            where: { testPlanId: plan.id },
          }),
        ).toBe(0);
        expect(
          await prisma.auditLog.count({
            where: { entityType: "TestPlanGovernanceWrite", entityId: plan.id },
          }),
        ).toBe(0);
      }
      // A rounded native type schema must not be advertised as exact provenance.
      await prisma.$executeRaw`UPDATE "TestPlanType" SET "fieldSchema"=${'{"type":"object","description":9007199254740993,"properties":{"objective":{"type":"string"}}}'}::jsonb WHERE id=${type.id}`;
      const schemaPlan = await prisma.testPlan.create({
        data: {
          projectId: scope.projectId,
          testPlanTypeId: type.id,
          name: `${unique}-schema`,
          customFields: {},
        },
      });
      expect(
        await caller.testPlanGovernance.preview({
          ...scope,
          testPlanId: schemaPlan.id,
        }),
      ).toMatchObject({
        canRecover: true,
        metadataSchema: {
          fieldSchema: null,
          fieldSchemaHash: null,
          supported: false,
          canEdit: false,
        },
      });
      // Synthetic resources are retained; no broad fixture cleanup.
    });
    it("native synthetic status/metadata revisions preserve unknown keys, explicit reopen and exact typed receipts", async () => {
      // Dedicated test-owned type/plan only. Never edit a built-in or customer
      // schema to force fixture admission. This fixture is AUTHORED NOT RUN.
      const unique = `synthetic-governed-properties-${randomUUID()}`;
      const type = await prisma.testPlanType.create({
        data: {
          key: unique,
          name: unique,
          category: "CUSTOM",
          fieldSchema: {
            type: "object",
            properties: {
              objective: { type: "string" },
              areas: { type: "array", items: { type: "string" } },
            },
          },
        },
      });
      const raw = JSON.parse(
        '{"objective":"old","areas":["same","same",""],"__proto__":{"retained":true},"unknown":{"values":[false,0,null," raw "]}}',
      );
      const plan = await prisma.testPlan.create({
        data: {
          projectId: scope.projectId,
          testPlanTypeId: type.id,
          name: unique,
          customFields: raw,
          description: null,
        },
      });
      const selected = { ...scope, testPlanId: plan.id },
        before = await caller.testPlanGovernance.preview({
          ...selected,
          requestId: randomUUID(),
        });
      const status = {
        ...selected,
        expectedPlanRevision: before.planRevision,
        expectedStatus: "DRAFT" as const,
        status: "APPROVED" as const,
        intent: "CHANGE" as const,
        requestId: randomUUID(),
        reason: "Synthetic approval lifecycle label, not qualified sign-off",
        confirmed: true as const,
      };
      const approved = await caller.testPlanGovernance.setPlanStatus(status);
      expect(await caller.testPlanGovernance.setPlanStatus(status)).toEqual({
        ...approved,
        replayed: true,
      });
      const frozen = await caller.testPlanGovernance.preview(selected);
      expect(frozen).toMatchObject({
        canRecover: true,
        statusActions: { canReopen: true },
        metadataSchema: { canEdit: false },
      });
      const changes = [
        {
          operation: "SET" as const,
          key: "objective",
          value: " raw\n authored ",
        },
        {
          operation: "SET" as const,
          key: "areas",
          value: ["", "same", "same", " last\n"],
        },
      ];
      await expect(
        caller.testPlanGovernance.editPlanCustomFields({
          ...selected,
          expectedPlanRevision: frozen.planRevision,
          expectedFieldSchemaHash: frozen.metadataSchema.fieldSchemaHash!,
          changes,
          requestId: randomUUID(),
          reason: "Frozen refusal",
          confirmed: true,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await caller.testPlanGovernance.setPlanStatus({
        ...selected,
        expectedPlanRevision: frozen.planRevision,
        expectedStatus: "APPROVED",
        status: "DRAFT",
        intent: "REOPEN",
        requestId: randomUUID(),
        reason: "Explicit synthetic reopen",
        confirmed: true,
      });
      const reviewed = await caller.testPlanGovernance.preview(selected);
      const metadata = {
        ...selected,
        expectedPlanRevision: reviewed.planRevision,
        expectedFieldSchemaHash: reviewed.metadataSchema.fieldSchemaHash!,
        changes,
        requestId: randomUUID(),
        reason: "Native synthetic declared-field review",
        confirmed: true as const,
      };
      const saved =
        await caller.testPlanGovernance.editPlanCustomFields(metadata);
      expect(
        await caller.testPlanGovernance.editPlanCustomFields(metadata),
      ).toEqual({ ...saved, replayed: true });
      const after = await caller.testPlanGovernance.preview(selected),
        fields = after.snapshot.customFields as Record<string, unknown>;
      expect(fields.objective).toBe(" raw\n authored ");
      expect(fields.areas).toEqual(changes[1]!.value);
      expect(fields.unknown).toEqual(raw.unknown);
      expect(Object.hasOwn(fields, "__proto__")).toBe(true);
      expect(fields.__proto__).toEqual(raw.__proto__);
      expect(after.snapshot).toMatchObject({
        name: before.snapshot.name,
        description: null,
        releaseId: null,
        criteria: [],
        executionTemplate: before.snapshot.executionTemplate,
        status: "DRAFT",
      });
      const history = await caller.testPlanGovernance.history({
        ...selected,
        take: 5,
      });
      const receipt = history.entries.find(
        (entry) => entry.receipt.ack.requestId === metadata.requestId,
      )!.receipt;
      expect(receipt.metadataReview).toEqual({
        testPlanTypeId: type.id,
        fieldSchema: type.fieldSchema,
        fieldSchemaHash: metadata.expectedFieldSchemaHash,
        changes,
      });
      expect(
        await prisma.testPlanVersion.count({ where: { testPlanId: plan.id } }),
      ).toBe(3);
    });
  },
);
