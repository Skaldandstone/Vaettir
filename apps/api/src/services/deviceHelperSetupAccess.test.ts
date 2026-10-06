import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@vaettir/db";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
import { deviceHelperSetupAccessRouter } from "../routers/deviceHelperSetupAccess.js";
import { readDeviceHelperSetupAccess, deviceHelperSetupAccessRequestKey } from "./deviceHelperSetupAccess.js";
import { DEVICE_HELPER_SETUP_INPUT_BYTES, DEVICE_HELPER_SETUP_OUTPUT_BYTES, deviceHelperSetupAccessInput,
  deviceHelperSetupAccessOutput, deviceHelperSetupAccessRequestText, deviceHelperSetupMetadataBytes } from "./deviceHelperSetupAccessSchema.js";
import { deviceCaptureAccessInput } from "./deviceCaptureAccessSchema.js";

function fixture() {
  const input = { kind: "ESTABLISH_CURRENT_SETUP_SCOPE" as const, projectId: "project", originalOrganizationId: "org", expectedClerkActorId: "clerk", readRequestId: randomUUID() };
  const flags = { org: true, suspendedAt: null as Date | null | undefined, role: "EDITOR", seatType: "FULL", member: true, project: true,
    projectOrg: "org" as string | null, user: true, nativeClerk: "clerk" as string | null };
  const events: string[] = [];
  const tx = { $executeRaw: vi.fn(async () => { events.push("timeout"); }), $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
    const sql = parts.join("?"); expect(sql).toContain("FOR SHARE");
    if (sql.includes('FROM "Organization"')) { events.push("org"); return flags.org ? [{ suspendedAt: flags.suspendedAt }] : []; }
    if (sql.includes('FROM "Membership"')) { events.push("membership"); return flags.member ? [{ role: flags.role, seatType: flags.seatType }] : []; }
    if (sql.includes('FROM "Project"')) { events.push("project"); expect(sql).toContain('octet_length("organizationId")<=800'); return flags.project ? [{ organizationId: flags.projectOrg }] : []; }
    if (sql.includes('FROM "User"')) { events.push("native-user"); expect(sql).toContain('octet_length("clerkUserId")<=800'); return flags.user ? [{ clerkUserId: flags.nativeClerk }] : []; }
    throw Error("Unexpected synthetic SQL branch");
  }) };
  const transaction = vi.fn(async (fn: (transaction: typeof tx) => unknown, options: unknown) => {
    expect(options).toEqual({ isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 5000 }); return fn(tx);
  });
  return { input, flags, events, tx, transaction, db: { $transaction: transaction } as unknown as PrismaClient };
}

