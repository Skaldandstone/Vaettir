import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { planExecutionAccessInput, planExecutionPageInput, planExecutionPageOutput, planExecutionReadKey, planExecutionCandidateScopeKey, PLAN_EXECUTION_READ_BOUNDS } from "./planExecutionReadSchema.js";

const base = { projectId: "p", testPlanId: "plan", originalOrganizationId: "o", expectedClerkActorId: "cl", requestId: "00000000-0000-4000-8000-000000000001" };
const page = { ...base, expectedNativeActorId: "native", search: "  literal,%_  ", limit: 2 };
function result() {
  return {
    readContext: { requestId: base.requestId, requestedKey: planExecutionReadKey(page, "PAGE"), projection: "PAGE", scope: { projectId: "p", testPlanId: "plan", organizationId: "o", actorId: "native", actorClerkUserId: "cl" } },
    hasFullEditorAccess: false,
    plan: { id: "plan", projectId: "p", name: " Exact\n name ", status: "ACTIVE" },
    rawTemplate: { sqlNull: false, jsonText: "{}" }, template: null,
    templateHash: "a".repeat(64), interpretation: "UNCONFIGURED_EMPTY_OBJECT",
    selected: [], candidates: [], search: page.search, limit: page.limit,
    candidateScopeKey: planExecutionCandidateScopeKey(page), nextCursor: null, limitations: [],
  };
}
describe("plan execution read wire only; no native SQL", () => {
  it("bootstrap omission stays absent; page requires native actor and explicit limit/search", () => {
    expect(planExecutionAccessInput.parse(base)).toEqual(base);
    expect(Object.hasOwn(planExecutionAccessInput.parse(base), "expectedNativeActorId")).toBe(false);
    expect(planExecutionPageInput.safeParse(base).success).toBe(false);
    const parsed = planExecutionPageInput.parse(page);
    expect(parsed.search).toBe(page.search);
    expect(Object.hasOwn(parsed, "cursor")).toBe(false);
  });
  it.each([0, 51, 1.5, NaN])("candidate limit %s refuses without hidden default", limit => {
    expect(planExecutionPageInput.safeParse({ ...page, limit }).success).toBe(false);
  });
  it.each(["", "x".repeat(201), "bad\0id", "bad\ud800id"])("unsupported identity %j refuses", id => {
    expect(planExecutionAccessInput.safeParse({ ...base, testPlanId: id }).success).toBe(false);
  });
  it("exact read key binds native owner, nonce, raw search, limit and complete cursor", () => {
    const key = planExecutionReadKey(page, "PAGE");
    for (const change of [{ requestId: "00000000-0000-4000-8000-000000000002" }, { expectedNativeActorId: "other" }, { search: page.search.trim() }, { limit: 1 }, { originalOrganizationId: "other" }, { cursor: { scopeKey: planExecutionCandidateScopeKey(page), lastId: "case" } }]) expect(planExecutionReadKey({ ...page, ...change }, "PAGE")).not.toBe(key);
    expect(planExecutionCandidateScopeKey({ ...page, requestId: "00000000-0000-4000-8000-000000000002" })).toBe(planExecutionCandidateScopeKey(page));
  });
  it("wire preserves exact raw JSON text and whitespace/empty labels without trim/default transforms", () => {
    const value = result();
    value.rawTemplate.jsonText = "{}";
    expect(planExecutionPageOutput.parse(value)).toEqual(value);
    expect(PLAN_EXECUTION_READ_BOUNDS.cases).toBe(500);
    expect(PLAN_EXECUTION_READ_BOUNDS.configurations).toBe(20);
  });
  it("complete selected order/state must reconcile with interpreted scope; absent entries cannot drop", () => {
    const value = { ...result(), template: { version: 1, testCaseIds: ["missing"], configurations: [] }, interpretation: "EXACT_SUPPORTED", selected: [{ testCaseId: "missing", state: "MISSING", metadata: null }] };
    expect(planExecutionPageOutput.safeParse(value).success).toBe(true);
    for (const selected of [[], [{ testCaseId: "other", state: "MISSING", metadata: null }], [{ testCaseId: "missing", state: "AVAILABLE", metadata: null }]]) expect(planExecutionPageOutput.safeParse({ ...value, selected }).success).toBe(false);
  });
  it("candidate limit, uniqueness, archived state and next cursor must remain exact", () => {
    const item = { id: "c", title: "", displayId: "", reviewStatus: "PENDING_REVIEW", archived: false };
    const value = { ...result(), candidates: [item], nextCursor: { scopeKey: planExecutionCandidateScopeKey(page), lastId: "c" } };
    expect(planExecutionPageOutput.safeParse(value).success).toBe(true);
    for (const change of [{ candidates: [item, item] }, { candidates: [{ ...item, archived: true }] }, { nextCursor: { scopeKey: "wrong", lastId: "c" } }, { nextCursor: { scopeKey: value.candidateScopeKey, lastId: "other" } }]) expect(planExecutionPageOutput.safeParse({ ...value, ...change }).success).toBe(false);
  });
  it("unknown output keys and wrong native plan/project scopes refuse", () => {
    expect(planExecutionPageOutput.safeParse({ ...result(), repaired: true }).success).toBe(false);
    expect(planExecutionPageOutput.safeParse({ ...result(), plan: { ...result().plan, projectId: "foreign" } }).success).toBe(false);
  });
  it("wire schema remains browser-pure and does not alter/import the legacy service graph", () => {
    const source = readFileSync(new URL("./planExecutionReadSchema.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["'](?:node:|@vaettir\/db|\.\/testPlanExecution|\.\/qualityExperienceProfile)/);
    expect(source).not.toContain(".trim()");
    expect(source).not.toContain(".default(");
  });
  it("cursor read key is explicit and independent of caller object property order", () => {
    expect(planExecutionReadKey({ ...page, cursor: { scopeKey: "scope", lastId: "last" } }, "PAGE")).toBe(planExecutionReadKey({ ...page, cursor: { lastId: "last", scopeKey: "scope" } }, "PAGE"));
    for (const search of ["bad\0query", "bad\ud800query"]) expect(planExecutionPageInput.safeParse({ ...page, search }).success).toBe(false);
  });
});
