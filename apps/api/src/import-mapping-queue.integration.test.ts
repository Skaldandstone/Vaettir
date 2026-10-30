import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { planMappingSheets } from "./services/importMappingPlan.js";
import { stageMappingBatch, confirmMappingBatch, cancelMappingBatch, readMappingQueue, listMappingQueues } from "./services/importMappingQueue.js";
import { importJobsRouter } from "./routers/importJobs.js";
import { saveProjectCaseKey, resolveProjectCaseReference } from "./services/projectCaseKeys.js";
import AdmZip from "adm-zip";

function assertDatabase() {
  if (!process.env.REPORT_TEST_OWNER_FILE) return assertOwnedTestDatabase(process.env.DATABASE_URL);
  const path = realpathSync(process.env.REPORT_TEST_OWNER_FILE);
  const local = realpathSync(resolve(import.meta.dirname, "../../..", ".local"));
  const rel = relative(local, path), owner = JSON.parse(readFileSync(path, "utf8"));
  const url = new URL(process.env.DATABASE_URL ?? "https://invalid");
  if (rel.startsWith("..") || rel.includes(":") || owner.owner !== "codex/reporting-parity-20261028" || owner.purpose !== "reporting-parity-disposable" ||
    realpathSync(owner.data) !== realpathSync(resolve(dirname(path), "data")) || owner.port !== 61199 ||
    !/^vaettir_reporting_test_[0-9]{13}$/.test(owner.database) || url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" ||
    url.port !== String(owner.port) || url.pathname !== `/${owner.database}` || url.search !== "?schema=public&connection_limit=5") throw Error("Exact owned test database required");
}
const tag = `mapping-${randomUUID()}`;
let orgId: string, otherOrgId: string, actor: { id: string; clerkActorId: string }, tierId: string;
beforeAll(async () => {
  assertDatabase();
  tierId = (await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } })).id;
  const organizations = await Promise.all(["", "-other"].map(suffix => prisma.organization.create({ data: { name: tag + suffix, slug: tag + suffix, planTierId: tierId } })));
  orgId = organizations[0]!.id; otherOrgId = organizations[1]!.id;
  const user = await prisma.user.create({ data: { clerkUserId: tag, email: tag + "@example.invalid", memberships: { create: [orgId, otherOrgId].map(organizationId => ({ organizationId, role: "OWNER", seatType: "FULL" })) } } });
  actor = { id: user.id, clerkActorId: tag };
});
afterAll(async () => { await prisma.$disconnect(); });
async function fixture(csv = "ID,Title,Steps,Expected Result\na,Ready,Open,Works\nb,,Check,Shown", format: "CSV" | "XLSX" | "SHEETS" = "CSV") {
  const project = await prisma.project.create({ data: { organizationId: orgId, name: tag, slug: `${tag}-${randomUUID()}` } });
  const scope = { projectId: project.id, originalOrganizationId: orgId, expectedClerkActorId: tag };
  const plan = planMappingSheets([{ name: "Auth", csvText: csv, mapping: { title: "Title", when: "Steps", then: "Expected Result", externalId: "ID" }, overrides: [],
    ...(format === "SHEETS" ? { source: { spreadsheetId: "synthetic-sheet", sheetId: 13 } } : {}) }], format);
  const prepared = await stageMappingBatch(prisma, actor, scope, { requestId: randomUUID(), sourceLabel: "Synthetic source", sourceDigest: plan.digest, rows: plan.rows });
  const input = { ...scope, batchId: prepared.id, expectedDigest: prepared.digest, requestId: randomUUID() };
  return { project, scope, plan, prepared, input, read: () => readMappingQueue(prisma, actor, input) };
}

