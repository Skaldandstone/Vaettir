import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import {
  lockCaseFieldReadScope,
  type CaseFieldReadAuthorization,
} from "./caseFieldReadScope.js";
import { readQualityExperience } from "./qualityExperienceProfile.js";
import {
  manualRunStartReviewedAccessInput,
  manualRunStartReviewedAccessOutput,
  manualRunStartReviewedPreviewInput,
  manualRunStartReviewedPreviewOutput,
  manualRunStartReviewedReadKey,
  manualRunStartReviewedAuthenticatedSubject,
  type ManualRunStartReviewedAccessInput,
  type ManualRunStartReviewedPreviewInput,
} from "./manualRunStartReviewedWireSchema.js";

export const MANUAL_START_PROFILE_MAX_BYTES = 2 * 1024 * 1024;
const options = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 20000,
  maxWait: 5000,
};
const refused = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Current run-start metadata is unsupported. No private profile or write permission was substituted.",
  });
const foreign = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message:
      "The original signed-in actor and project are required. This run-start read was not rebound.",
  });
const unsupported = () => ({
  kind: "UNSUPPORTED" as const,
  reason: "PROFILE_UNAVAILABLE" as const,
});
const limitations = [
  "Current native metadata read, not a run creation, receipt approval or globally frozen snapshot.",
  "Can configure/recover means current full-editor access only. Starting still checks the complete selected cases, prerequisites, profile and plan inside its own transaction.",
  "The profile hash covers the complete admitted stored JSON; experience is the existing supported interpretation. Unknown raw profile fields are not exposed.",
  "Unsupported profile data has no substitute hash. Current recovery capability does not prove that a particular retained UUID was accepted.",
];
async function access(
  tx: Prisma.TransactionClient,
  actorId: string,
  input: ManualRunStartReviewedAccessInput,
  authorized: CaseFieldReadAuthorization,
) {
  const scope = await lockCaseFieldReadScope(tx, actorId, input, authorized);
  if (
    scope.projectId !== input.projectId ||
    scope.organizationId !== input.originalOrganizationId ||
    scope.actorId !== actorId ||
    scope.actorClerkUserId !== authorized.clerkActorId ||
    scope.actorClerkUserId !== input.expectedClerkActorId ||
    (input.expectedNativeActorId !== undefined &&
      input.expectedNativeActorId !== scope.actorId)
  )
    throw foreign();
  // The original helper holds org -> member -> project -> User SHARE locks.
  // Re-read only these bounded native scalars, never cached ctx memberships.
  const rows = await tx.$queryRaw<Array<{ role: string; seatType: string }>>`
    SELECT role::text AS role,"seatType"::text AS "seatType" FROM "Membership"
    WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.actorId} FOR SHARE`;
  if (
    rows.length !== 1 ||
    !["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(
      rows[0]!.role,
    ) ||
    !["FULL", "READ_ONLY"].includes(rows[0]!.seatType)
  )
    throw refused();
  const canConfigure =
    rows[0]!.seatType === "FULL" &&
    ["OWNER", "ADMIN", "EDITOR"].includes(rows[0]!.role);
  return { scope, canConfigure, canRecover: canConfigure };
}
export async function readManualRunStartReviewedAccess(
  db: PrismaClient,
  actorId: string,
  raw: ManualRunStartReviewedAccessInput,
  authorized: CaseFieldReadAuthorization,
) {
  const subject = manualRunStartReviewedAuthenticatedSubject.safeParse(
    authorized?.clerkActorId,
  );
  if (
    !subject.success ||
    !manualRunStartReviewedAuthenticatedSubject.safeParse(actorId).success
  )
    throw foreign();
  const input = manualRunStartReviewedAccessInput.parse(raw);
  return db.$transaction(async (tx) => {
    const current = await access(tx, actorId, input, {
      clerkActorId: subject.data,
    });
    return manualRunStartReviewedAccessOutput.parse({
      readContext: {
        requestId: input.requestId,
        requestedKey: manualRunStartReviewedReadKey(input, "ACCESS"),
        projection: "ACCESS",
        scope: current.scope,
      },
      canConfigure: current.canConfigure,
      canRecover: current.canRecover,
    });
  }, options);
}
/** Complete descriptor/depth/node/byte admission before the old recursive
 * canonical hash. This refuses unsupported codecs; it does not repair values. */
