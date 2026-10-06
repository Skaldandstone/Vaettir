import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { planExecutionReadKey, planExecutionCandidateScopeKey, planExecutionPageOutput } from "../../api/src/services/planExecutionReadSchema";
import {
  admitPlanExecutionRead, inspectPlanExecutionReadWire, planExecutionReviewedReadKey,
  planExecutionCandidateBrowserKey, planExecutionReadWireSignature,
  PlanExecutionReadRenderGuard, PLAN_EXECUTION_BROWSER_BOUNDS,
  type PlanExecutionReadInput, type PlanExecutionReadPageInput,
} from "./plan-execution-reviewed-reader";
const base = { projectId: "p", testPlanId: "plan", originalOrganizationId: "o", expectedClerkActorId: "cl", requestId: "00000000-0000-4000-8000-000000000001" };
const input: PlanExecutionReadPageInput = { ...base, expectedNativeActorId: "n", search: " literal,%_ ", limit: 2 };
function fixture() {
  const context = { configuration: "", environment: "", platform: "", build: "", hardwareRevision: "", firmwareVersion: "", rig: "", batchOrLot: "", calibrationReference: "", protocolReference: "" };
  const rawTemplate = { version: 1, testCaseIds: ["case", "missing", "archived"], configurations: [{ id: "00000000-0000-4000-8000-000000000002", name: " Raw\n name ", context: {} }] };
  const metadata = (id: string, archived = false) => ({ id, title: " Exact\n title ", displayId: "", reviewStatus: "APPROVED", archived });
  return {
    readContext: { requestId: input.requestId, requestedKey: planExecutionReadKey(input, "PAGE"), projection: "PAGE", scope: { projectId: "p", testPlanId: "plan", organizationId: "o", actorClerkUserId: "cl", actorId: "n" } },
    hasFullEditorAccess: false,
    plan: { id: "plan", projectId: "p", name: " Exact\n plan ", status: "ACTIVE" },
    rawTemplate: { sqlNull: false, jsonText: JSON.stringify(rawTemplate) },
    template: { ...rawTemplate, configurations: [{ ...rawTemplate.configurations[0]!, name: "Raw\n name", context }] },
    templateHash: "a".repeat(64), interpretation: "LEGACY_NORMALIZED",
    selected: [{ testCaseId: "case", state: "AVAILABLE", metadata: metadata("case") }, { testCaseId: "missing", state: "MISSING", metadata: null }, { testCaseId: "archived", state: "ARCHIVED", metadata: metadata("archived", true) }],
    candidates: [metadata("a"), metadata("b")], search: input.search, limit: 2,
    candidateScopeKey: planExecutionCandidateScopeKey(input), nextCursor: { scopeKey: planExecutionCandidateScopeKey(input), lastId: "b" },
    limitations: ["Synthetic DTO only; not native hash/SQL/authentication proof."],
  };
}
it("complete actual API wire admits exact raw text independently from legacy interpretation, including missing/archived identities", () => {
  const raw = fixture(); expect(planExecutionPageOutput.safeParse(raw).success).toBe(true);
  const value = admitPlanExecutionRead(raw, input, "PAGE", "cl");
  expect(value?.origin).toEqual({ projectId: "p", testPlanId: "plan", organizationId: "o", clerkActorId: "cl", nativeActorId: "n" });
  expect(value?.data).toEqual(raw); expect(value?.data).not.toBe(raw);
  if (!value || !("rawTemplate" in value.data)) throw Error("Expected PAGE");
  expect(Object.isFrozen(value.data)).toBe(true);
  const saved = value.data as ReturnType<typeof fixture>;
  expect(saved.rawTemplate.jsonText).toBe(raw.rawTemplate.jsonText);
  expect(Object.isFrozen(saved.template.configurations[0]?.context)).toBe(true);
  raw.template.configurations[0]!.context.environment = "changed";
  expect(saved.template.configurations[0]!.context.environment).toBe("");
});
it("ACCESS proves current membership only and may first observe N without inferring any historical request provenance", () => {
  const raw = { readContext: { requestId: base.requestId, requestedKey: planExecutionReadKey(base, "ACCESS"), projection: "ACCESS", scope: { projectId: "p", testPlanId: "plan", organizationId: "o", actorId: "n", actorClerkUserId: "cl" } }, hasFullEditorAccess: false };
  expect(admitPlanExecutionRead(raw, base, "ACCESS", "cl")?.origin.nativeActorId).toBe("n");
  expect(admitPlanExecutionRead({ ...raw, canStart: true }, base, "ACCESS", "cl")).toBeNull();
  expect(admitPlanExecutionRead({ ...raw, template: {} }, base, "ACCESS", "cl")).toBeNull();
});
it("input keys exactly match the frozen server order and preserve optional omission/raw search/cursor", () => {
  expect(planExecutionReviewedReadKey(base, "ACCESS")).toBe(planExecutionReadKey(base, "ACCESS"));
  expect(planExecutionReviewedReadKey(input, "PAGE")).toBe(planExecutionReadKey(input, "PAGE"));
  expect(planExecutionCandidateBrowserKey(input)).toBe(planExecutionCandidateScopeKey(input));
  const cursor = { scopeKey: planExecutionCandidateScopeKey(input), lastId: "a" };
  expect(planExecutionReviewedReadKey({ ...input, cursor }, "PAGE")).toBe(planExecutionReadKey({ ...input, cursor }, "PAGE"));
  expect(planExecutionReviewedReadKey({ ...input, cursor: { lastId: "a", scopeKey: cursor.scopeKey } }, "PAGE")).toBe(planExecutionReadKey({ ...input, cursor }, "PAGE"));
  expect(() => planExecutionReviewedReadKey(base, "PAGE")).toThrow();
  expect(() => planExecutionReviewedReadKey({ ...base, expectedNativeActorId: undefined }, "ACCESS")).toThrow();
});
it.each(["projectId", "testPlanId", "organizationId", "actorId", "actorClerkUserId"])("foreign current native %s echo refuses complete body", key => {
  const raw = fixture(); (raw.readContext.scope as Record<string, string>)[key] = "foreign";
  expect(admitPlanExecutionRead(raw, input, "PAGE", "cl")).toBeNull();
});
it("original frozen scope is never rebound to matching but newly discovered M", () => {
  const raw = fixture(), original = admitPlanExecutionRead(raw, input, "PAGE", "cl")!.origin;
  raw.readContext.scope.actorId = "M";
  expect(admitPlanExecutionRead(raw, { ...input, expectedNativeActorId: "M" }, "PAGE", "cl", original)).toBeNull();
  expect(admitPlanExecutionRead(fixture(), input, "PAGE", "cl", { ...original })).toBeNull();
});
it.each(["requestId", "requestedKey", "projection"])("stale %s read context never grants a current PAGE", key => {
  const raw = fixture(); (raw.readContext as Record<string, unknown>)[key] = "stale";
  expect(admitPlanExecutionRead(raw, input, "PAGE", "cl")).toBeNull();
});
it("unsupported raw roots, unknown context, empty/null fields and wrong declared interpretation refuse, not repair", () => {
  for (const native of [null, [], { version: 999 }, { version: 1, testCaseIds: [], configurations: [], future: null }, { version: 1, testCaseIds: ["case", "missing", "archived"], configurations: [{ id: "00000000-0000-4000-8000-000000000002", name: "Raw\n name", context: { environment: null } }] }]) {
    const raw = fixture(); raw.rawTemplate.jsonText = JSON.stringify(native);
    expect(admitPlanExecutionRead(raw, input, "PAGE", "cl")).toBeNull();
  }
  const raw = fixture(); raw.interpretation = "EXACT_SUPPORTED";
  expect(admitPlanExecutionRead(raw, input, "PAGE", "cl")).toBeNull();
});
it("unconfigured {} stays separate from NULL/empty-template substitution and retains its literal native JSON text", () => {
  const value = { ...fixture(), rawTemplate: { sqlNull: false, jsonText: "{}" }, template: null, selected: [], interpretation: "UNCONFIGURED_EMPTY_OBJECT" };
  expect(admitPlanExecutionRead(value, input, "PAGE", "cl")?.data).toEqual(value);
  expect(admitPlanExecutionRead({ ...value, rawTemplate: { sqlNull: true, jsonText: "{}" } }, input, "PAGE", "cl")).toBeNull();
});
it("all 500 saved IDs and 20 configurations survive exact-boundary admission with no candidate scope substitution", () => {
  const raw = fixture(), ids = Array.from({ length: 500 }, (_, index) => `missing-${index}`), configurations = Array.from({ length: 20 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`, name: `Configuration ${index}`, context: { ...raw.template.configurations[0]!.context } }));
  const value = { ...raw, rawTemplate: { sqlNull: false, jsonText: JSON.stringify({ version: 1, testCaseIds: ids, configurations }) }, template: { version: 1, testCaseIds: ids, configurations }, interpretation: "EXACT_SUPPORTED", selected: ids.map(testCaseId => ({ testCaseId, state: "MISSING", metadata: null })) };
  expect(admitPlanExecutionRead(value, input, "PAGE", "cl")?.data).toEqual(value);
  value.selected.pop(); expect(admitPlanExecutionRead(value, input, "PAGE", "cl")).toBeNull();
});
it.each(["state", "order", "duplicate", "archived", "cursor", "literal search", "limit"])("mismatched %s metadata/pagination refuses the entire supported partition", kind => {
  const raw = fixture();
  if (kind === "state") raw.selected[0]!.state = "MISSING";
  if (kind === "order") raw.candidates.reverse();
  if (kind === "duplicate") raw.candidates[1]!.id = "a";
  if (kind === "archived") raw.candidates[0]!.archived = true;
  if (kind === "cursor") raw.nextCursor.lastId = "lookahead";
  if (kind === "literal search") raw.search = input.search.trim();
  if (kind === "limit") raw.limit = 1;
  expect(admitPlanExecutionRead(raw, input, "PAGE", "cl")).toBeNull();
});
it("strict enum types do not coerce arrays, objects or numbers to labels", () => {
  for (const value of [["ACTIVE"], { toString: () => "ACTIVE" }, 1]) {
    const raw = fixture(); (raw.plan as Record<string, unknown>).status = value;
    expect(admitPlanExecutionRead(raw, input, "PAGE", "cl")).toBeNull();
  }
});
it("getters/toJSON/symbol/non-enumerable hooks and sparse arrays refuse without invocation", () => {
  let invoked = 0;
  const getter = fixture(); Object.defineProperty(getter, "plan", { enumerable: true, get: () => { invoked++; return {}; } });
  const toJSON = { ...fixture(), toJSON: () => { invoked++; return {}; } };
  const symbol = fixture(); Object.defineProperty(symbol.candidates, Symbol("unsafe"), { value: true });
  const extra = fixture(); Object.defineProperty(extra.candidates, "hidden", { value: true });
  const sparse = fixture(); delete sparse.candidates[0];
  for (const raw of [getter, toJSON, symbol, extra, sparse]) expect(admitPlanExecutionRead(raw, input, "PAGE", "cl")).toBeNull();
  expect(invoked).toBe(0);
  const inputGetter = { ...input }; Object.defineProperty(inputGetter, "search", { enumerable: true, get: () => { invoked++; return ""; } });
  expect(() => planExecutionReviewedReadKey(inputGetter, "PAGE")).toThrow(); expect(invoked).toBe(0);
});
it("oversized total/raw/selected/candidate representations fail whole and raw signatures inspect mutations safely", () => {
  const raw = fixture(); raw.rawTemplate.jsonText = "x".repeat(PLAN_EXECUTION_BROWSER_BOUNDS.template + 1);
  expect(admitPlanExecutionRead(raw, input, "PAGE", "cl")).toBeNull();
  const huge = fixture(); huge.limitations = ["x".repeat(PLAN_EXECUTION_BROWSER_BOUNDS.PAGE + 1)];
  expect(planExecutionReadWireSignature(huge, "PAGE")).toBeNull();
  expect(() => inspectPlanExecutionReadWire({ body: "x".repeat(8193) }, 8192)).toThrow();
  const before = planExecutionReadWireSignature(fixture(), "PAGE"); expect(before).not.toBeNull();
  expect(planExecutionReadWireSignature({ ...fixture(), hasFullEditorAccess: true }, "PAGE")).not.toBe(before);
});
it("selected metadata retention has its own conservative 1 MiB cap below the whole PAGE cap", () => {
  const raw = fixture(), ids = Array.from({ length: 110 }, (_, index) => `case-${index}`);
  const template = { ...raw.template, testCaseIds: ids };
  const value = { ...raw, template, rawTemplate: { sqlNull: false, jsonText: JSON.stringify(template) }, interpretation: "EXACT_SUPPORTED", selected: ids.map(testCaseId => ({ testCaseId, state: "AVAILABLE", metadata: { ...raw.candidates[0]!, id: testCaseId, title: "x".repeat(10000) } })) };
  expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeLessThan(PLAN_EXECUTION_BROWSER_BOUNDS.PAGE);
  expect(admitPlanExecutionRead(value, input, "PAGE", "cl")).toBeNull();
});
it("candidate retention has an independent 512 KiB cap with no partial rows or lower fake limit", () => {
  const raw = fixture(), wider = { ...input, limit: 50 }, candidates = Array.from({ length: 50 }, (_, index) => ({ ...raw.candidates[0]!, id: `case-${String(index).padStart(3, "0")}`, title: "😀".repeat(5000) }));
  const value = { ...raw, candidates, limit: 50, nextCursor: null, candidateScopeKey: planExecutionCandidateScopeKey(wider), readContext: { ...raw.readContext, requestedKey: planExecutionReadKey(wider, "PAGE") } };
  expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeLessThan(PLAN_EXECUTION_BROWSER_BOUNDS.PAGE);
  expect(admitPlanExecutionRead(value, wider, "PAGE", "cl")).toBeNull();
});
it("render/cache nonce retirement is monotonic across A-B-A and cannot be cleared by a posted stale commit", () => {
  const guard = new PlanExecutionReadRenderGuard(), frame = {}, view = {}, stamp = guard.observe(frame, view);
  expect(guard.matchesRead(stamp, base.requestId)).toBe(true);
  guard.revokeCache(base.requestId); guard.observe(frame, view);
  expect(guard.matchesRead(stamp, base.requestId)).toBe(false); expect(guard.isBlocked(base.requestId)).toBe(true);
  const changed = guard.observe({}, view); expect(guard.matchesRender(stamp)).toBe(false); expect(guard.matchesRender(changed)).toBe(true);
});
it("browser runtime imports no API schema/server graph; exact wire types are type-only", () => {
  const source = readFileSync(new URL("./plan-execution-reviewed-reader.ts", import.meta.url), "utf8");
  expect(source).toMatch(/^import type /);
  expect(source).not.toMatch(/import\s+(?!type)[^;]+(?:@vaettir\/api|api\/src|node:|@vaettir\/db)/);
  const invalid = { ...input, limit: 51 } as PlanExecutionReadInput;
  expect(() => planExecutionReviewedReadKey(invalid, "PAGE")).toThrow();
});
