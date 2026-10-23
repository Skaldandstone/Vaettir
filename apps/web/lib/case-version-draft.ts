import type { RouterInputs, RouterOutputs } from "./trpcReact";
export type VersionOrigin = Readonly<{
  projectId: string;
  caseId: string;
  organizationId: string;
  clerkActorId: string;
  nativeActorId: string;
}>;
export type VersionScope =
  RouterOutputs["caseVersionReview"]["access"]["readScope"];
export type VersionProjection =
  RouterOutputs["caseVersionReview"]["access"]["projection"];
export type VersionRestore = RouterInputs["caseVersionReview"]["restore"];
export type VersionEnvelope =
  RouterInputs["caseVersionReview"]["restoreReviewed"];
export type VersionPending = Readonly<{
  input: VersionEnvelope;
  origin: VersionOrigin;
  requestHash: string;
  uncertain: boolean;
  draftIdentity: string;
}>;
export function freezeVersionReview<T>(value: T): T {
  const copy = structuredClone(value);
  let nodes = 0;
  const freeze = (entry: unknown, depth: number) => {
    if (++nodes > 100000 || depth > 64)
      throw Error(
        "The complete comparison exceeds bounded review structure; no baseline was selected.",
      );
    if (entry && typeof entry === "object") {
      Object.values(entry).forEach((child) => freeze(child, depth + 1));
      Object.freeze(entry);
    }
  };
  freeze(copy, 0);
  return copy;
}
export const sameVersionReader = (
  scope: VersionScope | undefined,
  origin: VersionOrigin,
) =>
  !!scope &&
  scope.projectId === origin.projectId &&
  scope.organizationId === origin.organizationId &&
  scope.actorClerkUserId === origin.clerkActorId &&
  scope.actorId === origin.nativeActorId;
export function currentVersionRead<
  T extends { readContext?: RouterOutputs["caseVersionReview"]["access"] },
>(
  query: {
    data?: T;
    error?: unknown;
    isFetching: boolean;
    isPaused: boolean;
    isFetchedAfterMount: boolean;
  },
  origin: VersionOrigin | null,
  readable: boolean,
  readRequestId: string,
  projection: VersionProjection,
): T | null {
  const data = query.data,
    context = data?.readContext;
  return readable &&
    origin &&
    query.isFetchedAfterMount &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    context?.readRequestId === readRequestId &&
    context.caseId === origin.caseId &&
    sameVersionReader(context.readScope, origin) &&
    canonical(context.projection) === canonical(projection)
    ? data!
    : null;
}
export function freezeVersionEnvelope(
  request: VersionRestore,
  origin: VersionOrigin,
): VersionEnvelope {
  // These fields are all scalars except the copied field-name array. Never
  // mutate old restore input to add activation/session/envelope properties.
  const input = Object.freeze({
    ...request,
    fields: Object.freeze([...request.fields]),
  }) as VersionRestore;
  return Object.freeze({
    request: input,
    originalOrganizationId: origin.organizationId,
    expectedClerkActorId: origin.clerkActorId,
    expectedNativeActorId: origin.nativeActorId,
  });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
/** Exact existing server parsed-input hash: reason trim, sorted fields, no
 * operation marker, read nonce, scope envelope or new defaults. */
export async function versionRestoreRequestHash(
  input: VersionRestore,
): Promise<string> {
  const encoded = canonical({
    ...input,
    reason: input.reason.trim(),
    fields: [...input.fields].sort(),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(encoded),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function assertVersionRestoreAck(
  result: RouterOutputs["caseVersionReview"]["restoreReviewed"],
  pending: VersionPending,
) {
  const request = pending.input.request;
  if (
    result.requestId !== request.requestId ||
    result.requestHash !== pending.requestHash ||
    result.caseId !== request.testCaseId ||
    result.restoredVersionNumber !== request.versionNumber ||
    !Number.isInteger(result.createdVersionNumber) ||
    result.createdVersionNumber <= result.restoredVersionNumber ||
    result.scopeProof !== "CURRENT_LOCKED_AUTHORIZATION" ||
    !sameVersionReader(result.readScope, pending.origin)
  )
    throw Error(
      "The restore acknowledgement did not match the exact request, hash and native scope. Keep the original request for recovery.",
    );
}