export function admitManualStartProfileText(
  text: unknown,
): { value: Record<string, unknown>; encoded: string } | null {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text, "utf8") > MANUAL_START_PROFILE_MAX_BYTES
  )
    return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 100000 || item.depth > 64) return null;
    if (typeof item.value === "number" && !Number.isFinite(item.value))
      return null;
    if (item.value !== null && typeof item.value === "object") {
      const descriptors = Object.getOwnPropertyDescriptors(item.value);
      if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string"))
        return null;
      for (const descriptor of Object.values(descriptors)) {
        if (!Object.hasOwn(descriptor, "value")) return null;
        pending.push({ value: descriptor.value, depth: item.depth + 1 });
      }
    }
  }
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > MANUAL_START_PROFILE_MAX_BYTES)
    return null;
  return { value: value as Record<string, unknown>, encoded };
}
async function profile(tx: Prisma.TransactionClient, projectId: string) {
  // Native scalar type/byte admission before returning the raw JSON text. SQL
  // NULL and JSON null stay unsupported, never changed to an empty profile.
  const rows = await tx.$queryRaw<
    Array<{ bytes: bigint; kind: string | null; sqlNull: boolean }>
  >`
    SELECT COALESCE(octet_length("qualityProfile"::text),0)::bigint AS bytes,
    jsonb_typeof("qualityProfile") AS kind,"qualityProfile" IS NULL AS "sqlNull"
    FROM "Project" WHERE id=${projectId}`;
  if (rows.length !== 1) throw refused();
  const size = rows[0]!;
  if (
    typeof size.bytes !== "bigint" ||
    size.bytes < 0n ||
    typeof size.sqlNull !== "boolean" ||
    !(size.kind === null || typeof size.kind === "string")
  )
    throw refused();
  if (
    size.sqlNull ||
    size.kind !== "object" ||
    size.bytes > BigInt(MANUAL_START_PROFILE_MAX_BYTES)
  )
    return unsupported();
  const projected = await tx.$queryRaw<Array<{ profileText: string }>>`
    SELECT "qualityProfile"::text AS "profileText" FROM "Project" WHERE id=${projectId}
    AND jsonb_typeof("qualityProfile")='object' AND octet_length("qualityProfile"::text)<=${MANUAL_START_PROFILE_MAX_BYTES}`;
  if (projected.length !== 1) throw refused();
  if (
    typeof projected[0]!.profileText !== "string" ||
    BigInt(Buffer.byteLength(projected[0]!.profileText, "utf8")) !== size.bytes
  )
    throw refused();
  const admitted = admitManualStartProfileText(projected[0]!.profileText);
  if (!admitted) return unsupported();
  const equality = await tx.$queryRaw<Array<{ exact: boolean }>>`
    SELECT "qualityProfile"=${admitted.encoded}::jsonb AS exact FROM "Project" WHERE id=${projectId}`;
  if (equality.length !== 1 || typeof equality[0]?.exact !== "boolean")
    throw refused();
  if (!equality[0]!.exact) return unsupported();
  try {
    return {
      kind: "SUPPORTED" as const,
      ...readQualityExperience(admitted.value),
    };
  } catch {
    return unsupported();
  }
}
export async function readManualRunStartReviewedPreview(
  db: PrismaClient,
  actorId: string,
  raw: ManualRunStartReviewedPreviewInput,
  authorized: CaseFieldReadAuthorization,
) {
  const subject = manualRunStartReviewedAuthenticatedSubject.safeParse(
    authorized?.clerkActorId,
  );
  if (
    !subject.success ||
    !manualRunStartReviewedAuthenticatedSubject.safeParse(actorId).success
  )
    throw foreign();
  const input = manualRunStartReviewedPreviewInput.parse(raw);
  return db.$transaction(async (tx) => {
    const current = await access(tx, actorId, input, {
      clerkActorId: subject.data,
    });
    const admitted = await profile(tx, input.projectId);
    return manualRunStartReviewedPreviewOutput.parse({
      readContext: {
        requestId: input.requestId,
        requestedKey: manualRunStartReviewedReadKey(input, "PREVIEW"),
        projection: "PREVIEW",
        scope: current.scope,
      },
      canConfigure: current.canConfigure,
      canRecover: current.canRecover,
      canStart: current.canConfigure && admitted.kind === "SUPPORTED",
      profile: admitted,
      limitations,
    });
  }, options);
}
