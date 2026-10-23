import { describe, expect, it } from "vitest";
import {
  defectBatchSchema,
  defectDocumentSchema,
  defectRecordKey,
  previewDefectImport,
  emptyDefectDocument,
  buildDefectMap,
} from "./defectMap.js";

const now = "2026-10-02T10:00:00Z";
const signal = {
  provider: "sentry" as const,
  scope: "app-one",
  externalId: "e1",
  groupId: "group-one",
  title: "Synthetic checkout fails",
  occurrences: 12,
  windowStart: "2026-10-01T10:00:00Z",
  windowEnd: now,
  lastSeen: now,
  component: "checkout",
  release: "v1",
  environment: "production",
  taskRefs: [{ provider: "jira" as const, scope: "team", externalId: "QA-1" }],
};
const task = {
  provider: "jira" as const,
  scope: "team",
  externalId: "QA-1",
  title: "Synthetic repair",
  status: "closed" as const,
  observedAt: now,
  component: "checkout",
  release: "v1",
  environment: "production",
};
export const batch = {
  sources: [
    {
      provider: "sentry" as const,
      scope: "app-one",
      status: "available" as const,
      observedAt: now,
    },
    {
      provider: "jira" as const,
      scope: "team",
      status: "available" as const,
      observedAt: now,
    },
  ],
  signals: [signal],
  tasks: [task],
};

describe("evidence-based defect mapping", () => {
  it("preserves provider groups, scopes, variants and releases without assuming shared root cause", () => {
    const input = {
      ...batch,
      signals: [
        signal,
        { ...signal, externalId: "e2", release: "v2" },
        { ...signal, externalId: "e3", variant: "variant-two" },
        { ...signal, scope: "other-app", externalId: "e4" },
      ],
      sources: [...batch.sources, { ...batch.sources[0]!, scope: "other-app" }],
    };
    const document = previewDefectImport(emptyDefectDocument(), input).document;
    expect(buildDefectMap(document).clusters).toHaveLength(4);
  });
  it("deduplicates identical imports and never sums overlapping windows or calls events distinct users", () => {
    const first = previewDefectImport(emptyDefectDocument(), {
      ...batch,
      signals: [signal, { ...signal, externalId: "e2", occurrences: 20 }],
    });
    const second = previewDefectImport(first.document, {
      ...batch,
      signals: [signal, { ...signal, externalId: "e2", occurrences: 20 }],
    });
    expect(second.document).toEqual(first.document);
    expect(second.changes.every((change) => change.kind === "unchanged")).toBe(
      true,
    );
    expect(buildDefectMap(second.document).clusters[0]?.occurrenceVolume).toBe(
      20,
    );
    expect(buildDefectMap(second.document).clusters[0]?.volumeMethod).toContain(
      "not distinct users",
    );
  });
  it("suggests explicit and dimensional links, never interprets closed tracker work as runtime resolution", () => {
    const document = previewDefectImport(emptyDefectDocument(), batch).document;
    const cluster = buildDefectMap(document).clusters[0]!;
    expect(cluster.tracking).toBe("suggested");
    expect(cluster.links[0]?.reasons).toContain(
      "Source explicitly references this task",
    );
    expect(cluster.links[0]?.status).toBe("suggested");
    document.decisions.push({
      clusterId: cluster.id,
      taskKey: defectRecordKey(task),
      status: "confirmed",
      evidenceHash: "a".repeat(64),
    });
    expect(
      buildDefectMap(document, () => "a".repeat(64)).clusters[0]?.caution,
    ).toContain("not proof of a deployed fix");
    expect(
      buildDefectMap(document, () => "b".repeat(64)).clusters[0]?.links[0]
        ?.stale,
    ).toBe(true);
  });
  it("retains missing/inaccessible inputs and human decisions on selective source reruns", () => {
    const document = previewDefectImport(emptyDefectDocument(), batch).document;
    const id = buildDefectMap(document).clusters[0]!.id;
    document.decisions.push({
      clusterId: id,
      taskKey: defectRecordKey(task),
      status: "rejected",
      evidenceHash: "a".repeat(64),
    });
    const next = previewDefectImport(document, {
      sources: [
        {
          ...batch.sources[0]!,
          status: "unavailable",
          observedAt: "2026-10-02T11:00:00Z",
        },
      ],
    });
    expect(next.document.signals).toEqual(document.signals);
    expect(next.document.tasks).toEqual(document.tasks);
    expect(next.document.decisions).toEqual(document.decisions);
    expect(buildDefectMap(next.document).clusters[0]?.links).toHaveLength(0);
    expect(buildDefectMap(next.document).clusters[0]?.unavailable).toBe(true);
  });
  it("does not overwrite a newer source/task/signal snapshot with stale evidence", () => {
    const document = previewDefectImport(emptyDefectDocument(), batch).document;
    const older = {
      ...batch,
      signals: [
        {
          ...signal,
          occurrences: 1,
          windowEnd: "2026-10-02T09:00:00Z",
          lastSeen: "2026-10-02T09:00:00Z",
        },
      ],
      tasks: [
        {
          ...task,
          status: "open" as const,
          observedAt: "2026-10-02T09:00:00Z",
        },
      ],
    };
    const result = previewDefectImport(document, older);
    expect(result.document).toEqual(document);
    expect(
      result.changes.filter((change) => change.kind === "stale"),
    ).toHaveLength(2);
  });
  it("rejects duplicate identities, missing approved scope and unavailable input writes", () => {
    expect(() =>
      previewDefectImport(emptyDefectDocument(), {
        ...batch,
        signals: [signal, signal],
      }),
    ).toThrow("Duplicate");
    expect(() =>
      previewDefectImport(emptyDefectDocument(), {
        ...batch,
        sources: [batch.sources[1]!],
      }),
    ).toThrow("selected source scope");
    expect(() =>
      previewDefectImport(emptyDefectDocument(), {
        ...batch,
        sources: batch.sources.map((source) => ({
          ...source,
          status: "unavailable",
        })),
      }),
    ).toThrow("available");
  });
  it("excludes raw payloads, redacts summary credentials/PII, rejects unsafe links and bounds metadata", () => {
    expect(
      defectBatchSchema.safeParse({
        ...batch,
        signals: [{ ...signal, rawStack: "customer trace" }],
      }).success,
    ).toBe(false);
    const parsed = defectBatchSchema.parse({
      ...batch,
      signals: [
        {
          ...signal,
          title: "Failure for person@example.com token=private-value",
        },
      ],
    });
    expect(parsed.signals[0]?.title).not.toContain("private-value");
    expect(parsed.signals[0]?.title).not.toContain("person@example.com");
    for (const url of [
      "javascript:alert(1)",
      "https://user:secret@example.com/path",
      "https://example.com/path?token=secret",
    ])
      expect(
        defectBatchSchema.safeParse({ ...batch, signals: [{ ...signal, url }] })
          .success,
      ).toBe(false);
    expect(
      defectBatchSchema.safeParse({
        ...batch,
        signals: Array(101).fill(signal),
      }).success,
    ).toBe(false);
    expect(
      defectDocumentSchema.safeParse({
        ...emptyDefectDocument(),
        decisions: Array(401).fill({}),
      }).success,
    ).toBe(false);
  });
  it("compares offsets chronologically, rejecting an invalid equivalent-looking window", () => {
    expect(
      defectBatchSchema.safeParse({
        ...batch,
        signals: [
          {
            ...signal,
            windowStart: "2026-10-02T09:00:00-07:00",
            windowEnd: "2026-10-02T10:00:00Z",
            lastSeen: now,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
