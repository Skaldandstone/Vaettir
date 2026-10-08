import type {
  manualRunStartReviewedAccessOutput,
  manualRunStartReviewedPreviewOutput,
  ManualRunStartReviewedAccessInput,
} from "../../api/src/services/manualRunStartReviewedWireSchema";

export type RunStartProjection = "ACCESS" | "PREVIEW";
export type RunStartReadInput = ManualRunStartReviewedAccessInput;
export type RunStartReadWire =
  | (typeof manualRunStartReviewedAccessOutput)["_output"]
  | (typeof manualRunStartReviewedPreviewOutput)["_output"];
export type RunStartReadOrigin = Readonly<{
  projectId: string;
  organizationId: string;
  clerkActorId: string;
  nativeActorId: string;
}>;
export type RunStartReadSnapshot = Readonly<{
  origin: RunStartReadOrigin;
  observedSessionId: string;
  projection: RunStartProjection;
  epoch: number;
  revision: number;
  receivedAt: string;
  data: RunStartReadWire;
}>;
export const RUN_START_READ_BOUNDS = Object.freeze({
  ACCESS: 8192,
  PREVIEW: 2097152,
  nodes: 100000,
  depth: 64,
  array: 1000,
  objectKeys: 10000,
  retiredNonces: 4096,
  retiredNonceBytes: 262144,
});
const refused = () =>
  Error(
    "The complete run-start metadata projection is unsupported. No value was clipped, normalized, defaulted or substituted.",
  );
type Dictionary = Record<string, unknown>;
const record = (v: unknown): v is Dictionary =>
  !!v && typeof v === "object" && !Array.isArray(v);
const fields = (
  v: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): v is Dictionary =>
  record(v) &&
  required.every((k) => Object.hasOwn(v, k)) &&
  Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
const text = (v: unknown, max: number, min = 0): v is string =>
  typeof v === "string" && v.length >= min && v.length <= max;
export const runStartReadIdentity = (v: unknown): v is string =>
  text(v, 200, 1) &&
  !Array.from(v).some((c) => {
    const n = c.codePointAt(0)!;
    return n < 32 || (n >= 127 && n <= 159) || (n >= 0xd800 && n <= 0xdfff);
  });
