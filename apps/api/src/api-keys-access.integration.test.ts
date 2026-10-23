import { describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname) && /test/i.test(url.pathname) && !url.searchParams.has("host");

describe.skipIf(!isolated)("API key administrator authorization", () => {
  it("rejects read-only, stale, and suspended administrators before credential mutations", async () => {
    const key = `key-access-${Date.now()}`;
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({ data: { name: key, slug: key, planTierId: tier.id } });
    const ownerUser = await prisma.user.create({ data: { email: `${key}@example.com`, clerkUserId: key,
      memberships: { create: { organizationId: org.id, role: "OWNER", seatType: "FULL" } } }, include: { memberships: true } });
    const readOnlyUser = await prisma.user.create({ data: { email: `${key}-read@example.com`, clerkUserId: `${key}-read`,
      memberships: { create: { organizationId: org.id, role: "ADMIN", seatType: "READ_ONLY" } } }, include: { memberships: true } });
    const owner = appRouter.createCaller({ prisma, user: ownerUser });
    const readOnlyAdmin = appRouter.createCaller({ prisma, user: readOnlyUser });

    const issued = await owner.apiKeys.create({ organizationId: org.id, name: "Synthetic CI" });
    expect((await owner.apiKeys.list({ organizationId: org.id })).some(row => row.id === issued.id)).toBe(true);
    expect((await readOnlyAdmin.apiKeys.list({ organizationId: org.id })).some(row => row.id === issued.id)).toBe(true);
    await expect(readOnlyAdmin.apiKeys.create({ organizationId: org.id, name: "Denied" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(readOnlyAdmin.apiKeys.revoke({ id: issued.id })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The caller still carries its original OWNER membership snapshot.
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: org.id, userId: ownerUser.id } }, data: { role: "VIEWER" } });
    try {
      await expect(owner.apiKeys.list({ organizationId: org.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(owner.apiKeys.create({ organizationId: org.id, name: "Denied stale role" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(owner.apiKeys.revoke({ id: issued.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await prisma.membership.update({ where: { organizationId_userId: { organizationId: org.id, userId: ownerUser.id } }, data: { role: "OWNER" } });
    }

    await prisma.organization.update({ where: { id: org.id }, data: { suspendedAt: new Date() } });
    await expect(owner.apiKeys.create({ organizationId: org.id, name: "Denied suspended" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.apiKeys.revoke({ id: issued.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: issued.id } })).revokedAt).toBeNull();
  });
});
