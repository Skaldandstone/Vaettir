import { createHash } from "node:crypto";
import { z } from "zod";
import { ticketTestInputSchema, ticketTestCaseSchema, validateTicketTestReview, type TicketTestCase } from "@vaettir/ai-agent";
import { productJson, type ForgeIdentity } from "./forgeInvocation.js";

/** Text nodes only. Never render ADF HTML, dereference links/mentions/media or
 * treat comments as functionality. Unsupported nodes remain explicit gaps. */
export function ticketDescriptionText(adf: unknown) {
  if (adf === null || adf === undefined) return { text: "", unsupported: [] as string[] };
  const root = z.object({ type: z.literal("doc"), version: z.literal(1), content: z.array(z.unknown()) }).parse(adf);
  const allowed = new Set(["doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "hardBreak", "rule", "table", "tableRow", "tableHeader", "tableCell"]);
  const blocks = new Set(["paragraph", "heading", "listItem", "blockquote", "codeBlock", "tableRow", "tableCell", "tableHeader"]);
  const unsupported = new Set<string>();
  let nodes = 0;
  const visit = (raw: unknown, depth: number): string => {
    if (++nodes > 20000 || depth > 40) throw new Error("Ticket description is too complex to read completely.");
    const node = z.object({ type: z.string().min(1).max(80), text: z.string().optional(), content: z.array(z.unknown()).optional() }).parse(raw);
    if (!allowed.has(node.type)) unsupported.add(node.type);
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak" || node.type === "rule") return "\n";
    return (node.content ?? []).map(child => visit(child, depth + 1)).join("") + (blocks.has(node.type) ? "\n" : "");
  };
  const text = visit(root, 0).trim();
  if (text.length > 100000) throw new Error("Ticket description exceeds complete-text review capacity.");
  return { text, unsupported: [...unsupported].sort() };
}

/** Must be called only after current FIT/viewer AND project discovery approval.
 * Provider identity is bound to the signed ticket; callers supply no URLs/IDs. */
export async function readTicketMatchContext(identity: ForgeIdentity, userToken: string, transport: typeof fetch = fetch) {
  if (identity.product !== "jira" || identity.moduleKey !== "vaettir-issue-quality" || !identity.resourceId || !identity.issueKey ||
      !/^\d{1,40}$/.test(identity.resourceId) || !/^\d{1,40}$/.test(identity.targetId) ||
      !/^[a-f0-9-]{36}$/.test(identity.cloudId) || identity.apiBaseUrl !== `https://api.atlassian.com/ex/jira/${identity.cloudId}` ||
      !userToken || userToken.length > 16000 || /[\r\n]/.test(userToken)) throw new Error("Verified current ticket context required.");
  const issue = z.object({
    id: z.literal(identity.resourceId), key: z.literal(identity.issueKey),
    fields: z.object({ project: z.object({ id: z.literal(identity.targetId) }), summary: z.string().min(1).max(1000),
      description: z.unknown(), labels: z.array(z.string().min(1).max(255)).max(100), updated: z.string().min(1).max(64) }),
  }).parse(await productJson(`${identity.apiBaseUrl}/rest/api/3/issue/${identity.resourceId}?fields=project,summary,description,labels,updated`, userToken, transport));
  const description = ticketDescriptionText(issue.fields.description);
  const ticket = ticketTestInputSchema.parse({ id: issue.id, key: issue.key, summary: issue.fields.summary, description: description.text, labels: issue.fields.labels });
  return { ticket, updatedAt: issue.fields.updated, unsupportedDescriptionNodes: description.unsupported };
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalized = (value: string) => value.normalize("NFKC").trim().toLowerCase();
/** Labels prioritize database candidates but never exclude the rest of the
 * authorized repository or prove coverage. Full-inventory completion is needed
 * before displaying 'no suitable tests'; failures are not negative matches. */
export function ticketMatchScope(projectId: string, context: Awaited<ReturnType<typeof readTicketMatchContext>>, candidates: TicketTestCase[]) {
  if (!projectId || candidates.length > 15000 || new Set(candidates.map(c => c.id)).size !== candidates.length) throw new Error("A complete distinct project inventory is required.");
  const cases = candidates.map(c => ticketTestCaseSchema.parse(c));
  if (JSON.stringify(cases).length > 16000000) throw new Error("Complete repository exceeds matching capacity. No absence of tests was inferred.");
  const ticket = ticketTestInputSchema.parse(context.ticket);
  const labels = new Set(ticket.labels.map(normalized));
  const overlap = (c: TicketTestCase) => [...new Set(c.tags.map(normalized))].filter(t => labels.has(t));
  const ordered = [...cases].sort((a, b) => overlap(b).length - overlap(a).length || a.id.localeCompare(b.id));
  const capacity = Math.min(60000, 179000 - JSON.stringify(ticket).length);
  const batches: TicketTestCase[][] = [];
  const unprocessed: Array<{ caseId: string; reason: string }> = [];
  let batch: TicketTestCase[] = [], size = 0;
  for (const c of ordered) {
    const length = JSON.stringify(c).length + 1;
    if (length > capacity) { unprocessed.push({ caseId: c.id, reason: "Complete test definition exceeds batch capacity; review required." }); continue; }
    if (batch.length && (batch.length >= 20 || size + length > capacity)) { batches.push(batch); batch = []; size = 0; }
    batch.push(c); size += length;
  }
  if (batch.length) batches.push(batch);
  return {
    ticket,
    scopeHash: digest({ protocol: "ticket-tests/v1", projectId, ticket, updatedAt: context.updatedAt, unsupported: context.unsupportedDescriptionNodes, cases: [...cases].sort((a, b) => a.id.localeCompare(b.id)) }),
    batches, unprocessed, candidateCount: cases.length,
    labelMatches: ordered.filter(c => overlap(c).length).map(c => ({ caseId: c.id, labels: overlap(c) })),
    completeInput: !!ticket.description.trim() && !unprocessed.length && !context.unsupportedDescriptionNodes.length,
  };
}

/** Reduce only validated proposals for the caller's freshly authorized scope.
 * Missing/failed batches are pending, never negative results. The caller still
 * owns current access checks, funding, job persistence and human confirmation. */
export function summarizeTicketMatches(
  scope: ReturnType<typeof ticketMatchScope>,
  completed: Array<{ scopeHash: string; batchIndex: number; review: unknown }>,
) {
  const seen = new Set<number>();
  const matches = completed.flatMap(item => {
    if (item.scopeHash !== scope.scopeHash) throw new Error("Ticket or test definitions changed. Review the current scope.");
    const batch = scope.batches[item.batchIndex];
    if (!Number.isInteger(item.batchIndex) || !batch || seen.has(item.batchIndex)) throw new Error("Invalid or duplicate matching batch.");
    seen.add(item.batchIndex);
    return validateTicketTestReview(scope.ticket, batch, "MATCH", item.review).matches;
  });
  const proposed = matches.filter(m => m.relevance === "REQUIRED" || m.relevance === "RELATED");
  const uncertain = matches.filter(m => m.relevance === "UNCERTAIN");
  const pendingBatches = scope.batches.length - seen.size;
  // A label search that returns zero hits is not a completed semantic review.
  // Low-confidence proposals remain visible but cannot establish an absence.
  const needsReview = !scope.completeInput || uncertain.length > 0 || matches.some(m => m.confidence === "LOW");
  return {
    proposed, uncertain, reviewedCount: matches.length,
    candidateCount: scope.candidateCount, pendingBatches,
    unprocessed: scope.unprocessed,
    state: pendingBatches > 0 ? "IN_PROGRESS" as const
      : needsReview ? "REVIEW_REQUIRED" as const
      : proposed.length ? "PROPOSED_MATCHES" as const
      : "NO_SUITABLE_TESTS" as const,
    // This reducer never produces confirmed links or execution/coverage claims.
  };
}
