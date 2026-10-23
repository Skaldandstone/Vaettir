import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname)
  && /test/i.test(url.pathname) && !url.searchParams.has("host");

describe.skipIf(!isolated)("ordered step media references", () => {
  const key = `step-media-${randomUUID()}`;
  let orgId: string;
  let projectId: string;
  let ownerId: string;
  let viewerId: string;
  let caseId: string;
  let otherCaseId: string;
  let imageId: string;
  let videoId: string;
  let foreignId: string;
  let textId: string;
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const tier = await prisma.planTier.findFirstOrThrow();
    const org = await prisma.organization.create({ data: { name: key, slug: key, planTierId: tier.id } });
    orgId = org.id;
    const [ownerUser, viewerUser] = await Promise.all([
      prisma.user.create({ data: { clerkUserId: `${key}-owner`, email: `${key}-owner@example.com` } }),
      prisma.user.create({ data: { clerkUserId: `${key}-viewer`, email: `${key}-viewer@example.com` } }),
    ]);
    ownerId = ownerUser.id;
    viewerId = viewerUser.id;
    await prisma.membership.createMany({ data: [
      { organizationId: orgId, userId: ownerId, role: "OWNER" },
      { organizationId: orgId, userId: viewerId, role: "VIEWER" },
    ] });
    const project = await prisma.project.create({ data: { organizationId: orgId, name: key, slug: key } });
    projectId = project.id;
    owner = appRouter.createCaller({ prisma, user: await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, include: { memberships: true } }) });
    viewer = appRouter.createCaller({ prisma, user: await prisma.user.findUniqueOrThrow({ where: { id: viewerId }, include: { memberships: true } }) });
    caseId = (await owner.testCases.create({ projectId, title: "Media case", testType: "FUNCTIONAL", steps: [{ action: "Open" }, { action: "Submit" }] })).id;
    otherCaseId = (await owner.testCases.create({ projectId, title: "Other case", testType: "FUNCTIONAL", steps: [{ action: "Elsewhere" }] })).id;
    const [image, video, foreign, text] = await Promise.all([
      prisma.testCaseAttachment.create({ data: { testCaseId: caseId, fileName: "screen.png", contentType: "image/png", sizeBytes: 100, storageUrl: "s3://synthetic/screen", uploadedById: ownerId } }),
      prisma.testCaseAttachment.create({ data: { testCaseId: caseId, fileName: "flow.mp4", contentType: "video/mp4", sizeBytes: 100, storageUrl: "s3://synthetic/flow", uploadedById: ownerId } }),
      prisma.testCaseAttachment.create({ data: { testCaseId: otherCaseId, fileName: "other.mp4", contentType: "video/mp4", sizeBytes: 100, storageUrl: "s3://synthetic/other", uploadedById: ownerId } }),
      prisma.testCaseAttachment.create({ data: { testCaseId: caseId, fileName: "secret.txt", contentType: "text/plain", sizeBytes: 100, storageUrl: "s3://synthetic/text", uploadedById: ownerId } }),
    ]);
    imageId = image.id;
    videoId = video.id;
    foreignId = foreign.id;
    textId = text.id;
  });

  afterAll(async () => {
    if (!orgId) return;
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.testCaseAttachment.deleteMany({ where: { testCaseId: { in: [caseId, otherCaseId] } } });
    await prisma.testCaseVersion.deleteMany({ where: { testCaseId: { in: [caseId, otherCaseId] } } });
    await prisma.testCaseStep.deleteMany({ where: { testCaseId: { in: [caseId, otherCaseId] } } });
    await prisma.testCase.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } });
    await prisma.membership.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, viewerId] } } });
  });

  it("saves media on the ordered step and snapshots its version", async () => {
    const before = await owner.testCases.byId({ id: caseId });
    await owner.testCases.update({ id: caseId, title: "Media case", testType: "FUNCTIONAL", expectedStepRevision: before.stepRevision, expectedCaseRevision: before.caseRevision,
      steps: [{ action: "Submit", mediaAttachmentIds: [imageId] }, { action: "Open", mediaAttachmentIds: [] }],
    });
    const detail = await owner.testCases.byId({ id: caseId });
    expect(detail.steps.map(step => [step.order, step.action, step.mediaAttachmentIds])).toEqual([
      [0, "Submit", [imageId]], [1, "Open", []],
    ]);
    const version = await prisma.testCaseVersion.findFirstOrThrow({ where: { testCaseId: caseId }, orderBy: { versionNumber: "desc" } });
    expect(version.steps).toMatchObject([{ mediaAttachmentIds: [imageId] }, { mediaAttachmentIds: [] }]);
  });

  it("rejects old editors, wrong-case files, non-media files and read-only actors", async () => {
    const current = await owner.testCases.byId({ id: caseId });
    const base = { id: caseId, title: "Media case", testType: "FUNCTIONAL", expectedStepRevision: current.stepRevision, expectedCaseRevision: current.caseRevision, steps: [{ action: "Submit", mediaAttachmentIds: [imageId] }] };
    await expect(viewer.testCases.update(base)).rejects.toThrow();
    await expect(owner.testCases.update({ ...base, expectedStepRevision: undefined })).rejects.toThrow("steps or media changed");
    await expect(owner.testCases.update({ ...base, steps: [{ action: "Submit", mediaAttachmentIds: [foreignId] }] })).rejects.toThrow("this test case");
    await expect(owner.testCases.update({ ...base, steps: [{ action: "Submit", mediaAttachmentIds: [textId] }] })).rejects.toThrow("this test case");
    expect((await owner.testCases.byId({ id: caseId })).steps[0]?.mediaAttachmentIds).toEqual([imageId]);
  });

  it("rejects a stale editor after another editor adds step media", async () => {
    const stale = await owner.testCases.byId({ id: caseId });
    await owner.testCases.update({ id: caseId, title: "Media case", testType: "FUNCTIONAL", expectedStepRevision: stale.stepRevision, expectedCaseRevision: stale.caseRevision,
      steps: [{ action: "Submit", mediaAttachmentIds: [imageId, videoId] }, { action: "Open", mediaAttachmentIds: [] }],
    });
    await expect(owner.testCases.update({ id: caseId, title: "Stale overwrite", testType: "FUNCTIONAL", expectedStepRevision: stale.stepRevision, expectedCaseRevision: stale.caseRevision,
      steps: [{ action: "Submit", mediaAttachmentIds: [imageId] }],
    })).rejects.toThrow("steps or media changed");
    const after = await owner.testCases.byId({ id: caseId });
    expect(after.steps[0]?.mediaAttachmentIds).toEqual([imageId, videoId]);
    expect(after.title).toBe("Media case");
  });

  it("requires explicit unlink before deleting a referenced file", async () => {
    await expect(owner.testCaseAttachments.delete({ attachmentId: imageId })).rejects.toThrow("Unlink it");
    const current = await owner.testCases.byId({ id: caseId });
    await owner.testCases.update({ id: caseId, title: current.title, testType: current.testType,
      expectedStepRevision: current.stepRevision,
      expectedCaseRevision: current.caseRevision,
      steps: current.steps.map(step => ({ action: step.action, mediaAttachmentIds: step.mediaAttachmentIds.filter(id => id !== imageId) })),
    });
    await owner.testCaseAttachments.delete({ attachmentId: imageId });
    expect(await prisma.testCaseAttachment.findUnique({ where: { id: imageId } })).toBeNull();
  });
});
