import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { createReportDeck } from "./report-deck";
import type { FrozenReportPayload } from "./frozen-report";
const require = createRequire(
  new URL("../../api/package.json", import.meta.url),
);
const Zip = require("adm-zip") as new (bytes: Buffer) => {
  getEntries(): Array<{ entryName: string }>;
  readAsText(name: string): string;
  readFile(name: string): Buffer;
};
const report = {
  state: "approved",
  projectName: "Synthetic reporting",
  title: "Investor quality update",
  asOf: "2026-10-28T21:00:00Z",
  windowStart: "2026-09-28T21:00:00Z",
  definition: {
    audience: "stakeholders",
    windowDays: 30,
    sections: ["inventory", "execution", "automation"],
    summary: "Reviewed launch readiness",
    risks: "Two recorded failures need review.",
    nextActions: "Resolve failures before the release decision.",
  },
  inventory: {
    active: 12,
    riskAssessed: 0,
    flaky: 0,
    priority: [
      { key: "HIGH", count: 4 },
      { key: "MEDIUM", count: 8 },
    ],
    automation: [
      { key: "AUTOMATED", count: 7 },
      { key: "MANUAL", count: 5 },
    ],
  },
  execution: {
    runs: 3,
    results: 10,
    outcomes: [
      { key: "PASS", count: 8 },
      { key: "FAIL", count: 2 },
    ],
    distinctCases: 9,
    highPriorityCases: 4,
    highPriorityExecuted: 3,
  },
  traceability: {
    requirements: 0,
    coveredRequirements: 0,
    casesWithLinks: 0,
    links: 0,
  },
  defects: null,
  cohort: [{ id: "PRIVATE_COHORT_ID", status: "AUTOMATED" }],
  automationChange: null,
  limitations: ["Synthetic fixture only. No hosted acceptance."],
} as FrozenReportPayload;

describe("editable report deck", () => {
  it("preserves every narrative, metric, date and chart workbook under presentation changes", async () => {
    const variants = [
      undefined,
      { version: 1, palette: "evergreen", font: "aptos" } as const,
      { version: 1, palette: "navy", font: "georgia" } as const,
    ];
    const packages = await Promise.all(
      variants.map(
        async (preset) =>
          new Zip(
            (await createReportDeck(report, preset).write({
              outputType: "nodebuffer",
            })) as Buffer,
          ),
      ),
    );
    const content = (zip: InstanceType<typeof Zip>) =>
      zip
        .getEntries()
        .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
        .map((e) =>
          [...zip.readAsText(e.entryName).matchAll(/<a:t>(.*?)<\/a:t>/gs)].map(
            (m) => m[1],
          ),
        );
    expect(content(packages[1]!)).toEqual(content(packages[0]!));
    expect(content(packages[2]!)).toEqual(content(packages[0]!));
    // PptxGenJS assigns chart IDs across deck instances; compare ordered contents.
    const names = (zip: InstanceType<typeof Zip>, pattern: RegExp) =>
      zip
        .getEntries()
        .map((e) => e.entryName)
        .filter((n) => pattern.test(n))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const chartContents = (zip: InstanceType<typeof Zip>) =>
      names(zip, /^ppt\/charts\/chart\d+\.xml$/).map((n) => zip.readAsText(n));
    expect(chartContents(packages[2]!)).toEqual(chartContents(packages[0]!));
    const workbooks = (zip: InstanceType<typeof Zip>) =>
      names(zip, /^ppt\/embeddings\/.*\.xlsx$/).map((n) => {
        const book = new Zip(zip.readFile(n));
        return book
          .getEntries()
          .filter(
            (e) => /^xl\//.test(e.entryName) && e.entryName.endsWith(".xml"),
          )
          .map((e) => book.readAsText(e.entryName));
      });
    expect(workbooks(packages[2]!)).toEqual(workbooks(packages[0]!));
    const slides = packages[2]!
      .getEntries()
      .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
      .map((e) => packages[2]!.readAsText(e.entryName))
      .join("");
    expect(slides).toContain("2459A6");
    expect(slides).toContain(report.asOf);
    expect(slides).toContain(report.definition.risks);
    expect(slides).toContain(report.limitations[0]);
    expect(packages[2]!.readAsText("ppt/theme/theme1.xml")).toContain(
      "Georgia",
    );
  });
  it("contains native editable text, charts, tables and embedded data, with no raster slides", async () => {
    const bytes = await createReportDeck(report).write({
      outputType: "nodebuffer",
      compression: true,
    });
    const zip = new Zip(bytes as Buffer);
    const names = zip.getEntries().map((entry) => entry.entryName);
    expect(
      names.filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name)).length,
    ).toBeGreaterThan(0);
    expect(
      names.filter((name) => /^ppt\/embeddings\/.*\.xlsx$/.test(name)).length,
    ).toBeGreaterThan(0);
    expect(names.filter((name) => /^ppt\/media\/.+/.test(name))).toHaveLength(
      0,
    );
    const xml = names
      .filter((name) => name.endsWith(".xml"))
      .map((name) => zip.readAsText(name))
      .join("\n");
    expect(xml).toContain("Reviewed launch readiness");
    expect(xml).toContain("<a:tbl>");
    expect(xml).toContain("<c:externalData");
    expect(xml).not.toContain("PRIVATE_COHORT_ID");
    expect(xml).not.toContain("https://");
    const charts = names
      .filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name))
      .map((name) => zip.readAsText(name))
      .join("\n");
    expect(charts).toContain("<c:v>8</c:v>");
    expect(charts).toContain("<c:v>2</c:v>");
  });
  it("refuses unapproved output and preserves a long Unicode narrative across slides", async () => {
    expect(() => createReportDeck({ ...report, state: "preview" })).toThrow(
      /Approve/,
    );
    const summary = "Quality 🧪 evidence ".repeat(70);
    const bytes = await createReportDeck({
      ...report,
      definition: { ...report.definition, summary },
    }).write({ outputType: "nodebuffer" });
    const zip = new Zip(bytes as Buffer);
    const slides = zip
      .getEntries()
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
      .map((entry) => zip.readAsText(entry.entryName))
      .join("");
    expect((slides.match(/🧪/g) ?? []).length).toBe(70);
  });
});

export { report as syntheticReportDeckFixture };
