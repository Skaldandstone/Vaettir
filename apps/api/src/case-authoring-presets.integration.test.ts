import { randomUUID } from "node:crypto";
import { beforeEach, describe, it, expect } from "vitest";
import { prisma, Prisma, type PrismaClient } from "@vaettir/db";
import { appRouter } from "./router.js";
import { writeCaseAuthoringPreset, listCaseAuthoringPresets } from "./services/caseAuthoringPresets.js";
import { qualityProfileHash } from "./services/qualityExperienceProfile.js";
import {
  hardDeleteOrganization,
  previewOrgHardDelete,
} from "./services/orgHardDelete.js";
import type { z } from "zod";
import {
  caseAuthoringPresetReview,
  type caseAuthoringPresetDefinition,
} from "./services/caseAuthoringPresetSchema.js";
type Definition = z.infer<typeof caseAuthoringPresetDefinition>;
const scaffold = (): Definition => ({
  version: 1,
  titleSuggestion: "Human title suggestion",
  background: "Conditions required before any action",
  given: ["Exact Given"],
  when: ["Exact When"],
  then: ["Exact Then"],
  steps: [
    {
      action: "Exact structured action",
      expectedActionOrData: "Exact data",
      expectedResult: "Exact expected result",
      expectedResponse: "Exact response",
    },
  ],
  testType: "FUNCTIONAL",
  priority: "HIGH",
  tags: ["authored"],
  validationDomain: "SOFTWARE",
  verificationProfile: {
    setup: "No machine actuation",
    safety: "Approved stop condition required",
    instruments: "Calibration supplied per run",
    acceptanceCriteria: "Human criteria",
  },
  customFields: {},
  applicability: null,
});
describe("controlled project case authoring presets (owned synthetic DB)", () => {
  let owner: ReturnType<typeof appRouter.createCaller>,
    editor: typeof owner,
    viewer: typeof owner,
    outsider: typeof owner,
    actorId: string,
    editorId: string,
    orgId: string,
    foreignOrgId: string,
    projectId: string;
  beforeEach(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !url.pathname.includes("test") ||
      url.searchParams.has("host")
    )
      throw Error("Unique disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    const key = `case-preset-${randomUUID()}`;
    const org = await prisma.organization.create({
      data: { name: key, slug: key, planTierId: tier.id },
    });
    async function member(
      role: "OWNER" | "EDITOR" | "VIEWER",
      organizationId = org.id,
    ) {
      const user = await prisma.user.create({
        data: {
          email: `${randomUUID()}@example.com`,
          clerkUserId: randomUUID(),
          memberships: {
            create: {
              organizationId,
              role,
              seatType: role === "VIEWER" ? "READ_ONLY" : "FULL",
            },
          },
        },
        include: { memberships: true },
      });
      return { user, caller: appRouter.createCaller({ prisma, user }) };
    }
    const a = await member("OWNER"),
      b = await member("EDITOR"),
      c = await member("VIEWER");
    owner = a.caller;
    actorId = a.user.id;
    editor = b.caller;
    editorId = b.user.id;
    viewer = c.caller;
    orgId = org.id;
    const other = await prisma.organization.create({
      data: { name: key + "-other", slug: key + "-other", planTierId: tier.id },
    });
    foreignOrgId = other.id;
    outsider = (await member("OWNER", other.id)).caller;
    projectId = (
      await owner.project.create({ organizationId: orgId, name: key })
    ).id;
  });
  async function approve(review: z.infer<typeof caseAuthoringPresetReview>) {
    const preview = await owner.caseAuthoringPresets.preview(review);
    return {
      ...review,
      expectedHash: preview.expectedHash,
      requestId: randomUUID(),
      confirmed: true as const,
      reason: "Synthetic reviewed authoring change",
    };
  }
  async function create(definition = scaffold(), name = "Reviewed scaffold") {
    return owner.caseAuthoringPresets.write(
      await approve({ projectId, operation: "CREATE", name, definition }),
    );
  }
  it("echoes locked current identity on catalog/body/history/review and refuses wrong actor or original organization before reads and receipt recovery", async () => {
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
    const expectedScope = { organizationId: orgId, clerkActorId: actor.clerkUserId };
    const review = { projectId, expectedScope, operation: "CREATE" as const, name: "Scope-bound scaffold", definition: scaffold() };
    const approved = await approve(review);
    const created = await owner.caseAuthoringPresets.write(approved);
    const identity = { projectId, organizationId: orgId, clerkActorId: actor.clerkUserId };
    expect(created).toMatchObject(identity);
    for (const result of [
      await owner.caseAuthoringPresets.list({ projectId, expectedScope }),
      await owner.caseAuthoringPresets.get({ projectId, expectedScope, presetId: created.value.presetId }),
      await owner.caseAuthoringPresets.history({ projectId, expectedScope, presetId: created.value.presetId }),
      // A CREATE preview after creation must refuse duplicate identity, not echo
      // a successful approval for a second preset. Review the existing head.
      await owner.caseAuthoringPresets.preview({
        ...review,
        operation: "UPDATE",
        presetId: created.value.presetId,
      }),
      await owner.caseAuthoringPresets.reviewPrefill({ projectId, expectedScope, presetId: created.value.presetId }),
    ]) expect(result).toMatchObject(identity);
    await expect(owner.caseAuthoringPresets.preview(review)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("already exists"),
    });
    for (const changed of [{ ...expectedScope, organizationId: foreignOrgId }, { ...expectedScope, clerkActorId: "wrong-clerk-actor" }]) {
      await expect(owner.caseAuthoringPresets.list({ projectId, expectedScope: changed })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(owner.caseAuthoringPresets.get({ projectId, expectedScope: changed, presetId: created.value.presetId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(owner.caseAuthoringPresets.write({ ...approved, expectedScope: changed })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await owner.caseAuthoringPresets.write(approved)).replayed).toBe(true);
    expect(await prisma.caseAuthoringPresetWrite.count({ where: { projectId } })).toBe(1);
  });
  it("retains legacy omission request and prefill hashes without rebinding a historical UUID to new scope", async () => {
    const approved = await approve({ projectId, operation: "CREATE", name: "Legacy omission", definition: scaffold() });
    expect(Object.hasOwn(approved, "expectedScope")).toBe(false);
    const created = await owner.caseAuthoringPresets.write(approved);
    const stored = await prisma.caseAuthoringPresetWrite.findUniqueOrThrow({ where: { id: created.receiptId } });
    expect(stored.requestHash).toBe(qualityProfileHash(approved));
    const legacyReview = await owner.caseAuthoringPresets.reviewPrefill({ projectId, presetId: created.value.presetId });
    expect(legacyReview.expectedHash).toBe(qualityProfileHash({ actorId, projectId, organizationId: orgId, value: legacyReview.value, fieldSchemaHash: legacyReview.fieldSchemaHash, profileHash: legacyReview.profileHash }));
    const acknowledged = await owner.caseAuthoringPresets.confirmPrefill({ projectId, presetId: created.value.presetId, expectedHash: legacyReview.expectedHash, confirmed: true });
    expect(acknowledged.value).toEqual(legacyReview.value);
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(0);
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
    await expect(owner.caseAuthoringPresets.write({ ...approved, expectedScope: { organizationId: orgId, clerkActorId: actor.clerkUserId } })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await owner.caseAuthoringPresets.write(approved)).replayed).toBe(true);
  });
  it("pins organization/member/project rows throughout a catalog read while preserving existing viewer metadata access", async () => {
    await create();
    let attempted = false;
    const guarded = prisma.$extends({ query: { caseAuthoringPreset: { async findMany({ args, query }) {
      attempted = true;
      await expect(prisma.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
        await tx.$executeRaw`UPDATE "Project" SET "organizationId"=${foreignOrgId} WHERE id=${projectId}`;
      }, { timeout: 5000 })).rejects.toMatchObject({ code: "P2010", meta: expect.objectContaining({ code: "55P03" }) });
      return query(args);
    } } } });
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
    const scope = { organizationId: orgId, clerkActorId: actor.clerkUserId };
    const catalog = await listCaseAuthoringPresets(guarded as unknown as PrismaClient, actorId, projectId, scope);
    expect(attempted).toBe(true);
    expect(catalog).toMatchObject({ projectId, organizationId: orgId, clerkActorId: actor.clerkUserId });
    expect(catalog.items).toHaveLength(1);
    expect((await viewer.caseAuthoringPresets.list({ projectId })).canEdit).toBe(false);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).organizationId).toBe(orgId);
  });
  it("refuses reparented old-origin catalog/prefill even for an actor who can access both organizations", async () => {
    const created = await create();
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
    const expectedScope = { organizationId: orgId, clerkActorId: actor.clerkUserId };
    const reviewed = await owner.caseAuthoringPresets.reviewPrefill({ projectId, presetId: created.value.presetId, expectedScope });
    await prisma.membership.create({ data: { organizationId: foreignOrgId, userId: actorId, role: "OWNER", seatType: "FULL" } });
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: foreignOrgId } });
    await expect(owner.caseAuthoringPresets.list({ projectId, expectedScope })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.caseAuthoringPresets.confirmPrefill({ projectId, presetId: created.value.presetId, expectedScope, expectedHash: reviewed.expectedHash, confirmed: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await owner.caseAuthoringPresets.list({ projectId })).items).toEqual([]);
    expect(await prisma.caseAuthoringPresetWrite.count({ where: { projectId } })).toBe(1);
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(0);
  });
  async function fields(required = false) {
    const schema = {
      version: 1 as const,
      fields: [
        {
          key: "platform",
          label: "Platform",
          type: "CHOICE" as const,
          required,
          retired: false,
          options: ["Console", "PC"],
        },
      ],
    };
    const impact = await owner.caseFields.reviewSchema({ projectId, schema });
    await owner.caseFields.configure({
      projectId,
      schema,
      actorId: impact.actorId,
      expectedSchemaHash: impact.expectedSchemaHash,
      expectedImpactHash: impact.expectedImpactHash,
      requestId: randomUUID(),
      confirmed: true,
      reason: "Synthetic field definition",
    });
    return schema;
  }
  it("creates one stable preset and one immutable receipt under concurrent exact actor retries", async () => {
    const input = await approve({
      projectId,
      operation: "CREATE",
      name: "Stable source",
      definition: scaffold(),
    });
    const [a, b] = await Promise.all([
      owner.caseAuthoringPresets.write(input),
      owner.caseAuthoringPresets.write(input),
    ]);
    expect(a.value.presetId).toBe(b.value.presetId);
    expect(a.receiptId).toBe(b.receiptId);
    expect(
      await prisma.caseAuthoringPreset.count({ where: { projectId } }),
    ).toBe(1);
    expect(
      await prisma.caseAuthoringPresetWrite.count({ where: { projectId } }),
    ).toBe(1);
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(0);
    expect(a.value.definition.background).toBe(
      "Conditions required before any action",
    );
    expect(a.value.definition.given).toEqual(["Exact Given"]);
    expect(a.value.definition.steps[0]?.expectedResult).toBe(
      "Exact expected result",
    );
    await expect(
      owner.caseAuthoringPresets.write({
        ...input,
        reason: "Different approved meaning",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("requires current full Owner/Admin management, full editor prefill and new-draft-only semantics", async () => {
    const created = await create();
    await expect(
      editor.caseAuthoringPresets.preview({
        projectId,
        operation: "CREATE",
        name: "Unauthorized",
        definition: scaffold(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const review = await editor.caseAuthoringPresets.reviewPrefill({
      projectId,
      presetId: created.value.presetId,
    });
    const draft = await editor.caseAuthoringPresets.confirmPrefill({
      projectId,
      presetId: created.value.presetId,
      expectedHash: review.expectedHash,
      confirmed: true,
    });
    expect(draft.value.definition).toEqual(created.value.definition);
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(0);
    await expect(
      viewer.caseAuthoringPresets.reviewPrefill({
        projectId,
        presetId: created.value.presetId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: editorId },
      },
      data: { role: "VIEWER", seatType: "READ_ONLY" },
    });
    await expect(
      editor.caseAuthoringPresets.confirmPrefill({
        projectId,
        presetId: created.value.presetId,
        expectedHash: review.expectedHash,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("shows missing required values without inventing defaults, while normal new-case save still requires them", async () => {
    await fields(true);
    const created = await create();
    const preview = await owner.caseAuthoringPresets.reviewPrefill({
      projectId,
      presetId: created.value.presetId,
    });
    expect(preview.requiredFields).toEqual(["Platform is required."]);
    expect(preview.value.definition.customFields).toEqual({});
    const state = await owner.caseFields.get({ projectId });
    await expect(
      owner.testCases.create({
        projectId,
        title: "Missing required case",
        testType: "FUNCTIONAL",
        steps: [{ action: "Human operation" }],
        customFields: {},
        expectedFieldSchemaHash: state.expectedSchemaHash,
      }),
    ).rejects.toThrow("Platform");
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(0);
    const value = { ...scaffold(), customFields: { platform: "Console" } };
    const withDefaults = await create(value, "Typed defaults");
    const fresh = await owner.caseAuthoringPresets.reviewPrefill({
      projectId,
      presetId: withDefaults.value.presetId,
    });
    expect(fresh.requiredFields).toEqual([]);
    expect(fresh.value.definition.customFields).toEqual({
      platform: "Console",
    });
  });
  it("appends audited restoration as a new version while preserving archive identity and every old receipt", async () => {
    const original = await create();
    const originalReceipt =
      await prisma.caseAuthoringPresetWrite.findUniqueOrThrow({
        where: { id: original.receiptId },
      });
    const updated = await owner.caseAuthoringPresets.write(
      await approve({
        projectId,
        operation: "UPDATE",
        presetId: original.value.presetId,
        name: "Changed owner scaffold",
        definition: { ...scaffold(), given: ["New Given"] },
      }),
    );
    await owner.caseAuthoringPresets.write(
      await approve({
        projectId,
        operation: "ARCHIVE",
        presetId: original.value.presetId,
      }),
    );
    const restored = await owner.caseAuthoringPresets.write(
      await approve({
        projectId,
        operation: "RESTORE",
        presetId: original.value.presetId,
        restoreReceiptId: original.receiptId,
      }),
    );
    expect(restored.value).toMatchObject({
      presetId: original.value.presetId,
      version: 4,
      archived: true,
      name: original.value.name,
      definition: original.value.definition,
    });
    expect(
      await prisma.caseAuthoringPresetWrite.findUniqueOrThrow({
        where: { id: original.receiptId },
      }),
    ).toEqual(originalReceipt);
    expect(
      await prisma.caseAuthoringPresetWrite.count({ where: { projectId } }),
    ).toBe(4);
    await expect(
      owner.caseAuthoringPresets.reviewPrefill({
        projectId,
        presetId: original.value.presetId,
      }),
    ).rejects.toThrow("archived");
    const active = await owner.caseAuthoringPresets.write(
      await approve({
        projectId,
        operation: "UNARCHIVE",
        presetId: original.value.presetId,
      }),
    );
    expect(active.value).toMatchObject({
      presetId: updated.value.presetId,
      version: 5,
      archived: false,
    });
    expect(
      await prisma.caseAuthoringPreset.count({ where: { projectId } }),
    ).toBe(1);
  });
  it("refuses stale content, human schema and profile approvals without silently refreshing them", async () => {
    const original = await create();
    const first = await approve({
      projectId,
      operation: "UPDATE",
      presetId: original.value.presetId,
      name: original.value.name,
      definition: { ...scaffold(), when: ["First reviewed edit"] },
    });
    await owner.caseAuthoringPresets.write(
      await approve({
        projectId,
        operation: "UPDATE",
        presetId: original.value.presetId,
        name: original.value.name,
        definition: { ...scaffold(), when: ["Other owner edit"] },
      }),
    );
    await expect(owner.caseAuthoringPresets.write(first)).rejects.toMatchObject(
      { code: "CONFLICT" },
    );
    const schemaReview = await approve({
      projectId,
      operation: "UPDATE",
      presetId: original.value.presetId,
      name: original.value.name,
      definition: scaffold(),
    });
    await fields();
    await expect(
      owner.caseAuthoringPresets.write(schemaReview),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const use = await owner.caseAuthoringPresets.reviewPrefill({
      projectId,
      presetId: original.value.presetId,
    });
    await prisma.project.update({
      where: { id: projectId },
      data: {
        qualityProfile: {
          experience: {
            version: 1,
            offerings: ["GAME"],
            softwareKinds: [],
            gameGenres: ["RPG"],
            gamePlatforms: ["PS5"],
            multiplayerModes: ["ONLINE_COOP"],
            hardwareKinds: [],
            processKinds: [],
            jurisdictions: [],
          },
        },
      },
    });
    await expect(
      owner.caseAuthoringPresets.confirmPrefill({
        projectId,
        presetId: original.value.presetId,
        expectedHash: use.expectedHash,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("shows exact granular profile mismatch as advisory, never platform authorization or regulatory qualification", async () => {
    const applicable = {
      version: 1 as const,
      offerings: ["GAME" as const],
      softwareKinds: [],
      gameGenres: ["RPG"],
      gamePlatforms: ["PS5"],
      multiplayerModes: ["ONLINE_COOP"],
      hardwareKinds: [],
      processKinds: [],
      jurisdictions: [],
    };
    const created = await create({ ...scaffold(), applicability: applicable });
    const review = await owner.caseAuthoringPresets.reviewPrefill({
      projectId,
      presetId: created.value.presetId,
    });
    expect(review.applicabilityMatches).toBe(false);
    expect(review.value.definition.applicability).toEqual(applicable);
    expect(review.warnings.join(" ")).toContain("not a certification");
    await owner.caseAuthoringPresets.confirmPrefill({
      projectId,
      presetId: created.value.presetId,
      expectedHash: review.expectedHash,
      confirmed: true,
    });
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(0);
  });
  it("refuses unavailable typed defaults during use and historical restoration while retaining their exact original values", async () => {
    const schema = await fields();
    const created = await create({
      ...scaffold(),
      customFields: { platform: "Console" },
    });
    const retired = {
      ...schema,
      fields: [{ ...schema.fields[0]!, retired: true }],
    };
    const impact = await owner.caseFields.reviewSchema({
      projectId,
      schema: retired,
    });
    await owner.caseFields.configure({
      projectId,
      schema: retired,
      actorId: impact.actorId,
      expectedSchemaHash: impact.expectedSchemaHash,
      expectedImpactHash: impact.expectedImpactHash,
      requestId: randomUUID(),
      confirmed: true,
      reason: "Synthetic field retirement",
    });
    await expect(
      owner.caseAuthoringPresets.reviewPrefill({
        projectId,
        presetId: created.value.presetId,
      }),
    ).rejects.toThrow("incompatible");
    await expect(
      owner.caseAuthoringPresets.preview({
        projectId,
        operation: "RESTORE",
        presetId: created.value.presetId,
        restoreReceiptId: created.receiptId,
      }),
    ).rejects.toThrow("incompatible");
    await owner.caseAuthoringPresets.write(
      await approve({
        projectId,
        operation: "ARCHIVE",
        presetId: created.value.presetId,
      }),
    );
    expect(
      (
        await owner.caseAuthoringPresets.get({
          projectId,
          presetId: created.value.presetId,
        })
      ).value.definition.customFields,
    ).toEqual({ platform: "Console" });
  });
  it("retains archived names and rejects complete oversize/reference-bearing definitions rather than truncating them", async () => {
    const created = await create();
    await owner.caseAuthoringPresets.write(
      await approve({
        projectId,
        operation: "ARCHIVE",
        presetId: created.value.presetId,
      }),
    );
    await expect(
      owner.caseAuthoringPresets.preview({
        projectId,
        operation: "CREATE",
        name: created.value.name,
        definition: scaffold(),
      }),
    ).rejects.toThrow("archived identities");
    const huge = {
      ...scaffold(),
      given: Array.from({ length: 100 }, () => "x".repeat(10000)),
    };
    await expect(
      owner.caseAuthoringPresets.preview({
        projectId,
        operation: "CREATE",
        name: "Huge",
        definition: huge,
      }),
    ).rejects.toThrow("256 KiB");
    expect(
      await prisma.caseAuthoringPreset.count({ where: { projectId } }),
    ).toBe(1);
  });
  it("rolls back changed head/version/audit if durable receipt insertion fails", async () => {
    const created = await create();
    const before = await prisma.caseAuthoringPreset.findUniqueOrThrow({
      where: { id: created.value.presetId },
    });
    const input = await approve({
      projectId,
      operation: "UPDATE",
      presetId: created.value.presetId,
      name: created.value.name,
      definition: { ...scaffold(), given: ["Fault-boundary body"] },
    });
    const fault = prisma.$extends({
      query: {
        caseAuthoringPresetWrite: {
          async create() {
            throw Error("Synthetic durable preset receipt failure");
          },
        },
      },
    });
    await expect(
      writeCaseAuthoringPreset(
        fault as unknown as PrismaClient,
        actorId,
        input,
      ),
    ).rejects.toThrow("Synthetic durable preset receipt failure");
    expect(
      await prisma.caseAuthoringPreset.findUniqueOrThrow({
        where: { id: created.value.presetId },
      }),
    ).toEqual(before);
    expect(
      await prisma.caseAuthoringPresetWrite.count({ where: { projectId } }),
    ).toBe(1);
    const retried = await owner.caseAuthoringPresets.write(input);
    expect(retried.value.version).toBe(2);
  });
  it("refuses typed defaults that would exceed the actual case stored-value bound", async () => {
    const schema = {
      version: 1 as const,
      fields: Array.from({ length: 20 }, (_, index) => ({
        key: `note${index}`,
        label: `Note ${index}`,
        type: "TEXT" as const,
        required: false,
        retired: false,
        options: [],
      })),
    };
    const impact = await owner.caseFields.reviewSchema({ projectId, schema });
    await owner.caseFields.configure({
      projectId,
      schema,
      actorId: impact.actorId,
      expectedSchemaHash: impact.expectedSchemaHash,
      expectedImpactHash: impact.expectedImpactHash,
      requestId: randomUUID(),
      confirmed: true,
      reason: "Synthetic metadata byte bound",
    });
    const customFields = Object.fromEntries(
      schema.fields.map((field) => [field.key, "é".repeat(2000)]),
    );
    await expect(
      owner.caseAuthoringPresets.preview({
        projectId,
        operation: "CREATE",
        name: "Oversize typed defaults",
        definition: { ...scaffold(), customFields },
      }),
    ).rejects.toThrow("64 KiB");
    expect(
      await prisma.caseAuthoringPreset.count({ where: { projectId } }),
    ).toBe(0);
  });
  it("rejects foreign access, revoked owner receipt recovery and project-reparent replay", async () => {
    const input = await approve({
      projectId,
      operation: "CREATE",
      name: "Owner scope",
      definition: scaffold(),
    });
    const created = await owner.caseAuthoringPresets.write(input);
    await expect(
      outsider.caseAuthoringPresets.get({
        projectId,
        presetId: created.value.presetId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { role: "VIEWER", seatType: "READ_ONLY" },
    });
    await expect(owner.caseAuthoringPresets.write(input)).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgId, userId: actorId },
      },
      data: { role: "OWNER", seatType: "FULL" },
    });
    await prisma.membership.create({
      data: {
        organizationId: foreignOrgId,
        userId: actorId,
        role: "OWNER",
        seatType: "FULL",
      },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: foreignOrgId },
    });
    expect(
      (await owner.caseAuthoringPresets.list({ projectId })).items,
    ).toEqual([]);
    await expect(owner.caseAuthoringPresets.write(input)).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    await expect(
      owner.caseAuthoringPresets.get({
        projectId,
        presetId: created.value.presetId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (
        await prisma.caseAuthoringPreset.findUniqueOrThrow({
          where: { id: created.value.presetId },
        })
      ).organizationId,
    ).toBe(orgId);
  });
  it("keeps receipts append-only and erases only the explicitly scoped organization with foreign sentinels retained", async () => {
    const created = await create();
    await expect(
      prisma.caseAuthoringPresetWrite.update({
        where: { id: created.receiptId },
        data: { receipt: {} },
      }),
    ).rejects.toThrow("append-only");
    await expect(
      prisma.caseAuthoringPresetWrite.delete({
        where: { id: created.receiptId },
      }),
    ).rejects.toThrow("append-only");
    const foreignProject = await outsider.project.create({
      organizationId: foreignOrgId,
      name: "Other tenant sentinel",
    });
    const review = {
      projectId: foreignProject.id,
      operation: "CREATE" as const,
      name: "Foreign sentinel",
      definition: scaffold(),
    };
    const preview = await outsider.caseAuthoringPresets.preview(review);
    const sentinel = await outsider.caseAuthoringPresets.write({
      ...review,
      expectedHash: preview.expectedHash,
      requestId: randomUUID(),
      confirmed: true,
      reason: "Scoped foreign sentinel",
    });
    const impact = await previewOrgHardDelete(prisma, orgId);
    expect(impact.rowCounts).toMatchObject({
      CaseAuthoringPreset: 1,
      CaseAuthoringPresetWrite: 1,
    });
    const result = await hardDeleteOrganization(
      prisma,
      orgId,
      actorId,
      "Scoped synthetic preset fixture erasure",
    );
    expect(result.rowCounts).toMatchObject({
      CaseAuthoringPreset: 1,
      CaseAuthoringPresetWrite: 1,
    });
    expect(
      await prisma.caseAuthoringPreset.count({
        where: { organizationId: orgId },
      }),
    ).toBe(0);
    expect(
      await prisma.caseAuthoringPreset.findUniqueOrThrow({
        where: { id: sentinel.value.presetId },
      }),
    ).toMatchObject({ organizationId: foreignOrgId });
  });
  it("refuses unrecorded head edits and malformed or duplicate revision receipts without inventing a reviewed version", async () => {
    const created = await create();
    const recorded = await prisma.caseAuthoringPresetWrite.findUniqueOrThrow({
      where: { id: created.receiptId },
    });
    const receipt = recorded.receipt as Record<string, unknown>;
    const after = receipt.after as Record<string, unknown>;
    await expect(
      prisma.caseAuthoringPresetWrite.create({
        data: {
          organizationId: orgId,
          projectId,
          presetId: created.value.presetId,
          actorId,
          requestId: randomUUID(),
          requestHash: "a".repeat(64),
          receipt: {
            ...receipt,
            after: { ...after, name: "Forged unsupported head" },
          } as Prisma.InputJsonValue,
        },
      }),
    ).rejects.toThrow("exactly describe");
    await expect(
      prisma.caseAuthoringPresetWrite.create({
        data: {
          organizationId: orgId,
          projectId,
          presetId: created.value.presetId,
          actorId,
          requestId: randomUUID(),
          requestHash: "b".repeat(64),
          receipt: recorded.receipt!,
        },
      }),
    ).rejects.toThrow("already has");
    await prisma.caseAuthoringPreset.update({
      where: { id: created.value.presetId },
      data: {
        definition: { ...scaffold(), given: ["Unrecorded raw synthetic edit"] },
      },
    });
    await expect(
      owner.caseAuthoringPresets.get({
        projectId,
        presetId: created.value.presetId,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      owner.caseAuthoringPresets.reviewPrefill({
        projectId,
        presetId: created.value.presetId,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      await prisma.caseAuthoringPresetWrite.findUniqueOrThrow({
        where: { id: created.receiptId },
      }),
    ).toEqual(recorded);
  });
});
