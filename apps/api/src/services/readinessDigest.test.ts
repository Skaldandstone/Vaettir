import { describe, it, expect } from "vitest";
import { buildDigestBlocks, buildDigestFallbackText } from "./readinessDigest.js";
import type { OrgOverview } from "./orgReadiness.js";

const readyOverview: OrgOverview = {
  projects: [
    {
      projectId: "p1",
      projectName: "Kall",
      release: {
        id: "r1",
        name: "v2.4",
        status: "IN_TESTING",
        readiness: {
          score: 92,
          label: "READY",
          criteria: { met: 5, atRisk: 0, notMet: 0, pending: 0, total: 5 },
          riskFlags: { critical: 0, high: 0, medium: 0, low: 0, openTotal: 0 },
        },
      },
    },
  ],
  summary: { ready: 1, atRisk: 0, blocked: 0, noActiveRelease: 0 },
};

const emptyOverview: OrgOverview = {
  projects: [{ projectId: "p1", projectName: "Kall", release: null }],
  summary: { ready: 0, atRisk: 0, blocked: 0, noActiveRelease: 1 },
};

describe("buildDigestFallbackText", () => {
  it("summarizes the org-wide counts in one line", () => {
    expect(buildDigestFallbackText("Skald and Stone", readyOverview)).toBe(
      "Skald and Stone release readiness: 1 ready, 0 at risk, 0 blocked, 0 with no active release.",
    );
  });
});

describe("buildDigestBlocks", () => {
  it("includes a header, a summary context block, and one section per project with an active release", () => {
    const blocks = buildDigestBlocks("Skald and Stone", readyOverview) as Array<{ type: string; text?: { text: string } }>;
    expect(blocks[0]).toMatchObject({ type: "header" });
    expect(blocks.some((b) => b.type === "context")).toBe(true);
    const projectSection = blocks.find((b) => b.type === "section" && b.text?.text.includes("Kall"));
    expect(projectSection?.text?.text).toContain("v2.4");
    expect(projectSection?.text?.text).toContain("92/100");
  });

  it("shows a plain 'nothing in flight' message when no project has an active release", () => {
    const blocks = buildDigestBlocks("Skald and Stone", emptyOverview) as Array<{ type: string; text?: { text: string } }>;
    const emptyMessage = blocks.find((b) => b.type === "section");
    expect(emptyMessage?.text?.text).toMatch(/no projects have a release in flight/i);
  });

  it("uses the correct emoji per readiness label", () => {
    const blockedOverview: OrgOverview = {
      projects: [
        {
          projectId: "p1",
          projectName: "Kall",
          release: {
            id: "r1",
            name: "v2.4",
            status: "IN_TESTING",
            readiness: {
              score: 20,
              label: "BLOCKED",
              criteria: { met: 0, atRisk: 0, notMet: 3, pending: 0, total: 3 },
              riskFlags: { critical: 1, high: 0, medium: 0, low: 0, openTotal: 1 },
            },
          },
        },
      ],
      summary: { ready: 0, atRisk: 0, blocked: 1, noActiveRelease: 0 },
    };
    const blocks = buildDigestBlocks("Skald and Stone", blockedOverview) as Array<{ type: string; text?: { text: string } }>;
    const projectSection = blocks.find((b) => b.type === "section" && b.text?.text.includes("Kall"));
    expect(projectSection?.text?.text).toContain("🔴");
  });
});
