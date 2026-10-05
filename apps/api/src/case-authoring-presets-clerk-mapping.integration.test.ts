// Native regressions executed by root against fresh owned disposable databases.
// Stale independently authenticated ctx A versus native Clerk B on the same
// User. Explicit original scope refusals are controls, not missing-write proof.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import { qualityProfileHash } from "./services/qualityExperienceProfile.js";
import type { z } from "zod";
import type { caseAuthoringPresetDefinition } from "./services/caseAuthoringPresetSchema.js";

describe("preset reads and accepted write recovery require independent authenticated Clerk mapping", () => {
  const tag = `preset-clerk-${randomUUID()}`;
  let organizationId: string;
  let userA: Prisma.UserGetPayload<{ include: { memberships: true } }>;
  let callerA: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    organizationId = (await prisma.organization.create({
      data: { slug: tag, name: tag, planTierId: tier.id },
    })).id;
    const user = await prisma.user.create({ data: {
      email: `${tag}@example.com`, clerkUserId: `${tag}-authenticated-a`,
      memberships: { create: { organizationId, role: "OWNER", seatType: "FULL" } },
    } });
    userA = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { memberships: true } });
    expect(userA.memberships).toEqual(expect.arrayContaining([
      expect.objectContaining({ organizationId, role: "OWNER", seatType: "FULL" }),
    ]));
    callerA = appRouter.createCaller({ prisma, user: userA });
  });

  afterAll(async () => {
    if (!organizationId || !userA) return;
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (organization.slug !== tag) throw Error("Owned synthetic preset-Clerk organization required");
    const native = await prisma.user.findUniqueOrThrow({ where: { id: userA.id } });
    if (native.clerkUserId !== userA.clerkUserId)
      throw Error("Original synthetic Clerk mapping must be restored before teardown");
    await hardDeleteOrganization(prisma, organizationId, userA.id, "Owned synthetic preset-Clerk fixture teardown");
    expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: userA.id } })).toBe(1);
    // Retain dedicated synthetic actor and original native erasure receipt.
  });

  type Definition = z.infer<typeof caseAuthoringPresetDefinition>;
  const definition: Definition = {
    version: 1, titleSuggestion: "Synthetic original | suggestion\nsecond line",
    background: "Independent preconditions | exact\nsecond setup line",
    given: ["Given | original"], when: ["When\noriginal"], then: ["Then | original"],
    steps: [{
      action: "Original | action\nsecond line", expectedActionOrData: "Literal | input",
      expectedResult: "Original expected\nresult", expectedResponse: "Literal | response",
    }],
    testType: "FUNCTIONAL", priority: "HIGH", tags: ["synthetic", "literal|tag"],
    validationDomain: "SOFTWARE",
    verificationProfile: {
      setup: "Synthetic no external system", safety: "No machine actuation",
      instruments: "Synthetic observations only", acceptanceCriteria: "Human review required",
    },
    customFields: {}, applicability: null,
  };

  async function eligible(scoped: boolean) {
    const project = await callerA.project.create({
      organizationId, name: `${tag}-${randomUUID()}`,
      caseKey: `p${randomUUID().replaceAll("-", "").slice(0, 15)}`,
    });
    // Independent real native case/procedure history must remain unchanged by
    // every preset read, review or exact accepted receipt recovery.
    const testCase = await callerA.testCases.create({
      projectId: project.id, title: "Retained synthetic | case\nsecond line",
      background: definition.background, given: definition.given, when: definition.when, then: definition.then,
      steps: definition.steps, testType: "FUNCTIONAL", priority: "HIGH", tags: definition.tags,
    });
    const catalogInput = {
      projectId: project.id,
      ...(scoped ? { expectedScope: { organizationId, clerkActorId: userA.clerkUserId } } : {}),
    };
    const createReview = {
      ...catalogInput, operation: "CREATE" as const, name: "Reviewed synthetic scaffold", definition,
    };
    const createPreview = await callerA.caseAuthoringPresets.preview(createReview);
    expect(createPreview).toMatchObject({
      projectId: project.id, organizationId, clerkActorId: userA.clerkUserId,
      current: null, nextVersion: 1, definition, requiredFields: [],
    });
    const createInput = {
      ...createReview, expectedHash: createPreview.expectedHash, confirmed: true as const,
      requestId: randomUUID(), reason: "Reviewed creation of synthetic reusable authoring scaffold",
    };
    const created = await callerA.caseAuthoringPresets.write(createInput);
    expect(created).toMatchObject({ replayed: false, requestId: createInput.requestId, value: { version: 1, definition } });
    const scope = { ...catalogInput, presetId: created.value.presetId };
    const updateDefinition: Definition = {
      ...definition, titleSuggestion: "Synthetic reviewed revision two | suggestion",
      given: ["Given | reviewed second revision"],
    };
    const updateReview = {
      ...scope, operation: "UPDATE" as const, name: "Reviewed second synthetic scaffold", definition: updateDefinition,
    };
    const updatePreview = await callerA.caseAuthoringPresets.preview(updateReview);
    expect(updatePreview).toMatchObject({ current: { version: 1, definition }, nextVersion: 2, definition: updateDefinition, requiredFields: [] });
    const acceptedInput = {
      ...updateReview, expectedHash: updatePreview.expectedHash, confirmed: true as const,
      requestId: randomUUID(), reason: "Reviewed second synthetic authoring revision with immutable history",
    };
    const accepted = await callerA.caseAuthoringPresets.write(acceptedInput);
    expect(accepted).toMatchObject({
      projectId: project.id, organizationId, clerkActorId: userA.clerkUserId,
      requestId: acceptedInput.requestId, replayed: false,
      value: { presetId: created.value.presetId, version: 2, definition: updateDefinition, archived: false },
    });
    const receipt = await prisma.caseAuthoringPresetWrite.findUniqueOrThrow({ where: { id: accepted.receiptId } });
    expect(receipt).toMatchObject({ organizationId, projectId: project.id, actorId: userA.id, requestId: acceptedInput.requestId });
    expect(receipt.requestHash).toBe(qualityProfileHash(acceptedInput));
    expect(receipt.receipt).toMatchObject({
      organizationId, projectId: project.id, actorId: userA.id, operation: "UPDATE",
      before: { version: 1, definition }, after: { version: 2, definition: updateDefinition },
    });
    if (!scoped) {
      expect(Object.hasOwn(createInput, "expectedScope")).toBe(false);
      expect(Object.hasOwn(acceptedInput, "expectedScope")).toBe(false);
    }
    const pendingUpdate = {
      ...scope, operation: "UPDATE" as const, name: "Separately reviewed third synthetic scaffold",
      definition: { ...updateDefinition, when: ["When | separately proposed third revision"] },
    };
    return { project, testCase, catalogInput, scope, pendingUpdate, acceptedInput, accepted, receipt };
  }
  type Fixture = Awaited<ReturnType<typeof eligible>>;
  type Path = "list" | "get" | "preview" | "history" | "reviewPrefill" | "acceptedReplay";

  async function retained(f: Fixture) {
    return {
      project: await prisma.project.findUniqueOrThrow({ where: { id: f.project.id } }),
      presets: await prisma.caseAuthoringPreset.findMany({ where: { projectId: f.project.id }, orderBy: { id: "asc" } }),
      writes: await prisma.caseAuthoringPresetWrite.findMany({ where: { projectId: f.project.id }, orderBy: { id: "asc" } }),
      audits: await prisma.auditLog.findMany({ where: { projectId: f.project.id }, orderBy: { id: "asc" } }),
      cases: await prisma.testCase.findMany({
        where: { projectId: f.project.id }, orderBy: { id: "asc" },
        include: {
          steps: { orderBy: [{ order: "asc" }, { id: "asc" }] },
          versions: { orderBy: [{ versionNumber: "asc" }, { id: "asc" }] },
        },
      }),
      count: await prisma.testCase.count({ where: { projectId: f.project.id } }),
    };
  }
  function operation(f: Fixture, path: Path) {
    if (path === "list") return callerA.caseAuthoringPresets.list(f.catalogInput);
    if (path === "get") return callerA.caseAuthoringPresets.get(f.scope);
    if (path === "preview") return callerA.caseAuthoringPresets.preview(f.pendingUpdate);
    if (path === "history") return callerA.caseAuthoringPresets.history(f.scope);
    if (path === "reviewPrefill") return callerA.caseAuthoringPresets.reviewPrefill(f.scope);
    return callerA.caseAuthoringPresets.write(f.acceptedInput);
  }

  for (const scoped of [false, true]) {
    const label = scoped ? "explicit original A scope (existing refusal control)" : "legacy omitted expectedScope";
    for (const path of ["list", "get", "preview", "history", "reviewPrefill", "acceptedReplay"] as const) {
      it(`${path} refuses independently stale ctx A and preserves every retained body: ${label}`, async () => {
        const f = await eligible(scoped);
        const before = await retained(f);
        expect(before.presets).toHaveLength(1);
        expect(before.writes).toHaveLength(2);
        expect(before.count).toBe(1);
        expect(before.cases[0]!.id).toBe(f.testCase.id);
        expect(before.cases[0]!.versions).toHaveLength(1);
        const positive = await operation(f, path);
        expect(positive).toMatchObject({ projectId: f.project.id, organizationId, clerkActorId: userA.clerkUserId });
        if (path === "list") expect(positive).toMatchObject({ canManage: true, canEdit: true, items: [expect.objectContaining({ presetId: f.scope.presetId, version: 2 })] });
        if (path === "get" || path === "reviewPrefill") expect(positive).toMatchObject({ value: f.accepted.value });
        if (path === "preview") expect(positive).toMatchObject({ current: f.accepted.value, nextVersion: 3, definition: f.pendingUpdate.definition, requiredFields: [] });
        if (path === "history") expect(positive).toMatchObject({ items: expect.arrayContaining([
          expect.objectContaining({ receiptId: f.receipt.id, actorId: userA.id, receipt: expect.objectContaining({ before: expect.objectContaining({ version: 1 }), after: f.accepted.value }) }),
        ]) });
        if (path === "reviewPrefill") expect(positive).toMatchObject({ requiredFields: [], applicabilityMatches: true });
        if (path === "acceptedReplay") expect(positive).toEqual({ ...f.accepted, replayed: true });
        expect(await retained(f)).toEqual(before);

        const clerkB = `${tag}-native-b-${randomUUID()}`;
        await prisma.user.update({ where: { id: userA.id }, data: { clerkUserId: clerkB } });
        try {
          const native = await prisma.user.findUniqueOrThrow({ where: { id: userA.id }, include: { memberships: true } });
          expect(native).toMatchObject({ id: userA.id, clerkUserId: clerkB });
          expect(native.memberships).toEqual(userA.memberships);
          expect(userA.clerkUserId).not.toBe(native.clerkUserId);
          // No fresh B caller or scope rebound. All actual router calls still
          // receive the original independent authenticated ctx object A.
          const outcome = await operation(f, path).then(
            () => ({ accepted: true as const }),
            (error: unknown) => ({ accepted: false as const, error }),
          );
          expect.soft(outcome.accepted, `${path} ${label}: stale ctx must receive no private body/replay response`).toBe(false);
          if (!outcome.accepted) expect.soft(outcome.error).toMatchObject({ code: "FORBIDDEN" });
          expect.soft(await retained(f), `${path} ${label}: full preset/write/audit/case/procedure/history state must remain exact`).toEqual(before);
        } finally {
          await prisma.user.update({ where: { id: userA.id }, data: { clerkUserId: userA.clerkUserId } });
        }
        expect(await operation(f, path)).toEqual(positive);
        expect(await retained(f)).toEqual(before);
        expect(await prisma.caseAuthoringPresetWrite.findUniqueOrThrow({ where: { id: f.receipt.id } })).toEqual(f.receipt);
        expect(await prisma.caseAuthoringPresetWrite.count({ where: {
          projectId: f.project.id, actorId: userA.id, requestId: f.acceptedInput.requestId,
        } })).toBe(1);
      });
    }
  }
  // Unaccepted write and confirmPrefill carry current field-CAS-bound review
  // hashes and may already refuse CONFLICT after a mapping change. They are
  // deliberately not represented as demonstrated admitted missing-write gaps.
});
