import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "../router.js";
import { createContext } from "../trpc.js";
import { hardDeleteOrganization } from "./orgHardDelete.js";

const run = "tenant-" + randomUUID();
const users: string[] = [];
let orgId: string, projectId: string, caseId: string, attachmentId: string;
let ownerId: string, viewerId: string, outsiderId: string;
async function caller(id: string) {
  return appRouter.createCaller({ prisma, user: await prisma.user.findUniqueOrThrow({ where: { id }, include: { memberships: { where: { organization: { suspendedAt: null } } } } }) });
}
async function tokenCaller(key: string) {
  return appRouter.createCaller(await createContext({ req: { headers: { authorization: "Bearer " + key } } } as never));
}
beforeAll(async () => {
  for (const label of ["owner", "viewer", "outsider"]) users.push((await prisma.user.create({ data: { clerkUserId: run + label, email: run + label + "@example.com" } })).id);
  [ownerId, viewerId, outsiderId] = users as [string, string, string];
  const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "private-beta" } });
  const org = await prisma.organization.create({ data: { name: run, slug: run, planTierId: tier.id } });
  orgId = org.id;
  await prisma.membership.createMany({ data: [
    { organizationId: orgId, userId: ownerId, role: "OWNER", seatType: "FULL" },
    { organizationId: orgId, userId: viewerId, role: "VIEWER", seatType: "READ_ONLY" },
  ] });
  projectId = (await prisma.project.create({ data: { organizationId: orgId, name: "Isolation fixture", slug: "fixture" } })).id;
  caseId = (await prisma.testCase.create({ data: { projectId, title: "Private fixture", testType: "FUNCTIONAL", given: [], when: [], then: [], tags: [] } })).id;
  attachmentId = (await prisma.testCaseAttachment.create({ data: { testCaseId: caseId, fileName: "private.txt", contentType: "text/plain", sizeBytes: 1, storageUrl: "s3://fixture/private" } })).id;
});
afterAll(async () => {
  if (orgId) {
    const keys = await prisma.apiKey.findMany({ where: { organizationId: orgId }, select: { serviceUserId: true } });
    users.push(...keys.map((key) => key.serviceUserId));
    await hardDeleteOrganization(prisma, orgId, ownerId, "Tenant-isolation fixture cleanup");
    await prisma.organizationDeletionLog.deleteMany({ where: { organizationId: orgId } });
  }
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
});
describe.sequential("Tenant and service credential isolation", () => {
  it("rejects cross-tenant object, export, attachment and staff requests", async () => {
    const outsider = await caller(outsiderId);
    const requests = await Promise.allSettled([
      outsider.testCases.byId({ id: caseId }),
      outsider.testCases.exportCsv({ projectId }),
      outsider.testCaseAttachments.list({ testCaseId: caseId }),
      outsider.testCaseAttachments.getViewUrl({ attachmentId }),
      outsider.testCaseAttachments.delete({ attachmentId }),
      outsider.staff.listOrgs(),
      outsider.admin.listOrganizations({ query: "" }),
    ]);
    for (const request of requests) {
      expect(request.status).toBe("rejected");
      if (request.status === "rejected") expect(request.reason).toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
    }
  });
  it("read-only users cannot mutate cases, attachments or shared catalogs", async () => {
    const viewer = await caller(viewerId);
    await expect(viewer.testCases.byId({ id: caseId })).resolves.toBeDefined();
    await expect(viewer.testCaseAttachments.requestUpload({ testCaseId: caseId, fileName: "x", contentType: "text/plain", sizeBytes: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.compliance.createFramework({ key: run, name: run })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(viewer.testPlans.createType({ key: run, name: run, category: "CUSTOM", fields: [{ key: "x", type: "string" }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("API key minting competes for the same four remaining full seats", async () => {
    const owner = await caller(ownerId);
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, n) => owner.apiKeys.create({ organizationId: orgId, name: "fixture-" + n, role: "VIEWER" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    expect(await prisma.membership.count({ where: { organizationId: orgId, seatType: "FULL" } })).toBe(5);
    const granted = results.find((r) => r.status === "fulfilled");
    if (!granted || granted.status !== "fulfilled") throw new Error("No test key");
    const key = granted.value;
    const token = await tokenCaller(key.key);
    await expect(token.testCases.byId({ id: caseId })).resolves.toBeDefined();
    await expect(token.project.create({ organizationId: orgId, name: "Forbidden" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await owner.apiKeys.revoke({ id: key.id });
    await expect((await tokenCaller(key.key)).testCases.byId({ id: caseId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await prisma.membership.count({ where: { organizationId: orgId, seatType: "FULL" } })).toBe(4);
  });
  it("revoked membership cannot retrieve objects or exports", async () => {
    await prisma.membership.delete({ where: { organizationId_userId: { organizationId: orgId, userId: viewerId } } });
    const revoked = await caller(viewerId);
    await expect(revoked.testCases.byId({ id: caseId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(revoked.testCases.exportCsv({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("suspension removes organization and project access for service tokens", async () => {
    const key = await (await caller(ownerId)).apiKeys.create({ organizationId: orgId, name: "suspended", role: "EDITOR" });
    await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: new Date() } });
    const suspended = await tokenCaller(key.key);
    await expect(suspended.organization.mine()).resolves.toEqual([]);
    await expect(suspended.testCases.byId({ id: caseId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(suspended.testCaseAttachments.getViewUrl({ attachmentId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
