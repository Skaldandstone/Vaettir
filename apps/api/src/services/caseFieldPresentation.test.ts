import { describe, expect, it, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
const locks = vi.hoisted(() => ({ project: vi.fn(), actor: vi.fn(), read: vi.fn() }));
vi.mock("./caseFields.js", async original => ({ ...await original<typeof import("./caseFields.js")>(), lockCaseFieldProject: locks.project }));
vi.mock("./caseFieldReadScope.js", async original => ({ ...await original<typeof import("./caseFieldReadScope.js")>(), lockCurrentCaseFieldActor: locks.actor, lockCaseFieldReadScope: locks.read }));
import { caseFieldPresentationConfigureInput, caseFieldPresentationGetInput, caseFieldPresentationStateOutput, caseFieldPresentationRequestHash, caseFieldPresentationDefinitionHash, getCaseFieldPresentation, configureCaseFieldPresentation } from "./caseFieldPresentation.js";
import { caseFieldAuthoringSchemaHash } from "./caseFields.js";
import { caseFieldSchema } from "./caseFieldSchema.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";

const scope = { projectId: "synthetic-project", organizationId: "synthetic-org", actorId: "synthetic-user", actorClerkUserId: "synthetic-clerk" };
const originalSchema = { version: 1, fields: [{ key: "component", label: "  Retained exact native label  ", type: "TEXT", required: false, retired: false, options: [] }] };
const originalProfile = { objective: "Private unrelated context must not leak", futureSibling: { version: 7, retained: ["original", false, 0, null] }, experience: { version: 1, offerings: ["SOFTWARE"] } };
function request() { return { projectId: scope.projectId, originalOrganizationId: scope.organizationId, expectedClerkActorId: scope.actorClerkUserId, expectedProfileHash: qualityProfileHash(originalProfile), expectedFieldSchemaHash: caseFieldPresentationDefinitionHash(scope.projectId, scope.organizationId, scope.actorId, scope.actorClerkUserId, 3, originalSchema), configuration: { version: 1 as const, fields: { component: { widget: "PARAGRAPH" as const, placeholder: " Exact guidance " } } }, requestId: randomUUID(), confirmed: true as const, reason: "Synthetic explicit presentation review" }; }
function fixture() {
  const state = { role: "ADMIN", seatType: "FULL", organizationId: scope.organizationId, profile: originalProfile as unknown, schema: originalSchema as unknown, version: 3, profileBytes: 1000, schemaBytes: 1000, siblingBytes: 500, mergedBytes: 2000, updatedCount: 1, receipts: [] as Array<{ organizationId: string | null; requestHash: string | null }> };
  const events: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (raw: TemplateStringsArray | { sql: string }) => {
      const sql = Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql;
      if (sql.includes('FROM "AuditLog"')) { events.push("receipt-digest-only"); return state.receipts; }
      if (sql.includes('AS "profileBytes"')) { events.push("native-body-preflight"); return [{ profileBytes: state.profileBytes, schemaBytes: state.schemaBytes }]; }
      if (sql.includes('AS "siblingBytes"')) { events.push("native-merged-preflight"); return [{ siblingBytes: state.siblingBytes, mergedBytes: state.mergedBytes }]; }
      throw new Error(`Unexpected synthetic SQL ${sql}`);
    }),
    project: { findUniqueOrThrow: vi.fn(async (args: { select: Record<string, boolean> }) => { if (args.select.qualityProfile) { events.push("raw-json-read"); return { qualityProfile: state.profile, caseFieldSchema: state.schema, caseFieldSchemaVersion: state.version }; } events.push("scope-identity-read"); return { organizationId: state.organizationId }; }), updateMany: vi.fn(async () => { events.push("profile-cas-write"); return { count: state.updatedCount }; }) },
    membership: { findUniqueOrThrow: vi.fn(async () => { events.push("current-role-read"); return { role: state.role, seatType: state.seatType }; }) },
    auditLog: { create: vi.fn(async () => { events.push("new-scoped-receipt"); }) },
  };
  const db = { $transaction: vi.fn(async (work: (tx: typeof tx) => unknown) => work(tx)) };
  return { state, events, tx, db };
}
describe("isolated custom field presentation settings, mocked source proof", () => {
  beforeEach(() => { locks.project.mockReset(); locks.actor.mockReset().mockResolvedValue(scope.actorClerkUserId); locks.read.mockReset().mockResolvedValue(scope); });
  it("strict new inputs retain exact pins/configuration absence and reject unreviewed or unsupported changes", () => {
    const input = request(); expect(caseFieldPresentationConfigureInput.parse(input)).toEqual(input);
    for (const changes of [{ confirmed: false }, { expectedFieldSchemaHash: undefined }, { expectedClerkActorId: undefined }, { configuration: { version: 1, fields: { component: { widget: "URL" } } } }]) expect(caseFieldPresentationConfigureInput.safeParse({ ...input, ...changes }).success).toBe(false);
    expect(caseFieldPresentationGetInput.safeParse({ projectId: scope.projectId, originalOrganizationId: scope.organizationId }).success).toBe(false);
  });
  it("read locks current original scope and natively bounds BOTH JSON bodies before selecting either", async () => {
    const f = fixture(); f.state.role = "VIEWER"; f.state.seatType = "READ_ONLY";
    const value = await getCaseFieldPresentation(f.db as never, scope.actorId, { projectId: scope.projectId, originalOrganizationId: scope.organizationId, expectedClerkActorId: scope.actorClerkUserId }, { clerkActorId: scope.actorClerkUserId });
    expect(locks.read).toHaveBeenCalledBefore(f.tx.project.findUniqueOrThrow);
    expect(f.events).toEqual(["native-body-preflight", "raw-json-read", "current-role-read"]);
    expect(value).toMatchObject({ readScope: scope, canConfigure: false, definitionSchema: originalSchema, definitionSchemaVersion: 3, definitionSupported: true, configurationSupported: true });
    expect(Object.hasOwn(value, "configuration")).toBe(false);
    for (const secret of ["rawProfile", "rawSchema", "objective", "futureSibling", "experience", "values"]) expect(value).not.toHaveProperty(secret);
    expect(JSON.stringify(value)).not.toContain("Private unrelated");
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 5000 });
  });
  it("hashes exact raw native schema before label parsing, retaining a separate old authoring-hash bridge", async () => {
    const f = fixture(), value = await getCaseFieldPresentation(f.db as never, scope.actorId, { projectId: scope.projectId }, { clerkActorId: scope.actorClerkUserId });
    const parsed = caseFieldSchema.parse(originalSchema);
    expect(value.definitionSchema!.fields[0]!.label).toBe(originalSchema.fields[0]!.label);
    expect(value.profileHash).toBe(qualityProfileHash(originalProfile));
    expect(value.fieldSchemaHash).toBe(request().expectedFieldSchemaHash);
    expect(value.fieldSchemaHash).not.toBe(caseFieldPresentationDefinitionHash(scope.projectId, scope.organizationId, scope.actorId, scope.actorClerkUserId, 3, parsed));
    expect(value.fieldAuthoringSchemaHash).toBe(caseFieldAuthoringSchemaHash({ projectId: scope.projectId, organizationId: scope.organizationId, version: 3, schema: parsed }, scope.actorId, scope.actorClerkUserId));
    expect(caseFieldPresentationStateOutput.parse(value).definitionSchema!.fields[0]!.label).toBe(originalSchema.fields[0]!.label);
  });
  it("native read oversize or revoked read access fails before raw materialization", async () => {
    for (const change of [{ profileBytes: 262145 }, { schemaBytes: 32769 }]) { const f = fixture(); Object.assign(f.state, change); await expect(getCaseFieldPresentation(f.db as never, scope.actorId, { projectId: scope.projectId }, { clerkActorId: scope.actorClerkUserId })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.events).not.toContain("raw-json-read"); }
    const f = fixture(); locks.read.mockRejectedValueOnce(new Error("Current original actor revoked")); await expect(getCaseFieldPresentation(f.db as never, scope.actorId, { projectId: scope.projectId }, { clerkActorId: scope.actorClerkUserId })).rejects.toThrow("revoked"); expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });
  it("unsupported stored config/definition yields only whitelisted snapshots and generic warnings, never repair or raw leakage", async () => {
    const f = fixture(); f.state.profile = { ...originalProfile, caseFieldPresentation: { version: 7, opaqueBody: "must not leak" } };
    let value = await getCaseFieldPresentation(f.db as never, scope.actorId, { projectId: scope.projectId }, { clerkActorId: scope.actorClerkUserId });
    expect(value.configurationSupported).toBe(false); expect(value.warnings).toHaveLength(1); expect(value).not.toHaveProperty("configuration"); expect(JSON.stringify(value)).not.toContain("opaqueBody");
    f.state.schema = { version: 8, secretDefinitionBody: "must not leak" };
    value = await getCaseFieldPresentation(f.db as never, scope.actorId, { projectId: scope.projectId }, { clerkActorId: scope.actorClerkUserId });
    expect(value.definitionSupported).toBe(false); expect(value.definitionSchema).toBeNull(); expect(value.fieldAuthoringSchemaHash).toBeNull(); expect(JSON.stringify(value)).not.toContain("secretDefinitionBody");
    expect(f.tx.project.updateMany).not.toHaveBeenCalled();
  });
  it("new FULLAdmin write preserves unknown siblings, performs raw profile/schema/version CAS and one distinct audit", async () => {
    const f = fixture(), input = request(), ack = await configureCaseFieldPresentation(f.db as never, scope.actorId, input, { clerkActorId: scope.actorClerkUserId });
    expect(locks.project).toHaveBeenCalledBefore(locks.actor); expect(ack).toEqual({ projectId: scope.projectId, organizationId: scope.organizationId, actorClerkUserId: scope.actorClerkUserId, requestId: input.requestId, replayed: false });
    const update = (f.tx.project.updateMany.mock.calls[0] as unknown as [{ where: unknown; data: { qualityProfile: Record<string, unknown> } }])[0];
    expect(update.where).toEqual({ id: scope.projectId, organizationId: scope.organizationId, qualityProfile: { equals: originalProfile }, caseFieldSchema: { equals: originalSchema }, caseFieldSchemaVersion: 3 });
    expect(update.data.qualityProfile.futureSibling).toBe(originalProfile.futureSibling); expect(update.data.qualityProfile.experience).toBe(originalProfile.experience); expect(update.data.qualityProfile.caseFieldPresentation).toEqual(input.configuration);
    expect(f.events).toEqual(["scope-identity-read", "current-role-read", "receipt-digest-only", "native-body-preflight", "raw-json-read", "current-role-read", "native-merged-preflight", "profile-cas-write", "new-scoped-receipt"]);
    const audit = (f.tx.auditLog.create.mock.calls[0] as unknown as [{ data: { entityType: string; metadata: Record<string, unknown> } }])[0].data;
    expect(audit.entityType).toBe("CaseFieldPresentationWrite"); expect(audit.metadata.requestHash).toBe(caseFieldPresentationRequestHash(input)); expect(audit.metadata).not.toHaveProperty("rawProfile"); expect(audit.metadata).not.toHaveProperty("rawSchema");
  });
  it("role, seat, original organization or authenticated Clerk changes refuse before any private receipt/hash read", async () => {
    for (const change of [{ role: "EDITOR" }, { role: "VIEWER" }, { seatType: "READ_ONLY" }, { organizationId: "other-org" }]) { const f = fixture(); Object.assign(f.state, change); await expect(configureCaseFieldPresentation(f.db as never, scope.actorId, request(), { clerkActorId: scope.actorClerkUserId })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.tx.$queryRaw).not.toHaveBeenCalled(); }
    const f = fixture(); locks.actor.mockResolvedValueOnce("different-clerk"); await expect(configureCaseFieldPresentation(f.db as never, scope.actorId, request(), { clerkActorId: scope.actorClerkUserId })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });
  it("exact UUID replay recovers before any later unsupported/oversized profile or schema parsing", async () => {
    const f = fixture(), input = request(); f.state.receipts = [{ organizationId: scope.organizationId, requestHash: caseFieldPresentationRequestHash(input) }]; f.state.profileBytes = 999999; f.state.schemaBytes = 999999; f.state.profile = { unsupported: true }; f.state.schema = { unsupported: true };
    expect((await configureCaseFieldPresentation(f.db as never, scope.actorId, input, { clerkActorId: scope.actorClerkUserId })).replayed).toBe(true);
    expect(f.events).toEqual(["scope-identity-read", "current-role-read", "receipt-digest-only"]); expect(f.tx.project.updateMany).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("changed body, duplicate receipts, missing digest and former organization reject exact UUID replacement", async () => {
    const input = request();
    for (const receipts of [[{ organizationId: scope.organizationId, requestHash: "a".repeat(64) }], [{ organizationId: scope.organizationId, requestHash: null }], Array.from({ length: 2 }, () => ({ organizationId: scope.organizationId, requestHash: caseFieldPresentationRequestHash(input) }))]) { const f = fixture(); f.state.receipts = receipts; await expect(configureCaseFieldPresentation(f.db as never, scope.actorId, input, { clerkActorId: scope.actorClerkUserId })).rejects.toMatchObject({ code: "CONFLICT" }); expect(f.events).not.toContain("raw-json-read"); }
    const f = fixture(); f.state.receipts = [{ organizationId: "former-org", requestHash: caseFieldPresentationRequestHash(input) }]; await expect(configureCaseFieldPresentation(f.db as never, scope.actorId, input, { clerkActorId: scope.actorClerkUserId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("raw schema/profile/version and failed row CAS conflict without new receipt or value changes", async () => {
    for (const change of [{ expectedProfileHash: "a".repeat(64) }, { expectedFieldSchemaHash: "a".repeat(64) }]) { const f = fixture(); await expect(configureCaseFieldPresentation(f.db as never, scope.actorId, { ...request(), ...change }, { clerkActorId: scope.actorClerkUserId })).rejects.toMatchObject({ code: "CONFLICT" }); expect(f.tx.project.updateMany).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled(); }
    const version = fixture(); version.state.version = 4; await expect(configureCaseFieldPresentation(version.db as never, scope.actorId, request(), { clerkActorId: scope.actorClerkUserId })).rejects.toMatchObject({ code: "CONFLICT" });
    const raced = fixture(); raced.state.updatedCount = 0; await expect(configureCaseFieldPresentation(raced.db as never, scope.actorId, request(), { clerkActorId: scope.actorClerkUserId })).rejects.toMatchObject({ code: "CONFLICT" }); expect(raced.tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("unsupported native revision cannot approve a new write, but cannot trap an already accepted UUID", async () => {
    const input = request(), f = fixture(); f.state.version = -1;
    await expect(configureCaseFieldPresentation(f.db as never, scope.actorId, input, { clerkActorId: scope.actorClerkUserId })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.tx.project.updateMany).not.toHaveBeenCalled();
    f.state.receipts = [{ organizationId: scope.organizationId, requestHash: caseFieldPresentationRequestHash(input) }];
    expect((await configureCaseFieldPresentation(f.db as never, scope.actorId, input, { clerkActorId: scope.actorClerkUserId })).replayed).toBe(true);
  });
  it("unknown/incompatible settings and malformed saved sibling refuse without erasure", async () => {
    for (const fields of [{ unknown_field: { widget: "AUTO" as const } }, { component: { widget: "CHECKBOX" as const } }]) { const f = fixture(); await expect(configureCaseFieldPresentation(f.db as never, scope.actorId, { ...request(), configuration: { version: 1, fields } }, { clerkActorId: scope.actorClerkUserId })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.tx.project.updateMany).not.toHaveBeenCalled(); }
    const f = fixture(); f.state.profile = { ...originalProfile, caseFieldPresentation: { version: 8, fields: {} } }; const input = { ...request(), expectedProfileHash: qualityProfileHash(f.state.profile) }; await expect(configureCaseFieldPresentation(f.db as never, scope.actorId, input, { clerkActorId: scope.actorClerkUserId })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.tx.project.updateMany).not.toHaveBeenCalled();
  });
  it("mocked PostgreSQL sibling32KiB/merged256KiB byte refusals precede mutation despite successful pure estimate", async () => {
    for (const change of [{ siblingBytes: 32769 }, { mergedBytes: 262145 }]) { const f = fixture(); Object.assign(f.state, change); await expect(configureCaseFieldPresentation(f.db as never, scope.actorId, request(), { clerkActorId: scope.actorClerkUserId })).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.events).toContain("native-merged-preflight"); expect(f.tx.project.updateMany).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled(); }
  });
  it("source router/services remain separately scoped, bounded and do not write native case metadata or expose receipt bodies", () => {
    const service = readFileSync(new URL("./caseFieldPresentation.ts", import.meta.url), "utf8"), route = readFileSync(new URL("../routers/caseFieldPresentation.ts", import.meta.url), "utf8");
    expect(service).toContain("statement_timeout='8000ms'"); expect(service).toContain("timeout: 10000"); expect(service).toContain("LIMIT 2");
    expect(service).not.toMatch(/auditLog\.find|testCase\.update|caseFieldSchema:\s*input|\$queryRawUnsafe|fetch\(|invokeModel/);
    expect(service).toContain('metadata->>\'requestHash\''); expect(service).not.toMatch(/SELECT\s+metadata\s+FROM/);
    expect(route).toContain('requireProjectAccess(ctx, input.projectId, "ADMIN")'); expect(route).toContain("ctx.user.clerkUserId");
    expect(service).not.toContain('entityType: "CasePresentationWrite"'); expect(service).not.toContain('entityType: "CaseFieldSchemaWrite"');
  });
});