describe("durable mapping queue on real PostgreSQL", () => {
  it.each(["XLSX", "SHEETS"] as const)("stages actual %s route input with original coordinates and resolves saved rows without another upload", async format => {
    const project = await prisma.project.create({ data: { organizationId: orgId, name: "Synthetic source format", slug: `${tag}-${randomUUID()}` } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, include: { memberships: { include: { organization: true } } } });
    const caller = importJobsRouter.createCaller({ prisma, user, authenticatedClerkSubject: tag, workspaceOrganizationId: orgId });
    const scope = { projectId: project.id, originalOrganizationId: orgId, expectedClerkActorId: tag };
    const mapping = { title: "Title", externalId: "ID", when: "Steps", then: "Expected Result" };
    const zip = new AdmZip();
    zip.addFile("xl/workbook.xml", Buffer.from('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cases" sheetId="1" r:id="rId1"/></sheets></workbook>'));
    zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'));
    const records: [number, string[]][] = [[3, ["ID", "Title", "Steps", "Expected Result"]], [7, ["a", "Ready", "Open", "Works"]], [11, ["b", "", "Check", "Shown"]]];
    zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(`<worksheet><sheetData>${records.map(([row, cells]) => `<row r="${row}">${cells.map((cell, column) => `<c r="${String.fromCharCode(65 + column)}${row}" t="inlineStr"><is><t>${cell}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`));
    const source = format === "XLSX"
      ? { format, fileBase64: zip.toBuffer().toString("base64"), sheets: [{ name: "Cases", mapping, overrides: [] }] }
      : { format, sheets: [{ name: "Cases", csvText: "ID,Title,Steps,Expected Result\na,Ready,Open,Works\nb,,Check,Shown", mapping, overrides: [], source: { spreadsheetId: "synthetic-workbook", sheetId: 37 } }] };
    const staged = await caller.prepareMapping({ ...scope, requestId: randomUUID(), sourceLabel: "Synthetic source", source });
    expect(staged).toMatchObject({ readyCount: 1, pendingCount: 1 });
    const input = { ...scope, batchId: staged.id };
    expect((await caller.mappingQueue(input)).rows.map(r => r.originalRowNumber)).toEqual(format === "XLSX" ? [7, 11] : [2, 3]);
    expect(await caller.confirmMapping({ ...input, requestId: randomUUID(), expectedDigest: staged.digest })).toMatchObject({ createdCount: 1, pendingCount: 1 });
    const retained = await caller.mappingQueue(input), row = retained.rows.find(r => r.state === "MAPPING")!;
    expect(row.original.cells).toEqual(["b", "", "Check", "Shown"]);
    const receipt = await caller.resolveMapping({ ...input, requestId: randomUUID(), expectedDigest: retained.digest, rows: [{ id: row.id, candidate: { ...row.candidate!, title: "Repaired from saved source" } }] });
    expect(receipt).toMatchObject({ createdCount: 1, pendingCount: 0 });
    const cases = await prisma.testCase.findMany({ where: { projectId: project.id }, orderBy: { title: "asc" } });
    expect(cases.map(c => c.title)).toEqual(["Ready", "Repaired from saved source"]);
    const sources = await prisma.testCaseSource.findMany({ where: { testCaseId: { in: cases.map(c => c.id) } } });
    expect(new Set(sources.map(s => s.externalTestId)).size).toBe(2);
  });
  it("generates letter-only keys and retains legacy references when a project key changes", async () => {
    const migrations = resolve(import.meta.dirname, "../../../packages/db/prisma/migrations");
    const previous = readFileSync(resolve(migrations, "20261012090000_project_case_key_aliases/migration.sql"), "utf8");
    const oldFunction = previous.match(/CREATE OR REPLACE FUNCTION vaettir_project_case_key\(\)[\s\S]*?END \$\$;/)?.[0];
    if (!oldFunction) throw Error("Original key function not found");
    const current = readFileSync(resolve(migrations, "20261030000000_new_project_keys_letters/migration.sql"), "utf8");
    // Model a pre-upgrade project inside this transaction, restoring the new
    // function before commit. Historical migration files remain untouched.
    const legacy = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(oldFunction);
      const project = await tx.project.create({ data: { organizationId: orgId, name: "Synthetic legacy", slug: "legacy-fixture", caseKey: "old-key9" } });
      await tx.$executeRawUnsafe(current);
      return project;
    });
    const c = await prisma.testCase.create({ data: { projectId: legacy.id, title: "Identity retained", testType: "FUNCTIONAL", createdById: actor.id } });
    const before = await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } });
    const input = { projectId: legacy.id, originalOrganizationId: orgId, expectedClerkActorId: tag, expectedNativeActorId: actor.id,
      requestId: randomUUID(), expectedCaseKey: "old-key9", expectedRevision: 0, caseKey: "abc" };
    await saveProjectCaseKey(prisma, actor.id, input, { clerkActorId: tag });
    expect(await saveProjectCaseKey(prisma, actor.id, input, { clerkActorId: tag })).toMatchObject({ replayed: true });
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } })).caseNumber).toBe(before.caseNumber);
    for (const reference of ["old-key9-01", "abc-01"]) expect(await resolveProjectCaseReference(prisma, actor.id, legacy.id, reference, { clerkActorId: tag })).toMatchObject({ id: c.id, displayId: "abc-01" });
    await expect(saveProjectCaseKey(prisma, actor.id, { ...input, requestId: randomUUID(), expectedCaseKey: "abc", expectedRevision: 1, caseKey: "long-key9" }, { clerkActorId: tag })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const generated = await Promise.all(["12", "--", "a", "a2", "a3", "averylongname"].map(slug => prisma.project.create({ data: { organizationId: orgId, name: "Synthetic generated", slug } })));
    expect(generated.every(p => /^[a-z]{3,5}$/.test(p.caseKey))).toBe(true);
    expect(new Set(generated.map(p => p.caseKey)).size).toBe(generated.length);
    for (const caseKey of ["ab", "ab1", "long-key", "abcdef"]) await expect(prisma.project.create({ data: { organizationId: orgId, name: "Rejected", slug: randomUUID(), caseKey } })).rejects.toThrow();
  });
  it("imports only ready rows once; retains and repairs an original row without uploading again", async () => {
    const f = await fixture();
    expect(f.prepared).toMatchObject({ readyCount: 1, pendingCount: 1 });
    expect(await prisma.testCase.count({ where: { projectId: f.project.id } })).toBe(0);
    const first = await confirmMappingBatch(prisma, actor, f.input);
    expect(first).toMatchObject({ createdCount: 1, pendingCount: 1 });
    expect(await confirmMappingBatch(prisma, actor, f.input)).toEqual(first);
    const queue = await f.read();
    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0]!.original.cells).toEqual(["b", "", "Check", "Shown"]);
    const row = queue.rows[0]!;
    const repaired = { ...f.input, expectedDigest: queue.digest, requestId: randomUUID(), rows: [{ id: row.id, candidate: { ...row.candidate!, title: "Repaired" } }] };
    expect(await confirmMappingBatch(prisma, actor, repaired)).toMatchObject({ createdCount: 1, pendingCount: 0, importedCount: 2 });
    expect((await f.read()).rows).toHaveLength(0);
    const stored = await prisma.importMappingRow.findMany({ where: { batchId: f.prepared.id } });
    expect(stored.every(r => JSON.stringify(r.original) === "{}")).toBe(true);
    expect(await prisma.testCase.count({ where: { projectId: f.project.id } })).toBe(2);
    const cases = await prisma.testCase.findMany({ where: { projectId: f.project.id } });
    // Preserve the existing case-approval policy. Mapping is not bulk review.
    for (const c of cases) {
      const candidate = c.title === "Repaired" ? row.candidate! : f.plan.rows[0]!.candidate;
      expect(c.reviewStatus).toBe(candidate.reviewReasons?.length ? "PENDING_REVIEW" : "APPROVED");
    }
  });
  it.each(["CSV", "XLSX", "SHEETS"] as const)("retains zero-ready and all-ready %s sources", async format => {
    const zero = await fixture("ID,Title,Steps,Expected Result\na,,Open,Works", format);
    expect(await confirmMappingBatch(prisma, actor, zero.input)).toMatchObject({ createdCount: 0, pendingCount: 1 });
    expect((await zero.read()).rows[0]!.originalRowNumber).toBe(2);
    const all = await fixture("ID,Title,Steps,Expected Result\na,Ready,Open,Works", format);
    expect(await confirmMappingBatch(prisma, actor, all.input)).toMatchObject({ createdCount: 1, pendingCount: 0 });
    expect((await all.read()).rows).toHaveLength(0);
  });
  it("keeps ambiguous source IDs unresolved and refuses a partial collision", async () => {
    const f = await fixture("ID,Title,Steps,Expected Result\na,First,Open,Works\na,Second,Check,Shown");
    expect(await confirmMappingBatch(prisma, actor, f.input)).toMatchObject({ createdCount: 0, pendingCount: 2 });
    const queue = await f.read();
    await expect(confirmMappingBatch(prisma, actor, { ...f.input, requestId: randomUUID(), expectedDigest: queue.digest, rows: [{ id: queue.rows[0]!.id, candidate: queue.rows[0]!.candidate! }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await f.read()).rows).toHaveLength(2);
    expect(await confirmMappingBatch(prisma, actor, { ...f.input, requestId: randomUUID(), expectedDigest: queue.digest, rows: queue.rows.map((row, i) => ({ id: row.id, candidate: { ...row.candidate!, externalId: String(i) } })) })).toMatchObject({ createdCount: 2, pendingCount: 0 });
  });
  it("records unchanged imported identities and preserves human edit conflicts", async () => {
    const f = await fixture("ID,Title,Steps,Expected Result\na,Ready,Open,Works");
    await confirmMappingBatch(prisma, actor, f.input);
    const restage = () => stageMappingBatch(prisma, actor, f.scope, { requestId: randomUUID(), sourceLabel: "Synthetic source", sourceDigest: f.plan.digest, rows: f.plan.rows });
    const unchanged = await restage();
    expect(await confirmMappingBatch(prisma, actor, { ...f.input, batchId: unchanged.id, requestId: randomUUID(), expectedDigest: unchanged.digest })).toMatchObject({ createdCount: 0, updatedCount: 0, pendingCount: 0, importedCount: 1 });
    await prisma.testCase.updateMany({ where: { projectId: f.project.id }, data: { title: "Human correction" } });
    const changed = await restage();
    expect(await confirmMappingBatch(prisma, actor, { ...f.input, batchId: changed.id, requestId: randomUUID(), expectedDigest: changed.digest })).toMatchObject({ createdCount: 0, updatedCount: 0, pendingCount: 1 });
    expect((await prisma.testCase.findFirstOrThrow({ where: { projectId: f.project.id } })).title).toBe("Human correction");
    expect((await readMappingQueue(prisma, actor, { ...f.input, batchId: changed.id })).rows[0]!.original.cells[1]).toBe("Ready");
  });
  it("retains result observations with the actual imported case identity", async () => {
    const f = await fixture("ID,Title,Steps,Expected Result,Result\na,Ready,Open,Works,PASS");
    expect(await confirmMappingBatch(prisma, actor, f.input)).toMatchObject({ createdCount: 1, historyCount: 1 });
    const row = (await f.read()).rows[0]!;
    expect(row).toMatchObject({ state: "HISTORY", candidate: null });
    expect(row.original.cells.at(-1)).toBe("PASS"); expect(row.caseId).toBeTruthy();
  });
  it("serializes simultaneous confirmation and exact retries without duplicate cases", async () => {
    const f = await fixture("ID,Title,Steps,Expected Result\na,Ready,Open,Works");
    const results = await Promise.all([confirmMappingBatch(prisma, actor, f.input), confirmMappingBatch(prisma, actor, f.input)]);
    expect(results[0]).toEqual(results[1]);
    expect(await prisma.testCase.count({ where: { projectId: f.project.id } })).toBe(1);
    await expect(confirmMappingBatch(prisma, actor, { ...f.input, requestId: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rolls back both cases and queue settlement if the receipt cannot be stored", async () => {
    const f = await fixture();
    // Deliberate failure scoped to this new synthetic batch in the admitted DB.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION mapping_test_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."batchId"='${f.prepared.id}' THEN RAISE EXCEPTION 'synthetic receipt failure'; END IF; RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER mapping_test_fail_receipt BEFORE INSERT ON "ImportMappingWrite" FOR EACH ROW EXECUTE FUNCTION mapping_test_fail_receipt()');
    try { await expect(confirmMappingBatch(prisma, actor, f.input)).rejects.toThrow(); }
    finally { await prisma.$executeRawUnsafe('DROP TRIGGER mapping_test_fail_receipt ON "ImportMappingWrite"'); await prisma.$executeRawUnsafe('DROP FUNCTION mapping_test_fail_receipt()'); }
    expect(await prisma.testCase.count({ where: { projectId: f.project.id } })).toBe(0);
    expect(await f.read()).toMatchObject({ state: "DRAFT", readyCount: 1, pendingCount: 1, digest: f.prepared.digest });
    expect(await confirmMappingBatch(prisma, actor, f.input)).toMatchObject({ createdCount: 1 });
  });
  it("cancels staging without cases and cannot cancel an already confirmed import", async () => {
    const f = await fixture();
    expect(await cancelMappingBatch(prisma, actor, f.input)).toEqual({ cancelled: true });
    expect(await cancelMappingBatch(prisma, actor, f.input)).toEqual({ cancelled: true });
    expect(await prisma.importMappingRow.count({ where: { batchId: f.prepared.id } })).toBe(0);
    expect(await prisma.testCase.count({ where: { projectId: f.project.id } })).toBe(0);
    const saved = await fixture(); await confirmMappingBatch(prisma, actor, saved.input);
    await expect(cancelMappingBatch(prisma, actor, saved.input)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each(["membership", "suspension", "transfer", "actor"] as const)("does not revive retained mandates after %s change and restore", async change => {
    const f = await fixture();
    if (change === "membership") {
      const where = { organizationId_userId: { organizationId: orgId, userId: actor.id } };
      await prisma.membership.update({ where, data: { role: "VIEWER" } }); await prisma.membership.update({ where, data: { role: "OWNER" } });
    } else if (change === "suspension") {
      await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: new Date() } }); await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: null } });
    } else if (change === "transfer") {
      await prisma.project.update({ where: { id: f.project.id }, data: { organizationId: otherOrgId } }); await prisma.project.update({ where: { id: f.project.id }, data: { organizationId: orgId } });
    } else {
      await prisma.user.update({ where: { id: actor.id }, data: { clerkUserId: tag + "-changed" } }); await prisma.user.update({ where: { id: actor.id }, data: { clerkUserId: tag } });
    }
    await expect(confirmMappingBatch(prisma, actor, f.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await listMappingQueues(prisma, actor, f.scope)).some(b => b.id === f.prepared.id)).toBe(false);
  });
  it("requires independent original actor, native ownership and ingress scope", async () => {
    const f = await fixture();
    await expect(confirmMappingBatch(prisma, { ...actor, clerkActorId: "foreign" }, f.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(confirmMappingBatch(prisma, actor, { ...f.input, originalOrganizationId: otherOrgId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, include: { memberships: { include: { organization: true } } } });
    for (const extra of [{ authenticatedClerkSubject: undefined }, { authenticatedClerkSubject: tag, authenticatedApiKeyId: "synthetic-service" }, { authenticatedClerkSubject: tag, workspaceOrganizationId: otherOrgId }]) {
      const caller = importJobsRouter.createCaller({ prisma, user, workspaceOrganizationId: orgId, ...extra });
      await expect(caller.confirmMapping(f.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