const uuid = (v: unknown): v is string =>
  text(v, 36) &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const hash = (v: unknown) => text(v, 64) && /^[a-f0-9]{64}$/.test(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const integer = (
  v: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): v is number => finite(v) && Number.isSafeInteger(v) && v >= min && v <= max;

/** Complete descriptor inspection precedes property reads, copying and JSON.
 * This browser boundary rejects unsafe objects; it is not a native JSON codec. */
export function inspectRunStartReadWire(
  value: unknown,
  cap: number = RUN_START_READ_BOUNDS.PREVIEW,
) {
  if (!integer(cap, 1, RUN_START_READ_BOUNDS.PREVIEW)) throw refused();
  let bytes = 0,
    nodes = 0;
  const seen = new Set<object>(),
    encoder = new TextEncoder();
  function add(s: string) {
    bytes += encoder.encode(s).length;
    if (bytes > cap) throw refused();
  }
  function visit(v: unknown, depth: number) {
    if (
      ++nodes > RUN_START_READ_BOUNDS.nodes ||
      depth > RUN_START_READ_BOUNDS.depth
    )
      throw refused();
    if (v === null || typeof v === "boolean" || finite(v)) {
      add(JSON.stringify(v));
      return;
    }
    if (typeof v === "string") {
      for (const c of v) {
        const n = c.codePointAt(0)!;
        if (n >= 0xd800 && n <= 0xdfff) throw refused();
      }
      add(JSON.stringify(v));
      return;
    }
    if (!v || typeof v !== "object" || seen.has(v)) throw refused();
    const a = Array.isArray(v),
      proto = Object.getPrototypeOf(v),
      keys = Reflect.ownKeys(v);
    if (
      (proto !== (a ? Array.prototype : Object.prototype) &&
        !(proto === null && !a)) ||
      keys.some((k) => typeof k !== "string") ||
      keys.length > RUN_START_READ_BOUNDS.objectKeys
    )
      throw refused();
    seen.add(v);
    add(a ? "[" : "{");
    if (a) {
      if (
        v.length > RUN_START_READ_BOUNDS.array ||
        keys.length !== v.length + 1 ||
        keys.some(
          (k) =>
            k !== "length" &&
            (!/^(0|[1-9]\d*)$/.test(String(k)) || Number(k) >= v.length),
        )
      )
        throw refused();
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d?.enumerable || !("value" in d)) throw refused();
        if (i) add(",");
        visit(d.value, depth + 1);
      }
    } else {
      let i = 0;
      for (const k of keys) {
        const d = Object.getOwnPropertyDescriptor(v, k)!;
        if (!d.enumerable || !("value" in d)) throw refused();
        if (i++) add(",");
        add(JSON.stringify(k) + ":");
        visit(d.value, depth + 1);
      }
    }
    add(a ? "]" : "}");
    seen.delete(v);
  }
  visit(value, 0);
  return Object.freeze({ bytes, nodes });
}
export function runStartReadWireSignature(
  value: unknown,
  projection: RunStartProjection,
): string | null {
  try {
    inspectRunStartReadWire(value, RUN_START_READ_BOUNDS[projection]);
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function choices(
  v: unknown,
  catalog: readonly string[],
  max = 32,
  min = 0,
): v is string[] {
  return (
    Array.isArray(v) &&
    v.length >= min &&
    v.length <= max &&
    v.every((x) => typeof x === "string" && catalog.includes(x)) &&
    new Set(v).size === v.length
  );
}
// Mirror the OUTPUT interpretation of qualityExperience.ts. Every array must
// already be present; browser admission never applies server input defaults.
function experience(v: unknown) {
  if (v === null) return true;
  if (
    !fields(
      v,
      [
        "version",
        "offerings",
        "softwareKinds",
        "gameGenres",
        "gamePlatforms",
        "multiplayerModes",
        "hardwareKinds",
        "processKinds",
        "jurisdictions",
      ],
      ["enabledTools"],
    ) ||
    v.version !== 1
  )
    return false;
  return (
    (!Object.hasOwn(v, "enabledTools") ||
      choices(
        v.enabledTools,
        [
          "Compliance",
          "ProductionSignals",
          "LiveAppGeneration",
          "ReverseEngineer",
          "AdvancedAnalytics",
          "TestStrategy",
        ],
        6,
      )) &&
    choices(
      v.offerings,
      [
        "SOFTWARE",
        "GAME",
        "HARDWARE",
        "HIL",
        "SYSTEM_INTEGRATION",
        "FOOD_SAFETY",
        "CLINICAL",
        "LABORATORY",
        "MANUFACTURING",
      ],
      9,
      1,
    ) &&
    choices(v.softwareKinds, [
      "SAAS",
      "B2B",
      "WEB",
      "MOBILE",
      "DESKTOP",
      "API",
      "EMBEDDED",
      "DATA",
      "OTHER",
    ]) &&
    choices(v.gameGenres, [
      "ACTION",
      "RPG",
      "STRATEGY",
      "SIMULATION",
      "PUZZLE",
      "PLATFORMER",
      "RACING",
      "SPORTS",
      "SURVIVAL",
      "SOCIAL",
      "VR_AR",
      "OTHER",
    ]) &&
    choices(v.gamePlatforms, [
      "WINDOWS_PC",
      "MACOS",
      "LINUX_PC",
      "PS5",
      "PS4",
      "XBOX_SERIES",
      "XBOX_ONE",
      "SWITCH",
      "SWITCH_2",
      "IOS",
      "ANDROID",
      "WEB",
      "OTHER",
    ]) &&
    choices(v.multiplayerModes, [
      "SINGLE_PLAYER",
      "LOCAL",
      "ONLINE_COOP",
      "ONLINE_COMPETITIVE",
      "CROSS_PLAY",
      "PERSISTENT_WORLD",
    ]) &&
    choices(v.hardwareKinds, [
      "CONTROLLER",
      "SENSOR",
      "ROBOTICS",
      "MACHINERY",
      "CONNECTED_DEVICE",
      "MEDICAL_DEVICE",
      "ELECTRONICS",
      "OTHER",
    ]) &&
    choices(v.processKinds, [
      "MONITORING",
      "VALIDATION",
      "VERIFICATION",
      "PRODUCT_TESTING",
      "ENVIRONMENTAL",
      "QUALITY_CHECK",
      "PROTOCOL",
      "COMMISSIONING",
    ]) &&
    Array.isArray(v.jurisdictions) &&
    v.jurisdictions.length <= 16 &&
    v.jurisdictions.every((x) => text(x, 120, 1) && x === x.trim()) &&
    new Set(v.jurisdictions).size === v.jurisdictions.length
  );
}
function profile(v: unknown) {
  return (
    (fields(v, ["kind", "experience", "profileHash"]) &&
      v.kind === "SUPPORTED" &&
      hash(v.profileHash) &&
      experience(v.experience)) ||
    (fields(v, ["kind", "reason"]) &&
      v.kind === "UNSUPPORTED" &&
      v.reason === "PROFILE_UNAVAILABLE")
  );
}
export function runStartReviewedReadKey(
  input: RunStartReadInput,
  projection: RunStartProjection,
) {
  inspectRunStartReadWire(input, RUN_START_READ_BOUNDS.ACCESS);
  if (
    !fields(
      input,
      [
        "projectId",
        "originalOrganizationId",
        "expectedClerkActorId",
        "requestId",
      ],
      ["expectedNativeActorId"],
    ) ||
    ![
      input.projectId,
      input.originalOrganizationId,
      input.expectedClerkActorId,
    ].every(runStartReadIdentity) ||
    !uuid(input.requestId) ||
    (Object.hasOwn(input, "expectedNativeActorId") &&
      !runStartReadIdentity(input.expectedNativeActorId)) ||
    !["ACCESS", "PREVIEW"].includes(projection) ||
    (projection === "PREVIEW" &&
      !runStartReadIdentity(input.expectedNativeActorId))
  )
    throw refused();
  return JSON.stringify([
    projection,
    input.projectId,
    input.originalOrganizationId,
    input.expectedClerkActorId,
    input.expectedNativeActorId ?? null,
    input.requestId,
  ]);
}
function freezeCopy<T>(v: T): T {
  if (v && typeof v === "object") {
    const out: unknown = Array.isArray(v)
      ? v.map((x) => freezeCopy(x))
      : Object.fromEntries(
          Object.entries(v).map(([k, x]) => [k, freezeCopy(x)]),
        );
    return Object.freeze(out) as T;
  }
  return v;
}
export function sameRunStartReadOrigin(
  a: RunStartReadOrigin | null,
  b: RunStartReadOrigin | null,
) {
  return (
    !!a &&
    !!b &&
    a.projectId === b.projectId &&
    a.organizationId === b.organizationId &&
    a.clerkActorId === b.clerkActorId &&
    a.nativeActorId === b.nativeActorId
  );
}
/** ACCESS proves membership/native mapping only. PREVIEW proves supported
 * profile metadata only. Neither admits a cohort/configuration, finds a receipt
 * nor authorizes starting a run; the separate writer must admit those facts. */
export function admitRunStartRead(
  raw: unknown,
  input: RunStartReadInput,
  projection: RunStartProjection,
  currentClerkActorId: string,
  original: RunStartReadOrigin | null = null,
): Readonly<{ origin: RunStartReadOrigin; data: RunStartReadWire }> | null {
  try {
    const key = runStartReviewedReadKey(input, projection);
    inspectRunStartReadWire(raw, RUN_START_READ_BOUNDS[projection]);
    if (original) {
      inspectRunStartReadWire(original, RUN_START_READ_BOUNDS.ACCESS);
      if (
        !Object.isFrozen(original) ||
        !fields(original, [
          "projectId",
          "organizationId",
          "clerkActorId",
          "nativeActorId",
        ]) ||
        !Object.values(original).every(runStartReadIdentity)
      )
        return null;
    }
    if (
      !runStartReadIdentity(currentClerkActorId) ||
      currentClerkActorId !== input.expectedClerkActorId ||
      !fields(
        raw,
        projection === "ACCESS"
          ? ["readContext", "canConfigure", "canRecover"]
          : [
              "readContext",
              "canConfigure",
              "canRecover",
              "canStart",
              "profile",
              "limitations",
            ],
      )
    )
      return null;
    const c = raw.readContext;
    if (
      !fields(c, ["requestId", "requestedKey", "scope", "projection"]) ||
      c.requestId !== input.requestId ||
      !uuid(c.requestId) ||
      !text(c.requestedKey, 8192, 1) ||
      c.requestedKey !== key ||
      c.projection !== projection ||
      !fields(c.scope, [
        "projectId",
        "organizationId",
        "actorId",
        "actorClerkUserId",
      ]) ||
      !Object.values(c.scope).every(runStartReadIdentity)
    )
      return null;
    const s = c.scope,
      origin = Object.freeze({
        projectId: s.projectId as string,
        organizationId: s.organizationId as string,
        clerkActorId: s.actorClerkUserId as string,
        nativeActorId: s.actorId as string,
      });
    if (
      s.projectId !== input.projectId ||
      s.organizationId !== input.originalOrganizationId ||
      s.actorClerkUserId !== currentClerkActorId ||
      (input.expectedNativeActorId !== undefined &&
        s.actorId !== input.expectedNativeActorId) ||
      (original && !sameRunStartReadOrigin(original, origin)) ||
      typeof raw.canConfigure !== "boolean" ||
      typeof raw.canRecover !== "boolean" ||
      raw.canConfigure !== raw.canRecover
    )
      return null;
    if (
      projection === "PREVIEW" &&
      (!profile(raw.profile) ||
        !Array.isArray(raw.limitations) ||
        raw.limitations.length > 8 ||
        !raw.limitations.every((x) => text(x, 1000)) ||
        raw.canStart !==
          (raw.canConfigure &&
            (raw.profile as Dictionary).kind === "SUPPORTED"))
    )
      return null;
    return Object.freeze({
      origin: original ?? origin,
      data: freezeCopy(raw) as RunStartReadWire,
    });
  } catch {
    return null;
  }
}

/** Render and cache/session generations prevent posted layouts or A-B-A data
 * from reviving a previously revoked native nonce. No render-time ref authority. */
export class RunStartReadRenderGuard {
  private render = 0;
  private cache = 0;
  private blocked = new Set<string>();
  private retiredBytes = 2;
  private exhausted = false;
  private frame: object | null = null;
  private view: object | null = null;
  private stamp: Readonly<{
    renderGeneration: number;
    cacheGeneration: number;
  }> = Object.freeze({ renderGeneration: 0, cacheGeneration: 0 });
  observe(frame: object, view: object | null) {
    if (this.frame !== frame || this.view !== view) {
      this.frame = frame;
      this.view = view;
      this.render++;
    }
    if (
      this.stamp.renderGeneration !== this.render ||
      this.stamp.cacheGeneration !== this.cache
    )
      this.stamp = Object.freeze({
        renderGeneration: this.render,
        cacheGeneration: this.cache,
      });
    return this.stamp;
  }
  matchesRender(s: { renderGeneration: number }) {
    return this.render === s.renderGeneration;
  }
  matchesRead(
    s: { renderGeneration: number; cacheGeneration: number },
    id: string | null,
  ) {
    return (
      this.matchesRender(s) &&
      s.cacheGeneration === this.cache &&
      !this.isBlocked(id)
    );
  }
  isBlocked(id: string | null) {
    return !!id && (this.exhausted || this.blocked.has(id));
  }
  canRenew() {
    return !this.exhausted;
  }
  candidateFrame() {
    return this.view ? this.frame : null;
  }
  revokeCache(id: string | null) {
    this.cache++;
    if (id && !this.blocked.has(id)) {
      const bytes = uuid(id)
        ? id.length + 3
        : RUN_START_READ_BOUNDS.retiredNonceBytes;
      if (
        !uuid(id) ||
        this.blocked.size >= RUN_START_READ_BOUNDS.retiredNonces ||
        this.retiredBytes + bytes > RUN_START_READ_BOUNDS.retiredNonceBytes
      )
        this.exhausted = true;
      else {
        this.blocked.add(id);
        this.retiredBytes += bytes;
      }
    }
  }
  revokeActions() {
    this.render++;
  }
}
