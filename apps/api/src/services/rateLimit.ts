import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@vaettir/db";

// P2-09: a per-org ceiling on reverse-engineering jobs (each one is a real
// LLM call, i.e. real spend) queued within a rolling window -- protects
// against a runaway script or an org scanning in a loop, not against
// legitimate heavy usage. The window is a rolling hour rather than a
// calendar one so it can't be gamed by bursting right at a reset boundary.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_JOBS_PER_WINDOW = 200;

// Returns how many more jobs this org can queue right now before hitting
// the ceiling. Callers that want to queue more than this either refuse
// outright (submitJob: one job, all-or-nothing) or queue a partial batch
// and report the rest as rate-limited (scanRepo: queueing 1-24 of a
// 25-file batch is still useful, unlike queueing none of it).
export async function remainingReverseEngineerBudget(prisma: PrismaClient, organizationId: string): Promise<number> {
  const used = await prisma.reverseEngineerJob.count({
    where: {
      project: { organizationId },
      createdAt: { gt: new Date(Date.now() - WINDOW_MS) },
    },
  });
  return Math.max(0, MAX_JOBS_PER_WINDOW - used);
}

export async function assertReverseEngineerBudget(prisma: PrismaClient, organizationId: string): Promise<void> {
  const remaining = await remainingReverseEngineerBudget(prisma, organizationId);
  if (remaining <= 0) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `This organization has hit its reverse-engineering rate limit (${MAX_JOBS_PER_WINDOW} jobs/hour). Try again shortly.`,
    });
  }
}
