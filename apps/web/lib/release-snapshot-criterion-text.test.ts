import { describe, expect, it } from "vitest";
import { buildHtmlSnapshot, buildMarkdownSnapshot, type SnapshotData } from "./snapshotExport";

// Actual export functions with synthetic data. No browser, wiki or Markdown
// parser is installed here: structural row/entity checks are format proof only.
function fixture(descriptions: string[] = ["Check first\n  Then verify response"]): SnapshotData {
  return {
    release: { id: "release", name: "Regular release", status: "PLANNED", targetDate: null, projectId: "project" },
    projectName: "Synthetic project",
    readiness: {
      score: 25, label: "AT_RISK",
      criteria: { met: 1, atRisk: 0, notMet: 0, pending: descriptions.length - 1, total: descriptions.length },
      riskFlags: { critical: 0, high: 1, medium: 0, low: 0, openTotal: 1 },
    },
    testPlans: [{ id: "plan", name: "Quality plan", status: "DRAFT", testPlanType: { id: "type", name: "Regression" },
      acceptanceCriteria: descriptions.map((description, index) => ({ id: `criterion-${index}`, description, status: index === 0 ? "MET" : "PENDING", autoComputed: index === 0 })),
    }],
    riskFlags: [{ id: "risk", severity: "HIGH", source: "MANUAL", description: "Investigate", relatedFilePath: null, relatedPrUrl: null, createdAt: "2026-10-06T00:00:00.000Z", resolvedAt: null }],
    trend: [
      { releaseId: "previous", name: "Previous", createdAt: "2026-10-01T00:00:00.000Z", runCount: 2, passRate: 0.5, flakyCount: 1, coveragePct: 40, meanTimeToGreenMs: 3_600_000 },
      { releaseId: "current", name: "Current", createdAt: "2026-10-06T00:00:00.000Z", runCount: 0, passRate: null, flakyCount: 0, coveragePct: null, meanTimeToGreenMs: null },
    ],
    generatedAt: "2026-10-06T12:00:00.000Z",
  };
}
function escapedHtml(raw: string): string {
  return raw.replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!);
}
function criteriaSpans(html: string): string[] {
  return [...html.matchAll(/<span class="criterion-text">([\s\S]*?)<\/span>/g)].map(match => match[1]!);
}
function cellsFromSection(markdown: string, heading: string): string[][] {
  const section = markdown.split(`## ${heading}\n`)[1]!.split("\n## ")[0]!;
  return section.split("\n").filter(line => line.startsWith("| ") && !line.startsWith("| Status |") &&
    !line.startsWith("| Severity |") && !line.startsWith("| Release |"))
    .map(row => row.slice(1, -1).split("|").map(cell => cell.trim()));
}
// Independent decoding of the documented safe-inline representation, not a
// Markdown renderer. GFM trims cell edges and may collapse indentation.
function decodedCell(cell: string): string {
  return cell.replace(/<br>/g, "\n").replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));
}
function normalizedCell(raw: string): string {
  return raw.replace(/\r\n|\r/g, "\n").trim();
}
function deeplyFreeze(value: unknown): void {
  if (!value || typeof value !== "object") return;
  Object.freeze(value);
  for (const child of Object.values(value)) deeplyFreeze(child);
}
const adversarial = '</summary></details><script>synthetic()</script> &lt;literal&gt;\n<img src="x" onerror="synthetic">\r\n| injected | row |\r[link](https://synthetic.invalid) ![image](x) **bold** _em_ `code` \\path \\| λ🎮';

