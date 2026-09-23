import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { reconcileLocalUserIdentity } from "./clerk.js";

const run = `clerk-reconcile-${randomUUID()}`;
const email = `${run}@example.com`;
const concurrentEmail = `${run}-concurrent@example.com`;
const oldClerkUserId = `${run}-old`;
const newClerkUserId = `${run}-new`;
let localUserId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { clerkUserId: oldClerkUserId, email: email.toUpperCase(), name: "Original Name" },
  });
  localUserId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { equals: email, mode: "insensitive" } },
        { email: { equals: concurrentEmail, mode: "insensitive" } },
      ],
    },
  });
  await prisma.$disconnect();
});

describe("Clerk local-user reconciliation", () => {
  it("rebinds the existing local row when a verified email returns with a new Clerk id", async () => {
    const reconciled = await reconcileLocalUserIdentity({
      clerkUserId: newClerkUserId,
      email,
      emailVerified: true,
      name: "Current Name",
    });

    expect(reconciled).toMatchObject({
      id: localUserId,
      clerkUserId: newClerkUserId,
      email,
      name: "Current Name",
    });
    await expect(prisma.user.count({ where: { email: { equals: email, mode: "insensitive" } } })).resolves.toBe(1);
  });

  it("is idempotent for repeated requests from the current Clerk identity", async () => {
    const reconciled = await reconcileLocalUserIdentity({
      clerkUserId: newClerkUserId,
      email,
      emailVerified: true,
      name: "Current Name",
    });

    expect(reconciled.id).toBe(localUserId);
    await expect(prisma.user.count({ where: { email: { equals: email, mode: "insensitive" } } })).resolves.toBe(1);
  });

  it("serializes concurrent first requests for the same verified identity", async () => {
    const identity = {
      clerkUserId: `${run}-concurrent`,
      email: concurrentEmail,
      emailVerified: true,
      name: "Concurrent User",
    };
    const [first, second] = await Promise.all([
      reconcileLocalUserIdentity(identity),
      reconcileLocalUserIdentity(identity),
    ]);

    expect(first.id).toBe(second.id);
    await expect(prisma.user.count({
      where: { email: { equals: concurrentEmail, mode: "insensitive" } },
    })).resolves.toBe(1);
  });

  it("refuses to bind an unverified email to an existing user", async () => {
    await expect(reconcileLocalUserIdentity({
      clerkUserId: `${run}-unverified`,
      email,
      emailVerified: false,
      name: null,
    })).rejects.toThrow("unverified primary email address");

    await expect(prisma.user.findUnique({ where: { id: localUserId } })).resolves.toMatchObject({
      clerkUserId: newClerkUserId,
    });
  });
});
