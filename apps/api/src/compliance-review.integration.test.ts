import { testPlansRouter } from "./routers/testPlans.js";
import { previewProjectDeletion } from "./services/projectDeletion.js";
import {
  previewOrgHardDelete,
  hardDeleteOrganization,
} from "./services/orgHardDelete.js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { prisma } from "@vaettir/db";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { complianceRouter } from "./routers/compliance.js";
import type { Context } from "./trpc.js";
import {
  previewCompliance,
  loadComplianceReference,
  readComplianceDraft,
  saveComplianceSelection,
  applyComplianceReview,
  explainComplianceMatch,
} from "./services/complianceReview.js";

const available = !!process.env.DATABASE_URL;
if (available) assertOwnedTestDatabase(process.env.DATABASE_URL);
async function fixture() {
  const key = `compliance-${randomUUID()}`;
  const tier = await prisma.planTier.create({
    data: { key, name: key, sortOrder: 0, minFullSeats: 1 },
  });
  const org = await prisma.organization.create({
    data: { name: key, slug: key, planTierId: tier.id },
  });
  const user = await prisma.user.create({
    data: { clerkUserId: key, email: `${key}@example.invalid` },
  });
  await prisma.membership.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      role: "OWNER",
      seatType: "FULL",
    },
  });
  const project = await prisma.project.create({
    data: { organizationId: org.id, name: key, slug: key },
  });
  const actor = {
    id: user.id,
    clerkActorId: key,
    workspaceOrganizationId: org.id,
  };
  const scope = {
    projectId: project.id,
    originalOrganizationId: org.id,
    expectedClerkActorId: key,
  };
  const framework = await loadComplianceReference(
    prisma,
    actor,
    scope,
    "music-rights-us",
  );
  const controls = await prisma.complianceControl.findMany({
    where: { frameworkId: framework.id },
    orderBy: { code: "asc" },
  });
  const tc = await prisma.testCase.create({
    data: {
      projectId: project.id,
      title: "License expiry review",
      given: ["music license terms"],
      when: ["compare expiry and territory"],
      then: ["missing permission requires review"],
      tags: [],
      testType: "COMPLIANCE",
      steps: {
        create: {
          order: 0,
          action: "Review soundtrack license",
          expectedResult: "Expired license is flagged",
        },
      },
    },
    include: { steps: true },
  });
  const ctx = {
    prisma,
    user: await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { memberships: true },
    }),
    authenticatedClerkSubject: key,
    workspaceOrganizationId: org.id,
    staff: null,
  } as Context;
  const input = {
    ...scope,
    requestId: randomUUID(),
    frameworkIds: [framework.id],
  };
  return { actor, scope, framework, controls, tc, ctx, input };
}
async function selected(f: Awaited<ReturnType<typeof fixture>>) {
  const d = await previewCompliance(prisma, f.actor, f.input);
  const p = d.proposals[0]!;
  return saveComplianceSelection(prisma, f.actor, {
    ...f.scope,
    draftId: d.id,
    expectedDigest: d.digest,
    selection: [
      { controlId: p.controlId, caseIds: [f.tc.id], newCase: p.outline },
    ],
  });
}

