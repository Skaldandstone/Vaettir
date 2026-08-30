import { createClerkClient, verifyToken } from "@clerk/backend";
import { prisma, type User } from "@vaettir/db";

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
  } catch (err) {
    // A failed verification is an expected, routine case (expired/absent
    // token) and correctly still returns null to the caller -- but
    // swallowing the actual reason made every auth failure indistinguishable
    // from "no token sent," which is exactly the kind of thing that turns a
    // five-minute key-mismatch diagnosis into guesswork. Log it, still
    // return null.
    console.error("Clerk token verification failed:", err instanceof Error ? err.message : err);
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
  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const primary = clerkUser.emailAddresses.find(
    (e) => e.id === clerkUser.primaryEmailAddressId,
  );
  if (!primary || primary.verification?.status !== "verified") {
    throw new Error("Verify your primary email address before accessing Vaettir");
  }
  const email = primary.emailAddress.trim().toLowerCase();
  return prisma.user.upsert({
    where: { clerkUserId },
    update: { email },
    create: {
      clerkUserId,
      email,
      name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null,
    },
  });
}
