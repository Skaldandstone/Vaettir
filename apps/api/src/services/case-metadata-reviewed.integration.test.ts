// AUTHORED, NOT RUN. Requires a NEW reviewed driver-created disposable database,
// exact source manifest, private one-use token and opt-in. Never run as a broad
// suite to clear runtime/security or production gates. All rows are retained.
import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@vaettir/db";
import type { appRouter as AppRouter } from "../router.js";
import type { Context } from "../trpc.js";
import {
  admitReviewedMetadataFixture,
  metadataNativeManifestSchema,
  metadataSha,
} from "./case-metadata-native-admission.js";

vi.mock("@vaettir/ai-agent", async (original) => ({
  ...(await original<typeof import("@vaettir/ai-agent")>()),
  assessTestCaseRisk: vi.fn(() => {
    throw Error(
      "Provider/AI calls are forbidden in this owned metadata fixture",
    );
  }),
  reviewTestDesign: vi.fn(() => {
    throw Error(
      "Provider/AI calls are forbidden in this owned metadata fixture",
    );
  }),
}));
type Caller = ReturnType<typeof AppRouter.createCaller>;
type Restore = Parameters<Caller["caseVersionReview"]["restoreReviewed"]>[0];
const optIn = process.env.VAETTIR_CASE_METADATA_NATIVE_FIXTURE === "yes";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
type ProcedureStep = {
  order: number;
  action: string;
  expectedActionOrData: string | null;
  expectedResult: string | null;
  expectedResponse: string | null;
  mediaAttachmentIds: string[];
};
const fields: ProcedureStep = {
  order: 0,
  action: "  Click button\nthen observe  ",
  expectedActionOrData: "GET /synthetic\n  exact ",
  expectedResult: "",
  expectedResponse: null,
  mediaAttachmentIds: [],
};
describe.skipIf(!optIn)(
  "owned reviewed case metadata native (AUTHORED NOT RUN)",
  { concurrent: false },
  () => {
    const namespace = `metadata-reviewed-${randomUUID()}`;
    let db: PrismaClient | undefined,
      owner: Caller,
      viewer: Caller,
      foreign: Caller;
    let projectId: string,
      organizationId: string,
      actorId: string,
      clerkId: string,
      otherActorId: string;
    let ownerContext: Context,
      router: typeof AppRouter,
      seedNumber = 0;
    const nativeConcurrencyOutcomes: string[] = [];
    const client = () => {
      if (!db) throw Error("Owned DB admission required");
      return db;
    };
    const pins = () => ({
      originalOrganizationId: organizationId,
      expectedClerkActorId: clerkId,
      expectedNativeActorId: actorId,
    });
    const prerequisitePins = (caseId: string) => ({
      projectId,
      caseId,
      originalOrganizationId: organizationId,
      expectedClerkActorId: clerkId,
      expectedActorId: actorId,
    });
    beforeAll(async () => {
      const captured = { ...process.env },
        manifestPath = captured.VAETTIR_CASE_METADATA_NATIVE_MANIFEST;
      if (
        !manifestPath ||
        realpathSync(root).replaceAll("\\", "/").toLowerCase() !==
          "c:/users/james/documents/github/vaettir"
      )
        throw Error("Canonical owned manifest required");
      const expectedParent = resolve(
        root,
        ".local/case-metadata-native-validation/runs",
      );
      const actual = realpathSync(manifestPath),
        parent = dirname(actual);
      if (
        dirname(parent).toLowerCase() !== expectedParent.toLowerCase() ||
        statSync(actual).size > 4_000_000
      )
        throw Error("Bounded exact local manifest required");
      const manifest = metadataNativeManifestSchema.parse(
        JSON.parse(readFileSync(actual, "utf8")),
      );
      if (
        parent.toLowerCase() !==
        resolve(expectedParent, manifest.database).toLowerCase()
      )
        throw Error("Manifest/database ownership mismatch");
      // Token/time/route/manifest integrity is checked before importing even the
      // local driver tools. A changed driver cannot execute ahead of its hash.
      admitReviewedMetadataFixture(captured, manifest, manifest.sources);
      const driverPath = resolve(
        root,
        ".local/case-metadata-native-validation/driver.mjs",
      );
      if (
        metadataSha(readFileSync(driverPath, "utf8")) !==
        manifest.coherence.driverHash
      )
        throw Error("Reviewed local driver source required");
      // This module has only node tools and a guarded CLI entry, no DB runtime.
      const driverUrl = pathToFileURL(
        resolve(root, ".local/case-metadata-native-validation/driver.mjs"),
      ).href;
      const driver = (await import(driverUrl)) as {
        sourceEntries(root: string): typeof manifest.sources;
        generatedSchemaPath(root: string): string;
        clientBuildFingerprint(root: string): string;
        workspaceBuildFingerprint(root: string): string;
      };
      const admitted = admitReviewedMetadataFixture(
        captured,
        manifest,
        driver.sourceEntries(root),
      );
      if (
        metadataSha(
          readFileSync(
            resolve(root, ".local/case-metadata-native-validation/driver.mjs"),
            "utf8",
          ),
        ) !== manifest.coherence.driverHash ||
        metadataSha(
          readFileSync(
            resolve(root, "packages/db/prisma/schema.prisma"),
            "utf8",
          ),
        ) !== manifest.coherence.schemaHash ||
        metadataSha(readFileSync(driver.generatedSchemaPath(root), "utf8")) !==
          manifest.coherence.generatedSchemaHash ||
        driver.clientBuildFingerprint(root) !==
          manifest.coherence.clientBuildHash ||
        driver.workspaceBuildFingerprint(root) !==
          manifest.coherence.workspaceBuildHash
      )
        throw Error("Exact current schema/client/driver coherence required");
      writeFileSync(
        resolve(parent, "fixture-claim.json"),
        JSON.stringify({
          namespace,
          database: admitted.database,
          snapshotHash: admitted.snapshotHash,
          retained: true,
          cloud: false,
          customerData: false,
        }),
        { flag: "wx" },
      );
      // ALL native imports/client construction follow exact admission + one-use claim.
      const [{ ConstraintCheckedPrismaClient }, imported] = await Promise.all([
        import("@vaettir/db/dist/constraintCheckedClient.js"),
        import("../router.js"),
      ]);
      db = new ConstraintCheckedPrismaClient({
        datasources: { db: { url: captured.DATABASE_URL! } },
      });
      router = imported.appRouter;
      const tier = await client().planTier.findUniqueOrThrow({
        where: { key: "free" },
      });
      const org = await client().organization.create({
        data: { name: namespace, slug: namespace, planTierId: tier.id },
      });
      organizationId = org.id;
      projectId = (
        await client().project.create({
          data: { organizationId, name: namespace, slug: namespace },
        })
      ).id;
      clerkId = `${namespace}-owner`;
      const user = await client().user.create({
        data: {
          clerkUserId: clerkId,
          email: `${namespace}-owner@example.invalid`,
          memberships: {
            create: { organizationId, role: "OWNER", seatType: "FULL" },
          },
        },
        include: { memberships: true },
      });
      actorId = user.id;
      const reader = await client().user.create({
        data: {
          clerkUserId: `${namespace}-viewer`,
          email: `${namespace}-viewer@example.invalid`,
          memberships: {
            create: { organizationId, role: "VIEWER", seatType: "READ_ONLY" },
          },
        },
        include: { memberships: true },
      });
      otherActorId = reader.id;
      const otherOrg = await client().organization.create({
        data: {
          name: `${namespace}-foreign`,
          slug: `${namespace}-foreign`,
          planTierId: tier.id,
        },
      });
      const outsider = await client().user.create({
        data: {
          clerkUserId: `${namespace}-foreign`,
          email: `${namespace}-foreign@example.invalid`,
          memberships: {
            create: {
              organizationId: otherOrg.id,
              role: "OWNER",
              seatType: "FULL",
            },
          },
        },
        include: { memberships: true },
      });
      const context = (current: typeof user): Context => ({
        prisma: client() as Context["prisma"],
        user: current,
        staff: null,
        securityLogger: { warn: () => {} },
        staffAttempt: {
          tokenConfigured: false,
          tokenPresented: false,
          actorHeaderPresented: false,
        },
      });
      ownerContext = context(user);
      owner = router.createCaller(ownerContext);
      viewer = router.createCaller(context(reader));
      foreign = router.createCaller(context(outsider));
      console.info(
        JSON.stringify({
          kind: "owned_metadata_native_fixture",
          namespace,
          database: admitted.database,
          snapshotHash: admitted.snapshotHash,
          retained: true,
          nativeRuntimeSecurityAccepted: false,
          productionAccepted: false,
        }),
      );
    }, 120000);
    afterAll(async () => {
      // No hardDeleteOrganization, SQL DELETE/DROP, reset, grants or cleanup.
      console.info(
        JSON.stringify({
          kind: "owned_metadata_native_outcomes",
          namespace,
          nativeConcurrencyOutcomes,
          retained: true,
          fullRuntimeImageSecurityAccepted: false,
          productionAccepted: false,
        }),
      );
      if (db) await db.$disconnect();
    }, 30000);
    async function seed(label: string) {
      const number = ++seedNumber;
      return client().testCase.create({
        data: {
          projectId,
          // Native identity trigger assigns counter/display ID. Never bypass it
          // with explicit caseNumber/displayId or relaxed schema constraints.
          title: `${namespace}-${label}-${number}-current`,
          given: ["", "  exact  ", "same", "same"],
          when: ["Synthetic only"],
          then: ["No external system"],
          tags: ["", " retained "],
          priority: "MEDIUM",
          testType: "FUNCTIONAL",
          reviewStatus: "APPROVED",
          verificationProfile: {},
          steps: { create: fields },
        },
      });
    }
    async function version(caseId: string, title: string, steps = [fields]) {
      const row = await client().testCase.findUniqueOrThrow({
        where: { id: caseId },
      });
      return client().testCaseVersion.create({
        data: {
          testCaseId: caseId,
          versionNumber: 1,
          title,
          background: row.background,
          given: row.given,
          when: row.when,
          then: row.then,
          tags: row.tags,
          priority: row.priority,
          testType: row.testType,
          validationDomain: row.validationDomain,
          verificationProfile: {},
          steps: steps as unknown as Prisma.InputJsonValue,
          createdById: actorId,
        },
      });
    }
    async function restoreInput(
      caseId: string,
      selected: Restore["request"]["fields"] = ["title"],
    ): Promise<Restore> {
      const preview = await owner.caseVersionReview.preview({
        projectId,
        testCaseId: caseId,
        versionNumber: 1,
        readRequestId: randomUUID(),
        originalOrganizationId: organizationId,
        expectedClerkActorId: clerkId,
      });
      return {
        request: {
          projectId,
          testCaseId: caseId,
          versionNumber: 1,
          expectedCaseRevision: preview.expectedCaseRevision,
          expectedVersionRevision: preview.expectedVersionRevision,
          fields: selected,
          reason: "  Reviewed synthetic restore  ",
          confirmed: true,
          requestId: randomUUID(),
        },
        ...pins(),
      };
    }
    async function counts(caseId: string) {
      return {
        versions: await client().testCaseVersion.count({
          where: { testCaseId: caseId },
        }),
        audits: await client().auditLog.count({
          where: { projectId, entityId: caseId },
        }),
      };
    }
    async function graphDraft(caseId: string, ids: string[]) {
      const page = await owner.testCaseStructure.prerequisitePage({
        ...prerequisitePins(caseId),
        readRequestId: randomUUID(),
        search: "",
        sort: "case-id",
      });
      return {
        ...prerequisitePins(caseId),
        requestId: randomUUID(),
        expectedGraphHash: page.graphHash,
        expectedPrerequisiteIds: page.prerequisiteIds,
        prerequisiteIds: ids,
        confirmed: true as const,
      };
    }
    it("echoes exact scoped read nonce/projection/native identity; fresh readonly and foreign authorization remain distinct", async () => {
      const item = await seed("reads");
      await version(item.id, "Saved synthetic title");
      const readRequestId = randomUUID(),
        scope = {
          projectId,
          organizationId,
          actorId,
          actorClerkUserId: clerkId,
        };
      expect(
        await owner.caseVersionReview.access({
          projectId,
          testCaseId: item.id,
          readRequestId,
          originalOrganizationId: organizationId,
          expectedClerkActorId: clerkId,
        }),
      ).toMatchObject({
        readRequestId,
        readScope: scope,
        canRecover: true,
        projection: { kind: "ACCESS" },
      });
      expect(
        (
          await owner.caseVersionReview.preview({
            projectId,
            testCaseId: item.id,
            versionNumber: 1,
            readRequestId,
            originalOrganizationId: organizationId,
            expectedClerkActorId: clerkId,
          })
        ).readContext,
      ).toMatchObject({
        readRequestId,
        readScope: scope,
        projection: { kind: "CURRENT", versionNumber: 1 },
      });
      expect(
        (
          await owner.caseVersionReview.list({
            projectId,
            testCaseId: item.id,
            take: 1,
            readRequestId,
          })
        ).readContext,
      ).toMatchObject({
        readRequestId,
        projection: { kind: "LIST", take: 1, before: null },
      });
      const next = randomUUID();
      expect(
        (
          await owner.caseVersionReview.access({
            projectId,
            testCaseId: item.id,
            readRequestId: next,
          })
        ).readRequestId,
      ).toBe(next);
      expect(
        await viewer.caseVersionReview.access({
          projectId,
          testCaseId: item.id,
          readRequestId: randomUUID(),
        }),
      ).toMatchObject({
        canRecover: false,
        readScope: { actorId: otherActorId },
      });
      await expect(
        foreign.caseVersionReview.access({
          projectId,
          testCaseId: item.id,
          readRequestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        owner.caseVersionReview.access({
          projectId,
          testCaseId: item.id,
          readRequestId: randomUUID(),
          originalOrganizationId: "synthetic-wrong-org",
          expectedClerkActorId: clerkId,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const priority = await owner.casePriority.preview({
        projectId,
        caseId: item.id,
        requestId: randomUUID(),
        ...pins(),
      });
      expect(priority).toMatchObject({
        readScope: scope,
        canRecover: true,
        canChange: true,
      });
      const prereqNonce = randomUUID();
      expect(
        await owner.testCaseStructure.prerequisiteAccess({
          ...prerequisitePins(item.id),
          readRequestId: prereqNonce,
        }),
      ).toMatchObject({
        readRequestId: prereqNonce,
        readScope: scope,
        canEdit: true,
      });
      await expect(
        viewer.caseVersionReview.restoreReviewed(await restoreInput(item.id)),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("restores exact authored six-field steps and keeps legacy request hash/replay independent of read nonces", async () => {
      const item = await seed("version");
      const savedFields = {
        ...fields,
        action: "  Original\nstep  ",
        expectedActionOrData: "",
        expectedResult: null,
        expectedResponse: "200\n  retained ",
        mediaAttachmentIds: [],
      };
      await version(item.id, "Saved title", [savedFields]);
      const input = await restoreInput(item.id, ["steps", "title"]),
        ack = await owner.caseVersionReview.restoreReviewed(input);
      const { versionRestoreSchema } = await import("./caseVersionReview.js");
      const { qualityProfileHash } =
        await import("./qualityExperienceProfile.js");
      const parsed = versionRestoreSchema.parse(input.request);
      expect(ack.requestHash).toBe(
        qualityProfileHash({ ...parsed, fields: [...parsed.fields].sort() }),
      );
      expect(ack).toMatchObject({
        requestId: input.request.requestId,
        scopeProof: "CURRENT_LOCKED_AUTHORIZATION",
        readScope: { actorId, organizationId, actorClerkUserId: clerkId },
        replayed: false,
      });
      const own = await client().testCaseStep.findMany({
        where: { testCaseId: item.id },
        select: {
          order: true,
          action: true,
          expectedActionOrData: true,
          expectedResult: true,
          expectedResponse: true,
          mediaAttachmentIds: true,
        },
      });
      expect(own).toEqual([savedFields]);
      const before = await counts(item.id);
      expect(
        (await owner.caseVersionReview.restoreReviewed(input)).replayed,
      ).toBe(true);
      expect(await counts(item.id)).toEqual(before);
      await expect(
        owner.caseVersionReview.restoreReviewed({
          ...input,
          request: { ...input.request, reason: "Different reviewed reason" },
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      // Accepted UUID recovery precedes later unsupported native profile admission.
      await client()
        .$executeRaw`UPDATE "TestCase" SET "verificationProfile"='null'::jsonb WHERE id=${item.id} AND "projectId"=${projectId}`;
      expect(
        (await owner.caseVersionReview.restoreReviewed(input)).replayed,
      ).toBe(true);
      expect(await counts(item.id)).toEqual(before);
      await expect(
        owner.caseVersionReview.restoreReviewed({
          ...input,
          expectedNativeActorId: otherActorId,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    it("refuses new reviewed restore of current JSON-null or imprecise native profile without mutating columns/history", async () => {
      for (const representation of ["json-null", "precision"] as const) {
        const item = await seed(`refuse-${representation}`);
        await version(item.id, "Saved title");
        if (representation === "json-null")
          await client()
            .$executeRaw`UPDATE "TestCase" SET "verificationProfile"='null'::jsonb WHERE id=${item.id} AND "projectId"=${projectId}`;
        else
          await client()
            .$executeRaw`UPDATE "TestCase" SET "verificationProfile"='{"counter":9007199254740993}'::jsonb WHERE id=${item.id} AND "projectId"=${projectId}`;
        const before = await counts(item.id),
          input = await restoreInput(item.id);
        await expect(
          owner.caseVersionReview.restoreReviewed(input),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await counts(item.id)).toEqual(before);
        expect(
          (
            await client().testCase.findUniqueOrThrow({
              where: { id: item.id },
              select: { title: true },
            })
          ).title,
        ).toBe(item.title);
        const native = await client().$queryRaw<
          Array<{ exact: boolean }>
        >`SELECT CASE WHEN ${representation}='json-null' THEN "verificationProfile"='null'::jsonb ELSE "verificationProfile"->>'counter'='9007199254740993' END AS exact FROM "TestCase" WHERE id=${item.id} AND "projectId"=${projectId}`;
        expect(native[0]?.exact).toBe(true);
      }
    });
    it("copies native JSON-null and exact six-field own/shared priority snapshots; receipts recover before later precision bounds", async () => {
      for (const procedure of ["own", "shared"] as const) {
        const item = await seed(`priority-${procedure}`);
        if (procedure === "shared") {
          const shared = await client().sharedStepGroup.create({
            data: { projectId, name: `${namespace}-shared`, steps: [fields] },
          });
          await client().testCase.update({
            where: { id: item.id },
            data: { sharedStepGroupId: shared.id },
          });
        }
        await client()
          .$executeRaw`UPDATE "TestCase" SET "verificationProfile"='null'::jsonb WHERE id=${item.id} AND "projectId"=${projectId}`;
        const read = await owner.casePriority.preview({
          projectId,
          caseId: item.id,
          requestId: randomUUID(),
          ...pins(),
        });
        expect(read.canChange).toBe(true);
        const input = {
          projectId,
          caseId: item.id,
          priority: "HIGH" as const,
          expectedCaseRevision: read.caseRevision!,
          requestId: randomUUID(),
          originalOrganizationId: organizationId,
          expectedClerkActorId: clerkId,
        };
        const ack = await owner.casePriority.setReviewed({
          input,
          expectedNativeActorId: actorId,
        });
        const { casePriorityInput, casePriorityRequestHash } =
          await import("./casePriority.js");
        expect(ack.requestHash).toBe(
          casePriorityRequestHash(casePriorityInput.parse(input)),
        );
        const saved = await client().testCaseVersion.findFirstOrThrow({
          where: { testCaseId: item.id },
          orderBy: { versionNumber: "desc" },
        });
        expect(saved.steps).toEqual([fields]);
        expect(
          Object.keys(
            (saved.steps as Array<Record<string, unknown>>)[0]!,
          ).sort(),
        ).toEqual(Object.keys(fields).sort());
        const native = await client().$queryRaw<
          Array<{ exact: boolean; jsonNull: boolean }>
        >`SELECT v."verificationProfile" IS NOT DISTINCT FROM c."verificationProfile" AS exact, v."verificationProfile"='null'::jsonb AS "jsonNull" FROM "TestCaseVersion" v JOIN "TestCase" c ON c.id=v."testCaseId" WHERE v.id=${saved.id} AND c."projectId"=${projectId}`;
        expect(native[0]).toEqual({ exact: true, jsonNull: true });
        const before = await counts(item.id);
        await client()
          .$executeRaw`UPDATE "TestCase" SET "verificationProfile"='{"counter":9007199254740993}'::jsonb WHERE id=${item.id} AND "projectId"=${projectId}`;
        expect(
          (
            await owner.casePriority.setReviewed({
              input,
              expectedNativeActorId: actorId,
            })
          ).replayed,
        ).toBe(true);
        expect(await counts(item.id)).toEqual(before);
        await expect(
          owner.casePriority.setReviewed({
            input,
            expectedNativeActorId: otherActorId,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        const blocked = await owner.casePriority.preview({
          projectId,
          caseId: item.id,
          requestId: randomUUID(),
          ...pins(),
        });
        expect(blocked).toMatchObject({
          canRecover: true,
          canChange: false,
          caseRevision: null,
        });
        await expect(
          owner.casePriority.setReviewed({
            input: { ...input, requestId: randomUUID() },
            expectedNativeActorId: actorId,
          }),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await counts(item.id)).toEqual(before);
      }
    });
    it("rechecks live suspension, current full seat and original Clerk mapping before accepted receipts", async () => {
      const item = await seed("fresh-native-auth");
      await version(item.id, "Saved title");
      const input = await restoreInput(item.id);
      await owner.caseVersionReview.restoreReviewed(input);
      const before = await counts(item.id);
      await client().organization.update({
        where: { id: organizationId },
        data: { suspendedAt: new Date() },
      });
      await expect(
        owner.caseVersionReview.restoreReviewed(input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await client().organization.update({
        where: { id: organizationId },
        data: { suspendedAt: null },
      });
      await client().membership.update({
        where: { organizationId_userId: { organizationId, userId: actorId } },
        data: { seatType: "READ_ONLY" },
      });
      await expect(
        owner.caseVersionReview.restoreReviewed(input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await client().membership.update({
        where: { organizationId_userId: { organizationId, userId: actorId } },
        data: { seatType: "FULL" },
      });
      await client().user.update({
        where: { id: actorId },
        data: { clerkUserId: `${clerkId}-changed` },
      });
      await expect(
        owner.caseVersionReview.restoreReviewed(input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await client().user.update({
        where: { id: actorId },
        data: { clerkUserId: clerkId },
      });
      expect(
        (await owner.caseVersionReview.restoreReviewed(input)).replayed,
      ).toBe(true);
      expect(await counts(item.id)).toEqual(before);
    });
    it("accepted version and priority UUIDs recover before later complete-body byte caps; new UUIDs fail closed", async () => {
      const item = await seed("receipt-before-body-cap");
      await version(item.id, "Saved title");
      const restore = await restoreInput(item.id);
      await owner.caseVersionReview.restoreReviewed(restore);
      const preview = await owner.casePriority.preview({
        projectId,
        caseId: item.id,
        requestId: randomUUID(),
        ...pins(),
      });
      const input = {
        projectId,
        caseId: item.id,
        priority: "HIGH" as const,
        expectedCaseRevision: preview.caseRevision!,
        requestId: randomUUID(),
        originalOrganizationId: organizationId,
        expectedClerkActorId: clerkId,
      };
      await owner.casePriority.setReviewed({
        input,
        expectedNativeActorId: actorId,
      });
      const before = await counts(item.id);
      // A bounded synthetic canary exceeds each supported 512KiB complete-body
      // cap. No production record/provider/upload or schema relaxation is used.
      await client()
        .$executeRaw`UPDATE "TestCase" SET background=repeat('x',524289) WHERE id=${item.id} AND "projectId"=${projectId}`;
      expect(
        (await owner.caseVersionReview.restoreReviewed(restore)).replayed,
      ).toBe(true);
      expect(
        (
          await owner.casePriority.setReviewed({
            input,
            expectedNativeActorId: actorId,
          })
        ).replayed,
      ).toBe(true);
      await expect(
        owner.caseVersionReview.restoreReviewed({
          ...restore,
          request: { ...restore.request, requestId: randomUUID() },
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(
        owner.casePriority.setReviewed({
          input: { ...input, requestId: randomUUID() },
          expectedNativeActorId: actorId,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await counts(item.id)).toEqual(before);
    });
    it("prerequisite graph CAS, UUID replay, retained archived links and new-unreviewed/cycle refusals are atomic", async () => {
      const [dependent, first, second, pending] = await Promise.all([
        seed("dependent"),
        seed("first"),
        seed("second"),
        seed("pending"),
      ]);
      const original = await graphDraft(dependent.id, [first.id]),
        accepted =
          await owner.testCaseStructure.reviewedSetPrerequisites(original);
      const { prerequisiteRequestHash } =
        await import("./casePrerequisiteSchema.js");
      expect(accepted.requestHash).toBe(prerequisiteRequestHash(original));
      const auditWhere = {
        projectId,
        entityType: "CasePrerequisiteWrite",
        entityId: original.requestId,
      };
      expect(
        (await owner.testCaseStructure.reviewedSetPrerequisites(original))
          .replayed,
      ).toBe(true);
      expect(await client().auditLog.count({ where: auditWhere })).toBe(1);
      await expect(
        owner.testCaseStructure.reviewedSetPrerequisites({
          ...original,
          prerequisiteIds: [second.id],
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const stale = await graphDraft(dependent.id, [first.id, second.id]);
      await owner.testCaseStructure.reviewedSetPrerequisites(
        await graphDraft(second.id, [first.id]),
      );
      await expect(
        owner.testCaseStructure.reviewedSetPrerequisites(stale),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await client().testCase.update({
        where: { id: first.id },
        data: { archived: true },
      });
      const retained = await owner.testCaseStructure.prerequisitePage({
        ...prerequisitePins(dependent.id),
        readRequestId: randomUUID(),
        search: "",
        sort: "title",
      });
      expect(retained.linked).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: first.id, archived: true }),
        ]),
      );
      expect(retained.items.some((row) => row.id === first.id)).toBe(false);
      await owner.testCaseStructure.reviewedSetPrerequisites(
        await graphDraft(dependent.id, [first.id, second.id]),
      );
      await client().testCase.update({
        where: { id: pending.id },
        data: { reviewStatus: "PENDING_REVIEW" },
      });
      await expect(
        owner.testCaseStructure.reviewedSetPrerequisites(
          await graphDraft(dependent.id, [first.id, second.id, pending.id]),
        ),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(
        owner.testCaseStructure.reviewedSetPrerequisites(
          await graphDraft(second.id, [dependent.id]),
        ),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(
        owner.testCaseStructure.reviewedSetPrerequisites({
          ...original,
          expectedActorId: otherActorId,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(
        (await owner.testCaseStructure.reviewedSetPrerequisites(original))
          .replayed,
      ).toBe(true);
      expect(
        await client().testCasePrerequisite.findMany({
          where: { projectId, dependentId: dependent.id },
          select: { prerequisiteId: true },
          orderBy: { prerequisiteId: "asc" },
        }),
      ).toEqual(
        [first.id, second.id]
          .sort()
          .map((prerequisiteId) => ({ prerequisiteId })),
      );
    });
    it("concurrent prerequisite reviewers admit at most one original graph; records native serialization separately", async () => {
      const [dependent, left, right] = await Promise.all([
        seed("race"),
        seed("left"),
        seed("right"),
      ]);
      const a = await graphDraft(dependent.id, [left.id]),
        b = { ...a, requestId: randomUUID(), prerequisiteIds: [right.id] };
      const outcomes = await Promise.allSettled([
        owner.testCaseStructure.reviewedSetPrerequisites(a),
        owner.testCaseStructure.reviewedSetPrerequisites(b),
      ]);
      const won = outcomes.flatMap((outcome, index) =>
        outcome.status === "fulfilled" ? [index] : [],
      );
      expect(won).toHaveLength(1);
      for (const outcome of outcomes)
        if (outcome.status === "rejected") {
          const cause = outcome.reason as {
            code?: string;
            meta?: { code?: string };
            cause?: { code?: string; meta?: { code?: string } };
          };
          const code =
            cause.code === "CONFLICT"
              ? "APPLICATION_CAS_CONFLICT"
              : cause.code === "P2034" ||
                  cause.cause?.code === "P2034" ||
                  cause.code === "40001" ||
                  cause.cause?.code === "40001" ||
                  cause.meta?.code === "40001" ||
                  cause.cause?.meta?.code === "40001"
                ? "NATIVE_SERIALIZATION_ABORT"
                : "UNEXPECTED_ABORT";
          nativeConcurrencyOutcomes.push(code);
          expect(code).not.toBe("UNEXPECTED_ABORT");
        }
      const winner = won[0] === 0 ? a : b;
      expect(
        await client().testCasePrerequisite.findMany({
          where: { projectId, dependentId: dependent.id },
          select: { prerequisiteId: true },
        }),
      ).toEqual(
        winner.prerequisiteIds.map((prerequisiteId) => ({ prerequisiteId })),
      );
      expect(
        await client().auditLog.count({
          where: {
            projectId,
            entityType: "CasePrerequisiteWrite",
            entityId: { in: [a.requestId, b.requestId] },
          },
        }),
      ).toBe(1);
      expect(
        (await owner.testCaseStructure.reviewedSetPrerequisites(winner))
          .replayed,
      ).toBe(true);
      // No automatic retry of loser, new UUID, bypass or altered transaction budget.
    });
  },
);
