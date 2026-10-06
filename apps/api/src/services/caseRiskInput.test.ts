import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCaseRiskInput, type CaseRiskInputSource } from "./caseRiskInput.js";

// Frozen pre-extraction cb4b56f riskInput semantics, independently retaining
// the old fixture's ordered JSON construction rather than new helper output.
function legacyHash(tc: CaseRiskInputSource) {
  const data = { title: tc.title, given: tc.given, when: tc.when, then: tc.then, testType: tc.testType, sourceFilePath: tc.source?.filePath ?? null };
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
const base = { title: "Premium account opens updated billing history", given: ["a premium member has signed in"], when: ["they open billing history"], then: ["the renewal appears"], testType: "FUNCTIONAL" };
describe("exact legacy risk-input foundation without provider or database", () => {
  it("matches the historical priority-review fixture's exact serialized bytes and pinned paid hash", () => {
    const result = buildCaseRiskInput(base);
    expect(JSON.stringify(result.data)).toBe('{"title":"Premium account opens updated billing history","given":["a premium member has signed in"],"when":["they open billing history"],"then":["the renewal appears"],"testType":"FUNCTIONAL","sourceFilePath":null}');
    expect(result.hash).toBe("70b74d1992412c7d58f5156d928f4d59b421122de761d82209fcefba8831a09f");
    expect(result.hash).toBe(legacyHash(base));
    expect(Object.keys(result.data)).toEqual(["title", "given", "when", "then", "testType", "sourceFilePath"]);
  });
  it("preserves exact whitespace, empty strings, Unicode, duplicate entries and array ordering", () => {
    const source = { ...base, title: " \r\nλ🎮 literal, title ", given: ["", " ", "same", "same", "line\nnext"], when: ["B", "A"], then: [" Expected\tresult "] };
    const before = structuredClone(source), result = buildCaseRiskInput(source);
    expect(result.hash).toBe(legacyHash(source)); expect(source).toEqual(before);
    expect(result.data.given).toBe(source.given); expect(result.data.when).toBe(source.when); expect(result.data.then).toBe(source.then);
    expect(buildCaseRiskInput({ ...source, when: [...source.when].reverse() }).hash).not.toBe(result.hash);
  });
  it("keeps absent/NULL source equivalence, while empty path and literal whitespace paths remain distinct", () => {
    const omitted = buildCaseRiskInput(base);
    expect(buildCaseRiskInput({ ...base, source: undefined }).hash).toBe(omitted.hash);
    expect(buildCaseRiskInput({ ...base, source: null }).hash).toBe(omitted.hash);
    const empty = buildCaseRiskInput({ ...base, source: { filePath: "" } });
    expect(empty.data.sourceFilePath).toBe(""); expect(empty.hash).not.toBe(omitted.hash);
    const rawPath = " original/path,with spaces\nfixture.ts ";
    const source = { ...base, source: { filePath: rawPath } };
    expect(buildCaseRiskInput(source).data.sourceFilePath).toBe(rawPath); expect(buildCaseRiskInput(source).hash).toBe(legacyHash(source));
  });
  it("does not add background, steps, prerequisites, source code, risk overrides or unrelated source metadata", () => {
    const selected = { ...base, source: { filePath: "fixture.ts" } };
    const expanded = { ...selected, background: "Not historically sent", steps: [{ action: "Not historically sent", expectedActionOrData: "Not historically sent" }], prerequisiteIds: ["not-sent"], verificationProfile: { safety: "not-sent" }, riskRationale: "Human override", source: { ...selected.source, code: "MUST_NOT_FORWARD", framework: "OTHER", lastSyncedCommitSha: "not-sent" } };
    expect(buildCaseRiskInput(expanded)).toEqual(buildCaseRiskInput(selected));
    expect(JSON.stringify(buildCaseRiskInput(expanded).data)).not.toContain("MUST_NOT_FORWARD");
  });
  it("preserves legacy JSON undefined/null distinctions without introducing coercive validation", () => {
    const undefinedTitle = { ...base, title: undefined } as unknown as CaseRiskInputSource;
    const nullTitle = { ...base, title: null } as unknown as CaseRiskInputSource;
    expect(buildCaseRiskInput(undefinedTitle).hash).toBe(legacyHash(undefinedTitle));
    expect(buildCaseRiskInput(nullTitle).hash).toBe(legacyHash(nullTitle));
    expect(buildCaseRiskInput(undefinedTitle).hash).not.toBe(buildCaseRiskInput(nullTitle).hash);
    const runtimeMissingPath = { ...base, source: {} } as CaseRiskInputSource;
    expect(buildCaseRiskInput(runtimeMissingPath).data.sourceFilePath).toBeNull();
  });
  it("retains exact 64,000 UTF-8 byte admission and identical safe refusal without clipping", () => {
    const empty = { ...base, title: "" }, overhead = Buffer.byteLength(JSON.stringify(buildCaseRiskInput(empty).data), "utf8");
    for (const multibyte of [false, true]) {
      const remaining = 64000 - overhead, title = multibyte ? "λ".repeat(Math.floor(remaining / 2)) + "x".repeat(remaining % 2) : "x".repeat(remaining);
      const exact = { ...base, title }; const result = buildCaseRiskInput(exact);
      expect(Buffer.byteLength(JSON.stringify(result.data), "utf8")).toBe(64000);
      expect(result.hash).toBe(legacyHash(exact));
      try { buildCaseRiskInput({ ...exact, title: `${title}x` }); expect.fail("Oversized input must refuse"); } catch (error) {
        expect(error).toMatchObject({ code: "BAD_REQUEST", message: "This case exceeds the risk review size limit. Split it into focused cases before reviewing." });
      }
    }
  });
  it("keeps all existing stale/hash/preview/worker/queue callsites on the same builder", () => {
    const router = readFileSync(new URL("../routers/testCases.ts", import.meta.url), "utf8"), queue = readFileSync(new URL("../routers/caseAnalysisQueue.ts", import.meta.url), "utf8"), worker = readFileSync(new URL("../jobs/caseAnalysisQueueWorker.ts", import.meta.url), "utf8");
    expect(router).toContain('import { buildCaseRiskInput as riskInput } from "../services/caseRiskInput.js";');
    expect(router).not.toContain("function riskInput(");
    expect(router.match(/\briskInput\(/g)).toHaveLength(5);
    expect(queue).toContain("prepareRiskReviewQueue(ctx.prisma");
    expect(queue).not.toContain("risk.riskPreview({ id: caseId })");
    const preparation = readFileSync(new URL("./caseRiskReviewPreparation.ts", import.meta.url), "utf8");
    expect(preparation).toContain("buildCaseRiskInput(tc).hash");
    expect(worker).toContain("testCasesRouter.createCaller(ctx).assessRisk({");
    const originalPriorityFixture = readFileSync(new URL("../test-case-priority.integration.test.ts", import.meta.url), "utf8");
    expect(originalPriorityFixture).toContain("sourceFilePath: current.source?.filePath ?? null })).digest(\"hex\")");
  });
});
