import { z } from "zod";

// These are identity contracts, not claims that a provider adapter is shipped.
export const populationProviderSchema = z.enum([
  "github",
  "gitlab",
  "bitbucket",
  "azure-devops",
  "git",
  "perforce",
  "svn",
  "jira",
  "linear",
  "document",
]);
export const populationSectionSchema = z.enum([
  "context",
  "sources",
  "requirements",
  "strategy",
  "cases",
  "assessment",
]);
const identifier = z.string().trim().min(1).max(500);
// Draft preferences are not approved project facts or authenticated connections.
export const populationDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    step: z.enum(["scope", "context", "sources", "review"]),
    sections: z
      .array(populationSectionSchema)
      .min(1)
      .max(6)
      .refine(
        (values) => new Set(values).size === values.length,
        "Duplicate sections",
      ),
    objective: z.string().max(2000),
    systemScope: z.enum(["SOFTWARE", "HARDWARE", "BOTH", "PROCESS"]),
    // Preferences only; credentials and connection IDs are never accepted here.
    providers: z
      .array(populationProviderSchema)
      .max(10)
      .refine(
        (values) => new Set(values).size === values.length,
        "Duplicate providers",
      ),
  })
  .strict();
export type PopulationDraft = z.infer<typeof populationDraftSchema>;
export const sourceRevisionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("git"),
      value: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("perforce"),
      value: z.string().regex(/^[1-9][0-9]*$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("svn"),
      value: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
    })
    .strict(),
  z.object({ kind: z.literal("version"), value: identifier }).strict(),
]);

export const populationEvidenceSchema = z
  .object({
    projectId: identifier,
    // Server-owned connection identity, including provider host/account/resource.
    sourceId: identifier,
    // Distinguishes selected streams/branches/subpaths, even in the same source.
    scopeId: identifier,
    externalId: identifier,
    provider: populationProviderSchema,
    kind: z.enum(["document", "code", "test", "ticket", "release"]),
    basis: z.enum(["documented", "observed", "inferred"]),
    revision: sourceRevisionSchema,
    locator: z.string().min(1).max(2000),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().trim().min(1).max(1000),
  })
  .strict();
export type PopulationEvidence = z.infer<typeof populationEvidenceSchema>;

export const populationScanSchema = z
  .object({
    projectId: identifier,
    sourceId: identifier,
    scopeId: identifier,
    // A complete scan means enumeration finished for this EXACT scope.
    // Failure, cancellation and truncation must never be represented as complete.
    status: z.enum(["complete", "partial", "unavailable", "cancelled"]),
    evidence: z.array(populationEvidenceSchema).max(10000),
  })
  .strict();
export type PopulationScan = z.infer<typeof populationScanSchema>;
export type PopulationBaseline = {
  version: number;
  evidence: PopulationEvidence[];
};
export type PopulationChange = {
  key: string;
  status:
    "new" | "changed" | "unchanged" | "conflict" | "missing" | "unavailable";
  before?: PopulationEvidence;
  incoming?: PopulationEvidence;
  reason: string;
  // Review hints only. No requirements, tests, or human edits are mutated here.
  affectedRecordIds: string[];
};
export type DerivedEvidenceLink = {
  recordId: string;
  evidenceKeys: string[];
  manuallyEdited: boolean;
};

export function populationEvidenceKey(
  evidence: Pick<
    PopulationEvidence,
    "projectId" | "sourceId" | "scopeId" | "externalId"
  >,
): string {
  // Tuple serialization avoids collisions from separators in native IDs/paths.
  return JSON.stringify([
    evidence.projectId,
    evidence.sourceId,
    evidence.scopeId,
    evidence.externalId,
  ]);
}

function scopeKey(value: { sourceId: string; scopeId: string }): string {
  return JSON.stringify([value.sourceId, value.scopeId]);
}

function sameEvidence(a: PopulationEvidence, b: PopulationEvidence): boolean {
  return (
    a.contentHash === b.contentHash &&
    a.revision.kind === b.revision.kind &&
    a.revision.value === b.revision.value &&
    a.title === b.title &&
    a.locator === b.locator &&
    a.provider === b.provider &&
    a.kind === b.kind &&
    a.basis === b.basis
  );
}

/**
 * Pure, deterministic preview for the wizard. Callers must authorize the project,
 * load its baseline server-side, then persist reviewed decisions transactionally
 * with compare-and-swap on baselineVersion. This function is NOT authorization,
 * durable idempotency, a connector, or permission to overwrite derived records.
 */
