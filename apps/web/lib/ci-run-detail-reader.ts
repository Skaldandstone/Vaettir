import {
  ciRunDetailAccessInput,
  ciRunDetailAccessOutput,
  ciRunDetailPageInput,
  ciRunDetailPageOutput,
  ciRunDetailReadKey,
  ciRunDetailCompareId,
} from "@vaettir/api/src/services/ciRunDetailReadSchema";
import { freezeRunHistory, RunHistoryRenderGuard } from "./run-history-reader";

export { RunHistoryRenderGuard as CiRunDetailRenderGuard };
export type CiRunDetailAccessInput = (typeof ciRunDetailAccessInput)["_output"];
export type CiRunDetailPageInput = (typeof ciRunDetailPageInput)["_output"];
export type CiRunDetailAccess = (typeof ciRunDetailAccessOutput)["_output"];
export type CiRunDetailPage = (typeof ciRunDetailPageOutput)["_output"];
export type CiRunDetailOrigin = Readonly<{
  projectId: string;
  testRunId: string;
  organizationId: string;
  clerkActorId: string;
  nativeActorId: string;
}>;
export type CiRunDetailSnapshot = Readonly<{
  origin: CiRunDetailOrigin;
  observedSessionId: string;
  epoch: number;
  revision: number;
  receivedAt: string;
  page: CiRunDetailPage;
}>;
export const freezeCiRunDetail = freezeRunHistory;
export function sameCiRunDetailOrigin(
  left: CiRunDetailOrigin | null,
  right: CiRunDetailOrigin | null,
) {
  return (
    !!left &&
    !!right &&
    left.projectId === right.projectId &&
    left.testRunId === right.testRunId &&
    left.organizationId === right.organizationId &&
    left.clerkActorId === right.clerkActorId &&
    left.nativeActorId === right.nativeActorId
  );
}
function originOf(
  data: CiRunDetailAccess | CiRunDetailPage,
): CiRunDetailOrigin {
  const scope = data.readContext.scope;
  return Object.freeze({
    projectId: scope.projectId,
    testRunId: scope.testRunId,
    organizationId: scope.organizationId,
    clerkActorId: scope.actorClerkUserId,
    nativeActorId: scope.actorId,
  });
}
function matches(
  input: CiRunDetailAccessInput,
  data: CiRunDetailAccess | CiRunDetailPage,
  origin: CiRunDetailOrigin | null,
) {
  const actual = originOf(data);
  return (
    data.readContext.requestId === input.requestId &&
    data.readContext.requestedKey === ciRunDetailReadKey(input) &&
    actual.projectId === input.projectId &&
    actual.testRunId === input.testRunId &&
    actual.organizationId === input.originalOrganizationId &&
    actual.clerkActorId === input.expectedClerkActorId &&
    (input.expectedNativeActorId === undefined ||
      actual.nativeActorId === input.expectedNativeActorId) &&
    (!origin || sameCiRunDetailOrigin(actual, origin))
  );
}
export function admitCiRunDetailAccess(
  raw: unknown,
  input: CiRunDetailAccessInput,
  origin: CiRunDetailOrigin | null,
) {
  const request = ciRunDetailAccessInput.safeParse(input),
    parsed = ciRunDetailAccessOutput.safeParse(raw);
  if (
    !request.success ||
    !parsed.success ||
    !matches(request.data, parsed.data, origin)
  )
    return null;
  return freezeCiRunDetail({
    data: parsed.data,
    origin: originOf(parsed.data),
  });
}
export function admitCiRunDetailPage(
  raw: unknown,
  input: CiRunDetailPageInput,
  origin: CiRunDetailOrigin,
) {
  const request = ciRunDetailPageInput.safeParse(input),
    parsed = ciRunDetailPageOutput.safeParse(raw);
  if (
    !request.success ||
    !parsed.success ||
    !matches(request.data, parsed.data, origin) ||
    parsed.data.throughResultId !== input.throughResultId ||
    parsed.data.limit !== input.limit ||
    parsed.data.rows.some(
      (row) =>
        input.afterId !== undefined &&
        ciRunDetailCompareId(row.id, input.afterId) <= 0,
    ) ||
    new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength > 524288
  )
    return null;
  return freezeCiRunDetail(parsed.data);
}
