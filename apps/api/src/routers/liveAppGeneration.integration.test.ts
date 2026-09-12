// SSE-181: exercises the two things worth a real-DB test here -- the
// liveAppScanProcedure allowlist gate (mirrors trpc.integration.test.ts's
// staffProcedure coverage) and the UnsafeUrlError handling fix in
// generateFromUrl (previously an uncaught 500, see liveAppGeneration.ts).
// Everything else in this feature (the crawl itself, the AI call) needs a
// real Chromium binary and a live Claude API call respectively, neither of
// which this environment can exercise -- see liveAppScan.ts's own
// NOT LIVE-VERIFIED comment.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "../router.js";

const RUN_ID = `sse181-${Date.now()}`;
const ALLOWLISTED_EMAIL = "james@skaldandstone.com"; // matches liveAppScanProcedure's default allowlist

let orgId: string;
let projectId: string;
let outsiderUserId: string;
let allowlistedUserId: string;
let createdAllowlistedUser = false;

function callerFor(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: true } }).then((user) =>
    appRouter.createCaller({ prisma, user }),
  );
}

beforeAll(async () => {
  const freeTier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
  const org = await prisma.organization.create({
    data: { name: `SSE-181 test org ${RUN_ID}`, slug: `sse181-test-${RUN_ID}`, planTier: { connect: { id: freeTier.id } } },
  });
  orgId = org.id;
  const project = await prisma.project.create({ data: { organizationId: orgId, name: "SSE-181 test project", slug: "sse181-test-project" } });
  projectId = project.id;

  // Enough balance to clear generateFromUrl's chargeAiCredits pre-charge
  // (AI_OPERATION_COSTS.generateTestCasesFromLiveApp === 15) so the test
  // reaches scanLiveApp's URL validation, not an unrelated insufficient-
  // credits rejection.
  await prisma.aiCreditTransaction.create({
    data: { organizationId: orgId, type: "GRANT", amount: 100, description: `Test grant for ${RUN_ID}` },
  });

  const outsider = await prisma.user.create({
    data: { clerkUserId: `${RUN_ID}-outsider`, email: `${RUN_ID}-outsider@example.com` },
  });
  outsiderUserId = outsider.id;

  // Reuse a real allowlisted account if this DB already has one (the
  // allowlist is keyed on an exact real email, which is unique in this
  // schema) rather than risk a unique-constraint collision.
  const existing = await prisma.user.findUnique({ where: { email: ALLOWLISTED_EMAIL } });
  if (existing) {
    allowlistedUserId = existing.id;
  } else {
    const created = await prisma.user.create({ data: { clerkUserId: `${RUN_ID}-allowlisted`, email: ALLOWLISTED_EMAIL } });
    allowlistedUserId = created.id;
    createdAllowlistedUser = true;
  }

  await Promise.all([
    prisma.membership.create({ data: { organizationId: orgId, userId: outsiderUserId, role: "EDITOR" } }),
    prisma.membership.create({ data: { organizationId: orgId, userId: allowlistedUserId, role: "EDITOR" } }),
  ]);
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.aiCreditTransaction.deleteMany({ where: { organizationId: orgId } });
  if (projectId) await prisma.testCase.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { organizationId: orgId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({
    where: { id: { in: [outsiderUserId, createdAllowlistedUser ? allowlistedUserId : undefined].filter(Boolean) as string[] } },
  });
  await prisma.organization.delete({ where: { id: orgId } });
});

describe("liveAppScanProcedure (real DB, real router)", () => {
  it("rejects a non-allowlisted user with FORBIDDEN even with valid project access", async () => {
    const caller = await callerFor(outsiderUserId);
    await expect(
      caller.liveAppGeneration.generateFromUrl({ projectId, startUrl: "https://example.com" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("an allowlisted user reaches past the gate: a private/unsafe start URL is BAD_REQUEST, not a 500", async () => {
    const caller = await callerFor(allowlistedUserId);
    // Regression coverage for the fix in liveAppGeneration.ts: scanLiveApp
    // throws UnsafeUrlError (not LiveAppScanError) for a URL assertPublicHttpUrl
    // rejects, and the router must map that to BAD_REQUEST too.
    await expect(
      caller.liveAppGeneration.generateFromUrl({ projectId, startUrl: "http://localhost:1234/internal" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
