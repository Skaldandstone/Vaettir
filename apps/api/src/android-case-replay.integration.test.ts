import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { readAndroidReplayCase, patchAndroidReplayCase } from "./services/androidCaseReplay.js";
import type { androidReplayPatchInput } from "./services/androidCaseReplaySchema.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const enabled = process.env.VAETTIR_ANDROID_REPLAY_DB_TEST === "1" && url && ["127.0.0.1", "localhost"].includes(url.hostname) && (/^\/vaettir_ai_approved_\d+_test$/.test(url.pathname) || (process.env.CI === "true" && url.pathname === "/vaettir_test")) && !url.searchParams.has("host");
async function fixture() {
  const name = "replay-" + randomUUID();
  const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
  const org = await prisma.organization.create({ data: { name, slug: name, planTierId: tier.id } });
  const user = await prisma.user.create({ data: { email: name + "@example.invalid", clerkUserId: name, memberships: { create: { organizationId: org.id, role: "EDITOR", seatType: "FULL" } } } });
  const project = await prisma.project.create({ data: { organizationId: org.id, name, slug: name } });
  const tc = await prisma.testCase.create({ data: { projectId: project.id, title: "Synthetic navigation", given: [], when: [], then: [], tags: [], testType: "FUNCTIONAL", steps: { create: [{ order: 0, action: "Open catalog", expectedResult: "Catalog appears", expectedActionOrData: "PRESERVED_TECHNICAL_DATA", expectedResponse: "PRESERVED_RESPONSE" }] } }, include: { steps: true } });
  const authority = { nativeActorId: user.id, clerkActorId: user.clerkUserId };
  const scope = { projectId: project.id, originalOrganizationId: org.id, expectedClerkActorId: user.clerkUserId, expectedNativeActorId: user.id };
  const original = await readAndroidReplayCase(prisma, { ...scope, caseId: tc.id }, authority);
  const locator = { kind: "RESOURCE_ID" as const, value: "com.example.qa:id/catalog", className: "android.widget.Button" };
  const assertion = { kind: "VISIBLE_LABEL" as const, value: "Catalog", relationReviewed: true as const };
  const plan = { caseId: tc.id, revision: original.revision, packageName: "com.example.qa", steps: [{ stepId: tc.steps[0]!.id, label: "Catalog", expectedResult: tc.steps[0]!.expectedResult!, locator, assertion }] };
  const input: typeof androidReplayPatchInput._output = { ...scope, requestId: randomUUID(), plan, runId: "a".repeat(48), planHash: createHash("sha256").update(JSON.stringify(plan)).digest("hex"), network: null, networkSelection: null, localReportedEvidenceReviewed: true, patchReviewed: true, disclosureApproved: true,
    receipts: [{ stepId: plan.steps[0]!.stepId, expectedResult: plan.steps[0]!.expectedResult, requestId: randomUUID(), sequence: 1, from: "b".repeat(64), to: "c".repeat(64), observedAt: Date.now(), originalLocator: locator, target: { packageName: plan.packageName, objectId: locator.value, className: locator.className, selector: { kind: locator.kind, value: locator.value }, bounds: [0, 0, 100, 100] }, commandArgs: ["shell", "input", "tap", "50", "50"], assertion: { ...assertion, matches: 1, passed: true }, repaired: false, repairApproval: null }] };
  return { tc, org, user, project, scope, authority, input };
}
describe.skipIf(!enabled)("reviewed Android case patch on isolated PostgreSQL", () => {
  afterAll(async () => { await prisma.$disconnect(); });
  it("creates one version and audit, preserves authored expectations, and recovers an identical request", async () => {
    const f = await fixture();
    const first = await patchAndroidReplayCase(prisma, f.input, f.authority);
    expect(await patchAndroidReplayCase(prisma, f.input, f.authority)).toEqual(first);
    const tc = await prisma.testCase.findUniqueOrThrow({ where: { id: f.tc.id }, include: { steps: true, versions: true } });
    expect(tc.steps[0]).toMatchObject({ expectedResult: "Catalog appears", expectedActionOrData: "PRESERVED_TECHNICAL_DATA", expectedResponse: "PRESERVED_RESPONSE" });
    expect(tc.steps[0]!.action).toContain("ADB="); expect(tc.reviewStatus).toBe("PENDING_REVIEW"); expect(tc.versions).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { projectId: f.project.id, entityType: "AndroidCaseReplayPatch" } })).toBe(1);
    expect(first.nativeExecutionIndependentlyVerified).toBe(false);
  }, 20_000);
  it("serializes concurrent duplicate requests without duplicate versions or replaying device actions", async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([patchAndroidReplayCase(prisma, f.input, f.authority), patchAndroidReplayCase(prisma, f.input, f.authority)]);
    expect(outcomes.some(r => r.status === "fulfilled")).toBe(true);
    const recovered = await patchAndroidReplayCase(prisma, f.input, f.authority);
    expect(recovered.caseId).toBe(f.tc.id);
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: f.tc.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { projectId: f.project.id, entityType: "AndroidCaseReplayPatch" } })).toBe(1);
  }, 20_000);
  it("denies a changed case, withdrawn editor or foreign tenant without creating a version", async () => {
    const f = await fixture();
    await expect(patchAndroidReplayCase(prisma, { ...f.input, originalOrganizationId: "foreign" }, f.authority)).rejects.toThrow();
    await prisma.testCaseStep.update({ where: { id: f.tc.steps[0]!.id }, data: { expectedResult: "Changed expected result" } });
    await expect(patchAndroidReplayCase(prisma, f.input, f.authority)).rejects.toThrow();
    await prisma.membership.update({ where: { organizationId_userId: { organizationId: f.org.id, userId: f.user.id } }, data: { role: "VIEWER" } });
    await expect(readAndroidReplayCase(prisma, { ...f.scope, caseId: f.tc.id }, f.authority)).rejects.toThrow();
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: f.tc.id } })).toBe(0);
  }, 20_000);
  it("rolls back every step and version if the durable audit cannot commit", async () => {
    const f = await fixture();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "syntheticRejectReplayAudit"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityType"='AndroidCaseReplayPatch' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END; $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "synthetic_replay_audit_failure" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "syntheticRejectReplayAudit"()`);
    try {
      await expect(patchAndroidReplayCase(prisma, f.input, f.authority)).rejects.toThrow();
      expect((await prisma.testCaseStep.findUniqueOrThrow({ where: { id: f.tc.steps[0]!.id } })).action).toBe("Open catalog");
      expect(await prisma.testCaseVersion.count({ where: { testCaseId: f.tc.id } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER "synthetic_replay_audit_failure" ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "syntheticRejectReplayAudit"()`);
    }
  }, 20_000);
});
