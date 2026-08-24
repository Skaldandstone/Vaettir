import { createClerkClient, verifyToken } from "@clerk/backend";
import { prisma, type User } from "@tci/db";

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

function getSecretKey(): string {
  if (!CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY is not set");
  }
  return CLERK_SECRET_KEY;
}

export const clerkClient = createClerkClient({ secretKey: CLERK_SECRET_KEY });

export async function verifyClerkSessionToken(token: string): Promise<string | null> {
  try {
    const payload = await verifyToken(token, { secretKey: getSecretKey() });
    return payload.sub;
  } catch {
    return null;
  }
}

/**
 * Local `User` rows are a mirror, not the identity source of truth -- Clerk
 * is. This lazily creates the mirror row on a Clerk user's first
 * authenticated request rather than requiring a separate registration step
 * or a webhook to have already fired.
 */
export async function getOrCreateLocalUser(clerkUserId: string): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { clerkUserId } });
  if (existing) return existing;

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const primaryEmail = clerkUser.emailAddresses.find(
    (e) => e.id === clerkUser.primaryEmailAddressId,
  )?.emailAddress;
  if (!primaryEmail) {
    throw new Error(`Clerk user ${clerkUserId} has no primary email address`);
  }

  return prisma.user.create({
    data: {
      clerkUserId,
      email: primaryEmail,
      name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null,
    },
  });
}
