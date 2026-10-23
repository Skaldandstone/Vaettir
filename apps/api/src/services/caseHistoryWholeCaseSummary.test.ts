// SOURCE ONLY, NOT RUN. Mock metadata scenarios are not PostgreSQL/query acceptance.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Prisma } from "@vaettir/db";
import { readCaseHistoryWholeCaseSummaries } from "./caseHistoryWholeCaseSummary.js";
const input = { projectId: "project", testCaseId: "case", originalOrganizationId: "original-org", runIds: ["run"] };
const scope = [{ projectValid: true, caseValid: true, runCount: 1 }];
const gate = [{ population: 1, heads: 1, bytes: 100n, invalid: false }];
const row = { runId: "run", revisionCount: 2, correctionCount: 1, lastRecorderName: "Recorded human name", lastRecordedAt: new Date("2026-10-04T10:00:00Z"), lastStatus: "FAIL" };
function fixture(responses: unknown[]) {
  const calls: unknown[] = [];
  return { calls, tx: { $queryRaw: (...args: unknown[]) => { calls.push(args); if (!responses.length) throw Error("Unexpected body projection"); return Promise.resolve(responses.shift()); } } as unknown as Prisma.TransactionClient };
}
describe("bounded read-only immutable whole-case history summaries (NOT RUN)", () => {
  it("source preflight refuses JSON null/unsupported or later legacy markers before correction counting", () => {
    const source = readFileSync(new URL("./caseHistoryWholeCaseSummary.ts",import.meta.url),"utf8");
    for (const literal of ['SELECT id,"ciProvider","manualTestCaseIds" FROM "TestRun"',
      'jsonb_typeof(q."legacyPrior") IS DISTINCT FROM \'object\'',
      'q."revisionNumber"<>1 OR q."previousRevisionId" IS NOT NULL',
      'UNVERSIONED_OBSERVATION_CAPTURED_NOW',
      'q."legacyPrior"->\'originalRecorder\' IS DISTINCT FROM \'null\'::jsonb',
      'q."legacyPrior"->\'originalRecordedAt\' IS DISTINCT FROM \'null\'::jsonb',
      'jsonb_typeof(q."legacyPrior"->\'captured\') IS DISTINCT FROM \'object\'',
      'q."legacyPrior"->\'captured\'->>\'resultId\' IS DISTINCT FROM q."testResultId"',
      "ARRAY['resultId','status','note','observations']"]) expect(source).toContain(literal);
    expect(source).not.toContain('SELECT * FROM "TestRun"');
    expect(source.indexOf('jsonb_typeof(q."legacyPrior")')).toBeLessThan(source.indexOf('AS "correctionCount"'));
  });
  it("projects captured tip name/time/status and real correction count without note/payload", async () => {
    const f = fixture([scope,gate,[row]]), result = await readCaseHistoryWholeCaseSummaries(f.tx,input);
    expect(result.run).toEqual({ revisionCount:2,correctionCount:1,lastRecorderName:row.lastRecorderName,lastRecordedAt:row.lastRecordedAt,lastStatus:"FAIL" });
    expect(Object.keys(result.run!)).toHaveLength(5); expect(f.calls).toHaveLength(3);
  });
  it("legacy absent head is absent summary, not reconstructed recorder or zero revisions", async () => {
    const f = fixture([scope,[{ ...gate[0],heads:0 }]]);
    expect(Object.keys(await readCaseHistoryWholeCaseSummaries(f.tx,input))).toEqual([]); expect(f.calls).toHaveLength(2);
  });
  it("foreign/dangling/malformed metadata refuses before projection rather than return zeros", async () => {
    for (const invalidGate of [{...gate[0],invalid:true},{...gate[0],bytes:65537n},{...gate[0],population:2}]) {
      const f=fixture([scope,[invalidGate]]); await expect(readCaseHistoryWholeCaseSummaries(f.tx,input)).rejects.toMatchObject({code:"PRECONDITION_FAILED"}); expect(f.calls).toHaveLength(2);
    }
  });
  it("original organization or selected run scope mismatch refuses before history labels", async () => {
    const f=fixture([[{...scope[0],projectValid:false}]]); await expect(readCaseHistoryWholeCaseSummaries(f.tx,input)).rejects.toThrow("original project"); expect(f.calls).toHaveLength(1);
  });
  it("more than25 selected runs/duplicate IDs/UTF16 oversized identity refuses before SQL", async () => {
    for (const runIds of [Array.from({length:26},(_,n)=>`run${n}`),["run","run"],["x".repeat(201)]]) {
      const f=fixture([]); await expect(readCaseHistoryWholeCaseSummaries(f.tx,{...input,runIds})).rejects.toMatchObject({code:"PRECONDITION_FAILED"}); expect(f.calls).toHaveLength(0);
    }
  });
  it("unsupported projected status/date/UTF16 name/count and population drift refuse wholly", async () => {
    for (const changed of [{lastStatus:"FLAKY"},{lastRecordedAt:new Date(NaN)},{lastRecorderName:"😀".repeat(101)},{correctionCount:3}]) {
      const f=fixture([scope,gate,[{...row,...changed}]]); await expect(readCaseHistoryWholeCaseSummaries(f.tx,input)).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    }
    const missing=fixture([scope,gate,[]]); await expect(readCaseHistoryWholeCaseSummaries(missing.tx,input)).rejects.toThrow("population changed");
  });
  it("first observed legacy correction can count once while initial observation need not", async () => {
    for (const correctionCount of [0,1]) {
      const f=fixture([scope,gate,[{...row,revisionCount:1,correctionCount}]]);
      expect((await readCaseHistoryWholeCaseSummaries(f.tx,input)).run?.correctionCount).toBe(correctionCount);
    }
  });
  it("empty selected run cohort still verifies original project/case before no summaries", async () => {
    const f=fixture([[{...scope[0],runCount:0}]]); expect(Object.keys(await readCaseHistoryWholeCaseSummaries(f.tx,{...input,runIds:[]}))).toEqual([]); expect(f.calls).toHaveLength(1);
  });
});
