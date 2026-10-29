import { createHash } from "node:crypto";
import { z } from "@vaettir/core/dist/validation.js";
import { TRPCError } from "@trpc/server";
import type { PrismaClient, Prisma } from "@vaettir/db";
import { splitCsvRows } from "./csvFieldMapping.js";
import { lockMappingProject } from "./externalTestMapping.js";
import { recordAudit } from "./auditLog.js";
import { liveCaseDisplayId, parseCaseReference } from "./projectCaseKeys.js";

export const historicalStatusSchema = z.enum(["PASS", "FAIL", "SKIP", "BLOCKED", "FLAKY", "IGNORE"]);
export const historicalReviewSchema = z.object({
  projectId: z.string(), sourceRef: z.string().trim().min(1).max(500), runLabel: z.string().trim().min(1).max(200),
  csvText: z.string().min(1).max(1024 * 1024),
  mapping: z.object({ caseId: z.string().optional(), title: z.string().optional(), result: z.string().min(1), date: z.string().optional(), note: z.string().optional() }).strict(),
  dateFormat: z.enum(["iso", "mdy", "dmy", "excel1900"]).default("iso"), runDate: z.string().default(""),
  statusMap: z.record(z.string().max(1000), historicalStatusSchema).default({}),
  caseSelections: z.record(z.string().regex(/^\d+$/), z.string().max(200)).refine(value => Object.keys(value).length <= 2500, "Choose at most 2,500 row matches.").default({}),
  sourceRowNumbers: z.array(z.number().int().min(1).max(1048576)).max(2501).optional(),
}).strict();
export type HistoricalInput = z.infer<typeof historicalReviewSchema>;
type Db = PrismaClient | Prisma.TransactionClient;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const aliases: Record<string, z.infer<typeof historicalStatusSchema>> = {
  pass: "PASS", passed: "PASS", success: "PASS", fail: "FAIL", failed: "FAIL", failure: "FAIL",
  skip: "SKIP", skipped: "SKIP", blocked: "BLOCKED", flaky: "FLAKY", "not run": "IGNORE", "not executed": "IGNORE", untested: "IGNORE", pending: "IGNORE", "": "IGNORE",
};
export function historicalTable(csv: string) {
  if (Buffer.byteLength(csv, "utf8") > 1024 * 1024) throw new Error("Choose at most 1 MiB of historical worksheet content.");
  let quoted = false;
  for (let i = 0; i < csv.length; i++) if (csv[i] === '"') { if (quoted && csv[i + 1] === '"') i++; else quoted = !quoted; }
  if (quoted) throw new Error("The CSV has an unfinished quoted cell. Export it again before importing.");
  const rows = splitCsvRows(csv, true), headers = (rows.shift() ?? []).map(x => x.trim());
  if (!headers.length || headers.length > 100 || headers.some(x => !x) || new Set(headers).size !== headers.length) throw new Error("Use unique, non-empty column names in the first row (up to 100 columns).");
  if (!rows.length || rows.length > 2500 || rows.some(x => x.length > headers.length)) throw new Error("Choose 1–2,500 result rows with the same columns as the header.");
  return { headers, rows };
}
export function historicalDate(raw: string, format: HistoricalInput["dateFormat"], now = new Date()) {
  let value = raw.trim(), year: number, month: number, day: number;
  if (format === "excel1900") {
    if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Choose an Excel 1900 date number, or change the date format.");
    const serial = Math.floor(Number(value));
    if (serial < 1 || serial === 60 || serial > 2958465) throw new Error("Invalid Excel date; its fictitious 29 February 1900 cannot be imported.");
    value = new Date(Date.UTC(1899, 11, 31) + (serial > 60 ? serial - 1 : serial) * 86400000).toISOString().slice(0, 10);
    format = "iso";
  }
  if (format === "iso") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!m) throw new Error("Use YYYY-MM-DD, choose the source date format, or enter one run date.");
    [, year, month, day] = m.map(Number) as [number, number, number, number];
  } else {
    const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value); if (!m) throw new Error("Use a four-digit year and the selected day/month order.");
    year = Number(m[3]); month = Number(m[format === "mdy" ? 1 : 2]); day = Number(m[format === "mdy" ? 2 : 1]);
  }
  const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (year < 1900 || Number.isNaN(Date.parse(date)) || new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date || date > now.toISOString().slice(0, 10)) throw new Error("Use a real historical date, no later than today.");
  return date;
}
export async function previewHistoricalResults(db: Db, input: HistoricalInput) {
  const table = historicalTable(input.csvText);
  if (input.sourceRowNumbers && (input.sourceRowNumbers.length !== table.rows.length + 1 || input.sourceRowNumbers.some((value, index, all) => index > 0 && value <= all[index - 1]!))) throw new Error("Worksheet row references changed. Choose the original worksheet again.");
  if (!input.mapping.caseId && !input.mapping.title) throw new Error("Choose a case ID or case title column.");
  for (const column of Object.values(input.mapping).filter(Boolean)) if (!table.headers.includes(column!)) throw new Error("A selected column is missing. Review the column mappings again.");
  const project = await db.project.findUniqueOrThrow({ where: { id: input.projectId }, select: { organizationId: true, caseKey: true } });
  const references = [...table.rows.map(row => input.mapping.caseId ? row[table.headers.indexOf(input.mapping.caseId)] ?? "" : ""), ...Object.values(input.caseSelections)];
  const prefixCandidates = [...new Set(references.map(value => parseCaseReference(value)?.caseKey).filter((value): value is string => Boolean(value)))];
  const keyAliases = await db.projectCaseKeyAlias.findMany({ where: { projectId: input.projectId, organizationId: project.organizationId, caseKey: { in: prefixCandidates } }, select: { caseKey: true }, take: prefixCandidates.length + 1 });
  const prefixes = new Set([project.caseKey, ...keyAliases.map(alias => alias.caseKey)]);
  const cases = await db.testCase.findMany({ where: { projectId: input.projectId }, select: { id: true, displayId: true, caseNumber: true, title: true, source: { select: { externalTestId: true } } }, orderBy: { id: "asc" }, take: 10001 });
  if (cases.length > 10000) throw new Error("This project exceeds the historical matching limit. Split the project scope before using this importer.");
  const byId = new Map(cases.map(c => [c.id, c]));
  type Case = typeof cases[number];
  const byNumber = new Map(cases.map(c => [c.caseNumber, c]));
  const storedLabels = new Map<string, Case[]>(), sourceKeys = new Map<string, Case[]>(), titles = new Map<string, Case[]>();
  const add = (map: Map<string, Case[]>, key: string, value: Case) => { if (!key) return; const entries = map.get(key); if (entries) entries.push(value); else map.set(key, [value]); };
  for (const c of cases) {
    add(storedLabels, c.displayId, c); add(titles, c.title.trim().toLowerCase(), c);
    const external = c.source?.externalTestId;
    if (external) {
      add(sourceKeys, external, c);
      // Index source namespaces once, instead of scanning 10,000 cases again
      // for every uploaded row. Matching still never crosses this project.
      for (let colon = external.indexOf(":"); colon >= 0; colon = external.indexOf(":", colon + 1)) add(sourceKeys, external.slice(colon + 1), c);
    }
  }
  const cell = (row: string[], column?: string) => column ? (row[table.headers.indexOf(column)] ?? "").trim() : "";
  const rows = table.rows.map((row, index) => {
    const rowNumber = index + 2, rawStatus = cell(row, input.mapping.result), key = cell(row, input.mapping.caseId), title = cell(row, input.mapping.title);
    const normalizedStatus = rawStatus.toLowerCase().replace(/\s+/g, " ");
    const status = Object.hasOwn(input.statusMap, rawStatus) ? input.statusMap[rawStatus] : Object.hasOwn(aliases, normalizedStatus) ? aliases[normalizedStatus] : undefined;
    const issues: string[] = [];
    if (!status) issues.push("Choose how to handle this result value.");
    const id = key.replace(/^VAE-/, "");
    const reference = parseCaseReference(key);
    const candidatesById = key ? [...new Map([byId.get(id), ...(storedLabels.get(key) ?? []), reference && prefixes.has(reference.caseKey) ? byNumber.get(reference.caseNumber) : undefined, ...(sourceKeys.get(key) ?? [])].filter((c): c is Case => Boolean(c)).map(c => [c.id, c])).values()] : [];
    const candidates = key ? candidatesById : titles.get(title.toLowerCase()) ?? [];
    const selected = input.caseSelections[String(rowNumber)];
    const selectedReference = selected ? parseCaseReference(selected) : null;
    const match = selected ? byId.get(selected.replace(/^VAE-/, "")) ?? (selectedReference && prefixes.has(selectedReference.caseKey) ? byNumber.get(selectedReference.caseNumber) : undefined) : candidates.length === 1 ? candidates[0] : undefined;
    let date = "";
    if (status !== "IGNORE") {
      if (!match) issues.push(selected ? "That case is not in this project." : candidates.length ? "Several cases match. Choose the exact Vaettir case ID." : "No case matches. Import the case definitions first, or choose its Vaettir case ID.");
      try { date = historicalDate(input.mapping.date ? cell(row, input.mapping.date) : input.runDate, input.mapping.date ? input.dateFormat : "iso"); }
      catch (error) { issues.push(error instanceof Error ? error.message : "Choose the historical run date."); }
    }
    const note = cell(row, input.mapping.note);
    if (note.length > 10000) issues.push("The result note exceeds 10,000 characters.");
    return { rowNumber, originalWorksheetRow: input.sourceRowNumbers?.[index + 1] ?? null, key, title, rawStatus, status: status ?? null, date, caseId: match?.id ?? null, caseTitle: match?.title ?? null, note,
      candidates: candidates.slice(0, 10).map(c => ({ id: c.id, displayId: liveCaseDisplayId(project.caseKey, c.caseNumber), title: c.title })), issues };
  });
  const seen = new Map<string, typeof rows[number]>();
  for (const row of rows) if (row.status && row.status !== "IGNORE" && row.caseId && row.date) {
    const identity = row.date + ":" + row.caseId;
    const prior = seen.get(identity);
    if (prior) { row.issues.push("This case appears more than once on this run date."); prior.issues.push("This case appears more than once on this run date."); }
    seen.set(identity, row);
  }
  const selected = rows.filter(row => row.status && row.status !== "IGNORE");
  const dates = [...new Set(selected.map(row => row.date).filter(Boolean))].sort();
  if (dates.length > 100) throw new Error("Choose at most 100 historical run dates per import.");
  const canonical = selected.map(row => ({ caseId: row.caseId, status: row.status, date: row.date, note: row.note })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { rows, matchedCount: selected.filter(row => row.caseId && !row.issues.length).length, ignoredCount: rows.filter(row => row.status === "IGNORE").length,
    blockedCount: rows.filter(row => row.issues.length).length, runCount: dates.length,
    fingerprint: digest({ projectId: input.projectId, sourceRef: input.sourceRef, runLabel: input.runLabel, mapping: input.mapping, dateFormat: input.dateFormat, runDate: input.runDate, statusMap: input.statusMap, caseSelections: input.caseSelections, sourceSnapshot: digest(input.csvText), sourceRowNumbers: input.sourceRowNumbers ?? null, canonical }) };
}
export async function commitHistoricalResults(prisma: PrismaClient, input: HistoricalInput & { expectedDigest: string }, authority: { actorId: string; organizationId: string }) {
  return prisma.$transaction(async tx => {
    await lockMappingProject(tx, input.projectId);
    // Recheck the real writer after waiting for the project lock. Hold these
    // rows through commit so a concurrent revocation/suspension cannot race it.
    const allowed = await tx.$queryRaw<Array<{ id: string }>>`SELECT m."id" FROM "Membership" m JOIN "Organization" o ON o."id" = m."organizationId" JOIN "Project" p ON p."organizationId" = o."id" WHERE p."id" = ${input.projectId} AND o."id" = ${authority.organizationId} AND m."userId" = ${authority.actorId} AND m."role" IN ('EDITOR', 'ADMIN', 'OWNER') AND o."suspendedAt" IS NULL FOR SHARE OF m, o`;
    if (!allowed.length) throw new TRPCError({ code: "FORBIDDEN", message: "Project editing access changed. Nothing was imported." });
    const preview = await previewHistoricalResults(tx, input);
    if (preview.blockedCount || !preview.matchedCount) throw new TRPCError({ code: "BAD_REQUEST", message: "Resolve every review issue and select at least one recorded result before importing." });
    if (preview.fingerprint !== input.expectedDigest) throw new TRPCError({ code: "CONFLICT", message: "The source or case matches changed. Nothing was imported. Refresh and review the matches." });
    const dates = [...new Set(preview.rows.filter(r => r.status !== "IGNORE").map(r => r.date))].sort();
    const groups = [];
    for (const date of dates) {
      const rows = preview.rows.filter(r => r.status !== "IGNORE" && r.date === date);
      const key = "historical:" + digest({ source: input.sourceRef, label: input.runLabel, column: input.mapping.result, date });
      const dataDigest = digest(rows.map(r => ({ caseId: r.caseId, status: r.status, note: r.note })).sort((a, b) => a.caseId!.localeCompare(b.caseId!)));
      const prior = await tx.testRun.findFirst({ where: { projectId: input.projectId, ciProvider: "historical-import", commitSha: key }, select: { id: true, executionContext: true } });
      if (prior && (prior.executionContext as { historicalImport?: { fingerprint?: string } } | null)?.historicalImport?.fingerprint !== dataDigest)
        throw new TRPCError({ code: "CONFLICT", message: "This source, result column and run date already have different imported results. Existing history was not changed. Review the source or use a distinct run label for a different execution." });
      groups.push({ date, rows, key, dataDigest, prior });
    }
    const runs: { id: string; date: string; results: number; replayed: boolean }[] = [];
    for (const group of groups) {
      if (group.prior) { runs.push({ id: group.prior.id, date: group.date, results: group.rows.length, replayed: true }); continue; }
      const historicalImport = { version: 1, sourceRef: input.sourceRef, runLabel: input.runLabel, resultColumn: input.mapping.result, originalDate: group.date, datePrecision: "day", timeUnknown: true, fingerprint: group.dataDigest, recordedBy: authority.actorId };
      const run = await tx.testRun.create({ data: { projectId: input.projectId, ciProvider: "historical-import", commitSha: group.key, branch: "historical observation",
        // The schema requires a timestamp. Noon UTC is a date-only display anchor,
        // explicitly marked above; duration/steps and original finish time are unknown.
        startedAt: new Date(group.date + "T12:00:00Z"), finishedAt: null,
        status: group.rows.some(r => r.status === "FAIL") ? "FAILED" : group.rows.some(r => ["BLOCKED", "SKIP", "FLAKY"].includes(r.status!)) ? "PARTIAL" : "PASSED",
        startedById: authority.actorId, executionContext: { historicalImport },
        results: { create: group.rows.map(r => ({ testCaseId: r.caseId!, externalTestId: "VAE-" + r.caseId, status: r.status as "PASS" | "FAIL" | "BLOCKED" | "SKIP" | "FLAKY", note: r.note || null, durationMs: null,
          observations: { historicalImport: { importTableRow: r.rowNumber, originalWorksheetRow: r.originalWorksheetRow, sourceCaseReference: r.key || r.title, recordedResultValue: r.rawStatus, originalDate: group.date, datePrecision: "day", procedureNotReverified: true } } })) },
      }, select: { id: true } });
      await recordAudit(tx as unknown as PrismaClient, { organizationId: authority.organizationId, projectId: input.projectId, actorId: authority.actorId, entityType: "TestRun", entityId: run.id, action: "CREATE", summary: `Imported ${group.rows.length} historical observations for ${group.date}`, metadata: { historical: true, date: group.date, resultCount: group.rows.length } });
      runs.push({ id: run.id, date: group.date, results: group.rows.length, replayed: false });
    }
    return { runs, importedCount: runs.filter(r => !r.replayed).reduce((n, r) => n + r.results, 0), replayedCount: runs.filter(r => r.replayed).reduce((n, r) => n + r.results, 0) };
  }, { maxWait: 10000, timeout: 30000 });
}