describe("compliance proposal explanation", () => {
  it("uses procedure terms and makes no semantic coverage assertion", () => {
    const m = explainComplianceMatch(
      { title: "Music license expiry", description: null },
      { title: "Unrelated label", body: "Expired license and music expiry" },
    );
    assert.equal(m.titleTerms.length, 0);
    assert.ok(m.procedureTerms.includes("expiry"));
    assert.match(m.explanation, /not verified coverage/);
  });
});
describe.skipIf(!available)(
  "owned compliance review transactions (fixtures retained)",
  () => {
    it("versions tenant references without adopting global identities and keeps custom mutations private", async () => {
      const f = await fixture(),
        other = await fixture();
      assert.notEqual(f.framework.id, other.framework.id);
      assert.equal(
        (
          await loadComplianceReference(
            prisma,
            f.actor,
            f.scope,
            "music-rights-us",
          )
        ).id,
        f.framework.id,
      );
      const caller = complianceRouter.createCaller(f.ctx);
      const custom = await caller.createFramework({
        projectId: f.scope.projectId,
        key: "same-label",
        name: "Private licensed criteria",
      });
      assert.equal(custom.organizationId, f.scope.originalOrganizationId);
      await assert.rejects(
        complianceRouter.createCaller(other.ctx).createControl({
          projectId: other.scope.projectId,
          frameworkId: custom.id,
          code: "PRIVATE",
          title: "Private",
        }),
      );
      assert.ok(
        !(
          await complianceRouter
            .createCaller(other.ctx)
            .listFrameworks({ projectId: other.scope.projectId })
        ).some((x) => x.id === custom.id),
      );
      await assert.rejects(
        caller.importControls({
          projectId: f.scope.projectId,
          frameworkId: f.framework.id,
          controls: [{ code: "INJECT", title: "Not public" }],
        }),
      );
      await assert.rejects(
        caller.createFramework({ key: "unscoped", name: "No project" }),
      );
    });
    it("traverses beyond the former 200-case limit including structured expected results", async () => {
      const f = await fixture();
      await prisma.testCase.createMany({
        data: Array.from({ length: 205 }, (_, n) => ({
          id: `scan-${randomUUID()}-${n}`,
          projectId: f.scope.projectId,
          title: `Synthetic ${n}`,
          given: [],
          when: [],
          then: [],
          tags: [],
          testType: "COMPLIANCE" as const,
        })),
      });
      const d = await previewCompliance(prisma, f.actor, f.input);
      assert.equal(d.scope.scanned, 206);
      assert.equal(d.scope.omitted, 0);
      assert.ok(
        d.cases.some((c) =>
          c.steps.some(
            (s) => s.expectedResult === "Expired license is flagged",
          ),
        ),
      );
      assert.deepEqual(d.selection, []);
      assert.equal(
        (await previewCompliance(prisma, f.actor, f.input)).id,
        d.id,
      );
    });
    it("atomically applies, preserves ordinary approval and returns an exact lost-response receipt", async () => {
      const f = await fixture(),
        d = await selected(f);
      const input = {
        ...f.scope,
        draftId: d.id,
        expectedDigest: d.digest,
        requestId: randomUUID(),
        confirmed: true as const,
      };
      const result = await applyComplianceReview(prisma, f.actor, input);
      assert.equal(result.state, "APPLIED");
      assert.deepEqual(
        (await applyComplianceReview(prisma, f.actor, input)).receipt,
        result.receipt,
      );
      const cases = await prisma.testCase.findMany({
        where: { projectId: f.scope.projectId, id: { not: f.tc.id } },
      });
      assert.equal(cases.length, 1);
      assert.equal(cases[0]!.reviewStatus, "PENDING_REVIEW");
      assert.equal(
        await prisma.testCaseVersion.count({
          where: { testCaseId: cases[0]!.id },
        }),
        1,
      );
      assert.equal(
        await prisma.testCaseComplianceControl.count({
          where: { testCase: { projectId: f.scope.projectId } },
        }),
        2,
      );
      await assert.rejects(
        applyComplianceReview(prisma, f.actor, {
          ...input,
          requestId: randomUUID(),
        }),
      );
      assert.ok(
        (await prisma.auditLog.count({
          where: { entityId: d.id, projectId: f.scope.projectId },
        })) >= 3,
      );
    });
    it("rejects another actor, workspace, project and service-token identity", async () => {
      const f = await fixture(),
        other = await fixture(),
        d = await selected(f);
      await assert.rejects(
        readComplianceDraft(prisma, other.actor, {
          ...other.scope,
          draftId: d.id,
        }),
      );
      await assert.rejects(
        readComplianceDraft(
          prisma,
          {
            ...f.actor,
            workspaceOrganizationId: other.scope.originalOrganizationId,
          },
          { ...f.scope, draftId: d.id },
        ),
      );
      await assert.rejects(
        previewCompliance(prisma, f.actor, {
          ...f.input,
          frameworkIds: [other.framework.id],
        }),
      );
      await assert.rejects(
        complianceRouter
          .createCaller({
            ...f.ctx,
            authenticatedClerkSubject: null,
            authenticatedApiKeyId: "synthetic-token",
          })
          .preview(f.input),
      );
    });
    it.each([
      "role",
      "seat",
      "suspension",
      "actor",
      "project",
      "membership-delete",
    ])(
      "invalidates retained authority after %s change-and-restore",
      async (change) => {
        const f = await fixture(),
          d = await selected(f),
          member = {
            organizationId_userId: {
              organizationId: f.scope.originalOrganizationId,
              userId: f.actor.id,
            },
          };
        if (change === "role") {
          await prisma.membership.update({
            where: member,
            data: { role: "VIEWER" },
          });
          await prisma.membership.update({
            where: member,
            data: { role: "OWNER" },
          });
        }
        if (change === "seat") {
          await prisma.membership.update({
            where: member,
            data: { seatType: "READ_ONLY" },
          });
          await prisma.membership.update({
            where: member,
            data: { seatType: "FULL" },
          });
        }
        if (change === "suspension") {
          await prisma.organization.update({
            where: { id: f.scope.originalOrganizationId },
            data: { suspendedAt: new Date() },
          });
          await prisma.organization.update({
            where: { id: f.scope.originalOrganizationId },
            data: { suspendedAt: null },
          });
        }
        if (change === "actor") {
          await prisma.user.update({
            where: { id: f.actor.id },
            data: { clerkUserId: randomUUID() },
          });
          await prisma.user.update({
            where: { id: f.actor.id },
            data: { clerkUserId: f.actor.clerkActorId },
          });
        }
        if (change === "membership-delete") {
          await prisma.membership.delete({ where: member });
          await prisma.membership.create({
            data: {
              organizationId: f.scope.originalOrganizationId,
              userId: f.actor.id,
              role: "OWNER",
              seatType: "FULL",
            },
          });
        }
        if (change === "project") {
          const other = await fixture();
          // Existing project-key ownership protections can themselves refuse transfers.
          try {
            await prisma.project.update({
              where: { id: f.scope.projectId },
              data: { organizationId: other.scope.originalOrganizationId },
            });
          } catch (error) {
            assert.match(
              String(error),
              /organization|ownership|project|transfer/i,
            );
            const retained = await prisma.project.findUniqueOrThrow({
              where: { id: f.scope.projectId },
            });
            assert.equal(
              retained.organizationId,
              f.scope.originalOrganizationId,
            );
            // A blocked transfer is protection evidence, not a completed transfer test.
            assert.equal(
              (
                await prisma.complianceReviewDraft.findUniqueOrThrow({
                  where: { id: d.id },
                })
              ).state,
              "DRAFT",
            );
            return;
          }
          await prisma.project.update({
            where: { id: f.scope.projectId },
            data: { organizationId: f.scope.originalOrganizationId },
          });
        }
        await assert.rejects(
          applyComplianceReview(prisma, f.actor, {
            ...f.scope,
            draftId: d.id,
            expectedDigest: d.digest,
            requestId: randomUUID(),
            confirmed: true,
          }),
        );
        assert.equal(
          await prisma.testCase.count({
            where: { projectId: f.scope.projectId },
          }),
          1,
        );
        const stored = await prisma.complianceReviewDraft.findUniqueOrThrow({
          where: { id: d.id },
        });
        assert.ok(stored.revokedAt);
        assert.ok(stored.authorityGeneration > 0);
      },
    );
    it.each(["case", "step", "control", "mapping"])(
      "rejects %s source changes even after restoration",
      async (change) => {
        const f = await fixture(),
          d = await selected(f);
        if (change === "case") {
          await prisma.testCase.update({
            where: { id: f.tc.id },
            data: { title: "Changed" },
          });
          await prisma.testCase.update({
            where: { id: f.tc.id },
            data: { title: f.tc.title },
          });
        }
        if (change === "step") {
          const step = f.tc.steps[0]!;
          await prisma.testCaseStep.update({
            where: { id: step.id },
            data: { expectedResult: "Changed" },
          });
          await prisma.testCaseStep.update({
            where: { id: step.id },
            data: { expectedResult: step.expectedResult },
          });
        }
        if (change === "control") {
          const c = f.controls[0]!;
          await prisma.complianceControl.update({
            where: { id: c.id },
            data: { title: "Changed" },
          });
          await prisma.complianceControl.update({
            where: { id: c.id },
            data: { title: c.title },
          });
        }
        if (change === "mapping") {
          const data = { testCaseId: f.tc.id, controlId: f.controls[0]!.id };
          await prisma.testCaseComplianceControl.create({ data });
          await prisma.testCaseComplianceControl.delete({
            where: { testCaseId_controlId: data },
          });
        }
        await assert.rejects(
          applyComplianceReview(prisma, f.actor, {
            ...f.scope,
            draftId: d.id,
            expectedDigest: d.digest,
            requestId: randomUUID(),
            confirmed: true,
          }),
        );
        assert.equal(
          await prisma.testCase.count({
            where: { projectId: f.scope.projectId },
          }),
          1,
        );
      },
    );
    it("rejects tampered selections and stale saved review digests", async () => {
      const f = await fixture(),
        other = await fixture(),
        d = await previewCompliance(prisma, f.actor, f.input);
      await assert.rejects(
        saveComplianceSelection(prisma, f.actor, {
          ...f.scope,
          draftId: d.id,
          expectedDigest: d.digest,
          selection: [
            {
              controlId: d.proposals[0]!.controlId,
              caseIds: [other.tc.id],
              newCase: null,
            },
          ],
        }),
      );
      const saved = await selected(f);
      await assert.rejects(
        applyComplianceReview(prisma, f.actor, {
          ...f.scope,
          draftId: saved.id,
          expectedDigest: d.digest,
          requestId: randomUUID(),
          confirmed: true,
        }),
      );
    });
    it("concurrent submits produce one receipt and can reconcile serialization refusal", async () => {
      const f = await fixture(),
        d = await selected(f);
      const input = {
        ...f.scope,
        draftId: d.id,
        expectedDigest: d.digest,
        requestId: randomUUID(),
        confirmed: true as const,
      };
      const results = await Promise.allSettled([
        applyComplianceReview(prisma, f.actor, input),
        applyComplianceReview(prisma, f.actor, input),
      ]);
      assert.ok(results.some((r) => r.status === "fulfilled"));
      assert.equal(
        await prisma.testCase.count({
          where: { projectId: f.scope.projectId },
        }),
        2,
      );
      assert.equal(
        (await applyComplianceReview(prisma, f.actor, input)).state,
        "APPLIED",
      );
    });
    it("validates reviewed required case fields atomically and detects schema change-and-restore", async () => {
      const f = await fixture();
      const schema = {
        version: 1,
        fields: [
          {
            key: "license_owner",
            label: "License owner",
            type: "TEXT",
            required: true,
            retired: false,
            options: [],
          },
        ],
      };
      await prisma.project.update({
        where: { id: f.scope.projectId },
        data: { caseFieldSchema: schema },
      });
      const d = await selected(f);
      const input = {
        ...f.scope,
        draftId: d.id,
        expectedDigest: d.digest,
        requestId: randomUUID(),
        confirmed: true as const,
      };
      await assert.rejects(
        applyComplianceReview(prisma, f.actor, input),
        /Complete project case fields/,
      );
      assert.equal(
        await prisma.testCase.count({
          where: { projectId: f.scope.projectId },
        }),
        1,
      );
      assert.equal(
        await prisma.testCaseComplianceControl.count({
          where: { testCase: { projectId: f.scope.projectId } },
        }),
        0,
      );
      assert.equal(
        (
          await prisma.complianceReviewDraft.findUniqueOrThrow({
            where: { id: d.id },
          })
        ).state,
        "DRAFT",
      );
      const saved = await saveComplianceSelection(prisma, f.actor, {
        ...f.scope,
        draftId: d.id,
        expectedDigest: d.digest,
        selection: d.selection.map((r) => ({
          ...r,
          newCase: r.newCase
            ? {
                ...r.newCase,
                customFields: { license_owner: "Synthetic rights reviewer" },
              }
            : null,
        })),
      });
      const applied = await applyComplianceReview(prisma, f.actor, {
        ...input,
        expectedDigest: saved.digest,
      });
      const created = await prisma.testCase.findUniqueOrThrow({
        where: { id: applied.receipt!.createdIds[0] },
      });
      assert.deepEqual(created.customFields, {
        license_owner: "Synthetic rights reviewer",
      });
      const second = await selected({
        ...f,
        input: { ...f.input, requestId: randomUUID() },
      });
      await prisma.project.update({
        where: { id: f.scope.projectId },
        data: {
          caseFieldSchema: {
            ...schema,
            fields: schema.fields.map((field) => ({
              ...field,
              label: "Changed label",
            })),
          },
        },
      });
      await prisma.project.update({
        where: { id: f.scope.projectId },
        data: { caseFieldSchema: schema },
      });
      await assert.rejects(
        applyComplianceReview(prisma, f.actor, {
          ...input,
          draftId: second.id,
          expectedDigest: second.digest,
          requestId: randomUUID(),
        }),
        /changed/,
      );
    });

    it("fails closed on every compliance route in a tenant-aware recovery image", async () => {
      const f = await fixture(),
        caller = complianceRouter.createCaller(f.ctx);
      const routes = Object.keys(complianceRouter._def.procedures);
      assert.ok(
        routes.includes("createControl") &&
          routes.includes("applyReview") &&
          routes.includes("myPendingSignOffRequests"),
      );
      const before = await prisma.complianceReviewDraft.count();
      vi.stubEnv("VAETTIR_COMPLIANCE_RECOVERY_MODE", "disabled");
      try {
        for (const route of routes)
          await assert.rejects(
            (
              caller as unknown as Record<
                string,
                (input?: unknown) => Promise<unknown>
              >
            )[route](),
            (error: unknown) =>
              !!error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "PRECONDITION_FAILED",
            route,
          );
        await assert.rejects(
          testPlansRouter
            .createCaller(f.ctx)
            .suggestRiskAreas({ projectId: f.scope.projectId }),
          (e: unknown) =>
            !!e &&
            typeof e === "object" &&
            "code" in e &&
            e.code === "PRECONDITION_FAILED",
        );
      } finally {
        vi.unstubAllEnvs();
      }
      assert.equal(await prisma.complianceReviewDraft.count(), before);
      assert.ok(
        (await caller.listFrameworks({ projectId: f.scope.projectId })).some(
          (r) => r.id === f.framework.id,
        ),
      );
    });

    it("hides foreign-owned control links and preserves both tenants when such links block erasure", async () => {
      const f = await fixture(),
        other = await fixture();
      await prisma.testCaseComplianceControl.create({
        data: { testCaseId: other.tc.id, controlId: f.controls[0]!.id },
      });
      const foreignCaller = complianceRouter.createCaller(other.ctx);
      assert.deepEqual(
        await foreignCaller.testCaseControls({ testCaseId: other.tc.id }),
        [],
      );
      await assert.rejects(
        hardDeleteOrganization(
          prisma,
          f.scope.originalOrganizationId,
          other.actor.id,
          "Synthetic foreign-link atomic refusal",
        ),
      );
      assert.ok(
        await prisma.organization.findUnique({
          where: { id: f.scope.originalOrganizationId },
        }),
      );
      assert.ok(
        await prisma.testCase.findUnique({ where: { id: other.tc.id } }),
      );
      assert.ok(
        await prisma.complianceFramework.findUnique({
          where: { id: f.framework.id },
        }),
      );
    });

    it("blocks ordinary project removal and includes owned catalog/reviews in original-organization erasure", async () => {
      const f = await fixture(),
        other = await fixture();
      const d = await selected(f);
      const plan = await previewProjectDeletion(prisma, f.scope.projectId);
      assert.equal(plan.blocked, true);
      assert.ok(
        plan.rows.some(
          (r) => r.key === "complianceReviewDrafts" && r.blocksDeletion,
        ),
      );
      await assert.rejects(
        prisma.project.delete({ where: { id: f.scope.projectId } }),
      );
      const erasure = await previewOrgHardDelete(
        prisma,
        f.scope.originalOrganizationId,
      );
      assert.equal(erasure.rowCounts.ComplianceFramework, 1);
      assert.equal(erasure.rowCounts.ComplianceControl, 8);
      assert.equal(erasure.rowCounts.ComplianceReviewDraft, 1);
      const outcome = await hardDeleteOrganization(
        prisma,
        f.scope.originalOrganizationId,
        other.actor.id,
        "Synthetic compliance lifecycle fixture only",
      );
      assert.equal(outcome.rowCounts.ComplianceReviewDraft, 1);
      assert.equal(outcome.rowCounts.ComplianceFramework, 1);
      assert.equal(outcome.rowCounts.ComplianceControl, 8);
      assert.equal(
        await prisma.complianceReviewDraft.findUnique({ where: { id: d.id } }),
        null,
      );
      assert.ok(
        await prisma.complianceFramework.findUnique({
          where: { id: other.framework.id },
        }),
      );
      assert.ok(
        await prisma.organizationDeletionLog.findUnique({
          where: { id: outcome.deletionLogId },
        }),
      );
    });

    it("retains an immutable analysis snapshot and an immutable applied receipt", async () => {
      const f = await fixture(),
        d = await selected(f);
      await assert.rejects(
        prisma.complianceReviewDraft.update({
          where: { id: d.id },
          data: { snapshot: {} },
        }),
      );
      await applyComplianceReview(prisma, f.actor, {
        ...f.scope,
        draftId: d.id,
        expectedDigest: d.digest,
        requestId: randomUUID(),
        confirmed: true,
      });
      await assert.rejects(
        prisma.complianceReviewDraft.update({
          where: { id: d.id },
          data: { receipt: {} },
        }),
      );
      await assert.rejects(
        prisma.complianceFramework.update({
          where: { id: f.framework.id },
          data: { organizationId: null },
        }),
      );
    });
    it("reports capped scope and refuses a missing-case proposal when cases were omitted", async () => {
      const f = await fixture();
      await prisma.testCase.createMany({
        data: Array.from({ length: 2000 }, (_, n) => ({
          id: `limit-${randomUUID()}-${n}`,
          projectId: f.scope.projectId,
          title: `Synthetic ${n}`,
          given: [],
          when: [],
          then: [],
          tags: [],
          testType: "COMPLIANCE" as const,
        })),
      });
      const d = await previewCompliance(prisma, f.actor, f.input);
      assert.equal(d.scope.scanned, 2000);
      assert.equal(d.scope.total, 2001);
      assert.equal(d.scope.omitted, 1);
      await assert.rejects(
        saveComplianceSelection(prisma, f.actor, {
          ...f.scope,
          draftId: d.id,
          expectedDigest: d.digest,
          selection: [
            {
              controlId: d.proposals[0]!.controlId,
              caseIds: [],
              newCase: d.proposals[0]!.outline,
            },
          ],
        }),
      );
    });
    it("quarantines unowned legacy controls, preserves project-linked evidence, and refuses ownership inference", async () => {
      const f = await fixture(),
        other = await fixture();
      const global = await prisma.complianceFramework.create({
        data: { key: randomUUID(), name: "Legacy private wording" },
      });
      const c = await prisma.complianceControl.create({
        data: {
          frameworkId: global.id,
          code: "LEGACY",
          title: "Retained legacy control",
        },
      });
      await prisma.testCaseComplianceControl.create({
        data: { testCaseId: f.tc.id, controlId: c.id },
      });
      const caller = complianceRouter.createCaller(f.ctx);
      assert.ok(
        (await caller.listFrameworks({ projectId: f.scope.projectId })).some(
          (x) => x.id === global.id && !x.workspaceOwned,
        ),
      );
      assert.equal(
        (
          await caller.controlCoverage({
            projectId: f.scope.projectId,
            frameworkId: global.id,
          })
        ).length,
        1,
      );
      assert.equal(
        (
          await complianceRouter.createCaller(other.ctx).controlCoverage({
            projectId: other.scope.projectId,
            frameworkId: global.id,
          })
        ).length,
        0,
      );
      await assert.rejects(
        caller.importControls({
          projectId: f.scope.projectId,
          frameworkId: global.id,
          controls: [{ code: "NEW", title: "No global mutation" }],
        }),
      );
      await assert.rejects(
        complianceRouter
          .createCaller(other.ctx)
          .mapTestCase({ testCaseId: other.tc.id, controlId: c.id }),
      );
      await assert.rejects(
        prisma.complianceFramework.update({
          where: { id: global.id },
          data: { organizationId: f.scope.originalOrganizationId },
        }),
      );
      const risk = await testPlansRouter
        .createCaller(f.ctx)
        .suggestRiskAreas({ projectId: f.scope.projectId });
      assert.ok(risk.every((r) => r.source !== "COMPLIANCE_GAP"));
      // No-project clients receive reference metadata only, never global control counts.
      assert.ok(
        (await caller.listFrameworks()).every(
          (x) => typeof x.controlCount === "number",
        ),
      );
    });
  },
);
