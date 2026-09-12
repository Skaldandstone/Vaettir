// SSE-180: exercises the plan-gate + access-control plumbing built ahead
// of the real per-customer OAuth work (which needs real Google Cloud OAuth
// credentials and a real App Store Connect account, neither available in
// this environment). Confirms: a Free-tier org is rejected regardless of
// role (the feature flag gate), a Business-tier VIEWER is rejected (the
// ADMIN gate), a Business-tier ADMIN reaches real business logic (Google
// Play OAuth correctly reports "not configured" rather than crashing;
// Apple App Store Connect credentials are validated and stored encrypted -
// never in plaintext - and a malformed key is rejected before storage).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { prisma } from "@vaettir/db";
import { appRouter } from "../router.js";

const RUN_ID = `sse180-${Date.now()}`;
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

let freeOrgId: string;
let businessOrgId: string;
let freeProjectId: string;
let businessProjectId: string;
let freeAdminUserId: string;
let businessAdminUserId: string;
let businessViewerUserId: string;
let originalEncryptionKey: string | undefined;

function callerFor(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: true } }).then((user) =>
    appRouter.createCaller({ prisma, user }),
  );
}

beforeAll(async () => {
  originalEncryptionKey = process.env.PRODUCTION_SIGNAL_ENCRYPTION_KEY;
  process.env.PRODUCTION_SIGNAL_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

  const [freeTier, businessTier] = await Promise.all([
    prisma.planTier.findUniqueOrThrow({ where: { key: "free" } }),
    prisma.planTier.findUniqueOrThrow({ where: { key: "business" } }),
  ]);

  const [freeOrg, businessOrg] = await Promise.all([
    prisma.organization.create({
      data: { name: `SSE-180 free org ${RUN_ID}`, slug: `sse180-free-${RUN_ID}`, planTier: { connect: { id: freeTier.id } } },
    }),
    prisma.organization.create({
      data: { name: `SSE-180 business org ${RUN_ID}`, slug: `sse180-biz-${RUN_ID}`, planTier: { connect: { id: businessTier.id } } },
    }),
  ]);
  freeOrgId = freeOrg.id;
  businessOrgId = businessOrg.id;

  const [freeProject, businessProject] = await Promise.all([
    prisma.project.create({ data: { organizationId: freeOrgId, name: "Free project", slug: "free-project" } }),
    prisma.project.create({ data: { organizationId: businessOrgId, name: "Business project", slug: "business-project" } }),
  ]);
  freeProjectId = freeProject.id;
  businessProjectId = businessProject.id;

  const [freeAdmin, businessAdmin, businessViewer] = await Promise.all([
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-free-admin`, email: `${RUN_ID}-free-admin@example.com` } }),
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-biz-admin`, email: `${RUN_ID}-biz-admin@example.com` } }),
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-biz-viewer`, email: `${RUN_ID}-biz-viewer@example.com` } }),
  ]);
  freeAdminUserId = freeAdmin.id;
  businessAdminUserId = businessAdmin.id;
  businessViewerUserId = businessViewer.id;

  await Promise.all([
    prisma.membership.create({ data: { organizationId: freeOrgId, userId: freeAdminUserId, role: "ADMIN" } }),
    prisma.membership.create({ data: { organizationId: businessOrgId, userId: businessAdminUserId, role: "ADMIN" } }),
    prisma.membership.create({ data: { organizationId: businessOrgId, userId: businessViewerUserId, role: "VIEWER" } }),
  ]);
});

afterAll(async () => {
  if (originalEncryptionKey === undefined) delete process.env.PRODUCTION_SIGNAL_ENCRYPTION_KEY;
  else process.env.PRODUCTION_SIGNAL_ENCRYPTION_KEY = originalEncryptionKey;

  if (freeProjectId) await prisma.productionSignal.deleteMany({ where: { projectId: { in: [freeProjectId, businessProjectId] } } });
  if (freeProjectId) {
    await prisma.productionSignalConnection.deleteMany({ where: { projectId: { in: [freeProjectId, businessProjectId] } } });
  }
  if (freeOrgId) {
    await prisma.project.deleteMany({ where: { organizationId: { in: [freeOrgId, businessOrgId] } } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: [freeOrgId, businessOrgId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [freeAdminUserId, businessAdminUserId, businessViewerUserId] } } });
    await prisma.organization.deleteMany({ where: { id: { in: [freeOrgId, businessOrgId] } } });
  }
});

describe("plan-tier feature gate (P12-07's tierHasFeature, first real caller)", () => {
  it("a Free-tier ADMIN is rejected regardless of role - the org simply isn't entitled", async () => {
    const caller = await callerFor(freeAdminUserId);
    await expect(
      caller.productionSignals.connectAppleAppStore({
        projectId: freeProjectId,
        issuerId: "issuer",
        keyId: "key",
        privateKeyPem: "not-checked-rejected-before-this",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a Business-tier VIEWER is rejected - ADMIN is required even on an entitled plan", async () => {
    const caller = await callerFor(businessViewerUserId);
    await expect(caller.productionSignals.startGooglePlayConnect({ projectId: businessProjectId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("startGooglePlayConnect (real DB, no real Google credentials in this environment)", () => {
  it("a Business-tier ADMIN reaches real logic: Google OAuth reports not-configured, not a crash", async () => {
    const caller = await callerFor(businessAdminUserId);
    await expect(caller.productionSignals.startGooglePlayConnect({ projectId: businessProjectId })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});

describe("connectAppleAppStore (real DB, real key validation, no real Apple network call)", () => {
  it("rejects a malformed (RSA, not EC) key before ever storing anything", async () => {
    const caller = await callerFor(businessAdminUserId);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const rsaPem = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    await expect(
      caller.productionSignals.connectAppleAppStore({
        projectId: businessProjectId,
        issuerId: "11111111-2222-3333-4444-555555555555",
        keyId: "ABCD1234",
        privateKeyPem: rsaPem,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const connections = await prisma.productionSignalConnection.findMany({ where: { projectId: businessProjectId } });
    expect(connections).toHaveLength(0);
  });

  it("accepts a real EC key, stores it encrypted (never plaintext), and listConnections never exposes it", async () => {
    const caller = await callerFor(businessAdminUserId);
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const ecPem = ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    const result = await caller.productionSignals.connectAppleAppStore({
      projectId: businessProjectId,
      issuerId: "11111111-2222-3333-4444-555555555555",
      keyId: "ABCD1234",
      privateKeyPem: ecPem,
    });
    expect(result.connected).toBe(true);

    const raw = await prisma.productionSignalConnection.findUniqueOrThrow({
      where: { projectId_provider: { projectId: businessProjectId, provider: "APPLE_APP_STORE" } },
    });
    expect(raw.status).toBe("CONNECTED");
    expect(raw.encryptedCredentials).toBeTruthy();
    expect(raw.encryptedCredentials).not.toContain("PRIVATE KEY");
    expect(raw.encryptedCredentials).not.toContain(ecPem);

    const listed = await caller.productionSignals.listConnections({ projectId: businessProjectId });
    const appleConnection = listed.find((c) => c.provider === "APPLE_APP_STORE");
    expect(appleConnection?.status).toBe("CONNECTED");
    expect(appleConnection?.appleIssuerId).toBe("11111111-2222-3333-4444-555555555555");
    expect(appleConnection).not.toHaveProperty("encryptedCredentials");
  });

  it("disconnect clears the stored credentials and flips status to DISCONNECTED", async () => {
    const caller = await callerFor(businessAdminUserId);
    await caller.productionSignals.disconnect({ projectId: businessProjectId, provider: "APPLE_APP_STORE" });

    const raw = await prisma.productionSignalConnection.findUniqueOrThrow({
      where: { projectId_provider: { projectId: businessProjectId, provider: "APPLE_APP_STORE" } },
    });
    expect(raw.status).toBe("DISCONNECTED");
    expect(raw.encryptedCredentials).toBeNull();
    expect(raw.appleIssuerId).toBeNull();
  });
});