describe("current helper setup scope: mocks only, native SQL NOT RUN", () => {
  it("first establishment reuses the exact four-lock FULL editor reader and provides no action or historical ownership grant", async () => {
    const h = fixture(), output = await readDeviceHelperSetupAccess(h.db, "native", h.input, { authenticatedClerkSubject: "clerk" });
    expect(h.events).toEqual(["timeout", "org", "membership", "project", "native-user"]);
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(output).toMatchObject({ readRequestId: h.input.readRequestId, scope: { projectId: "project", organizationId: "org", nativeActorId: "native", clerkActorId: "clerk" },
      identityEstablishment: "CURRENT_SETUP_SCOPE_ONLY", authorization: "CURRENT_LOCKED_FULL_EDITOR_READ", seatType: "FULL", role: "EDITOR" });
    for (const flag of ["deviceOperationPerformed", "helperLaunchPerformed", "windowsLaunchAcceptanceVerified", "foregroundTargetVerified", "captureConsentGranted", "processingPermissionGranted", "spendingApprovalGranted", "legacyDraftAttributionVerified"] as const) expect(output[flag]).toBe(false);
    expect(deviceHelperSetupAccessOutput.parse(output)).toEqual(output);
  });
  it.each(["OWNER", "ADMIN", "EDITOR"])("current FULL %s admits identity metadata only", async role => {
    const h = fixture(); h.flags.role = role; expect((await readDeviceHelperSetupAccess(h.db, "native", h.input, { authenticatedClerkSubject: "clerk" })).role).toBe(role);
  });
  it.each([{ role: "VIEWER" }, { role: "COMPLIANCE_AUDITOR" }, { role: "UNKNOWN" }, { seatType: "READ_ONLY" }, { member: false },
    { org: false }, { suspendedAt: new Date() }, { suspendedAt: undefined }, { projectOrg: "foreign" }, { projectOrg: null },
    { project: false }, { nativeClerk: "remapped" }, { nativeClerk: null }, { user: false }])("current native refusal %# cannot establish an origin", async patch => {
    const h = fixture(); Object.assign(h.flags, patch);
    await expect(readDeviceHelperSetupAccess(h.db, "native", h.input, { authenticatedClerkSubject: "clerk" })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.not.stringContaining("remapped") });
  });
  it("strict metadata rejects all private fields, new original-native guesses and omitted identity fields before DB", async () => {
    const h = fixture();
    for (const key of ["expectedNativeActorId", "serial", "appiumUrl", "sessionId", "pairingCode", "capture", "appName", "source", "drafts", "platform"]) {
      const raw = { ...h.input, [key]: "synthetic-private" }; expect(deviceHelperSetupAccessInput.safeParse(raw).success).toBe(false);
      await expect(readDeviceHelperSetupAccess(h.db, "native", raw, { authenticatedClerkSubject: "clerk" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.not.stringContaining("synthetic-private") });
    }
    for (const key of Object.keys(h.input)) expect(deviceHelperSetupAccessInput.safeParse({ ...h.input, [key]: undefined }).success).toBe(false);
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it("independent transport loss/remap and malformed server-native identity refuse before DB", async () => {
    const h = fixture();
    for (const subject of ["", "wrong"]) await expect(readDeviceHelperSetupAccess(h.db, "native", h.input, { authenticatedClerkSubject: subject })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const native of ["", "x".repeat(201), "native\u0000private", "😀".repeat(101)]) await expect(readDeviceHelperSetupAccess(h.db, native, h.input, { authenticatedClerkSubject: "clerk" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "The complete current setup identity metadata is unsupported. No identity was clipped or attributed to retained drafts." });
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it("has a distinct canonical first-establishment hash and changes with every fresh nonce or original identity pin", () => {
    const h = fixture(), key = deviceHelperSetupAccessRequestKey(h.input);
    expect(key).toBe(createHash("sha256").update(deviceHelperSetupAccessRequestText(h.input)).digest("hex"));
    expect(deviceHelperSetupAccessRequestText(h.input)).toBe(JSON.stringify({ kind: "DEVICE_HELPER_SETUP_ACCESS", input: h.input }));
    for (const patch of [{ readRequestId: randomUUID() }, { projectId: "other" }, { originalOrganizationId: "other" }, { expectedClerkActorId: "other" }]) expect(deviceHelperSetupAccessRequestKey({ ...h.input, ...patch })).not.toBe(key);
    expect(deviceCaptureAccessInput.safeParse(h.input).success).toBe(false); // never a strict original-native recovery request
  });
  it("preserves exact primitive identity whitespace and bounded wire metadata, without clipping or schema fallback", async () => {
    const h = fixture(); h.input.projectId = " exact project "; h.input.originalOrganizationId = " exact org "; h.flags.projectOrg = h.input.originalOrganizationId;
    const output = await readDeviceHelperSetupAccess(h.db, "native", h.input, { authenticatedClerkSubject: "clerk" });
    expect(output.scope.projectId).toBe(" exact project "); expect(output.scope.organizationId).toBe(" exact org ");
    expect(deviceHelperSetupMetadataBytes(h.input)).toBeLessThanOrEqual(DEVICE_HELPER_SETUP_INPUT_BYTES);
    expect(deviceHelperSetupMetadataBytes(output)).toBeLessThanOrEqual(DEVICE_HELPER_SETUP_OUTPUT_BYTES);
    expect(deviceHelperSetupAccessOutput.safeParse({ ...output, captureConsentGranted: true }).success).toBe(false);
    expect(deviceHelperSetupAccessOutput.safeParse({ ...output, unexpected: "private" }).success).toBe(false);
    expect(deviceHelperSetupAccessInput.safeParse({ ...h.input, projectId: "😀".repeat(101) }).success).toBe(false);
    const malformed = { ...h.input, capture: { private: "synthetic retained source" } };
    expect(() => deviceHelperSetupMetadataBytes(malformed)).toThrow("Complete setup identity metadata is unsupported.");
  });
  it("admits maximum supported multibyte identities whole within the distinct primitive wire budgets", async () => {
    const h = fixture(), maximum = "😀".repeat(100);
    Object.assign(h.input, { projectId: maximum, originalOrganizationId: maximum, expectedClerkActorId: maximum });
    h.flags.projectOrg = maximum; h.flags.nativeClerk = maximum;
    const output = await readDeviceHelperSetupAccess(h.db, maximum, h.input, { authenticatedClerkSubject: maximum });
    expect(Object.values(output.scope)).toEqual([maximum, maximum, maximum, maximum]);
    expect(deviceHelperSetupMetadataBytes(h.input)).toBeLessThanOrEqual(DEVICE_HELPER_SETUP_INPUT_BYTES);
    expect(deviceHelperSetupMetadataBytes(output)).toBeLessThanOrEqual(DEVICE_HELPER_SETUP_OUTPUT_BYTES);
  });
  it("actual protected router refuses anonymous/API-key/missing verified subject instead of native Clerk fallback", async () => {
    const h = fixture();
    const anonymous = { prisma: h.db, user: null, authenticatedClerkSubject: "clerk" } as unknown as Context;
    await expect(deviceHelperSetupAccessRouter.createCaller(anonymous).establishCurrent(h.input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const subject of [undefined, null, ""]) {
      const ctx = { prisma: h.db, user: { id: "native", clerkUserId: "clerk" }, authenticatedClerkSubject: subject } as unknown as Context;
      await expect(deviceHelperSetupAccessRouter.createCaller(ctx).establishCurrent(h.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it("actual protected router uses only verified transport subject and current locked native mapping", async () => {
    const h = fixture(), ctx = { prisma: h.db, user: { id: "native", clerkUserId: "not-transport-proof" }, authenticatedClerkSubject: "clerk" } as unknown as Context;
    expect((await deviceHelperSetupAccessRouter.createCaller(ctx).establishCurrent(h.input)).scope.nativeActorId).toBe("native");
    h.flags.nativeClerk = "remapped";
    await expect(deviceHelperSetupAccessRouter.createCaller(ctx).establishCurrent(h.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("actual source shares existing independently verified locked reader and has no legacy feature/default operation imports", () => {
    const source = readFileSync(new URL("./deviceHelperSetupAccess.ts", import.meta.url), "utf8");
    expect(source).toContain("await readDeviceCaptureAccess(db, actor.data");
    expect(source).toContain("expectedNativeActorId: actor.data");
    expect(source).not.toMatch(/caseReview|runHistory|ctx\.user\.clerkUserId|fetch\(|\$queryRaw|\$transaction|\.create\(|\b(?:db|tx)\.|spawn|downloadFile/);
  });
});
