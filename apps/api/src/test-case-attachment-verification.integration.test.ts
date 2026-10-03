import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("./services/artifactStorage.js", () => ({
  verifyStoredAttachment: verify,
  buildTestCaseAttachmentKey: () => "synthetic/key",
  createGenericUploadUrl: async () => "https://example.invalid/synthetic-upload",
  createViewUrl: async () => "https://example.invalid/synthetic-view",
  canonicalUrl: (key: string) => `s3://synthetic/${key}`,
  keyFromCanonicalUrl: (key: string) => key.replace("s3://synthetic/", ""),
}));
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname) && /test/i.test(url.pathname) && !url.searchParams.has("host");

describe.skipIf(!isolated)("attachment upload confirmation", () => {
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let outsider: ReturnType<typeof appRouter.createCaller>;
  let ownerId: string, organizationId: string, testCaseId: string;
  const key = `attachment-verification-${Date.now()}`;
  beforeAll(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({ data: { name: key, slug: key, planTierId: tier.id } });
    organizationId = org.id;
    const other = await prisma.organization.create({ data: { name: `${key}-outside`, slug: `${key}-outside`, planTierId: tier.id } });
    async function caller(suffix: string, orgId: string, role: "OWNER" | "VIEWER") {
      const user = await prisma.user.create({ data: { email: `${key}-${suffix}@example.com`, clerkUserId: `${key}-${suffix}`, memberships: { create: { organizationId: orgId, role } } }, include: { memberships: true } });
      if (suffix === "owner") ownerId = user.id;
      return appRouter.createCaller({ prisma, user });
    }
    owner = await caller("owner", org.id, "OWNER"); viewer = await caller("viewer", org.id, "VIEWER"); outsider = await caller("outside", other.id, "OWNER");
    const project = await owner.project.create({ organizationId: org.id, name: "Synthetic evidence project" });
    testCaseId = (await owner.testCases.create({ projectId: project.id, title: "Synthetic procedure", testType: "FUNCTIONAL", steps: [{ action: "Observe the synthetic sample", expectedResult: "Record the observation" }] })).id;
  });
  beforeEach(() => { verify.mockReset(); verify.mockResolvedValue({ etag: "synthetic-etag", versionId: null, verifiedAt: new Date().toISOString() }); });
  const request = () => owner.testCaseAttachments.requestUpload({ testCaseId, fileName: "synthetic.png", contentType: "image/png", sizeBytes: 123 });
  it("does not mark an upload request completed; confirms only matching stored metadata", async () => {
    const { attachmentId } = await request();
    expect((await prisma.testCaseAttachment.findUniqueOrThrow({ where: { id: attachmentId } })).uploadCompletedAt).toBeNull();
    const result = await owner.testCaseAttachments.confirmUpload({ attachmentId });
    expect(result.uploadCompletedAt).toBeInstanceOf(Date);
    expect(verify).toHaveBeenCalledWith("synthetic/key", expect.objectContaining({ sizeBytes: 123, contentType: "image/png" }));
    const retry = await owner.testCaseAttachments.confirmUpload({ attachmentId });
    expect(retry).toEqual(result); expect(verify).toHaveBeenCalledOnce();
  });
  it("keeps failed confirmation unverified for safe retry", async () => {
    const { attachmentId } = await request();
    verify.mockRejectedValueOnce(new Error("Stored file could not be verified."));
    await expect(owner.testCaseAttachments.confirmUpload({ attachmentId })).rejects.toThrow("could not be verified");
    expect((await prisma.testCaseAttachment.findUniqueOrThrow({ where: { id: attachmentId } })).uploadCompletedAt).toBeNull();
    await expect(owner.testCaseAttachments.confirmUpload({ attachmentId })).resolves.toMatchObject({ attachmentId });
  });
  it("denies viewer and cross-tenant confirmation before storage access", async () => {
    const { attachmentId } = await request();
    await expect(viewer.testCaseAttachments.confirmUpload({ attachmentId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(outsider.testCaseAttachments.confirmUpload({ attachmentId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(verify).not.toHaveBeenCalled();
  });
  it("rechecks membership after storage verification", async () => {
    const { attachmentId } = await request();
    verify.mockImplementationOnce(async () => {
      await prisma.membership.update({ where: { organizationId_userId: { organizationId, userId: ownerId } }, data: { role: "VIEWER" } });
      return { etag: "synthetic-etag", versionId: null, verifiedAt: new Date().toISOString() };
    });
    try { await expect(owner.testCaseAttachments.confirmUpload({ attachmentId })).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.membership.update({ where: { organizationId_userId: { organizationId, userId: ownerId } }, data: { role: "OWNER" } }); }
    expect((await prisma.testCaseAttachment.findUniqueOrThrow({ where: { id: attachmentId } })).uploadCompletedAt).toBeNull();
  });
  it("denies a changed/deleted record after metadata verification", async () => {
    const { attachmentId } = await request();
    verify.mockImplementationOnce(async () => {
      await prisma.testCaseAttachment.update({ where: { id: attachmentId }, data: { sizeBytes: 321 } });
      return { etag: "synthetic-etag", versionId: null, verifiedAt: new Date().toISOString() };
    });
    await expect(owner.testCaseAttachments.confirmUpload({ attachmentId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await prisma.testCaseAttachment.findUniqueOrThrow({ where: { id: attachmentId } })).uploadCompletedAt).toBeNull();
  });
  it("retains media referenced by a frozen run after it is unlinked from the live case", async () => {
    const { attachmentId } = await request();
    const current = await owner.testCases.byId({ id: testCaseId });
    await owner.testCases.update({ id: testCaseId, title: current.title, testType: "FUNCTIONAL", expectedStepRevision: current.stepRevision, expectedCaseRevision: current.caseRevision, steps: [{ action: "Synthetic observation", mediaAttachmentIds: [attachmentId] }] });
    const tc = await prisma.testCase.findUniqueOrThrow({ where: { id: testCaseId } });
    const run = await owner.manualExecution.start({ projectId: tc.projectId, testCaseIds: [testCaseId] });
    const linked = await owner.testCases.byId({ id: testCaseId });
    await owner.testCases.update({ id: testCaseId, title: linked.title, testType: "FUNCTIONAL", expectedStepRevision: linked.stepRevision, expectedCaseRevision: linked.caseRevision, steps: [{ action: "Synthetic observation", mediaAttachmentIds: [] }] });
    await expect(owner.testCaseAttachments.delete({ attachmentId })).rejects.toThrow("saved run procedure");
    expect(await prisma.testCaseAttachment.findUnique({ where: { id: attachmentId } })).not.toBeNull();
    expect((await owner.manualExecution.getForExecution({ testRunId: run.testRunId })).cases[0]?.steps[0]?.mediaAttachmentIds).toEqual([attachmentId]);
  });
  it("does not return provider or canonical locator error text", async () => {
    const { attachmentId } = await request();
    verify.mockRejectedValueOnce(new Error("synthetic sensitive transport detail"));
    await expect(owner.testCaseAttachments.confirmUpload({ attachmentId })).rejects.toThrow("Stored file could not be verified.");
  });
});
