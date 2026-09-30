import { describe, expect, it } from "vitest";
import {
  populationEvidenceKey,
  populationDraftSchema,
  previewProjectPopulation,
  sourceRevisionSchema,
  type PopulationEvidence,
  type PopulationScan,
} from "./projectPopulation.js";

const item = (
  overrides: Partial<PopulationEvidence> = {},
): PopulationEvidence => ({
  projectId: "project-a",
  sourceId: "gitlab-host/repo-a",
  scopeId: "release-1/docs",
  externalId: "README.md",
  provider: "gitlab",
  kind: "document",
  basis: "documented",
  revision: { kind: "git", value: "a".repeat(40) },
  locator: "README.md#requirements",
  contentHash: "b".repeat(64),
  title: "Playback",
  ...overrides,
});
const scan = (
  evidence: PopulationEvidence[],
  overrides: Partial<PopulationScan> = {},
): PopulationScan => ({
  projectId: "project-a",
  sourceId: "gitlab-host/repo-a",
  scopeId: "release-1/docs",
  status: "complete",
  evidence,
  ...overrides,
});
const preview = (baseline: PopulationEvidence[], scans: PopulationScan[]) =>
  previewProjectPopulation({
    projectId: "project-a",
    baseline: { version: 3, evidence: baseline },
    scans,
  });

