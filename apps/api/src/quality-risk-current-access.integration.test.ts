import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { qualityRisksRouter } from "./routers/qualityRisks.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
import type { QualityRiskDefinition, QualityRiskWriteInput } from "./services/qualityRiskSchema.js";
// SOURCE-ONLY authored disposable regressions. Not executed tonight.
describe("risk register current actor original organization and response identities", () => {
  let organizationId: string, foreignOrgId: string, projectId: string, actorId: string, viewerId: string, clerkUserId: string;
  let owner: ReturnType<typeof qualityRisksRouter.createCaller>, viewer: typeof owner, riskId: string;
  const users: string[] = [];
  const definition: QualityRiskDefinition = { title: "Synthetic retained risk", component: "Synthetic component", failureMode: "Synthetic failure",
    cause: "Synthetic cause", effect: "Synthetic effect", likelihood: "UNKNOWN", consequence: "UNKNOWN", rationale: "Synthetic retained human rationale",
    mitigation: "Synthetic mitigation", caseIds: [], requirementIds: [] };
  const input = () => ({ projectId, originalOrganizationId: organizationId });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host")) throw Error("Unique disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    organizationId = (await prisma.organization.create({ data: { name: "Synthetic risk read identity", slug: randomUUID(), planTierId: tier.id } })).id;
    foreignOrgId = (await prisma.organization.create({ data: { name: "Synthetic other organization", slug: randomUUID(), planTierId: tier.id } })).id;
    projectId = (await prisma.project.create({ data: { organizationId, name: "Synthetic retained register", slug: randomUUID(), caseKey: "syn" } })).id;
    for (const role of ["OWNER", "VIEWER"] as const) {
      const user = await prisma.user.create({ data: { clerkUserId: randomUUID(), email: `risk-read-${randomUUID()}@example.com`, memberships: {
        create: { organizationId, role, seatType: role === "OWNER" ? "FULL" : "READ_ONLY" } } }, include: { memberships: true } });
      users.push(user.id); const caller = qualityRisksRouter.createCaller({ prisma, user });
      if (role === "OWNER") { owner = caller; actorId = user.id; clerkUserId = user.clerkUserId; } else { viewer = caller; viewerId = user.id; }
    }
    riskId = (await owner.write({ projectId, requestId: randomUUID(), operation: "CREATE", definition })).entry.id;
  });
  afterAll(async () => { if (organizationId && actorId) await hardDeleteOrganization(prisma, organizationId, actorId, "Owned synthetic risk fixture erasure");
    if (foreignOrgId && actorId) await hardDeleteOrganization(prisma, foreignOrgId, actorId, "Owned synthetic risk fixture erasure");
    await prisma.organizationDeletionLog.deleteMany({ where: { organizationId: { in: [organizationId, foreignOrgId].filter(Boolean) }, deletedById: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } }); });
  it("echoes current project organization and actor for every native read without changing legacy request inputs", async () => {
    const page = await owner.list({ projectId }), detail = await owner.byId({ projectId, id: riskId }), lookup = await owner.lookup({ projectId, kind: "CASE", search: "" });
    for (const result of [page, detail, lookup]) expect(result).toMatchObject({ projectId, organizationId, actorClerkUserId: clerkUserId });
    expect((await viewer.list(input())).canWrite).toBe(false); expect((await viewer.byId({ ...input(), id: riskId })).entry.definition).toEqual(definition);
  });
  it("refuses original-org mismatch for list detail and linked choices without returning another tenant payload", async () => {
    const wrong = { projectId, originalOrganizationId: foreignOrgId };
    await expect(owner.list(wrong)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(owner.byId({ ...wrong, id: riskId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(owner.lookup({ ...wrong, kind: "REQUIREMENT", search: "" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rejects reparented register and linked choices even when optional original-org input is omitted", async () => {
    await prisma.membership.create({ data: { organizationId: foreignOrgId, userId: actorId, role: "OWNER", seatType: "FULL" } });
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: foreignOrgId } });
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: actorId }, include: { memberships: true } });
    const caller = qualityRisksRouter.createCaller({ prisma, user: fresh });
    try {
      await expect(caller.list({ projectId })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller.byId({ projectId, id: riskId })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(caller.lookup({ projectId, kind: "RESULT", search: "" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally { await prisma.project.update({ where: { id: projectId }, data: { organizationId } }); }
  });
  it("checks fresh role/seat before exact retry while keeping original actor UUID receipt idempotent", async () => {
    const request: QualityRiskWriteInput = { projectId, requestId: randomUUID(), operation: "UPDATE", id: riskId, expectedVersion: 1,
      dropUnavailableLinks: false, definition: { ...definition, title: "Synthetic acknowledged retained risk" } };
    const receipt = await owner.write(request);
    await prisma.membership.update({ where: { organizationId_userId: { organizationId, userId: actorId } }, data: { role: "VIEWER", seatType: "READ_ONLY" } });
    try {
      expect((await owner.list(input())).canWrite).toBe(false);
      await expect(owner.write(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { await prisma.membership.update({ where: { organizationId_userId: { organizationId, userId: actorId } }, data: { role: "OWNER", seatType: "FULL" } }); }
    expect(await owner.write(request)).toEqual(receipt);
    expect(await prisma.qualityRiskWrite.count({ where: { projectId, actorId, requestId: request.requestId } })).toBe(1);
    await prisma.membership.deleteMany({ where: { organizationId, userId: viewerId } });
    try {
      await expect(viewer.byId({ ...input(), id: riskId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(viewer.lookup({ ...input(), kind: "CASE", search: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { await prisma.membership.create({ data: { organizationId, userId: viewerId, role: "VIEWER", seatType: "READ_ONLY" } }); }
  });
});
