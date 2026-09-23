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

type ClerkMirrorIdentity = {
  clerkUserId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
};

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
 * Reconcile Clerk's current identity with the durable local user row.
 *
 * Clerk IDs can legitimately change when an identity is recreated or a user
 * switches to a different authentication provider. Email is the durable
 * identity key for human users in Vaettir, but it is only safe to use after
 * Clerk has verified ownership. Rebinding the existing row preserves every
 * membership and audit relation that points at its local id.
 *
 * The transaction-level advisory lock serializes first requests for the same
 * normalized email across API replicas, preventing concurrent OAuth callback
 * requests from racing into the unique email constraint.
 */
export async function reconcileLocalUserIdentity(identity: ClerkMirrorIdentity): Promise<User> {
  if (!identity.emailVerified) {
    throw new Error(`Clerk user ${identity.clerkUserId} has an unverified primary email address`);
  }

  const normalizedEmail = identity.email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error(`Clerk user ${identity.clerkUserId} has no primary email address`);
  }

  return prisma.$transaction(async (tx) => {
    // Keep the void-returning lock function out of the result shape because
    // Prisma cannot deserialize PostgreSQL's `void` type.
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1::int AS locked
      FROM (SELECT pg_advisory_xact_lock(hashtext(${normalizedEmail}))) AS acquired
    `;

    const byClerkId = await tx.user.findUnique({ where: { clerkUserId: identity.clerkUserId } });
    if (byClerkId) return byClerkId;

    const byEmail = await tx.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    });
    if (byEmail) {
      return tx.user.update({
        where: { id: byEmail.id },
        data: {
          clerkUserId: identity.clerkUserId,
          email: normalizedEmail,
          name: identity.name ?? byEmail.name,
        },
      });
    }

    return tx.user.create({
      data: {
        clerkUserId: identity.clerkUserId,
        email: normalizedEmail,
        name: identity.name,
      },
    });
  });
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
  );
  if (!primaryEmail) {
    throw new Error(`Clerk user ${clerkUserId} has no primary email address`);
  }

  return reconcileLocalUserIdentity({
    clerkUserId,
    email: primaryEmail.emailAddress,
    emailVerified: primaryEmail.verification?.status === "verified",
    name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null,
  });
}
