// Authored tonight; run only against a migrated disposable loopback test DB.
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import type { CaseProcedureExport } from "@vaettir/core";

describe("reviewed same-project procedure restoration", () => {
  const key = `procedure-reimport-${randomUUID()}`;
  const orgIds: string[] = [],
    userIds: string[] = [];
  let projectId: string, otherProjectId: string, actorId: string;
  let ownerClerkSubject: string;
  let owner: ReturnType<typeof appRouter.createCaller>,
    viewer: typeof owner,
    outsider: typeof owner;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned disposable loopback database required");
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    for (let n = 0; n < 2; n++) {
      const org = await prisma.organization.create({
        data: { name: `${key}-${n}`, slug: `${key}-${n}`, planTierId: tier.id },
      });
      orgIds.push(org.id);
      const authenticatedClerkSubject = `${key}-${n}`;
      const user = await prisma.user.create({
        data: {
          email: `${key}-${n}@example.com`,
          clerkUserId: authenticatedClerkSubject,
          memberships: {
            create: { organizationId: org.id, role: "OWNER", seatType: "FULL" },
          },
        },
        include: { memberships: true },
      });
      userIds.push(user.id);
      const caller = appRouter.createCaller({ prisma, user, authenticatedClerkSubject });
      const project = await caller.project.create({
        organizationId: org.id,
        name: `Synthetic ${n}`,
        caseKey: "rest",
      });
      if (n === 0) {
        owner = caller;
        actorId = user.id;
        ownerClerkSubject = authenticatedClerkSubject;
        projectId = project.id;
      } else {
        outsider = caller;
        otherProjectId = project.id;
      }
    }
    const viewerClerkSubject = `${key}-viewer`;
    const user = await prisma.user.create({
      data: {
        email: `${key}-viewer@example.com`,
        clerkUserId: viewerClerkSubject,
        memberships: {
          create: {
            organizationId: orgIds[0]!,
            role: "VIEWER",
            seatType: "READ_ONLY",
          },
        },
      },
      include: { memberships: true },
    });
    userIds.push(user.id);
    viewer = appRouter.createCaller({ prisma, user, authenticatedClerkSubject: viewerClerkSubject });
  });
  afterAll(async () => {
    for (const id of orgIds) {
      const org = await prisma.organization.findUnique({ where: { id } });
      if (!org?.slug.startsWith(key)) throw Error("Fixture owner mismatch");
      await hardDeleteOrganization(
        prisma,
        id,
        actorId,
        "Owned procedure reimport fixture teardown",
      );
    }
    // Retain dedicated synthetic users: deletion receipts intentionally retain their actor FK.
    for (const organizationId of orgIds)
      expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: actorId } })).toBe(1);
  });
  async function newCase(title = "  Original λ\nline ", targetProjectId = projectId) {
    return owner.testCases.create({
      projectId: targetProjectId,
      title,
      background: "背景\nexact",
      given: [" a|b "],
      when: [" action\nnext "],
      then: [" expected "],
      tags: ["a|b"],
      testType: "FUNCTIONAL",
      priority: "HIGH",
      suitePath: "Keep/suite",
      steps: [
        {
          action: " action ",
          expectedActionOrData: " data ",
          expectedResult: " result ",
          expectedResponse: " response ",
        },
      ],
    });
  }
  async function exportCase(id: string, targetProjectId = projectId) {
    return owner.testCases.exportProcedure({
      projectId: targetProjectId,
      ids: [id],
      scope: "selected",
      includeArchived: false,
    });
  }
  async function request(
    bundle: CaseProcedureExport,
    ids = bundle.cases.map((c) => c.id),
  ) {
    const serialized = JSON.stringify(bundle),
      review = await owner.caseProcedureReimport.preview({
        projectId: bundle.project.id,
        serialized,
      });
    return {
      projectId: bundle.project.id,
      serialized,
      expectedReviewHash: review.expectedReviewHash,
      actorId: review.actorId,
      selections: ids.map((caseId) => ({
        caseId,
        reason: "Approved snapshot correction",
        overwriteConfirmed: true as const,
      })),
      confirmed: true as const,
      requestId: randomUUID(),
    };
  }
  it("identical reruns are unchanged without new cases or history writes", async () => {
    const c = await newCase(),
      bundle = await exportCase(c.id);
    const before = await prisma.testCaseVersion.count({
      where: { testCaseId: c.id },
    });
    const review = await owner.caseProcedureReimport.preview({
      projectId,
      serialized: JSON.stringify(bundle),
    });
    expect(review.entries[0]?.status).toBe("UNCHANGED");
    await expect(
      owner.caseProcedureReimport.approve(await request(bundle)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await prisma.testCaseVersion.count({ where: { testCaseId: c.id } }),
    ).toBe(before);
  });
  it("old and new renamed-key exports restore exact procedures and prerequisite labels without changing stored identity or old receipts", async () => {

    const target = await owner.project.create({ organizationId: orgIds[0]!, name: "Owned renamed procedure fixture", caseKey: `old` });
    const c = await newCase(" Original\ncase λ ", target.id), prerequisite = await newCase(" Prerequisite\nraw ", target.id);
    await prisma.testCasePrerequisite.create({ data: { projectId: target.id, dependentId: c.id, prerequisiteId: prerequisite.id, createdById: actorId } });
    const media = await prisma.testCaseAttachment.create({ data: { testCaseId: c.id, fileName: "owned.png", contentType: "image/png", sizeBytes: 4, storageUrl: "synthetic://never-fetched", uploadCompletedAt: new Date() } });
    await prisma.testCaseStep.updateMany({ where: { testCaseId: c.id }, data: { expectedActionOrData: null, expectedResult: "", expectedResponse: " Response\n{ literal | λ } ", mediaAttachmentIds: [media.id] } });
    const stored = await prisma.testCase.findUniqueOrThrow({ where: { id: c.id }, include: { steps: true, prerequisites: true } });
    const old = await exportCase(c.id, target.id), originalSerialized = JSON.stringify(old);
    const identity = await owner.project.caseIdentity({ projectId: target.id, expectedClerkActorId: ownerClerkSubject });
    await owner.project.saveCaseKey({ projectId: target.id, originalOrganizationId: orgIds[0]!, expectedClerkActorId: ownerClerkSubject, expectedNativeActorId: actorId, expectedCaseKey: identity.caseKey, expectedRevision: identity.revision, caseKey: `new`, requestId: randomUUID() });
    const newer = await exportCase(c.id, target.id);
    expect(newer.cases[0]!.id).toBe(c.id); expect(newer.cases[0]!.caseNumber).toBe(c.caseNumber);
    expect(newer.cases[0]!.displayId).toBe(`new-${String(c.caseNumber).padStart(2, "0")}`);
    expect(newer.cases[0]!.prerequisites[0]!.displayId).toBe(`new-${String(prerequisite.caseNumber).padStart(2, "0")}`);
    expect(JSON.stringify(old)).toBe(originalSerialized);
    for (const bundle of [old, newer]) {
      bundle.cases[0]!.title = bundle === old ? " Old snapshot\ncorrected λ " : " New snapshot\ncorrected λ ";
      bundle.cases[0]!.background = " Background\n<literal> | λ ";
      bundle.cases[0]!.given = ["", " exact Given\nraw "]; bundle.cases[0]!.when = []; bundle.cases[0]!.then = [];
      bundle.cases[0]!.authoredSteps[0]!.action = " Click\nbutton | λ ";
      bundle.cases[0]!.resolvedSteps = bundle.cases[0]!.authoredSteps;
      const preview = await owner.caseProcedureReimport.preview({ projectId: target.id, serialized: JSON.stringify(bundle) });
      expect(preview.entries[0]!.status).toBe("CONFLICT"); expect(preview.entries[0]!.missingRelationships).toEqual([]);
      const approval = await request(bundle), receipt = await owner.caseProcedureReimport.approve(approval);
      expect(receipt.restored).toEqual([{ caseId: c.id, displayId: newer.cases[0]!.displayId }]);
      const restored = await prisma.testCase.findUniqueOrThrow({ where: { id: c.id }, include: { steps: true, prerequisites: true } });
      expect(restored).toMatchObject({ id: stored.id, displayId: stored.displayId, caseNumber: stored.caseNumber, title: bundle.cases[0]!.title, background: bundle.cases[0]!.background, given: bundle.cases[0]!.given, when: [], then: [], tags: bundle.cases[0]!.tags, suitePath: stored.suitePath, priority: stored.priority });
      expect(restored.steps.map(({ order, action, expectedActionOrData, expectedResult, expectedResponse, mediaAttachmentIds }) => ({ order, action, expectedActionOrData, expectedResult, expectedResponse, mediaAttachmentIds }))).toEqual(bundle.cases[0]!.authoredSteps);
      expect(restored.prerequisites).toEqual(stored.prerequisites);
      expect(await prisma.testCaseAttachment.findUnique({ where: { id: media.id } })).toEqual(media);
      if (bundle === newer) {
        const before = await prisma.auditLog.findFirstOrThrow({ where: { projectId: target.id, entityType: "TestCaseProcedureReimport", entityId: approval.requestId } });
        const now = await owner.project.caseIdentity({ projectId: target.id, expectedClerkActorId: ownerClerkSubject });
        await owner.project.saveCaseKey({ projectId: target.id, originalOrganizationId: orgIds[0]!, expectedClerkActorId: ownerClerkSubject, expectedNativeActorId: actorId, expectedCaseKey: now.caseKey, expectedRevision: now.revision, caseKey: `next`, requestId: randomUUID() });
        expect(await owner.caseProcedureReimport.approve(approval)).toEqual({ ...receipt, replayed: true });
        expect(await prisma.auditLog.findUnique({ where: { id: before.id } })).toEqual(before);
      }
    }
  });
  it("registered labels with another case number or immutable ID and foreign prefix/prerequisite aliases remain refused", async () => {

    const target = await owner.project.create({ organizationId: orgIds[0]!, name: "Owned alias refusal fixture", caseKey: `scope` });
    const c = await newCase("Original", target.id), prerequisite = await newCase("Prerequisite", target.id);
    await prisma.testCasePrerequisite.create({ data: { projectId: target.id, dependentId: c.id, prerequisiteId: prerequisite.id, createdById: actorId } });
    const original = await exportCase(c.id, target.id), count = await prisma.testCase.count({ where: { projectId: target.id } });
    const foreign = await outsider.project.caseIdentity({ projectId: otherProjectId });
    for (const mutate of [
      (bundle: CaseProcedureExport) => { bundle.cases[0]!.displayId = `${target.caseKey}-${String(prerequisite.caseNumber).padStart(2, "0")}`; },
      (bundle: CaseProcedureExport) => { bundle.cases[0]!.caseNumber = prerequisite.caseNumber; },
      (bundle: CaseProcedureExport) => { bundle.cases[0]!.displayId = `${foreign.caseKey}-${String(c.caseNumber).padStart(2, "0")}`; },
      (bundle: CaseProcedureExport) => { bundle.cases[0]!.prerequisites[0]!.displayId = `${target.caseKey}-${String(c.caseNumber).padStart(2, "0")}`; },
      (bundle: CaseProcedureExport) => { bundle.cases[0]!.prerequisites[0]!.displayId = `${foreign.caseKey}-${String(prerequisite.caseNumber).padStart(2, "0")}`; },
      (bundle: CaseProcedureExport) => { bundle.cases[0]!.displayId = ` ${bundle.cases[0]!.displayId} `; },
    ]) {
      const bundle = structuredClone(original); bundle.cases[0]!.title = "Refused incoming"; mutate(bundle);
      const preview = await owner.caseProcedureReimport.preview({ projectId: target.id, serialized: JSON.stringify(bundle) });
      expect(preview.entries[0]!.status).toBe("UNAVAILABLE");
      await expect(owner.caseProcedureReimport.approve(await request(bundle))).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await prisma.testCase.count({ where: { projectId: target.id } })).toBe(count);
      expect((await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } })).title).toBe(c.title);
    }
    const wrongHeader = structuredClone(original); wrongHeader.project.caseKey = foreign.caseKey;
    await expect(owner.caseProcedureReimport.preview({ projectId: target.id, serialized: JSON.stringify(wrongHeader) })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("retains exact BDD/structured fields, independent work and stable IDs; missing input is never deletion", async () => {
    const c = await newCase(),
      absent = await newCase("Keep absent"),
      prerequisite = await newCase("Required login");
    await prisma.testCasePrerequisite.create({
      data: {
        projectId,
        dependentId: c.id,
        prerequisiteId: prerequisite.id,
        createdById: actorId,
      },
    });
    const bundle = await exportCase(c.id);
    const draft = await prisma.automationDraft.create({
      data: {
        testCaseId: c.id,
        framework: "JEST_VITEST",
        status: "READY",
        content: { code: "Synthetic retained draft" },
        createdById: actorId,
      },
    });
    const source = await prisma.testCaseSource.create({
      data: {
        testCaseId: c.id,
        filePath: "synthetic.csv",
        framework: "synthetic",
        importSnapshot: { title: "Original evidence" },
      },
    });
    await prisma.testCase.update({
      where: { id: c.id },
      data: {
        title: "Manual edit",
        reviewStatus: "APPROVED",
        reviewNote: "Historical approval",
        riskScore: 80,
        suitePath: "Current/suite",
        priority: "CRITICAL",
      },
    });
    bundle.cases[0]!.title = " Snapshot\nλ corrected ";
    bundle.cases[0]!.authoredSteps[0]!.action = " New action\nline ";
    bundle.cases[0]!.resolvedSteps = bundle.cases[0]!.authoredSteps;
    const input = await request(bundle);
    const result = await owner.caseProcedureReimport.approve(input);
    expect(result.restored).toEqual([{ caseId: c.id, displayId: c.displayId }]);
    const restored = await prisma.testCase.findUniqueOrThrow({
      where: { id: c.id },
      include: { steps: true, prerequisites: true },
    });
    expect(restored).toMatchObject({
      displayId: c.displayId,
      title: bundle.cases[0]!.title,
      given: [" a|b "],
      suitePath: "Current/suite",
      priority: "CRITICAL",
      reviewStatus: "APPROVED",
      reviewNote: "Historical approval",
      riskScore: 80,
    });
    expect(restored.steps[0]!.action).toBe(" New action\nline ");
    expect(restored.prerequisites[0]!.prerequisiteId).toBe(prerequisite.id);
    expect(
      await prisma.automationDraft.findUnique({ where: { id: draft.id } }),
    ).toEqual(draft);
    expect(
      await prisma.testCaseSource.findUnique({ where: { id: source.id } }),
    ).toEqual(source);
    expect(
      await prisma.testCase.findUnique({ where: { id: absent.id } }),
    ).not.toBeNull();
    const history = await owner.caseVersionReview.list({
      projectId,
      testCaseId: c.id,
    });
    expect(history.restorationNotice).toContain("procedure snapshot");
    expect(history.restorationNotice).toContain("did not recertify");
    expect(await owner.caseProcedureReimport.approve(input)).toMatchObject({
      replayed: true,
      restored: result.restored,
    });
    const repeated = await owner.caseProcedureReimport.preview({
      projectId,
      serialized: input.serialized,
    });
    expect(repeated.entries[0]!.status).toBe("UNCHANGED");
  });
  it("stale preview rejects every selected write atomically", async () => {
    const a = await newCase(),
      b = await newCase();
    const bundle = await owner.testCases.exportProcedure({
      projectId,
      ids: [a.id, b.id],
      scope: "selected",
      includeArchived: false,
    });
    bundle.cases.forEach((c) => (c.title = "Incoming edit"));
    const input = await request(bundle);
    await prisma.testCase.update({
      where: { id: b.id },
      data: { title: "New manual edit" },
    });
    await expect(
      owner.caseProcedureReimport.approve(input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: a.id } })).title,
    ).toBe(a.title);
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: b.id } })).title,
    ).toBe("New manual edit");
  });
  it("unknown, archived, forged stable and foreign identities never create duplicates", async () => {
    const c = await newCase(),
      bundle = await exportCase(c.id);
    const count = await prisma.testCase.count({ where: { projectId } });
    bundle.cases[0]!.id = "nonexistent-original";
    expect(
      (
        await owner.caseProcedureReimport.preview({
          projectId,
          serialized: JSON.stringify(bundle),
        })
      ).entries[0]!.status,
    ).toBe("NEW_UNAVAILABLE");
    await expect(
      owner.caseProcedureReimport.approve(await request(bundle)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.testCase.count({ where: { projectId } })).toBe(count);
    bundle.cases[0]!.id = c.id;
    bundle.cases[0]!.displayId = "forged-999";
    expect(
      (
        await owner.caseProcedureReimport.preview({
          projectId,
          serialized: JSON.stringify(bundle),
        })
      ).entries[0]!.status,
    ).toBe("UNAVAILABLE");
    bundle.cases[0]!.displayId = c.displayId;
    await prisma.testCase.update({
      where: { id: c.id },
      data: { archived: true },
    });
    expect(
      (
        await owner.caseProcedureReimport.preview({
          projectId,
          serialized: JSON.stringify(bundle),
        })
      ).entries[0]!.status,
    ).toBe("UNAVAILABLE");
    await expect(
      outsider.caseProcedureReimport.preview({
        projectId,
        serialized: JSON.stringify(bundle),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.caseProcedureReimport.preview({
        projectId: otherProjectId,
        serialized: JSON.stringify(bundle),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not attach unavailable media or missing prerequisites and never fetches URLs", async () => {
    const c = await newCase(),
      bundle = await exportCase(c.id),
      p = bundle.cases[0]!;
    p.title = "Incoming";
    p.prerequisites.push({
      id: "missing-case",
      displayId: "rest0-999",
      title: "Missing",
      archived: false,
    });
    p.mediaReferences.push({
      id: "missing-media",
      fileName: "synthetic.png",
      contentType: "image/png",
      sizeBytes: 1,
      uploadMetadataVerified: true,
    });
    p.authoredSteps[0]!.mediaAttachmentIds = ["missing-media"];
    p.resolvedSteps = p.authoredSteps;
    const preview = await owner.caseProcedureReimport.preview({
      projectId,
      serialized: JSON.stringify(bundle),
    });
    expect(preview.entries[0]!.status).toBe("UNAVAILABLE");
    expect(preview.entries[0]!.missingRelationships).toHaveLength(2);
    await expect(
      owner.caseProcedureReimport.approve(await request(bundle)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("verified media remains on the same case and partial selection preserves other conflicts", async () => {
    const a = await newCase(),
      b = await newCase();
    const media = await prisma.testCaseAttachment.create({
      data: {
        testCaseId: a.id,
        fileName: "synthetic.png",
        contentType: "image/png",
        sizeBytes: 4,
        storageUrl: "synthetic://never-fetched",
        uploadCompletedAt: new Date(),
      },
    });
    await prisma.testCaseStep.updateMany({
      where: { testCaseId: a.id },
      data: { mediaAttachmentIds: [media.id] },
    });
    const bundle = await owner.testCases.exportProcedure({
      projectId,
      ids: [a.id, b.id],
      scope: "selected",
      includeArchived: false,
    });
    bundle.cases.forEach((c) => (c.title = "Incoming"));
    await owner.caseProcedureReimport.approve(await request(bundle, [a.id]));
    const live = await prisma.testCase.findUniqueOrThrow({
      where: { id: a.id },
      include: { steps: true },
    });
    expect(live.steps[0]!.mediaAttachmentIds).toEqual([media.id]);
    expect(
      await prisma.testCaseAttachment.findUnique({ where: { id: media.id } }),
    ).toEqual(media);
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: b.id } })).title,
    ).toBe(b.title);
  });
  it("current seat, suspension and actor binding are required even for replay", async () => {
    const c = await newCase(),
      bundle = await exportCase(c.id);
    bundle.cases[0]!.title = "Incoming";
    const input = await request(bundle);
    await expect(
      viewer.caseProcedureReimport.preview({
        projectId,
        serialized: input.serialized,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.caseProcedureReimport.approve({
        ...input,
        actorId: "different-actor",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await owner.caseProcedureReimport.approve(input);
    await prisma.organization.update({
      where: { id: orgIds[0]! },
      data: { suspendedAt: new Date() },
    });
    try {
      await expect(
        owner.caseProcedureReimport.approve(input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.organization.update({
        where: { id: orgIds[0]! },
        data: { suspendedAt: null },
      });
    }
    await prisma.membership.update({
      where: {
        organizationId_userId: { organizationId: orgIds[0]!, userId: actorId },
      },
      data: { role: "VIEWER", seatType: "READ_ONLY" },
    });
    try {
      await expect(
        owner.caseProcedureReimport.approve(input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.membership.update({
        where: {
          organizationId_userId: {
            organizationId: orgIds[0]!,
            userId: actorId,
          },
        },
        data: { role: "OWNER", seatType: "FULL" },
      });
    }
  });
  it("durable concurrent retry is exactly once and changed reuse is rejected", async () => {
    const c = await newCase(),
      bundle = await exportCase(c.id);
    bundle.cases[0]!.title = "Incoming";
    const input = await request(bundle),
      before = await prisma.testCaseVersion.count({
        where: { testCaseId: c.id },
      });
    const results = await Promise.all([
      owner.caseProcedureReimport.approve(input),
      owner.caseProcedureReimport.approve(input),
    ]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(
      await prisma.testCaseVersion.count({ where: { testCaseId: c.id } }),
    ).toBe(before + 2);
    await expect(
      owner.caseProcedureReimport.approve({
        ...input,
        selections: [
          { ...input.selections[0]!, reason: "Changed retry reason" },
        ],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("project reparenting invalidates prior review even when the actor has both memberships", async () => {
    const c = await newCase(),
      bundle = await exportCase(c.id);
    bundle.cases[0]!.title = "Incoming after old-tenant review";
    const input = await request(bundle);
    const acceptedCase = await newCase("Original accepted receipt case");
    const acceptedBundle = await exportCase(acceptedCase.id);
    acceptedBundle.cases[0]!.title = "Accepted original-tenant snapshot";
    const acceptedInput = await request(acceptedBundle);
    await owner.caseProcedureReimport.approve(acceptedInput);
    const originalReceipt = await prisma.auditLog.findFirstOrThrow({ where: { projectId, entityType: "TestCaseProcedureReimport", entityId: acceptedInput.requestId } });
    const membership = await prisma.membership.create({
      data: {
        userId: actorId,
        organizationId: orgIds[1]!,
        role: "OWNER",
        seatType: "FULL",
      },
    });
    const dualActor = await prisma.user.findUniqueOrThrow({
      where: { id: actorId },
      include: { memberships: true },
    });
    const dualCaller = appRouter.createCaller({ prisma, user: dualActor, authenticatedClerkSubject: ownerClerkSubject });
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgIds[1]! },
    });
    try {
      const currentReview = await dualCaller.caseProcedureReimport.preview({ projectId, serialized: input.serialized, expectedScope: { organizationId: orgIds[1]!, clerkActorId: ownerClerkSubject } });
      expect(currentReview.organizationId).toBe(orgIds[1]);
      expect(currentReview.entries[0]!.status).toBe("CONFLICT");
      expect(currentReview.entries[0]!.missingRelationships).toEqual([]);
      await expect(
        dualCaller.caseProcedureReimport.approve(input),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(dualCaller.caseProcedureReimport.approve(acceptedInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(dualCaller.caseProcedureReimport.approve(acceptedInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await prisma.auditLog.findUnique({ where: { id: originalReceipt.id } })).toEqual(originalReceipt);
      expect((await prisma.testCase.findUniqueOrThrow({ where: { id: acceptedCase.id } })).title).toBe(acceptedBundle.cases[0]!.title);
      expect(
        (await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } }))
          .title,
      ).toBe(c.title);
    } finally {
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: orgIds[0]! },
      });
      await prisma.membership.delete({ where: { id: membership.id } });
    }
  });
  it("unchanged same-project libraries stay linked; different libraries are never rewritten or attached", async () => {
    const c = await newCase();
    const group = await prisma.sharedStepGroup.create({
      data: {
        projectId,
        name: "Synthetic retained library",
        steps: [
          {
            order: 0,
            action: "Shared action",
            expectedActionOrData: null,
            expectedResult: "Result",
            expectedResponse: null,
          },
        ],
      },
    });
    await prisma.testCase.update({
      where: { id: c.id },
      data: { sharedStepGroupId: group.id },
    });
    const bundle = await exportCase(c.id);
    bundle.cases[0]!.title = "Reviewed wording";
    await owner.caseProcedureReimport.approve(await request(bundle));
    expect(
      (await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } }))
        .sharedStepGroupId,
    ).toBe(group.id);
    expect(
      await prisma.sharedStepGroup.findUnique({ where: { id: group.id } }),
    ).toEqual(group);
    const changed = await exportCase(c.id);
    changed.cases[0]!.sharedStepGroup = {
      id: "not-this-library",
      name: "Unavailable",
    };
    const preview = await owner.caseProcedureReimport.preview({
      projectId,
      serialized: JSON.stringify(changed),
    });
    expect(preview.entries[0]!.status).toBe("UNAVAILABLE");
    expect(preview.entries[0]!.missingRelationships.join(" ")).toContain(
      "shared-library",
    );
    await expect(
      owner.caseProcedureReimport.approve(await request(changed)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await prisma.sharedStepGroup.findUnique({ where: { id: group.id } }),
    ).toEqual(group);
  });
  it("rejects oversized, empty, duplicate, malformed and other-project files", async () => {
    const c = await newCase(),
      bundle = await exportCase(c.id);
    for (const serialized of [
      "{",
      "α".repeat(1024 * 1024 + 1),
      JSON.stringify({ ...bundle, cases: [] }),
      JSON.stringify({ ...bundle, cases: [bundle.cases[0], bundle.cases[0]] }),
      JSON.stringify({
        ...bundle,
        project: { ...bundle.project, id: otherProjectId },
      }),
    ])
      await expect(
        owner.caseProcedureReimport.preview({ projectId, serialized }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
