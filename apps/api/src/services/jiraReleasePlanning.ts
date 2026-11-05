import type { z } from "@vaettir/core/dist/validation.js";
import type { jiraIssueSchema } from "./jiraIssueIntake.js";

type Issue = z.infer<typeof jiraIssueSchema>;
type Candidate = { id: string; title: string; tags: string[] };
type AdfNode = { type?: unknown; text?: unknown; content?: unknown };
const criteriaHeading = /^acceptance (?:criteria|checks)\s*[:–-]?\s*(.*)$/i;
const normalize = (value: string) => value.trim().toLowerCase();
const genericTitleWords = new Set("a an and are as at be by can case check checks for from has have in is it of on or should test tests that the then this to verify when with bug defect fix issue expected behavior".split(" "));

export function jiraPlanningTitleTerms(title: string) {
  return [...new Set(normalize(title).split(/[^\p{L}\p{N}]+/u)
    .filter(term => term.length >= 3 && !genericTitleWords.has(term)))].slice(0, 24);
}

function nodes(value: unknown): AdfNode[] {
  return Array.isArray(value)
    ? value.filter((node): node is AdfNode => !!node && typeof node === "object").slice(0, 100)
    : [];
}

export function releaseAcceptanceChecks(description: unknown) {
  if (!description || typeof description !== "object") return [];
  const checks: string[] = [];
  let inCriteria = false;
  const add = (text: string) => {
    const check = text.trim().slice(0, 600);
    if (check && checks.length < 8) checks.push(check);
  };
  const line = (node: AdfNode) => nodes(node.content)
    .map(child => child.type === "text" && typeof child.text === "string" ? child.text : "")
    .join("").trim();
  for (const block of nodes((description as AdfNode).content)) {
    if (checks.length >= 8) break;
    if (block.type === "heading" || block.type === "paragraph") {
      const text = line(block);
      const heading = text.match(criteriaHeading);
      if (heading) {
        inCriteria = true;
        add(heading[1] ?? "");
      } else if (block.type === "heading" || /^[\w /&-]{1,50}:$/.test(text)) {
        inCriteria = false;
      } else if (inCriteria) {
        add(text);
      }
    } else if (inCriteria && (block.type === "bulletList" || block.type === "orderedList")) {
      for (const item of nodes(block.content)) {
        add(nodes(item.content).filter(child => child.type === "paragraph").map(line).join(" "));
      }
    }
  }
  return [...new Set(checks)];
}

export function jiraPlanningTags(issue: Issue) {
  return [...new Set([issue.key, ...(issue.labels ?? []), ...(issue.components ?? [])].map(normalize).filter(Boolean))];
}

export function suggestJiraReleaseChecks(issue: Issue, description: unknown, candidates: Candidate[]) {
  const tags = new Set(jiraPlanningTags(issue));
  const titleTerms = new Set(jiraPlanningTitleTerms(issue.title));
  const cases = candidates.flatMap(candidate => {
    const matches = [...new Set(candidate.tags.map(normalize).filter(tag => tags.has(tag)))];
    const candidateTerms = jiraPlanningTitleTerms(candidate.title);
    const overlap = candidateTerms.filter(term => titleTerms.has(term));
    const titleMatch = overlap.length >= Math.max(2, Math.ceil(Math.min(titleTerms.size, candidateTerms.length) * .75));
    return matches.length || titleMatch ? [{
      id: candidate.id, title: candidate.title,
      matches: matches.length ? matches : [`Title: ${overlap.join(", ")}`],
      tagCount: matches.length, titleCount: overlap.length,
    }] : [];
  }).sort((left, right) => Number(right.matches.includes(normalize(issue.key))) -
    Number(left.matches.includes(normalize(issue.key))) || right.tagCount - left.tagCount || right.titleCount - left.titleCount)
    .map(({ id, title, matches }) => ({ id, title, matches }));
  const checks = releaseAcceptanceChecks(description);
  const bug = /^(bug|defect)$/i.test(issue.issueType ?? "");
  return {
    key: issue.key, url: issue.url, title: issue.title, issueType: issue.issueType,
    labels: issue.labels ?? [], components: issue.components ?? [],
    checks: checks.length ? checks : [
      `${bug ? "Reproduce and verify the fix for" : "Verify the expected behavior for"} ${issue.title}. Confirm the expected result in Jira.`,
    ],
    fromJira: checks.length > 0,
    cases: cases.slice(0, 5),
    moreCases: cases.length > 5,
  };
}
