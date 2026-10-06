import {
  runHistoryAccessOutput,
  runHistoryPageOutput,
  runHistoryReadKey,
  type RunHistoryPage,
} from "@vaettir/api/src/services/runHistoryReadSchema";
import type { RouterOutputs } from "./trpcReact";
export type RunHistoryOrigin = Readonly<{
  projectId: string;
  organizationId: string;
  clerkActorId: string;
  nativeActorId: string;
}>;
export type RunHistoryAccessInput = {
  projectId: string;
  originalOrganizationId: string;
  expectedClerkActorId: string;
  expectedNativeActorId?: string;
  requestId: string;
};
export type RunHistoryAccess = RouterOutputs["runHistory"]["access"];
export type RunHistoryPageData = RouterOutputs["runHistory"]["page"];
export type RunHistoryReadSnapshot = Readonly<{
  origin: RunHistoryOrigin;
  observedSessionId: string;
  epoch: number;
  revision: number;
  receivedAt: string;
  page: RunHistoryPageData;
}>;
export type { RunHistoryPage };
/** Render can only revoke older action frames. Only layout may bind a read;
 * cache revocation is monotonic and cannot be cleared by a posted layout. */
export class RunHistoryRenderGuard {
  private frame: object | null = null;
  private view: object | null = null;
  private renderGeneration = 0;
  private cacheGeneration = 0;
  private blockedActivation: string | null = null;
  private stamp: Readonly<{
    renderGeneration: number;
    cacheGeneration: number;
  }> = Object.freeze({ renderGeneration: 0, cacheGeneration: 0 });
  observe(frame: object, view: object | null) {
    if (this.frame !== frame || this.view !== view) {
      this.frame = frame;
      this.view = view;
      this.renderGeneration++;
    }
    if (
      this.stamp.renderGeneration !== this.renderGeneration ||
      this.stamp.cacheGeneration !== this.cacheGeneration
    )
      this.stamp = Object.freeze({
        renderGeneration: this.renderGeneration,
        cacheGeneration: this.cacheGeneration,
      });
    return this.stamp;
  }
  matchesRender(stamp: { renderGeneration: number }) {
    return stamp.renderGeneration === this.renderGeneration;
  }
  /** Revocation listener may inspect a posted candidate, never publish it. */
  candidateFrame() {
    return this.view ? this.frame : null;
  }
  matchesRead(
    stamp: { renderGeneration: number; cacheGeneration: number },
    activation: string | null,
  ) {
    return (
      this.matchesRender(stamp) &&
      stamp.cacheGeneration === this.cacheGeneration &&
      !this.isBlocked(activation)
    );
  }
  isBlocked(activation: string | null) {
    return !!activation && activation === this.blockedActivation;
  }
  revokeCache(activation: string | null) {
    this.cacheGeneration++;
    this.blockedActivation = activation;
  }
  revokeActions() {
    this.renderGeneration++;
  }
}
export function freezeRunHistory<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freezeRunHistory(item);
    Object.freeze(value);
  }
  return value;
}
export function sameRunHistoryOrigin(
  left: RunHistoryOrigin | null,
  right: RunHistoryOrigin | null,
) {
  return (
    !!left &&
    !!right &&
    left.projectId === right.projectId &&
    left.organizationId === right.organizationId &&
    left.clerkActorId === right.clerkActorId &&
    left.nativeActorId === right.nativeActorId
  );
}
function originOf(
  access: RunHistoryAccess | RunHistoryPageData,
): RunHistoryOrigin {
  const scope = access.readContext.scope;
  return Object.freeze({
    projectId: scope.projectId,
    organizationId: scope.organizationId,
    clerkActorId: scope.actorClerkUserId,
    nativeActorId: scope.actorId,
  });
}
function matches(
  input: RunHistoryAccessInput,
  context: RunHistoryAccess["readContext"] | RunHistoryPageData["readContext"],
  origin: RunHistoryOrigin | null,
) {
  const scope = context.scope;
  return (
    context.requestId === input.requestId &&
    context.requestedKey === runHistoryReadKey(input) &&
    scope.projectId === input.projectId &&
    scope.organizationId === input.originalOrganizationId &&
    scope.actorClerkUserId === input.expectedClerkActorId &&
    !!scope.actorId &&
    (input.expectedNativeActorId === undefined ||
      scope.actorId === input.expectedNativeActorId) &&
    (!origin ||
      sameRunHistoryOrigin(origin, {
        projectId: scope.projectId,
        organizationId: scope.organizationId,
        clerkActorId: scope.actorClerkUserId,
        nativeActorId: scope.actorId,
      }))
  );
}
export function admitRunHistoryAccess(
  raw: unknown,
  input: RunHistoryAccessInput,
  origin: RunHistoryOrigin | null,
) {
  const parsed = runHistoryAccessOutput.safeParse(raw);
  if (!parsed.success || !matches(input, parsed.data.readContext, origin))
    return null;
  return freezeRunHistory({ data: parsed.data, origin: originOf(parsed.data) });
}
function compareId(left: string, right: string) {
  const a = new TextEncoder().encode(left),
    b = new TextEncoder().encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}
export function admitRunHistoryPage(
  raw: unknown,
  input: RunHistoryPage,
  origin: RunHistoryOrigin,
) {
  const parsed = runHistoryPageOutput.safeParse(raw);
  if (
    !parsed.success ||
    !matches(input, parsed.data.readContext, origin) ||
    parsed.data.readContext.asOf !== input.asOf ||
    parsed.data.limit !== input.limit
  )
    return null;
  const rows = parsed.data.rows;
  if (
    rows.some((row, index) => {
      const previous = rows[index - 1];
      return (
        (!!input.before &&
          (row.startedAt > input.before.startedAt ||
            (row.startedAt === input.before.startedAt &&
              compareId(row.id, input.before.id) >= 0))) ||
        (!!previous &&
          (row.startedAt > previous.startedAt ||
            (row.startedAt === previous.startedAt &&
              compareId(row.id, previous.id) >= 0)))
      );
    })
  )
    return null;
  return freezeRunHistory(parsed.data);
}
/** Bounded canonical DTO identity, NOT a permission token or content revision.
 * The browser-native reader remains responsible for current scope/session. */
export function runHistoryPageFingerprint(snapshot: RunHistoryReadSnapshot) {
  return JSON.stringify({
    origin: snapshot.origin,
    observedSessionId: snapshot.observedSessionId,
    epoch: snapshot.epoch,
    revision: snapshot.revision,
    receivedAt: snapshot.receivedAt,
    page: snapshot.page,
  });
}
export function validateRunHistorySnapshot(value: RunHistoryReadSnapshot) {
  const page = runHistoryPageOutput.parse(value.page);
  if (
    !sameRunHistoryOrigin(value.origin, originOf(page)) ||
    !value.observedSessionId ||
    !Number.isSafeInteger(value.epoch) ||
    value.epoch < 0 ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Number.isFinite(Date.parse(value.receivedAt)) ||
    new Date(value.receivedAt).toISOString() !== value.receivedAt
  )
    throw Error(
      "The current page review lacks a supported original reader/frame.",
    );
  return value;
}