export function previewProjectPopulation(input: {
  projectId: string;
  baseline: PopulationBaseline;
  scans: PopulationScan[];
  links?: DerivedEvidenceLink[];
}): {
  baselineVersion: number;
  changes: PopulationChange[];
  staleRecordIds: string[];
} {
  const projectId = identifier.parse(input.projectId);
  if (
    !Number.isSafeInteger(input.baseline.version) ||
    input.baseline.version < 0
  ) {
    throw new Error("Invalid baseline version");
  }
  if (input.baseline.evidence.length > 10000 || input.scans.length > 100) {
    throw new Error("Population preview exceeds its bounded scope");
  }
  const before = new Map<string, PopulationEvidence>();
  for (const raw of input.baseline.evidence) {
    const item = populationEvidenceSchema.parse(raw);
    if (item.projectId !== projectId)
      throw new Error("Cross-project evidence rejected");
    const key = populationEvidenceKey(item);
    if (before.has(key)) throw new Error("Duplicate baseline identity");
    before.set(key, item);
  }
  const scans = new Map<string, PopulationScan>();
  const incoming = new Map<string, PopulationEvidence>();
  for (const raw of input.scans) {
    const scan = populationScanSchema.parse(raw);
    if (scan.projectId !== projectId)
      throw new Error("Cross-project scan rejected");
    const scope = scopeKey(scan);
    if (scans.has(scope)) throw new Error("Duplicate scan scope");
    scans.set(scope, scan);
    if (scan.status === "unavailable" && scan.evidence.length) {
      throw new Error("Unavailable scan cannot contain new evidence");
    }
    for (const item of scan.evidence) {
      if (item.projectId !== projectId || scopeKey(item) !== scope) {
        throw new Error("Evidence is outside the selected scan scope");
      }
      const key = populationEvidenceKey(item);
      if (incoming.has(key)) throw new Error("Duplicate incoming identity");
      incoming.set(key, item);
      if (incoming.size > 10000)
        throw new Error("Population preview exceeds its bounded scope");
    }
  }
  const links = input.links ?? [];
  const linksByKey = new Map<string, DerivedEvidenceLink[]>();
  for (const link of links) {
    if (!link.recordId.trim())
      throw new Error("Invalid derived record identity");
    for (const key of new Set(link.evidenceKeys)) {
      if (!before.has(key))
        throw new Error("Derived link is outside this baseline");
      linksByKey.set(key, [...(linksByKey.get(key) ?? []), link]);
    }
  }
  const changes: PopulationChange[] = [];
  const stale = new Set<string>();
  const keys = new Set([...before.keys(), ...incoming.keys()]);
  for (const key of [...keys].sort()) {
    const old = before.get(key);
    const next = incoming.get(key);
    const item = next ?? old!;
    const scan = scans.get(scopeKey(item));
    // Partial reruns leave unselected scopes completely untouched.
    if (!scan) continue;
    const dependencies = linksByKey.get(key) ?? [];
    let status: PopulationChange["status"];
    let reason: string;
    if (!next) {
      status = scan.status === "complete" ? "missing" : "unavailable";
      reason =
        status === "missing"
          ? "Not found in the completed scope. Retain prior work until reviewed; this is not a deletion instruction."
          : "This scan could not establish current evidence. Retain the approved baseline.";
    } else if (!old) {
      status = "new";
      reason = "New source evidence awaits review.";
    } else if (sameEvidence(old, next)) {
      status = "unchanged";
      reason = "Matches the approved evidence; no regeneration is needed.";
    } else if (dependencies.some((link) => link.manuallyEdited)) {
      status = "conflict";
      reason =
        "Source changed underneath manually edited work. Review without overwriting those edits.";
    } else {
      status = "changed";
      reason =
        "Source content or provenance changed; review affected work before updating.";
    }
    const affectedRecordIds = [
      ...new Set(dependencies.map((link) => link.recordId)),
    ].sort();
    if (status !== "unchanged")
      affectedRecordIds.forEach((id) => stale.add(id));
    changes.push({
      key,
      status,
      before: old,
      incoming: next,
      reason,
      affectedRecordIds,
    });
  }
  return {
    baselineVersion: input.baseline.version,
    changes,
    staleRecordIds: [...stale].sort(),
  };
}
