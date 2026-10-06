import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { runConfigurationSchema } from "./services/qualityExperienceProfile.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";

// Safe failure diagnostics for owned synthetic concurrency only. Never print
// SQL, statements, native messages, query parameters or arbitrary error fields.
function ownDataProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value as unknown : undefined;
}
function concurrentFailureCodes(value: unknown) {
  const code = (candidate: unknown) => typeof candidate === "string" && /^[A-Z0-9_]{1,32}$/.test(candidate) ? candidate : "UNAVAILABLE";
  const cause = ownDataProperty(value, "cause");
  return JSON.stringify({ outerCode: code(ownDataProperty(value, "code")), nativeCode: code(ownDataProperty(cause, "code")), sqlState: code(ownDataProperty(ownDataProperty(cause, "meta"), "code")) });
}

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated =
  url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");

describe.skipIf(!isolated)(
  "saved plan configurations and reviewed repeated executions",
  () => {
    let owner: ReturnType<typeof appRouter.createCaller>;
    let viewer: ReturnType<typeof appRouter.createCaller>;
    let readonly: ReturnType<typeof appRouter.createCaller>;
    let outsider: ReturnType<typeof appRouter.createCaller>;
    let projectId: string;
    let ownerOrganizationId: string;
    let ownerClerkActorId: string;
    let caseIds: string[];
    let otherCaseId: string;
    let typeId: string;
    const key = `plan-execution-${Date.now()}`;
    beforeAll(async () => {
      assertOwnedTestDatabase(process.env.DATABASE_URL);
      const tier = await prisma.planTier.findUniqueOrThrow({
        where: { key: "free" },
      });
      const org = await prisma.organization.create({
        data: { name: key, slug: key, planTierId: tier.id },
      });
      const other = await prisma.organization.create({
        data: {
          name: `${key}-outside`,
          slug: `${key}-outside`,
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
        if (suffix === "owner") ownerClerkActorId = authenticatedClerkSubject;
        return appRouter.createCaller({ prisma, user, authenticatedClerkSubject, staff: null, staffAttempt: false, securityLogger: () => undefined });
      }
      ownerOrganizationId = org.id;
      owner = await caller("owner", org.id, "OWNER");
      viewer = await caller("viewer", org.id, "VIEWER");
      readonly = await caller("readonly", org.id, "EDITOR", "READ_ONLY");
      outsider = await caller("outsider", other.id, "OWNER");
      projectId = (
        await owner.project.create({
          organizationId: org.id,
          name: "Synthetic tailored plan project",
        })
      ).id;
      const otherProject = (
        await outsider.project.create({
          organizationId: other.id,
          name: "Synthetic other tenant",
        })
      ).id;
      caseIds = [];
      for (const title of [
        "Synthetic console login",
        "Synthetic controller action",
      ])
        caseIds.push(
          (
            await owner.testCases.create({
              projectId,
              title,
              testType: "FUNCTIONAL",
              steps: [
                {
                  action: "Synthetic manual procedure",
                  expectedResult: "Recorded evidence",
                },
              ],
            })
          ).id,
        );
      otherCaseId = (
        await outsider.testCases.create({
          projectId: otherProject,
          title: "Other tenant",
          testType: "FUNCTIONAL",
          steps: [{ action: "Synthetic other tenant procedure" }],
        })
      ).id;
      // Synthetic declared fields permit reviewed key edits without changing
      // any built-in/customer type. Unknown saved siblings stay retained.
      typeId = (await prisma.testPlanType.create({ data: {
        key: `${key}-type`, name: "Synthetic reviewed plan fields", category: "CUSTOM",
        fieldSchema: { type: "object", properties: { humanObjective: { type: "string" }, retained: { type: "string" } } },
      } })).id;
    });
    async function createPlan() {
      return owner.testPlans.create({
        projectId,
        testPlanTypeId: typeId,
        name: "Synthetic reusable plan",
        customFields: {
          humanObjective: "Do not replace",
          future: { retained: true },
        },
      });
    }
    async function renamePlan(testPlanId: string, name: string) {
      const scope = { projectId, testPlanId, originalOrganizationId: ownerOrganizationId, expectedClerkActorId: ownerClerkActorId };
      const preview = await owner.testPlanGovernance.preview(scope);
      return owner.testPlanGovernance.editPlanHeader({
        ...scope, name, expectedPlanRevision: preview.planRevision,
        requestId: randomUUID(), reason: "Synthetic reviewed header rename", confirmed: true,
      });
    }
    const governanceScope = (testPlanId: string) => ({ projectId, testPlanId, originalOrganizationId: ownerOrganizationId, expectedClerkActorId: ownerClerkActorId });
    async function setPlanStatus(testPlanId: string) {
      const scope = governanceScope(testPlanId), preview = await owner.testPlanGovernance.preview(scope);
      if (preview.snapshot.status !== "DRAFT") throw Error("Synthetic status intent requires the genuinely current draft lifecycle.");
      return owner.testPlanGovernance.setPlanStatus({ ...scope, expectedStatus: preview.snapshot.status, status: "ACTIVE", intent: "CHANGE", expectedPlanRevision: preview.planRevision, requestId: randomUUID(), reason: "Synthetic reviewed lifecycle change", confirmed: true });
    }
    async function editPlanField(testPlanId: string, change: { operation: "SET"; key: string; value: string } | { operation: "REMOVE"; key: string }) {
      const scope = governanceScope(testPlanId), preview = await owner.testPlanGovernance.preview(scope);
      if (!preview.metadataSchema.fieldSchemaHash) throw Error("Synthetic native field schema was unavailable; no fallback hash was invented.");
      return owner.testPlanGovernance.editPlanCustomFields({ ...scope, expectedFieldSchemaHash: preview.metadataSchema.fieldSchemaHash, changes: [change], expectedPlanRevision: preview.planRevision, requestId: randomUUID(), reason: "Synthetic reviewed key edit", confirmed: true });
    }
    function template(ids = caseIds) {
      return {
        version: 1 as const,
        testCaseIds: ids,
        configurations: [
          {
            id: randomUUID(),
            name: "Console A",
            context: runConfigurationSchema.parse({
              platform: "PS5",
              build: "synthetic-build-a",
            }),
          },
          {
            id: randomUUID(),
            name: "Synthetic rig B",
            context: runConfigurationSchema.parse({
              rig: "Rig B",
              firmwareVersion: "synthetic-b",
              batchOrLot: "Lot B",
              protocolReference: "Operator protocol",
            }),
          },
        ],
      };
    }
    async function configure(id: string, value = template()) {
      const current = await owner.testPlans.executionTemplate({ id });
      return owner.testPlans.saveExecutionTemplate({
        id,
        expectedTemplateHash: current.templateHash,
        template: value,
      });
    }
    async function request(
      id: string,
      saved: Awaited<ReturnType<typeof configure>>,
      index = 0,
    ) {
      const profile = await owner.project.experience({ projectId });
      const preset = saved.template.configurations[index]!;
      return {
        projectId,
        testCaseIds: saved.template.testCaseIds,
        expectedProfileHash: profile.profileHash,
        executionContext: preset.context,
        idempotencyKey: randomUUID(),
        planReference: {
          testPlanId: id,
          expectedTemplateHash: saved.templateHash,
          configurationId: preset.id,
        },
      };
    }

    it("keeps legacy plans explicitly unconfigured and protects reads/writes by tenant, role and seat", async () => {
      const plan = await createPlan();
      expect(
        (await viewer.testPlans.executionTemplate({ id: plan.id })).template,
      ).toBeNull();
      const state = await owner.testPlans.executionTemplate({ id: plan.id });
      await expect(
        outsider.testPlans.executionTemplate({ id: plan.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      for (const caller of [viewer, readonly, outsider])
        await expect(
          caller.testPlans.saveExecutionTemplate({
            id: plan.id,
            expectedTemplateHash: state.templateHash,
            template: template(),
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (await owner.testPlans.history({ testPlanId: plan.id }))[0]
          ?.executionTemplate,
      ).toEqual({});
    });

    it("persists ordered cases, stable presets and complete versions without replacing custom fields", async () => {
      const plan = await createPlan();
      const value = template([...caseIds].reverse());
      const saved = await configure(plan.id, value);
      expect(
        (await owner.testPlans.executionTemplate({ id: plan.id })).template,
      ).toEqual(value);
      expect(
        (await owner.testPlans.byId({ id: plan.id })).customFields,
      ).toEqual({
        humanObjective: "Do not replace",
        future: { retained: true },
      });
      const history = await owner.testPlans.history({ testPlanId: plan.id });
      expect(history.map((v) => v.versionNumber)).toEqual([2, 1]);
      expect(history[0]?.executionTemplate).toEqual(saved.template);
      await renamePlan(plan.id, "Human rename");
      await editPlanField(plan.id, { operation: "SET", key: "humanObjective", value: "Human edit" });
      await setPlanStatus(plan.id);
      expect((await owner.testPlans.byId({ id: plan.id })).customFields).toEqual({ humanObjective: "Human edit", future: { retained: true } });
      expect(
        (await owner.testPlans.executionTemplate({ id: plan.id })).template,
      ).toEqual(value);
      expect(
        (await owner.testPlans.history({ testPlanId: plan.id }))[0]
          ?.executionTemplate,
      ).toEqual(value);
    });

    it("rejects foreign, archived and missing cases without storing partial scope", async () => {
      const plan = await createPlan();
      for (const id of [otherCaseId, "missing-case"])
        await expect(configure(plan.id, template([id]))).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      await prisma.testCase.update({
        where: { id: caseIds[1] },
        data: { archived: true },
      });
      await expect(configure(plan.id, template())).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await prisma.testCase.update({
        where: { id: caseIds[1] },
        data: { archived: false },
      });
      expect(
        (await owner.testPlans.executionTemplate({ id: plan.id })).template,
      ).toBeNull();
      expect(
        await prisma.testPlanVersion.count({ where: { testPlanId: plan.id } }),
      ).toBe(1);
    });

    it("serializes whole-template saves and rejects stale concurrent edits", async () => {
      const plan = await createPlan();
      const state = await owner.testPlans.executionTemplate({ id: plan.id });
      const results = await Promise.allSettled([
        owner.testPlans.saveExecutionTemplate({
          id: plan.id,
          expectedTemplateHash: state.templateHash,
          template: template(),
        }),
        owner.testPlans.saveExecutionTemplate({
          id: plan.id,
          expectedTemplateHash: state.templateHash,
          template: template([...caseIds].reverse()),
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "CONFLICT" },
      });
      const current = await owner.testPlans.executionTemplate({ id: plan.id });
      await owner.testPlans.saveExecutionTemplate({
        id: plan.id,
        expectedTemplateHash: current.templateHash,
        template: current.template!,
      });
      expect(
        await prisma.testPlanVersion.count({ where: { testPlanId: plan.id } }),
      ).toBe(2);
    });

    it("requires exact reviewed saved scope and configuration before starting", async () => {
      const plan = await createPlan();
      const saved = await configure(plan.id);
      const input = await request(plan.id, saved);
      for (const caller of [viewer, readonly, outsider])
        await expect(caller.manualExecution.start(input)).rejects.toMatchObject(
          { code: "FORBIDDEN" },
        );
      await expect(
        owner.manualExecution.start({
          ...input,
          testCaseIds: [...caseIds].reverse(),
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        owner.manualExecution.start({
          ...input,
          executionContext: { rig: "Unreviewed rig" },
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        owner.manualExecution.start({ ...input, idempotencyKey: undefined }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await prisma.testRun.count({ where: { projectId } })).toBe(0);
    });

    it("freezes plan identity/preset/definitions and gives intentional repetitions independent runs", async () => {
      const plan = await createPlan();
      const saved = await configure(plan.id);
      const first = await owner.manualExecution.start(
        await request(plan.id, saved),
      );
      const second = await owner.manualExecution.start(
        await request(plan.id, saved, 1),
      );
      expect(second.testRunId).not.toBe(first.testRunId);
      const initial = await owner.manualExecution.getForExecution(first);
      expect(initial.executionContext?.plan).toEqual({
        testPlanId: plan.id,
        name: plan.name,
        templateHash: saved.templateHash,
        configurationId: saved.template.configurations[0]!.id,
        template: saved.template,
      });
      expect(
        (await owner.manualExecution.getForExecution(second)).executionContext
          ?.configuration.rig,
      ).toBe("Rig B");
      await configure(plan.id, template([caseIds[0]!]));
      await renamePlan(plan.id, "Later human rename");
      await editPlanField(plan.id, { operation: "REMOVE", key: "humanObjective" });
      await setPlanStatus(plan.id);
      expect((await owner.testPlans.byId({ id: plan.id })).customFields).toEqual({ future: { retained: true } });
      await prisma.testCase.update({
        where: { id: caseIds[0] },
        data: { title: "Later human case edit" },
      });
      expect(
        (await owner.manualExecution.getForExecution(first)).executionContext,
      ).toEqual(initial.executionContext);
      await expect(
        owner.manualExecution.start(await request(plan.id, saved)),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("recovers a lost response after template edits without replacing or reopening the first run", async () => {
      const plan = await createPlan();
      const saved = await configure(plan.id);
      const input = await request(plan.id, saved);
      const first = await owner.manualExecution.start(input);
      await owner.manualExecution.complete(first);
      await configure(plan.id, template([caseIds[0]!]));
      expect(await owner.manualExecution.start(input)).toEqual(first);
      expect((await owner.manualExecution.getForExecution(first)).status).toBe(
        "PARTIAL",
      );
      await expect(
        owner.manualExecution.start({
          ...input,
          testCaseIds: [...caseIds].reverse(),
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        owner.manualExecution.start({
          ...input,
          planReference: {
            ...input.planReference,
            configurationId: saved.template.configurations[1]!.id,
          },
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("recovers simultaneous identical starts with a single durable receipt", async () => {
      const plan = await createPlan();
      const saved = await configure(plan.id);
      const input = await request(plan.id, saved);
      const starts = await Promise.all([
        owner.manualExecution.start(input),
        owner.manualExecution.start(input),
      ]);
      expect(starts[0]).toEqual(starts[1]);
      expect(
        await prisma.testRun.count({ where: { id: starts[0]!.testRunId } }),
      ).toBe(1);
    });

    it("does not silently delete a stored selection when a case becomes unavailable", async () => {
      const plan = await createPlan();
      const saved = await configure(plan.id);
      await prisma.testCase.update({
        where: { id: caseIds[1] },
        data: { archived: true },
      });
      const state = await owner.testPlans.executionTemplate({ id: plan.id });
      expect(state.template).toEqual(saved.template);
      expect(state.cases.some((c) => c.id === caseIds[1])).toBe(false);
      await expect(
        owner.manualExecution.start(await request(plan.id, saved)),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await prisma.testCase.update({
        where: { id: caseIds[1] },
        data: { archived: false },
      });
    });

    it("rechecks live membership instead of trusting stale request membership", async () => {
      const plan = await createPlan();
      const saved = await configure(plan.id);
      const input = await request(plan.id, saved);
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: `${key}-owner@example.com` },
      });
      const membership = await prisma.membership.findFirstOrThrow({
        where: { userId: user.id },
      });
      await prisma.membership.update({
        where: { id: membership.id },
        data: { role: "VIEWER" },
      });
      await expect(
        owner.testPlans.saveExecutionTemplate({
          id: plan.id,
          expectedTemplateHash: saved.templateHash,
          template: template(),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(owner.manualExecution.start(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await prisma.membership.update({
        where: { id: membership.id },
        data: { role: "OWNER" },
      });
    });

    it("serializes ordinary plan edits with configuration snapshots without losing versions", async () => {
      const plan = await createPlan();
      const saved = await configure(plan.id);
      const scope = governanceScope(plan.id), reviewed = await owner.testPlanGovernance.preview(scope);
      if (!reviewed.metadataSchema.fieldSchemaHash) throw Error("The reviewed native type was unavailable.");
      const outcomes = await Promise.allSettled([
        owner.testPlanGovernance.editPlanCustomFields({
          ...scope, expectedPlanRevision: reviewed.planRevision, expectedFieldSchemaHash: reviewed.metadataSchema.fieldSchemaHash,
          changes: [{ operation: "SET", key: "retained", value: "Human content" }],
          requestId: randomUUID(), reason: "Synthetic concurrent reviewed key edit", confirmed: true,
        }),
        owner.testPlans.saveExecutionTemplate({
          id: plan.id,
          expectedTemplateHash: saved.templateHash,
          template: template([...caseIds].reverse()),
        }),
      ]);
      expect(outcomes[1]!.status).toBe("fulfilled");
      // A newer configuration can invalidate a reviewed metadata revision.
      // Refuse it atomically, then explicitly review a NEW request; never
      // relabel an old UUID or pretend both conflicting writes succeeded.
      if (outcomes[0]!.status === "rejected") {
        expect(outcomes[0]!.reason, concurrentFailureCodes(outcomes[0]!.reason)).toMatchObject({ code: "CONFLICT" });
        await editPlanField(plan.id, { operation: "SET", key: "retained", value: "Human content" });
      }
      await setPlanStatus(plan.id);
      await renamePlan(plan.id, "Concurrent human edit");
      const history = await owner.testPlans.history({ testPlanId: plan.id });
      expect(history.map((v) => v.versionNumber)).toEqual([6, 5, 4, 3, 2, 1]);
      const final = await prisma.testPlan.findUniqueOrThrow({
        where: { id: plan.id },
      });
      expect(final.name).toBe("Concurrent human edit");
      expect(final.customFields).toEqual({ humanObjective: "Do not replace", future: { retained: true }, retained: "Human content" });
      expect(history[0]).toMatchObject({
        name: final.name,
        customFields: final.customFields,
        executionTemplate: final.executionTemplate,
      });
      expect(history[4]?.executionTemplate).toEqual(saved.template);
    });

    it("blocks new writes/runs on archived plans but preserves existing receipts", async () => {
      const plan = await createPlan();
      const saved = await configure(plan.id);
      const input = await request(plan.id, saved);
      const first = await owner.manualExecution.start(input);
      await prisma.testPlan.update({
        where: { id: plan.id },
        data: { status: "ARCHIVED" },
      });
      await expect(
        owner.testPlans.saveExecutionTemplate({
          id: plan.id,
          expectedTemplateHash: saved.templateHash,
          template: template(),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        owner.manualExecution.start({ ...input, idempotencyKey: randomUUID() }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await owner.manualExecution.start(input)).toEqual(first);
    });

    it("preserves a lost-response receipt after plan deletion and project context edits", async () => {
      const plan = await createPlan();
      const saved = await configure(plan.id);
      const input = await request(plan.id, saved);
      const first = await owner.manualExecution.start(input);
      await prisma.testPlanVersion.deleteMany({
        where: { testPlanId: plan.id },
      });
      await prisma.testPlan.delete({ where: { id: plan.id } });
      await prisma.project.update({
        where: { id: projectId },
        data: { qualityProfile: { objective: "Later human context" } },
      });
      expect(await owner.manualExecution.start(input)).toEqual(first);
      expect(
        (await owner.manualExecution.getForExecution(first)).executionContext
          ?.plan?.name,
      ).toBe(plan.name);
      await expect(
        owner.manualExecution.start({ ...input, idempotencyKey: randomUUID() }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("refuses future persisted template versions without overwriting them", async () => {
      const plan = await createPlan();
      const state = await owner.testPlans.executionTemplate({ id: plan.id });
      const future = { version: 2, future: { protected: true } };
      await prisma.testPlan.update({
        where: { id: plan.id },
        data: { executionTemplate: future },
      });
      await expect(
        owner.testPlans.executionTemplate({ id: plan.id }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        owner.testPlans.saveExecutionTemplate({
          id: plan.id,
          expectedTemplateHash: state.templateHash,
          template: template(),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        (await prisma.testPlan.findUniqueOrThrow({ where: { id: plan.id } }))
          .executionTemplate,
      ).toEqual(future);
    });

    it("pages identical-title inventories beyond500 and retains saved identities on every page/search", async () => {
      const plan = await createPlan();
      const prefix = `${key}-inventory-`;
      const data = Array.from({ length: 505 }, (_, i) => ({
        id: `${prefix}${String(i).padStart(4, "0")}`,
        projectId,
        title: "Identical inventory title",
        testType: "FUNCTIONAL" as const,
        given: ["Synthetic precondition"],
        when: ["Synthetic action"],
        then: ["Synthetic result"],
        tags: [],
      }));
      await prisma.testCase.createMany({ data });
      const selectedIds = [data[499]!.id, data[504]!.id];
      const saved = await configure(plan.id, template(selectedIds));
      const first = await owner.testPlans.executionTemplate({
        id: plan.id,
        search: "Identical inventory title",
      });
      expect(first.caseLimitReached).toBe(true);
      expect(first.nextCursor).toBe(data[499]!.id);
      expect(first.cases.some((c) => c.id === data[504]!.id)).toBe(true);
      const second = await owner.testPlans.executionTemplate({
        id: plan.id,
        search: "Identical inventory title",
        cursor: first.nextCursor!,
      });
      expect(second.nextCursor).toBeNull();
      expect(
        new Set([...first.cases, ...second.cases].map((c) => c.id)).size,
      ).toBe(505);
      expect(second.template).toEqual(saved.template);
      const hidden = await owner.testPlans.executionTemplate({
        id: plan.id,
        search: "No matched title",
      });
      expect(hidden.cases.map((c) => c.id).sort()).toEqual(selectedIds.sort());
      // Inventory pages still contain505 identical titles; the current run
      // closure limit is1,000, so1selected+1,000required must fail atomically.
      const creator = await prisma.user.findUniqueOrThrow({
        where: { email: `${key}-owner@example.com` },
        select: { id: true },
      });
      await prisma.testCasePrerequisite.createMany({
        data: data
          .slice(0, 500)
          .map((c) => ({
            projectId,
            dependentId: data[504]!.id,
            prerequisiteId: c.id,
            createdById: creator.id,
          })),
      });
      const additionalPrerequisites = Array.from({ length: 500 }, (_, i) => ({
        id: `${prefix}separate-${String(i).padStart(4, "0")}`,
        projectId,
        title: "Separate synthetic graph prerequisite",
        testType: "FUNCTIONAL" as const,
        given: ["Synthetic precondition"],
        when: ["Synthetic action"],
        then: ["Synthetic result"],
        tags: [],
      }));
      await prisma.testCase.createMany({ data: additionalPrerequisites });
      await prisma.testCasePrerequisite.createMany({ data: additionalPrerequisites.map(c => ({
        projectId, dependentId: data[504]!.id, prerequisiteId: c.id, createdById: creator.id,
      })) });
      const bounded = await configure(plan.id, template([data[504]!.id]));
      const before = await prisma.testRun.count({ where: { projectId } });
      await expect(
        owner.manualExecution.start(await request(plan.id, bounded)),
      ).rejects.toThrow("more than 1,000");
      expect(await prisma.testRun.count({ where: { projectId } })).toBe(before);
    });
  },
);
