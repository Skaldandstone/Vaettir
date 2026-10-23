import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { qualityRisksRouter } from "./routers/qualityRisks.js";
import { qualityRiskWriteInput, type QualityRiskWriteInput } from "./services/qualityRiskSchema.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
// SOURCE ONLY. No fixture/test/provider/customer execution tonight.
describe("server-bound risk original actor and tenant scope", () => {
  let orgId: string, foreignOrgId: string, projectId: string, actorId: string, otherActorId: string, clerkActorId: string;
  let owner: ReturnType<typeof qualityRisksRouter.createCaller>, other: typeof owner;
  const users: string[] = [];
  const definition = { title: "Synthetic actor-bound risk", component: "Synthetic component", failureMode: "Synthetic failure", cause: "Synthetic cause", effect: "Synthetic effect",
    likelihood: "UNKNOWN" as const, consequence: "UNKNOWN" as const, rationale: "Synthetic rationale", mitigation: "", requirementIds: [], caseIds: [] };
  const scope = () => ({ organizationId: orgId, clerkActorId });
  const request = (): QualityRiskWriteInput => ({ operation: "CREATE", projectId, requestId: randomUUID(), expectedScope: scope(), definition });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host")) throw Error("Unique disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    orgId = (await prisma.organization.create({ data: { name: "Synthetic actor scope", slug: randomUUID(), planTierId: tier.id } })).id;
    foreignOrgId = (await prisma.organization.create({ data: { name: "Synthetic other scope", slug: randomUUID(), planTierId: tier.id } })).id;
    projectId = (await prisma.project.create({ data: { organizationId: orgId, name: "Synthetic risk scope", slug: randomUUID(), caseKey: "syn" } })).id;
    for (let n = 0; n < 2; n++) {
      const user = await prisma.user.create({ data: { clerkUserId: randomUUID(), email: `risk-scope-${randomUUID()}@example.com`, memberships: {
        create: [{ organizationId: orgId, role: "OWNER", seatType: "FULL" }, { organizationId: foreignOrgId, role: "OWNER", seatType: "FULL" }] } }, include: { memberships: true } });
      users.push(user.id); const caller = qualityRisksRouter.createCaller({ prisma, user });
      if (!n) { owner = caller; actorId = user.id; clerkActorId = user.clerkUserId; } else { other = caller; otherActorId = user.id; }
    }
  });
  afterAll(async () => {
    if (orgId && actorId) await hardDeleteOrganization(prisma, orgId, actorId, "Owned synthetic risk scope fixture erasure");
    if (foreignOrgId && actorId) await hardDeleteOrganization(prisma, foreignOrgId, actorId, "Owned synthetic risk scope fixture erasure");
    await prisma.organizationDeletionLog.deleteMany({ where: { organizationId: { in: [orgId, foreignOrgId].filter(Boolean) }, deletedById: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });
  it("rejects an asynchronously switched authenticated actor before new creation and before receipt replay", async () => {
    const input = request(), before = await prisma.qualityRiskEntry.count({ where: { projectId } });
    await expect(other.write(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.qualityRiskEntry.count({ where: { projectId } })).toBe(before);
    expect(await prisma.qualityRiskWrite.count({ where: { projectId, actorId: otherActorId, requestId: input.requestId } })).toBe(0);
    const receipt = await owner.write(input); expect(await owner.write(structuredClone(input))).toEqual(receipt);
    await expect(other.write(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.qualityRiskWrite.count({ where: { projectId, requestId: input.requestId } })).toBe(1);
    expect(await prisma.qualityRiskEntry.count({ where: { projectId } })).toBe(before + 1);
  });
  it("refuses pinned tenant mismatch even when both current organizations permit the same actor", async () => {
    const input = request(), before = await prisma.qualityRiskEntry.count({ where: { projectId } });
    await expect(owner.write({ ...input, expectedScope: { ...scope(), organizationId: foreignOrgId } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.qualityRiskEntry.count({ where: { projectId } })).toBe(before);
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: foreignOrgId } });
    try { await expect(owner.write(input)).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.project.update({ where: { id: projectId }, data: { organizationId: orgId } }); }
    expect(await prisma.qualityRiskWrite.count({ where: { projectId, requestId: input.requestId } })).toBe(0);
  });
  it("requires fresh write role for scope-bound replay without replacing the original UUID or receipt", async () => {
    const input = request(), receipt = await owner.write(input);
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: actorId } }, data: { role: "VIEWER", seatType: "READ_ONLY" } });
    try { await expect(owner.write(input)).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.membership.update({ where: { organizationId_userId: { organizationId: orgId, userId: actorId } }, data: { role: "OWNER", seatType: "FULL" } }); }
    expect(await owner.write(input)).toEqual(receipt);
    expect(await prisma.qualityRiskWrite.count({ where: { projectId, actorId, requestId: input.requestId } })).toBe(1);
    const { expectedScope: _originalScope, ...rebound } = input;
    await expect(owner.write(rebound)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("retains absent legacy hashes and receipt retry without adding reviewed scope defaults", async () => {
    const legacy: QualityRiskWriteInput = { operation: "CREATE", projectId, requestId: randomUUID(), definition }, receipt = await owner.write(legacy);
    const parsed = qualityRiskWriteInput.parse(legacy); expect(Object.hasOwn(parsed, "expectedScope")).toBe(false);
    const saved = await prisma.qualityRiskWrite.findUniqueOrThrow({ where: { projectId_actorId_requestId: { projectId, actorId, requestId: legacy.requestId } } });
    expect(saved.requestHash).toBe(createHash("sha256").update(JSON.stringify(parsed)).digest("hex"));
    expect(await owner.write(legacy)).toEqual(receipt);
    await expect(owner.write({ ...legacy, expectedScope: scope() })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
