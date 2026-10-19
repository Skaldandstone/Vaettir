import { describe, expect, it, vi } from "vitest";
import { ticketDescriptionText, ticketMatchScope, readTicketMatchContext, summarizeTicketMatches } from "./jiraTicketMatchScope.js";
import type { TicketTestCase } from "@vaettir/ai-agent";
import type { ForgeIdentity } from "./forgeInvocation.js";
const ticket = { id: "12", key: "ATM-12", summary: "Restore coins", description: "Restore the purchase without duplicate coins.", labels: ["atwist-mobile-api"] };
const context = { ticket, updatedAt: "2026-10-19T00:00:00Z", unsupportedDescriptionNodes: [] };
const candidate = (id: string, tags: string[] = []): TicketTestCase => ({ id, displayId: id, title: "Restore coins", tags, background: null, given: [], when: ["Restore purchase"], then: ["No duplicate coins"], steps: [], sharedSteps: null, verificationProfile: {} });

describe("Jira matching discovery scope", () => {
  it("prioritizes labels but includes unlabeled and differently labeled tests", () => {
    const scope = ticketMatchScope("project", context, [candidate("a"), candidate("b", ["ATWIST-MOBILE-API"]), candidate("c", ["other"])]);
    expect(scope.batches.flat().map(c => c.id)).toEqual(["b", "a", "c"]);
    expect(scope.labelMatches).toEqual([{ caseId: "b", labels: ["atwist-mobile-api"] }]);
    expect(scope.completeInput).toBe(true);
  });
  it("does not use substring labels as matches", () => {
    expect(ticketMatchScope("p", context, [candidate("a", ["atwist-mobile-api-admin"])]).labelMatches).toEqual([]);
  });
  it("invalidates scope on ticket, labels, project or actual procedure changes", () => {
    const c = candidate("a"), base = ticketMatchScope("p", context, [c]).scopeHash;
    for (const changed of [ticketMatchScope("other", context, [c]), ticketMatchScope("p", { ...context, ticket: { ...ticket, description: "Different behavior" } }, [c]), ticketMatchScope("p", context, [{ ...c, then: ["Changed assertion"] }]), ticketMatchScope("p", context, [{ ...c, tags: ["new"] }])]) expect(changed.scopeHash).not.toBe(base);
    expect(ticketMatchScope("p", context, [candidate("b"), c]).scopeHash).toBe(ticketMatchScope("p", context, [c, candidate("b")]).scopeHash);
  });
  it("retains explicit unprocessed status, never truncating an oversized definition into a no-match", () => {
    const scope = ticketMatchScope("p", context, [{ ...candidate("a"), when: ["x".repeat(65000)] }]);
    expect(scope.completeInput).toBe(false);expect(scope.unprocessed[0]?.caseId).toBe("a");expect(scope.batches).toEqual([]);
  });
  it("rejects duplicate identities", () => {
    expect(() => ticketMatchScope("p", context, [candidate("a"), candidate("a")])).toThrow(/distinct/);
  });
  it("reads ADF text without following links and flags unsupported functionality", () => {
    const result = ticketDescriptionText({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Restore purchase", marks: [{ type: "link", attrs: { href: "https://not-fetched.invalid" } }] }] }, { type: "mediaSingle", content: [{ type: "media", attrs: { id: "not-fetched" } }] }] });
    expect(result.text).toBe("Restore purchase");expect(result.unsupported).toEqual(["media", "mediaSingle"]);
    expect(ticketMatchScope("p", { ...context, unsupportedDescriptionNodes: result.unsupported }, [candidate("a")]).completeInput).toBe(false);
  });
  it("keeps missing description distinct from invented requirements", () => {
    expect(ticketDescriptionText(null)).toEqual({ text: "", unsupported: [] });
  });
  it("reads only exact signed Jira issue fields and rejects changed project identity", async () => {
    const identity = { product: "jira", moduleKey: "vaettir-issue-quality", resourceId: "12", issueKey: "ATM-12", targetId: "10", cloudId: "10000000-0000-4000-8000-000000000001", apiBaseUrl: "https://api.atlassian.com/ex/jira/10000000-0000-4000-8000-000000000001" } as ForgeIdentity;
    const issue = { id: "12", key: "ATM-12", fields: { project: { id: "10" }, summary: "Restore coins", description: null, labels: [], updated: context.updatedAt } };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(issue), { headers: { "Content-Type": "application/json" } }));
    expect((await readTicketMatchContext(identity, "test-only", fetcher)).ticket.key).toBe("ATM-12");
    expect(fetcher.mock.calls[0]?.[0]).toContain("/issue/12?fields=project,summary,description,labels,updated");
    issue.fields.project.id = "99";
    await expect(readTicketMatchContext(identity, "test-only", fetcher)).rejects.toThrow();
    fetcher.mockClear();
    await expect(readTicketMatchContext({ ...identity, apiBaseUrl: "https://other.invalid" }, "test-only", fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("ticket matching completion", () => {
  const completed = (scope: ReturnType<typeof ticketMatchScope>, relevance = "NOT_RELEVANT", confidence = "MEDIUM") => scope.batches.map((batch, batchIndex) => ({
    scopeHash: scope.scopeHash, batchIndex,
    review: { matches: batch.map(c => ({ caseId: c.id, relevance, confidence, reason: "Synthetic review decision.",
      ticketEvidence: ["Restore the purchase without duplicate coins."], caseEvidence: ["No duplicate coins"], missingCoverage: [] })), suggestions: [] },
  }));
  it("requires every batch before inferring no suitable tests", () => {
    const scope = ticketMatchScope("p", context, Array.from({ length: 21 }, (_, i) => candidate(String(i))));
    const results = completed(scope);
    expect(summarizeTicketMatches(scope, results.slice(0, 1))).toMatchObject({ state: "IN_PROGRESS", pendingBatches: 1, reviewedCount: 20 });
    expect(summarizeTicketMatches(scope, results)).toMatchObject({ state: "NO_SUITABLE_TESTS", pendingBatches: 0, reviewedCount: 21 });
  });
  it("keeps uncertainty and incomplete functionality under review", () => {
    const scope = ticketMatchScope("p", context, [candidate("a")]);
    expect(summarizeTicketMatches(scope, completed(scope, "UNCERTAIN", "LOW")).state).toBe("REVIEW_REQUIRED");
    expect(summarizeTicketMatches(scope, completed(scope, "NOT_RELEVANT", "LOW")).state).toBe("REVIEW_REQUIRED");
    for (const changed of [{ ...context, ticket: { ...ticket, description: "" } }, { ...context, unsupportedDescriptionNodes: ["media"] }]) {
      const incomplete = ticketMatchScope("p", changed, [candidate("a")]);
      const result = completed(incomplete);
      result[0]!.review.matches[0]!.ticketEvidence = [];
      expect(summarizeTicketMatches(incomplete, result).state).toBe("REVIEW_REQUIRED");
    }
  });
  it("never confirms a link, even for high-confidence relevant tests", () => {
    const scope = ticketMatchScope("p", context, [candidate("a")]);
    const result = summarizeTicketMatches(scope, completed(scope, "REQUIRED", "HIGH"));
    expect(result.state).toBe("PROPOSED_MATCHES");
    expect(result.proposed).toHaveLength(1);
    expect(result).not.toHaveProperty("confirmed");
  });
  it("rejects stale, duplicate, foreign and invented evidence", () => {
    const scope = ticketMatchScope("p", context, [candidate("a")]);
    const results = completed(scope);
    expect(() => summarizeTicketMatches(scope, [{ ...results[0]!, scopeHash: "old" }])).toThrow(/changed/);
    expect(() => summarizeTicketMatches(scope, [...results, ...results])).toThrow(/duplicate/);
    expect(() => summarizeTicketMatches(scope, [{ ...results[0]!, batchIndex: 99 }])).toThrow(/Invalid/);
    results[0]!.review.matches[0]!.caseEvidence = ["Invented behavior"];
    expect(() => summarizeTicketMatches(scope, results)).toThrow(/evidence/);
  });
  it("reports an empty inventory only when ticket functionality is readable", () => {
    expect(summarizeTicketMatches(ticketMatchScope("p", context, []), []).state).toBe("NO_SUITABLE_TESTS");
    expect(summarizeTicketMatches(ticketMatchScope("p", { ...context, ticket: { ...ticket, description: "" } }, []), []).state).toBe("REVIEW_REQUIRED");
  });
});
