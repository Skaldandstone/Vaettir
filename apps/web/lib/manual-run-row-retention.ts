import {
  admitManualRunCurrent,
  inspectManualRunWire,
  sameManualRunCurrentOrigin,
  type ManualRunCurrentInput,
  type ManualRunCurrentOrigin,
  type ManualRunCurrentSnapshot,
  type ManualRunCurrentWire,
} from "./manual-run-current-reader";

export type RetainedManualRunCase =
  ManualRunCurrentWire["view"]["cases"][number];
export type ManualRunRowRetention = Readonly<{
  origin: ManualRunCurrentOrigin;
  plannedCaseIds: readonly string[];
  /** Private mounting payloads only, NEVER a current denominator/export view. */
  rows: readonly RetainedManualRunCase[];
  bytes: number;
  nodes: number;
}>;
export type ManualRunRowRetentionResult = Readonly<{
  retained: ManualRunRowRetention | null;
  /** Caller still requires reader.current() === current at every action. */
  current: ManualRunCurrentSnapshot | null;
  reason:
    | "NO_CURRENT_READ"
    | "UNSUPPORTED_SNAPSHOT"
    | "ORIGINAL_SCOPE_CHANGED"
    | "RETENTION_BOUND"
    | null;
}>;
const result = (
  retained: ManualRunRowRetention | null,
  current: ManualRunCurrentSnapshot | null,
  reason: ManualRunRowRetentionResult["reason"],
): ManualRunRowRetentionResult => Object.freeze({ retained, current, reason });

function exactFrozenObject(value: unknown, keys: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.isFrozen(value)
  )
    return false;
  const own = Reflect.ownKeys(value);
  return (
    own.length === keys.length &&
    own.every(
      (key) =>
        typeof key === "string" &&
        keys.includes(key) &&
        (() => {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          return !!descriptor && descriptor.enumerable && "value" in descriptor;
        })(),
    )
  );
}

function deeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  const stack = [value],
    visited = new Set<object>();
  while (stack.length) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (!Object.isFrozen(current)) return false;
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
      if (!("value" in descriptor)) return false;
      if (descriptor.value !== null && typeof descriptor.value === "object")
        stack.push(descriptor.value);
    }
  }
  return true;
}

/** Browser-local retention only. No authority, historical provenance, restore,
 * permission upgrade or latest-native guarantee is created by this helper.
 * Input must be the current reader's already admitted immutable snapshot. We
 * repeat bounded descriptor/schema checks (including freeze) rather than trust
 * a cast, getter, mutable cache object or permissive partial projection.
 */
function supportedSnapshot(snapshot: ManualRunCurrentSnapshot): boolean {
  try {
    if (
      !exactFrozenObject(snapshot, [
        "origin",
        "observedSessionId",
        "epoch",
        "revision",
        "receivedAt",
        "data",
      ])
    )
      return false;
    const originDescriptor = Object.getOwnPropertyDescriptor(
      snapshot,
      "origin",
    )!;
    if (
      !exactFrozenObject(originDescriptor.value, [
        "projectId",
        "testRunId",
        "organizationId",
        "clerkActorId",
        "nativeActorId",
      ]) ||
      !Object.values(originDescriptor.value as Record<string, unknown>).every(
        (value) => typeof value === "string",
      )
    )
      return false;
    inspectManualRunWire(snapshot);
    if (
      !deeplyFrozen(snapshot) ||
      typeof snapshot.observedSessionId !== "string" ||
      !snapshot.observedSessionId ||
      !Number.isSafeInteger(snapshot.epoch) ||
      snapshot.epoch < 0 ||
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0 ||
      typeof snapshot.receivedAt !== "string" ||
      new Date(snapshot.receivedAt).toISOString() !== snapshot.receivedAt
    )
      return false;
    const parsed: unknown = JSON.parse(snapshot.data.readContext.requestedKey);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return false;
    return (
      admitManualRunCurrent(
        snapshot.data,
        parsed as ManualRunCurrentInput,
        snapshot.origin,
      ) !== null
    );
  } catch {
    return false;
  }
}

/** At most one latest admitted payload for each identity in the FIRST admitted
 * ordered planned scope (<=1000). Never evict an old mounting payload to admit
 * a new identity or a smaller partial view. A valid disappearance hides that
 * case's current facts while its exact prior payload/controllers remain private.
 * Bound refusal rejects the ENTIRE candidate publication and keeps every prior
 * row pointer; it does not claim that the old facts are current.
 *
 * The descriptor walk caps this parent retention projection at 16 MiB/1m nodes
 * and existing browser depth/array limits. Child drafts, cache generations and
 * stale external closures have independent limits; total browser memory and
 * native/performance/concurrency acceptance are NOT established here.
 */
export function retainManualRunRows(
  previous: ManualRunRowRetention | null,
  candidate: ManualRunCurrentSnapshot | null,
): ManualRunRowRetentionResult {
  if (!candidate) return result(previous, null, "NO_CURRENT_READ");
  if (!supportedSnapshot(candidate))
    return result(previous, null, "UNSUPPORTED_SNAPSHOT");
  const planned = candidate.data.view.plannedCaseIds;
  try {
    if (previous) {
      if (
        !exactFrozenObject(previous, [
          "origin",
          "plannedCaseIds",
          "rows",
          "bytes",
          "nodes",
        ])
      )
        return result(previous, null, "RETENTION_BOUND");
      inspectManualRunWire(previous);
      if (!deeplyFrozen(previous))
        return result(previous, null, "RETENTION_BOUND");
      if (
        !sameManualRunCurrentOrigin(previous.origin, candidate.origin) ||
        previous.plannedCaseIds.length !== planned.length ||
        previous.plannedCaseIds.some((id, index) => id !== planned[index])
      )
        return result(previous, null, "ORIGINAL_SCOPE_CHANGED");
    }
    const rows = new Map<string, RetainedManualRunCase>();
    for (const row of previous?.rows ?? []) {
      if (!planned.includes(row.testCaseId) || rows.has(row.testCaseId))
        return result(previous, null, "RETENTION_BOUND");
      rows.set(row.testCaseId, row);
    }
    for (const row of candidate.data.view.cases) rows.set(row.testCaseId, row);
    const ordered = Object.freeze(
      planned.filter((id) => rows.has(id)).map((id) => rows.get(id)!),
    );
    const origin = previous?.origin ?? candidate.origin;
    const plannedCaseIds =
      previous?.plannedCaseIds ?? Object.freeze([...planned]);
    const projection = { origin, plannedCaseIds, rows: ordered };
    const size = inspectManualRunWire(projection);
    const retained = Object.freeze({
      ...projection,
      bytes: size.bytes,
      nodes: size.nodes,
    });
    // Numeric accounting fields are included in the final stored-object cap;
    // a near-bound projection must not create a state its next read rejects.
    inspectManualRunWire(retained);
    return result(retained, candidate, null);
  } catch {
    return result(previous, null, "RETENTION_BOUND");
  }
}
