import { z } from "zod";

// Metadata-only contract: unknown fields (raw traces, users, credentials) fail closed.
const identity = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_.:/-]+$/);
const label = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .transform((value) =>
    value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
      .replace(
        /(?:Bearer\s+\S+|(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+)/gi,
        "[redacted]",
      ),
  );
const time = z.string().datetime({ offset: true });
const dimension = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_.:/ -]+$/)
  .nullable()
  .default(null);
const citation = z
  .string()
  .max(500)
  .url()
  .refine((value) => {
    return /^https:\/\/[a-z0-9.-]+(?::[1-9]\d{0,4})?(?:\/[^?#@\s]*)?$/i.test(
      value,
    );
  }, "Use an HTTPS source link without credentials, query parameters or fragments")
  .nullable()
  .default(null);
export const defectProviderSchema = z.enum([
  "sentry",
  "crashlytics",
  "analytics",
  "jira",
  "linear",
  "asana",
]);
const ref = z
  .object({
    provider: defectProviderSchema,
    scope: identity,
    externalId: identity,
  })
  .strict();
export const defectSourceSchema = z
  .object({
    provider: defectProviderSchema,
    scope: identity,
    status: z.enum(["available", "unavailable"]),
    observedAt: time,
  })
  .strict();
export const defectSignalSchema = ref
  .extend({
    provider: z.enum(["sentry", "crashlytics", "analytics"]),
    title: label,
    url: citation,
    groupId: identity.nullable().default(null),
    variant: dimension,
    component: dimension,
    release: dimension,
    environment: dimension,
    platform: dimension,
    fingerprint: identity.nullable().default(null),
    occurrences: z.number().int().min(0).max(1_000_000_000),
    windowStart: time,
    windowEnd: time,
    lastSeen: time,
    taskRefs: z.array(ref).max(10).default([]),
  })
  .strict()
  .refine(
    (row) =>
      Date.parse(row.windowStart) <= Date.parse(row.windowEnd) &&
      Date.parse(row.lastSeen) >= Date.parse(row.windowStart) &&
      Date.parse(row.lastSeen) <= Date.parse(row.windowEnd),
    "Invalid observation window",
  );
export const defectTaskSchema = ref
  .extend({
    provider: z.enum(["jira", "linear", "asana"]),
    title: label,
    url: citation,
    component: dimension,
    release: dimension,
    environment: dimension,
    status: z.enum(["open", "in_progress", "closed", "unknown"]),
    observedAt: time,
  })
  .strict();
export const defectBatchSchema = z
  .object({
    sources: z.array(defectSourceSchema).min(1).max(20),
    signals: z.array(defectSignalSchema).max(100).default([]),
    tasks: z.array(defectTaskSchema).max(100).default([]),
  })
  .strict();
export const defectDecisionSchema = z
  .object({
    clusterId: z.string().min(1).max(1000),
    taskKey: z.string().min(1).max(500),
    status: z.enum(["confirmed", "rejected"]),
    evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const defectDocumentSchema = z
  .object({
    sources: z.array(defectSourceSchema).max(40),
    signals: z.array(defectSignalSchema).max(200),
    tasks: z.array(defectTaskSchema).max(200),
    decisions: z.array(defectDecisionSchema).max(400),
  })
  .strict();
export type DefectBatch = z.input<typeof defectBatchSchema>;
export type DefectDocument = z.infer<typeof defectDocumentSchema>;
export type DefectSignal = z.infer<typeof defectSignalSchema>;
export type DefectTask = z.infer<typeof defectTaskSchema>;
export const emptyDefectDocument = (): DefectDocument => ({
  sources: [],
  signals: [],
  tasks: [],
  decisions: [],
});
export const defectSourceKey = (row: { provider: string; scope: string }) =>
  JSON.stringify([row.provider, row.scope]);
export const defectRecordKey = (row: {
  provider: string;
  scope: string;
  externalId: string;
}) => JSON.stringify([row.provider, row.scope, row.externalId]);
export const defectClusterId = (signal: DefectSignal) =>
  JSON.stringify([
    signal.provider,
    signal.scope,
    signal.groupId ?? signal.externalId,
    signal.variant,
    signal.release,
    signal.environment,
    signal.platform,
  ]);
export const defectSignalKey = (signal: DefectSignal) =>
  JSON.stringify([
    defectRecordKey(signal),
    signal.variant,
    signal.release,
    signal.environment,
    signal.platform,
  ]);
export const defectLinkEvidence = (signals: DefectSignal[], task: DefectTask) =>
  JSON.stringify([
    signals
      .slice()
      .sort((a, b) => defectSignalKey(a).localeCompare(defectSignalKey(b))),
    task,
  ]);

export function previewDefectImport(
  document: DefectDocument,
  input: DefectBatch,
) {
  const batch = defectBatchSchema.parse(input);
  const next = defectDocumentSchema.parse(document);
  const changes: Array<{
    kind: "new" | "changed" | "unchanged" | "unavailable" | "stale";
    record: "source" | "signal" | "task";
    key: string;
    title: string;
  }> = [];
  const incomingSources = new Map(
    batch.sources.map((source) => [defectSourceKey(source), source]),
  );
  if (incomingSources.size !== batch.sources.length)
    throw new Error("Duplicate source scope in batch");
  for (const [field, rows] of [
    ["signals", batch.signals],
    ["tasks", batch.tasks],
  ] as const) {
    const seen = new Set<string>();
    for (const row of rows) {
      const key =
        field === "signals"
          ? defectSignalKey(row as DefectSignal)
          : defectRecordKey(row);
      if (seen.has(key)) throw new Error("Duplicate native identity in batch");
      seen.add(key);
      if (incomingSources.get(defectSourceKey(row))?.status !== "available")
        throw new Error(
          "Every imported record needs an available, selected source scope",
        );
      const priorIndex = next[field].findIndex(
        (prior) =>
          (field === "signals"
            ? defectSignalKey(prior as DefectSignal)
            : defectRecordKey(prior)) === key,
      );
      const prior = next[field][priorIndex];
      const observed =
        field === "signals"
          ? (row as DefectSignal).windowEnd
          : (row as DefectTask).observedAt;
      const priorObserved = prior
        ? field === "signals"
          ? (prior as DefectSignal).windowEnd
          : (prior as DefectTask).observedAt
        : null;
      const stale =
        !!priorObserved && Date.parse(observed) < Date.parse(priorObserved);
      const kind = !prior
        ? "new"
        : stale
          ? "stale"
          : JSON.stringify(prior) === JSON.stringify(row)
            ? "unchanged"
            : "changed";
      changes.push({
        kind,
        record: field === "signals" ? "signal" : "task",
        key,
        title: row.title,
      });
      if (stale) continue;
      // Assign only after review. Never delete disappeared inputs or human decisions.
      if (field === "signals") {
        if (priorIndex < 0) next.signals.push(row as DefectSignal);
        else next.signals[priorIndex] = row as DefectSignal;
      } else {
        if (priorIndex < 0) next.tasks.push(row as DefectTask);
        else next.tasks[priorIndex] = row as DefectTask;
      }
    }
  }
  for (const source of batch.sources) {
    const key = defectSourceKey(source);
    const index = next.sources.findIndex(
      (prior) => defectSourceKey(prior) === key,
    );
    const prior = next.sources[index];
    const stale =
      prior && Date.parse(source.observedAt) < Date.parse(prior.observedAt);
    changes.push({
      kind: stale
        ? "stale"
        : source.status === "unavailable"
          ? "unavailable"
          : !prior
            ? "new"
            : JSON.stringify(prior) === JSON.stringify(source)
              ? "unchanged"
              : "changed",
      record: "source",
      key,
      title: `${source.provider} / ${source.scope}`,
    });
    if (!stale) {
      if (index < 0) next.sources.push(source);
      else next.sources[index] = source;
    }
  }
  return { document: defectDocumentSchema.parse(next), changes };
}

export function buildDefectMap(
  document: DefectDocument,
  hashEvidence?: (value: string) => string,
) {
  const groups = new Map<string, DefectSignal[]>();
  for (const signal of document.signals) {
    const id = defectClusterId(signal);
    groups.set(id, [...(groups.get(id) ?? []), signal]);
  }
  const clusters = [...groups].map(([id, signals]) => {
    const representative = signals[0]!;
    const decisions = document.decisions.filter(
      (decision) => decision.clusterId === id,
    );
    const links = document.tasks.flatMap((task) => {
      const taskKey = defectRecordKey(task);
      const decision = decisions.find((value) => value.taskKey === taskKey);
      if (decision?.status === "rejected") return [];
      const reasons: string[] = [];
      if (
        signals.some((signal) =>
          signal.taskRefs.some((ref) => defectRecordKey(ref) === taskKey),
        )
      )
        reasons.push("Source explicitly references this task");
      if (
        representative.component &&
        representative.component === task.component &&
        representative.release &&
        representative.release === task.release &&
        representative.environment &&
        representative.environment === task.environment
      )
        reasons.push("Same component, release and environment");
      if (!decision && !reasons.length) return [];
      return [
        {
          taskKey,
          task,
          status: decision ? ("confirmed" as const) : ("suggested" as const),
          stale:
            !!decision &&
            (!hashEvidence ||
              decision.evidenceHash !==
                hashEvidence(defectLinkEvidence(signals, task))),
          reasons: decision ? ["Human-confirmed link", ...reasons] : reasons,
        },
      ];
    });
    const unavailable = signals.some(
      (signal) =>
        document.sources.find(
          (source) => defectSourceKey(source) === defectSourceKey(signal),
        )?.status === "unavailable",
    );
    // Counts from possibly overlapping provider windows cannot safely be summed.
    const occurrenceVolume = Math.max(
      ...signals.map((signal) => signal.occurrences),
    );
    const lastSeen = signals.reduce(
      (latest, signal) =>
        Date.parse(signal.lastSeen) > Date.parse(latest)
          ? signal.lastSeen
          : latest,
      representative.lastSeen,
    );
    const confirmed = links.filter((link) => link.status === "confirmed");
    const closedTasks = confirmed.filter(
      (link) => link.task.status === "closed",
    );
    return {
      id,
      title: representative.title,
      provider: representative.provider,
      component: representative.component,
      release: representative.release,
      environment: representative.environment,
      platform: representative.platform,
      occurrenceVolume,
      volumeMethod:
        "maximum reported window count; not distinct users or cross-window total" as const,
      lastSeen,
      unavailable,
      signals: signals.map((signal) => ({
        ...signal,
        key: defectSignalKey(signal),
      })),
      links,
      tracking: confirmed.length
        ? ("tracked" as const)
        : links.length
          ? ("suggested" as const)
          : ("untracked" as const),
      caution: closedTasks.length
        ? "Closed task is not proof of a deployed fix. Compare release and observation dates."
        : null,
      nextAction: unavailable
        ? "Restore source access; retained evidence is not a fresh assessment."
        : !confirmed.length
          ? "Review a task match or record the missing work in your tracker."
          : "Verify the fix in the affected release and add a regression test.",
    };
  });
  clusters.sort(
    (a, b) =>
      b.occurrenceVolume - a.occurrenceVolume || a.id.localeCompare(b.id),
  );
  return {
    clusters,
    untracked: clusters.filter((cluster) => cluster.tracking === "untracked")
      .length,
    suggested: clusters.filter((cluster) => cluster.tracking === "suggested")
      .length,
    unavailableSources: document.sources.filter(
      (source) => source.status === "unavailable",
    ).length,
  };
}
