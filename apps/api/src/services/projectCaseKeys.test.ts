import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@vaettir/db";
import { liveCaseDisplayId, parseCaseReference, projectCaseKeySave, projectCaseKeyRequestHash, assertProjectCaseKeyReceipt, saveProjectCaseKey, resolveProjectCaseReference } from "./projectCaseKeys.js";
import { customQueryWhereSql } from "./caseCustomQuery.js";
import { caseQuerySchema, defaultCaseQuery } from "./caseQuerySchema.js";
import { caseQueryWhere, queryCasePage } from "./caseQuery.js";

const locks = vi.hoisted(() => ({
  project: vi.fn(), actor: vi.fn(), read: vi.fn(),
}));
vi.mock("./caseFields.js", () => ({ lockCaseFieldProject: locks.project }));
vi.mock("./caseFieldReadScope.js", () => ({
  lockCurrentCaseFieldActor: locks.actor, lockCaseFieldReadScope: locks.read,
}));
const input = { projectId: "project", originalOrganizationId: "org", expectedClerkActorId: "clerk", expectedNativeActorId: "actor",
  requestId: "12345678-1234-4234-8234-123456789012", expectedCaseKey: "old-key", expectedRevision: 3, caseKey: "new-key" };
const authorized = { clerkActorId: "clerk" };
function receipt(body = input) {
  return { projectId: body.projectId, organizationId: body.originalOrganizationId, actorId: "actor", actorClerkUserId: body.expectedClerkActorId,
    requestId: body.requestId, requestHash: projectCaseKeyRequestHash(body, "actor"), beforeKey: body.expectedCaseKey,
    caseKey: body.caseKey, beforeRevision: body.expectedRevision, revision: body.expectedRevision + (body.caseKey === body.expectedCaseKey ? 0 : 1),
    keyLocked: false, aliasesPreserved: true };
}
function fixture(options: { key?: string; revision?: number; org?: string; prior?: unknown; reserved?: string; changed?: number } = {}) {
  const calls: string[] = [];
  const tx = {
    project: { findUniqueOrThrow: vi.fn().mockResolvedValue({ organizationId: options.org ?? "org" }) },
    $queryRaw: vi.fn(async (sql: { strings?: string[] } | TemplateStringsArray) => {
      const text = Array.isArray(sql) ? sql.join("?") : (sql as { strings: string[] }).strings.join("?");
      calls.push(text);
      if (text.includes('FROM "ProjectCaseKeyWrite"')) return options.prior ? [options.prior] : [];
      if (text.includes('FROM "ProjectCaseKeyAlias"')) return options.reserved ? [{ projectId: options.reserved }] : [];
      if (text.includes('SELECT "caseKey"')) return [{ caseKey: options.key ?? "old-key", caseKeyRevision: options.revision ?? 3, nextCaseNumber: 851, organizationId: options.org ?? "org" }];
      if (text.includes('FROM "TestCase" c')) return [{ id: "stable-case", displayId: "new-key-01", title: "Unchanged", archived: false }];
      return [];
    }),
    $executeRaw: vi.fn(async (sql: TemplateStringsArray) => {
      calls.push(sql.join("?"));
      return sql.join("").startsWith('UPDATE "Project"') ? options.changed ?? 1 : 1;
    }),
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const db = { $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(tx)) } as unknown as PrismaClient;
  return { db, tx, calls };
}
beforeEach(() => {
  vi.clearAllMocks(); locks.project.mockResolvedValue(undefined); locks.actor.mockResolvedValue("clerk");
  locks.read.mockResolvedValue({ organizationId: "org", actorClerkUserId: "clerk" });
});
describe("project key aliases and original requests (synthetic service callbacks)", () => {
  it("projects current labels without changing stable numbers or clipping", () => {
    expect(liveCaseDisplayId("NEW-Key", 1)).toBe("new-key-01");
    expect(liveCaseDisplayId("new-key", 100)).toBe("new-key-100");
    expect(liveCaseDisplayId("new-key", 2147483647)).toBe("new-key-2147483647");
    for (const value of [0, -1, 1.5, 2147483648, NaN]) expect(() => liveCaseDisplayId("new-key", value)).toThrow();
  });
  it("admits only canonical case references including hyphenated prefixes", () => {
    expect(parseCaseReference(" OLD-Key-01 ")).toEqual({ caseKey: "old-key", caseNumber: 1 });
    expect(parseCaseReference("trailing--100")).toEqual({ caseKey: "trailing-", caseNumber: 100 });
    for (const v of ["old-001", "old-1", "old-00", "old-2147483648", "x' OR true-01", "2old-01", "a".repeat(25) + "-01"]) expect(parseCaseReference(v)).toBeNull();
  });
  it("rejects old bare writer inputs rather than inventing origin/revision/UUID", () => {
    expect(() => projectCaseKeySave.parse({ projectId: "project", expectedCaseKey: "old-key", caseKey: "new-key" })).toThrow();
    expect(() => projectCaseKeySave.parse({ ...input, extra: true })).toThrow();
  });
  it("binds hash to every immutable body field and native actor", () => {
    const hash = projectCaseKeyRequestHash(input, "actor");
    for (const patch of [{ projectId: "other" }, { originalOrganizationId: "other" }, { expectedClerkActorId: "other" }, { expectedNativeActorId: "other" }, { requestId: "12345678-1234-4234-8234-123456789013" }, { expectedCaseKey: "other" }, { expectedRevision: 4 }, { caseKey: "other" }]) expect(projectCaseKeyRequestHash({ ...input, ...patch }, "actor")).not.toBe(hash);
    expect(projectCaseKeyRequestHash(input, "other")).not.toBe(hash);
  });
  it("rejects foreign, corrupt, relabeled or revision-drifting receipts", () => {
    const ack = receipt();
    expect(assertProjectCaseKeyReceipt(ack, input, "actor")).toEqual(ack);
    for (const patch of [{ projectId: "other" }, { organizationId: "other" }, { actorId: "other" }, { actorClerkUserId: "other" }, { requestId: "12345678-1234-4234-8234-123456789013" }, { requestHash: "0".repeat(64) }, { beforeKey: "other" }, { caseKey: "other" }, { beforeRevision: 2 }, { revision: 3 }, { aliasesPreserved: false }, { keyLocked: true }]) expect(() => assertProjectCaseKeyReceipt({ ...ack, ...patch }, input, "actor")).toThrow();
  });
  it("writes one receipt then exact CAS without any case/version rewrite", async () => {
    const { db, tx, calls } = fixture();
    expect(await saveProjectCaseKey(db, "actor", input, authorized)).toEqual({ ...receipt(), replayed: false });
    expect(calls.findIndex(v => v.includes('INSERT INTO "ProjectCaseKeyWrite"'))).toBeLessThan(calls.findIndex(v => v.startsWith('UPDATE "Project"')));
    expect(calls.join("\n")).not.toMatch(/UPDATE "TestCase"|TestCaseVersion|ManualRun|nextCaseNumber"=/);
    expect(calls.join("\n")).toContain("vaettir.project_case_key_request");
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(locks.project).toHaveBeenCalledWith(tx, "actor", "project");
    expect(locks.actor).toHaveBeenCalledWith(tx, "actor", authorized);
  });
  it("recovers the exact original UUID after later key/revision changes without a second write", async () => {
    const prior = { projectId: "project", organizationId: "org", actorId: "actor", clerkActorId: "clerk", requestHash: receipt().requestHash, receipt: receipt() };
    const { db, tx } = fixture({ key: "later", revision: 7, prior });
    expect(await saveProjectCaseKey(db, "actor", input, authorized)).toEqual({ ...receipt(), replayed: true });
    expect(tx.$executeRaw).not.toHaveBeenCalled(); expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("cannot use an accepted UUID for a changed body or actor", async () => {
    const { db, tx } = fixture({ prior: { projectId: "project", organizationId: "org", actorId: "actor", clerkActorId: "clerk", requestHash: receipt().requestHash, receipt: receipt() } });
    await expect(saveProjectCaseKey(db, "actor", { ...input, caseKey: "replacement" }, authorized)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it("refuses stale CAS including same-prefix ABA, alias collisions and failed update count", async () => {
    for (const options of [{ revision: 5 }, { key: "other" }, { reserved: "foreign-project" }, { changed: 0 }]) {
      const { db, tx } = fixture(options); await expect(saveProjectCaseKey(db, "actor", input, authorized)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    }
  });
  it("requires independent current native full-editor/actor locks before receipts", async () => {
    const { db, tx } = fixture(); locks.project.mockRejectedValueOnce({ code: "FORBIDDEN" });
    await expect(saveProjectCaseKey(db, "actor", input, authorized)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(tx.$executeRaw).not.toHaveBeenCalled(); expect(locks.actor).not.toHaveBeenCalled();
    locks.actor.mockResolvedValueOnce("remapped");
    await expect(saveProjectCaseKey(db, "actor", input, authorized)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it("refuses original organization/account mismatch before writing", async () => {
    const { db, tx } = fixture({ org: "other" });
    await expect(saveProjectCaseKey(db, "actor", input, authorized)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveProjectCaseKey(db, "actor", input, { clerkActorId: "other" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveProjectCaseKey(db, "replacement-native-user", input, authorized)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it("records unchanged-key requests without incrementing revision or touching cases", async () => {
    const { db, calls } = fixture(); const body = { ...input, caseKey: input.expectedCaseKey };
    expect(await saveProjectCaseKey(db, "actor", body, authorized)).toEqual({ ...receipt(body), replayed: false });
    expect(calls.some(v => v.startsWith('UPDATE "Project"'))).toBe(false);
  });
  it("resolves old aliases only after current read authorization within the exact project", async () => {
    const { db, tx, calls } = fixture();
    expect(await resolveProjectCaseReference(db, "actor", "project", "old-key-01", authorized)).toMatchObject({ id: "stable-case", displayId: "new-key-01" });
    expect(locks.read).toHaveBeenCalledWith(tx, "actor", { projectId: "project" }, authorized);
    expect(calls.join("\n")).toContain('a."organizationId"=p."organizationId"');
    expect(calls.join("\n")).toContain('c."projectId"=?');
    locks.read.mockRejectedValueOnce({ code: "FORBIDDEN" });
    await expect(resolveProjectCaseReference(db, "actor", "project", "old-key-01", authorized)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("makes display equality project-correlated and bound, leaving unrelated rules unchanged", () => {
    const query = (value: string) => caseQuerySchema.parse({ ...defaultCaseQuery(), groups: [{ match: "all", rules: [{ field: "displayId", operator: "equals", value }] }] });
    for (const value of ["old-key-01", "new-key-01"]) {
      const sql = customQueryWhereSql("project", query(value), new Date(0));
      expect(sql.text).toContain('a."projectId"="TestCase"."projectId"');
      expect(sql.text).toContain('p."organizationId"=a."organizationId"');
      expect(sql.values).toContain(value.slice(0, -3)); expect(sql.values).toContain(1); expect(sql.values).toContain("project");
      expect(sql.text).not.toContain(value);
    }
    expect(customQueryWhereSql("project", query("old-key-001"), new Date(0)).text).toContain("false");
    const normal = customQueryWhereSql("project", caseQuerySchema.parse({ ...defaultCaseQuery(), groups: [{ match: "all", rules: [{ field: "title", operator: "contains", value: "a%b" }] }] }), new Date(0));
    expect(normal.text).toContain("title ILIKE"); expect(normal.values).toContain("%a\\%b%");
    expect(() => caseQueryWhere("project", query("new-key-01"), new Date(0))).toThrow("historical alias query path");
  });
  it("uses actual alias SQL for current ID queries and current-label metadata without changing their criteria", async () => {
    const query = caseQuerySchema.parse({ ...defaultCaseQuery(), groups: [{ match: "all", rules: [{ field: "displayId", operator: "equals", value: "new-key-01" }] }] });
    const originals = structuredClone(query), seen: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async (sql: { text: string }) => {
        seen.push(sql.text);
        if (sql.text.includes("count(*)::int")) return [{ count: 1 }];
        if (sql.text.includes(' AS "displayId"')) return [{ id: "case", caseNumber: 1, displayId: "new-key-01", title: "Literal", titleClipped: false }];
        return [{ id: "case", updatedAt: new Date(0) }];
      }),
      testCase: { count: vi.fn(), findMany: vi.fn() },
    };
    const page = await queryCasePage(tx as never, { projectId: "project", query, requestId: input.requestId }, "actor", "org", { PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") });
    expect(page.items).toMatchObject([{ id: "case", caseNumber: 1, displayId: "new-key-01" }]);
    expect(tx.testCase.count).not.toHaveBeenCalled(); expect(tx.testCase.findMany).not.toHaveBeenCalled();
    expect(seen.join("\n")).toContain('a."projectId"="TestCase"."projectId"');
    expect(seen.join("\n")).toContain('vaettir_case_display_label("projectId","caseNumber") AS "displayId"');
    expect(query).toEqual(originals);
  });
  it("migration only seeds aliases and guards key changes; allocator and all stored identities remain unchanged", () => {
    const sql = readFileSync(new URL("../../../../packages/db/prisma/migrations/20261012090000_project_case_key_aliases/migration.sql", import.meta.url), "utf8");
    expect(sql).toContain('"ProjectCaseKeyAlias_organizationId_caseKey_key"');
    expect(sql).toContain('regexp_replace(c."displayId"');
    expect(sql).not.toMatch(/UPDATE\s+"(?:TestCase|TestCaseVersion|ManualRun|CaseExecution)"/);
    expect(sql).not.toContain("vaettir_allocate_case_identity");
    expect(sql).not.toMatch(/DISABLE TRIGGER|session_replication_role|DROP/);
    expect(sql).toContain('NEW."nextCaseNumber"<>OLD."nextCaseNumber"');
  });
});
