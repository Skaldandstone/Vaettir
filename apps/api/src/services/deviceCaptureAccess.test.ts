import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@vaettir/db";
import { describe, expect, it, vi } from "vitest";
import { deviceCaptureAccessInput, deviceCaptureAccessOutput, deviceCaptureAccessRequestText } from "./deviceCaptureAccessSchema.js";
import { readDeviceCaptureAccess, deviceCaptureAccessRequestKey } from "./deviceCaptureAccess.js";
import { deviceCaptureAccessRouter } from "../routers/deviceCaptureAccess.js";
import type { Context } from "../trpc.js";

function fixture() {
  const input = { projectId: "project", originalOrganizationId: "org", expectedClerkActorId: "clerk", expectedNativeActorId: "native", readRequestId: randomUUID() };
  const flags = { org: true, suspendedAt: null as Date | null | undefined, role: "EDITOR", seatType: "FULL", projectOrg: "org" as string | null, nativeClerk: "clerk" as string | null, member: true, user: true, project: true };
  const events: string[] = [];
  const tx = { $executeRaw: vi.fn(async () => { events.push("timeout"); }), $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
    const sql = parts.join("?");
    expect(sql).toContain("FOR SHARE");
    if (sql.includes('FROM "Organization"')) { events.push("org"); return flags.org ? [{ suspendedAt: flags.suspendedAt }] : []; }
    if (sql.includes('FROM "Membership"')) { events.push("membership"); return flags.member ? [{ role: flags.role, seatType: flags.seatType }] : []; }
    if (sql.includes('FROM "Project"')) { events.push("project"); expect(sql).toContain('octet_length("organizationId")<=800'); return flags.project ? [{ organizationId: flags.projectOrg }] : []; }
    if (sql.includes('FROM "User"')) { events.push("native-user"); expect(sql).toContain('octet_length("clerkUserId")<=800'); return flags.user ? [{ clerkUserId: flags.nativeClerk }] : []; }
    throw Error("Unexpected synthetic SQL branch");
  }) };
  const transaction = vi.fn(async (fn: (transaction: typeof tx) => unknown, options: unknown) => { expect(options).toEqual({ isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 5000 }); return fn(tx); });
  return { input, flags, events, tx, db: { $transaction: transaction } as unknown as PrismaClient, transaction };
}
describe("capture access metadata foundation: source/mocks only; native SQL NOT RUN", () => {
  it("strict all-original pins and nonce exclude every private device/source input", () => {
    const h = fixture(); expect(deviceCaptureAccessInput.parse(h.input)).toEqual(h.input);
    for (const key of Object.keys(h.input)) expect(deviceCaptureAccessInput.safeParse({ ...h.input, [key]: undefined }).success).toBe(false);
    for (const key of ["serial", "appiumUrl", "sessionId", "pairingCode", "capture", "appName", "authorization"]) expect(deviceCaptureAccessInput.safeParse({ ...h.input, [key]: "synthetic-private" }).success).toBe(false);
    expect(deviceCaptureAccessInput.safeParse({ ...h.input, projectId: "x\u0000y" }).success).toBe(false);
  });
  it("read locks current scope in consistent order and exposes no processing/device grant", async () => {
    const h = fixture(), output = await readDeviceCaptureAccess(h.db, "native", h.input, { authenticatedClerkSubject: "clerk" });
    expect(h.events).toEqual(["timeout", "org", "membership", "project", "native-user"]);
    expect(output.scope).toEqual({ projectId: "project", organizationId: "org", nativeActorId: "native", clerkActorId: "clerk" });
    expect(output).toMatchObject({ readRequestId: h.input.readRequestId, processingPermissionGranted: false, foregroundTargetVerified: false, deviceOperationPerformed: false });
    expect(deviceCaptureAccessOutput.parse(output)).toEqual(output);
  });
  it.each(["OWNER", "ADMIN", "EDITOR"])("current FULL %s admits metadata only", async role => { const h = fixture(); h.flags.role = role; expect((await readDeviceCaptureAccess(h.db, "native", h.input, { authenticatedClerkSubject: "clerk" })).role).toBe(role); });
  it.each([{ role: "VIEWER" }, { role: "COMPLIANCE_AUDITOR" }, { role: "UNKNOWN" }, { seatType: "READ_ONLY" }, { member: false }, { org: false }, { suspendedAt: new Date() }, { suspendedAt: undefined }, { projectOrg: "foreign" }, { projectOrg: null }, { project: false }, { nativeClerk: "remapped" }, { nativeClerk: null }, { user: false }])("current native denial %# never becomes cached edit permission", async patch => {
    const h = fixture(); Object.assign(h.flags, patch);
    await expect(readDeviceCaptureAccess(h.db, "native", h.input, { authenticatedClerkSubject: "clerk" })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.not.stringContaining("remapped") });
  });
  it("independent transport/native pins refuse before any native query", async () => {
    const h = fixture();
    for (const [native, subject] of [["other", "clerk"], ["native", "other"], ["native", ""]]) await expect(readDeviceCaptureAccess(h.db, native!, h.input, { authenticatedClerkSubject: subject! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it("request key is exact canonical metadata including new read UUID, never private source", async () => {
    const h = fixture(), key = deviceCaptureAccessRequestKey(h.input);
    expect(key).toBe(createHash("sha256").update(deviceCaptureAccessRequestText(h.input)).digest("hex"));
    expect(deviceCaptureAccessRequestKey({ ...h.input, readRequestId: randomUUID() })).not.toBe(key);
    expect(Object.keys(await readDeviceCaptureAccess(h.db, "native", h.input, { authenticatedClerkSubject: "clerk" })).sort()).toEqual(["authorization", "deviceOperationPerformed", "foregroundTargetVerified", "processingPermissionGranted", "readRequestId", "requestKey", "role", "scope", "seatType"].sort());
  });
  it("malformed request uses generic errors without reflecting raw private values", async () => {
    const h = fixture(); await expect(readDeviceCaptureAccess(h.db, "native", { ...h.input, readRequestId: "synthetic-private-secret" }, { authenticatedClerkSubject: "clerk" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.not.stringContaining("synthetic-private-secret") }); expect(h.transaction).not.toHaveBeenCalled();
  });
  it("actual protected router requires independent Clerk provenance, not native/API-key row metadata", async () => {
    const h = fixture();
    for (const subject of [undefined, null, ""]) {
      const ctx = { prisma: h.db, user: { id: "native", clerkUserId: "clerk" }, authenticatedClerkSubject: subject } as unknown as Context;
      await expect(deviceCaptureAccessRouter.createCaller(ctx).read(h.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it("actual protected caller supplies independently verified subject to locked native authorization", async () => {
    const h = fixture(), ctx = { prisma: h.db, user: { id: "native", clerkUserId: "not-the-transport-proof" }, authenticatedClerkSubject: "clerk" } as unknown as Context;
    expect((await deviceCaptureAccessRouter.createCaller(ctx).read(h.input)).scope.clerkActorId).toBe("clerk");
    h.flags.nativeClerk = "remapped";
    await expect(deviceCaptureAccessRouter.createCaller(ctx).read(h.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