describe("actual release snapshot criterion text exports, synthetic format proof only", () => {
  it.each([" \tFirst line\n  Second line \n", "CRLF\r\nnext\rbare", "λ🎮\n次の手順", "", " \n \t", "Long ".repeat(400) + "\nLAST", adversarial])(
    "HTML keeps exact escaped criterion %j inside the whitespace-preserving span",
    raw => {
      const data = fixture([raw]), before = structuredClone(data);
      deeplyFreeze(data);
      const html = buildHtmlSnapshot(data);
      expect(criteriaSpans(html)).toEqual([escapedHtml(raw)]);
      expect(html).toContain(".criterion-text { white-space: pre-wrap; overflow-wrap: anywhere; }");
      expect(html).not.toMatch(/line-clamp|text-overflow|overflow:\s*hidden/);
      expect(html).toContain('<span class="badge badge-ok">MET</span>');
      expect(html).toContain('<span class="muted">(live)</span>');
      expect(data).toEqual(before);
    },
  );
  it("HTML retains duplicate and empty criteria, exact order, badges, counters and existing charts", () => {
    const descriptions = ["\n  duplicate \t", "\n  duplicate \t", "", " \n "];
    const data = fixture(descriptions), html = buildHtmlSnapshot(data);
    expect(criteriaSpans(html)).toEqual(descriptions.map(escapedHtml));
    expect(html.match(/class="criterion-text"/g)).toHaveLength(4);
    expect(html.match(/<span class="badge badge-warn">PENDING<\/span>/g)).toHaveLength(3);
    expect(html).toContain("1/4 criteria met · 1 open risk flag(s)");
    expect(html).toContain('<div class="score">25</div>');
    expect(html).toContain("Pass rate");
    expect(html).toContain("Coverage %");
    expect(html).toContain("Flaky results");
    expect(html).toContain("Previous: 50%");
    expect(html).toContain('data-severity="HIGH" data-resolved="0"');
    expect(html.match(/<script>/g)).toHaveLength(1); // Existing trusted sorting script only.
  });
  it("literal HTML cannot escape criterion spans or create injected elements", () => {
    const html = buildHtmlSnapshot(fixture([adversarial]));
    expect(criteriaSpans(html)).toEqual([escapedHtml(adversarial)]);
    expect(html).not.toContain('<img src="x"');
    expect(html).not.toContain("<script>synthetic()");
    expect(html).toContain("&amp;lt;literal&amp;gt;");
  });
  it.each([adversarial, "left|right", "backslash\\|pipe\\\\", "first\r\nsecond\nthird\rfinal", "λ🎮 次の手順", "", "same", "Long ".repeat(400)])(
    "Markdown encodes literal %j as one row without active table/HTML/format syntax",
    raw => {
      const data = fixture([raw, raw]), before = structuredClone(data);
      deeplyFreeze(data);
      const markdown = buildMarkdownSnapshot(data), rows = cellsFromSection(markdown, "Acceptance criteria");
      expect(rows).toHaveLength(2);
      expect(rows.map(row => row.length)).toEqual([2, 2]);
      expect(rows.map(row => decodedCell(row[1]!))).toEqual([normalizedCell(raw), normalizedCell(raw)]);
      expect(rows[0]![0]).toBe("MET (live)");
      expect(rows[1]![0]).toBe("PENDING");
      for (const row of rows) {
        const literal = row[1]!.replace(/<br>/g, "").replace(/&#\d+;/g, "");
        expect(literal).not.toMatch(/[\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e\r\n]/);
      }
      expect(data).toEqual(before);
    },
  );
  it("all user-text table cells and plan summaries use the same safe literal representation", () => {
    const data = fixture([adversarial]);
    data.release.name = adversarial;
    data.release.status = adversarial;
    data.projectName = adversarial;
    data.testPlans[0]!.name = adversarial;
    data.testPlans[0]!.status = adversarial;
    data.testPlans[0]!.testPlanType.name = adversarial;
    data.testPlans[0]!.acceptanceCriteria[0]!.status = adversarial;
    for (const key of ["severity", "source", "description", "relatedFilePath"] as const) data.riskFlags[0]![key] = adversarial;
    data.trend[0]!.name = adversarial;
    const before = structuredClone(data);
    deeplyFreeze(data);
    const markdown = buildMarkdownSnapshot(data), criteria = cellsFromSection(markdown, "Acceptance criteria"),
      risks = cellsFromSection(markdown, "Risk flags"), trends = cellsFromSection(markdown, "Trend (last 2 releases)");
    expect(criteria).toHaveLength(1);
    expect(criteria[0]).toHaveLength(2);
    expect(decodedCell(criteria[0]![0]!)).toBe(`${normalizedCell(adversarial)} (live)`);
    expect(risks).toHaveLength(1);
    expect(risks[0]).toHaveLength(5);
    expect(risks[0]!.slice(0, 4).map(decodedCell)).toEqual(Array(4).fill(normalizedCell(adversarial)));
    expect(risks[0]![4]).toBe("Open");
    expect(trends).toHaveLength(2);
    expect(trends.every(row => row.length === 6)).toBe(true);
    expect(decodedCell(trends[0]![0]!)).toBe(normalizedCell(adversarial));
    expect(trends[0]!.slice(1)).toEqual(["2", "50%", "40%", "1", "1.0h"]);
    expect(trends[1]!.slice(1)).toEqual(["0", "—", "—", "0", "—"]);
    expect(markdown.match(/<details open><summary><strong>/g)).toHaveLength(1);
    expect(markdown.match(/<\/summary>/g)).toHaveLength(1);
    expect(markdown.match(/<\/details>/g)).toHaveLength(1);
    expect(markdown).not.toMatch(/<script|<img|\[link\]\(|\*\*bold\*\*/);
    expect(markdown).toContain("&#38;lt&#59;literal&#38;gt&#59;");
    expect(data).toEqual(before);
  });
  it("punctuation entities round-trip literally without recursive entity interpretation", () => {
    const punctuation = Array.from({ length: 94 }, (_, index) => String.fromCharCode(33 + index)).join("");
    const markdown = buildMarkdownSnapshot(fixture([punctuation])), row = cellsFromSection(markdown, "Acceptance criteria")[0]!;
    expect(decodedCell(row[1]!)).toBe(punctuation);
    expect(row[1]).toContain("&#92;");
    expect(row[1]).toContain("&#124;");
    expect(row[1]).toContain("&#96;");
    expect(row[1]).toContain("&#38;");
    expect(markdown).toContain("Markdown renderers may trim cell-edge whitespace or normalize indentation; this is not a lossless backup.");
  });
  it("empty plans and nullable risk fields retain existing placeholders rather than invented content", () => {
    const data = fixture([]);
    data.readiness.criteria = { met: 0, atRisk: 0, notMet: 0, pending: 0, total: 0 };
    const html = buildHtmlSnapshot(data), markdown = buildMarkdownSnapshot(data);
    expect(criteriaSpans(html)).toEqual([]);
    expect(html).toContain("No acceptance criteria.");
    expect(markdown).toContain("_No acceptance criteria._");
    expect(cellsFromSection(markdown, "Acceptance criteria")).toEqual([]);
    expect(cellsFromSection(markdown, "Risk flags")[0]).toEqual(["HIGH", "MANUAL", "Investigate", "", "Open"]);
    data.testPlans = [];
    data.riskFlags = [];
    expect(buildHtmlSnapshot(data)).toContain("No test plans on this release.");
    expect(buildHtmlSnapshot(data)).toContain("No risk flags.");
    expect(buildMarkdownSnapshot(data)).toContain("_No risk flags._");
  });
});