describe("project population reconciliation", () => {
  it("retains optional context and accepts older drafts without changing their shape", () => {
    const legacy = {
      schemaVersion: 1,
      step: "context",
      sections: ["context"],
      objective: "Validate system",
      systemScope: "BOTH",
      providers: [],
    };
    expect(populationDraftSchema.parse(legacy)).toEqual(legacy);
    const contextDetails = {
      hardware: "HIL bench",
      software: "Firmware",
      compliance: "Review applicability",
    };
    expect(
      populationDraftSchema.parse({ ...legacy, contextDetails }).contextDetails,
    ).toEqual(contextDetails);
    expect(
      populationDraftSchema.parse({
        ...legacy,
        contextDetails: { ...contextDetails, regulatory: "Investigate FAA applicability" },
      }).contextDetails,
    ).toEqual({ ...contextDetails, regulatory: "Investigate FAA applicability" });
    expect(
      populationDraftSchema.safeParse({
        ...legacy,
        contextDetails: { ...contextDetails, hardware: "x".repeat(1001) },
      }).success,
    ).toBe(false);
    expect(
      populationDraftSchema.safeParse({
        ...legacy,
        contextDetails: { ...contextDetails, credentials: "no" },
      }).success,
    ).toBe(false);
  });
  it("identical reruns propose no additions or updates", () => {
    const result = preview([item()], [scan([item()])]);
    expect(result.baselineVersion).toBe(3);
    expect(result.changes.map((c) => c.status)).toEqual(["unchanged"]);
    expect(result.staleRecordIds).toEqual([]);
  });

  it("enriches an existing project from another repository without matching paths globally", () => {
    const extra = item({ sourceId: "github-host/repo-b", provider: "github" });
    const result = preview(
      [item()],
      [scan([extra], { sourceId: extra.sourceId })],
    );
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].status).toBe("new");
    expect(result.changes[0].incoming?.sourceId).toBe(extra.sourceId);
  });

  it("distinguishes branches and scopes in the same source", () => {
    const extra = item({ scopeId: "release-2/docs" });
    expect(
      preview([item()], [scan([extra], { scopeId: extra.scopeId })]).changes[0]
        .status,
    ).toBe("new");
  });

  it("avoids separator collisions in composite identity", () => {
    expect(
      populationEvidenceKey(item({ sourceId: "a/b", scopeId: "c" })),
    ).not.toBe(populationEvidenceKey(item({ sourceId: "a", scopeId: "b/c" })));
  });

  it("does not mutate the approved baseline while proposing changes", () => {
    const baseline = [item()];
    const original = structuredClone(baseline);
    expect(
      preview(baseline, [scan([item({ contentHash: "c".repeat(64) })])])
        .changes[0].status,
    ).toBe("changed");
    expect(baseline).toEqual(original);
  });

  it("preserves a provenance change even if content is identical", () => {
    const result = preview(
      [item()],
      [scan([item({ revision: { kind: "git", value: "d".repeat(40) } })])],
    );
    expect(result.changes[0].status).toBe("changed");
  });

  it("marks only affected derived records stale and exposes human-edit conflicts", () => {
    const untouched = item({ externalId: "unchanged.md" });
    const result = previewProjectPopulation({
      projectId: "project-a",
      baseline: { version: 1, evidence: [item(), untouched] },
      scans: [scan([item({ title: "Revised playback" }), untouched])],
      links: [
        {
          recordId: "requirement-1",
          evidenceKeys: [populationEvidenceKey(item())],
          manuallyEdited: true,
        },
        {
          recordId: "strategy-1",
          evidenceKeys: [populationEvidenceKey(item())],
          manuallyEdited: false,
        },
        {
          recordId: "requirement-2",
          evidenceKeys: [populationEvidenceKey(untouched)],
          manuallyEdited: true,
        },
      ],
    });
    expect(
      result.changes.find((c) => c.incoming?.externalId === "README.md")
        ?.status,
    ).toBe("conflict");
    expect(result.staleRecordIds).toEqual(["requirement-1", "strategy-1"]);
  });

  it("does not treat a local human edit as a source change", () => {
    const result = previewProjectPopulation({
      projectId: "project-a",
      baseline: { version: 1, evidence: [item()] },
      scans: [scan([item()])],
      links: [
        {
          recordId: "req",
          evidenceKeys: [populationEvidenceKey(item())],
          manuallyEdited: true,
        },
      ],
    });
    expect(result.changes[0].status).toBe("unchanged");
  });

  it("flags absence in a complete scope without proposing deletion", () => {
    const change = preview([item()], [scan([])]).changes[0];
    expect(change.status).toBe("missing");
    expect(change.before).toEqual(item());
    expect(change.reason).toContain("not a deletion instruction");
  });

  it.each(["partial", "unavailable", "cancelled"] as const)(
    "%s scans cannot claim source removal",
    (status) => {
      expect(preview([item()], [scan([], { status })]).changes[0].status).toBe(
        "unavailable",
      );
    },
  );

  it("retains successfully scanned evidence during partial recovery", () => {
    const other = item({ externalId: "second.md" });
    const result = preview(
      [item(), other],
      [scan([item()], { status: "partial" })],
    );
    expect(result.changes.map((c) => c.status).sort()).toEqual([
      "unavailable",
      "unchanged",
    ]);
    expect(
      preview([item(), other], [scan([item(), other])]).changes.every(
        (c) => c.status === "unchanged",
      ),
    ).toBe(true);
  });

  it("does not touch scopes absent from a partial rerun", () => {
    expect(preview([item()], []).changes).toEqual([]);
  });

  it("rejects cross-project baseline and scan data", () => {
    expect(() => preview([item({ projectId: "other" })], [])).toThrow(
      "Cross-project evidence",
    );
    expect(() => preview([], [scan([], { projectId: "other" })])).toThrow(
      "Cross-project scan",
    );
    expect(() => preview([], [scan([item({ projectId: "other" })])])).toThrow(
      "outside",
    );
  });

  it("rejects evidence from a different source or scope", () => {
    expect(() => preview([], [scan([item({ sourceId: "other" })])])).toThrow(
      "outside",
    );
    expect(() => preview([], [scan([item({ scopeId: "other" })])])).toThrow(
      "outside",
    );
  });

  it("rejects ambiguous duplicates rather than applying last-write-wins", () => {
    expect(() => preview([item(), item()], [])).toThrow("Duplicate baseline");
    expect(() => preview([], [scan([item(), item()])])).toThrow(
      "Duplicate incoming",
    );
    expect(() => preview([], [scan([]), scan([])])).toThrow("Duplicate scan");
  });

  it("rejects contradictory unavailable scan output", () => {
    expect(() =>
      preview([], [scan([item()], { status: "unavailable" })]),
    ).toThrow("Unavailable scan");
  });

  it("rejects derived links outside the project baseline", () => {
    expect(() =>
      previewProjectPopulation({
        projectId: "project-a",
        baseline: { version: 0, evidence: [] },
        scans: [],
        links: [
          {
            recordId: "x",
            evidenceKeys: ["foreign-key"],
            manuallyEdited: false,
          },
        ],
      }),
    ).toThrow("outside this baseline");
  });

  it("produces deterministic ordering independent of scan enumeration", () => {
    const a = item();
    const b = item({ externalId: "spec.md" });
    expect(preview([], [scan([a, b])])).toEqual(preview([], [scan([b, a])]));
  });

  it("preserves revision types instead of pretending all providers use Git", () => {
    for (const revision of [
      { kind: "perforce", value: "125" },
      { kind: "svn", value: "45" },
      { kind: "version", value: "ticket-v2" },
    ]) {
      expect(sourceRevisionSchema.parse(revision)).toEqual(revision);
    }
    expect(
      sourceRevisionSchema.safeParse({ kind: "git", value: "main" }).success,
    ).toBe(false);
    expect(
      sourceRevisionSchema.safeParse({ kind: "svn", value: "HEAD" }).success,
    ).toBe(false);
    expect(
      sourceRevisionSchema.safeParse({ kind: "perforce", value: "-1" }).success,
    ).toBe(false);
  });
});
