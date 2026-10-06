import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";
import {
  experienceProfileSchema,
  EXPERIENCE_OFFERINGS,
  SOFTWARE_KINDS,
  GAME_GENRES,
  GAME_PLATFORMS,
  MULTIPLAYER_MODES,
  HARDWARE_KINDS,
  PROCESS_KINDS,
} from "@vaettir/core";
import {
  manualRunStartReviewedAccessOutput,
  manualRunStartReviewedPreviewOutput,
  manualRunStartReviewedReadKey,
} from "../../api/src/services/manualRunStartReviewedWireSchema";
import {
  admitRunStartRead,
  inspectRunStartReadWire,
  runStartReviewedReadKey,
  runStartReadIdentity,
  RunStartReadRenderGuard,
  RUN_START_READ_BOUNDS,
  type RunStartProjection,
  type RunStartReadInput,
} from "./manual-run-start-reviewed-reader";
const input = (native = false): RunStartReadInput => ({
  projectId: "p",
  originalOrganizationId: "o",
  expectedClerkActorId: "cl",
  ...(native ? { expectedNativeActorId: "n" } : {}),
  requestId: "2eeeec04-4d34-40bf-b0e9-000000000001",
});
const profile = () =>
  experienceProfileSchema.parse({
    version: 1,
    offerings: ["SOFTWARE", "HIL"],
    jurisdictions: ["US", "EU"],
  });
function wire(projection: RunStartProjection = "ACCESS", full = true) {
  const i = input(projection === "PREVIEW");
  const readContext = {
    requestId: i.requestId,
    requestedKey: runStartReviewedReadKey(i, projection),
    projection,
    scope: {
      projectId: "p",
      organizationId: "o",
      actorId: "n",
      actorClerkUserId: "cl",
    },
  };
  return projection === "ACCESS"
    ? { readContext, canConfigure: full, canRecover: full }
    : {
        readContext,
        canConfigure: full,
        canRecover: full,
        canStart: full,
        profile: {
          kind: "SUPPORTED",
          experience: profile(),
          profileHash: "a".repeat(64),
        },
        limitations: ["Writer admission is required.", ""],
      };
}
const copy = <T>(value: T): T => structuredClone(value);
it.each(["ACCESS", "PREVIEW"] as const)(
  "mirrors actual %s output and exact key without server runtime imports in production",
  (projection) => {
    const i = input(projection === "PREVIEW"),
      raw = wire(projection);
    const server =
      projection === "ACCESS"
        ? manualRunStartReviewedAccessOutput.parse(raw)
        : manualRunStartReviewedPreviewOutput.parse(raw);
    expect(runStartReviewedReadKey(i, projection)).toBe(
      manualRunStartReviewedReadKey(i, projection),
    );
    const admitted = admitRunStartRead(server, i, projection, "cl");
    expect(admitted?.data).toEqual(server);
    expect(admitted?.origin).toEqual({
      projectId: "p",
      organizationId: "o",
      clerkActorId: "cl",
      nativeActorId: "n",
    });
    expect(Object.isFrozen(admitted!.data.readContext.scope)).toBe(true);
  },
);
it("ACCESS retains false membership capabilities and never invents start/profile/receipt/cohort", () => {
  const v = admitRunStartRead(wire("ACCESS", false), input(), "ACCESS", "cl")!;
  expect(v.data.canRecover).toBe(false);
  expect(Object.keys(v.data)).toEqual([
    "readContext",
    "canConfigure",
    "canRecover",
  ]);
  expect("canStart" in v.data).toBe(false);
});
it("PREVIEW supports explicit null experience, literal empty limitations and separate recovery for unsupported profile", () => {
  const raw = wire("PREVIEW") as unknown as {
    profile: unknown;
    canStart: boolean;
  };
  raw.profile = {
    kind: "SUPPORTED",
    experience: null,
    profileHash: "b".repeat(64),
  };
  expect(admitRunStartRead(raw, input(true), "PREVIEW", "cl")!.data).toEqual(
    raw,
  );
  raw.profile = { kind: "UNSUPPORTED", reason: "PROFILE_UNAVAILABLE" };
  raw.canStart = false;
  const v = admitRunStartRead(raw, input(true), "PREVIEW", "cl")!;
  expect(v.data.canRecover).toBe(true);
  expect("canStart" in v.data && v.data.canStart).toBe(false);
  expect("profile" in v.data && "profileHash" in v.data.profile).toBe(false);
});
it.each(["projectId", "organizationId", "actorClerkUserId", "actorId"])(
  "refuses changed %s native echo, preserving original pin",
  (field) => {
    const raw = wire("PREVIEW");
    (raw.readContext.scope as Record<string, string>)[field] = "foreign";
    expect(admitRunStartRead(raw, input(true), "PREVIEW", "cl")).toBeNull();
  },
);
it.each(["requestId", "requestedKey", "projection"])(
  "refuses stale or altered %s read echo",
  (field) => {
    const raw = wire();
    (raw.readContext as Record<string, unknown>)[field] = "stale";
    expect(admitRunStartRead(raw, input(), "ACCESS", "cl")).toBeNull();
  },
);
it("a new ACCESS mapping cannot replace original native identity or prove an old submission origin", () => {
  const a = admitRunStartRead(wire(), input(), "ACCESS", "cl")!;
  const raw = wire();
  raw.readContext.scope.actorId = "new";
  expect(admitRunStartRead(raw, input(), "ACCESS", "cl", a.origin)).toBeNull();
  expect(a.origin.nativeActorId).toBe("n");
  expect(admitRunStartRead(wire(), input(), "ACCESS", "different")).toBeNull();
});
it("all current core catalogs and exact UTF-16 jurisdiction boundary match canonical server output", () => {
  const complete = experienceProfileSchema.parse({
    version: 1,
    offerings: EXPERIENCE_OFFERINGS.map((c) => c.id),
    softwareKinds: SOFTWARE_KINDS.map((c) => c.id),
    gameGenres: GAME_GENRES.map((c) => c.id),
    gamePlatforms: GAME_PLATFORMS.map((c) => c.id),
    multiplayerModes: MULTIPLAYER_MODES.map((c) => c.id),
    hardwareKinds: HARDWARE_KINDS.map((c) => c.id),
    processKinds: PROCESS_KINDS.map((c) => c.id),
    jurisdictions: ["🙂".repeat(60)],
  });
  const raw = wire("PREVIEW");
  if (!("profile" in raw) || !raw.profile) throw Error();
  raw.profile.experience = complete;
  const server = manualRunStartReviewedPreviewOutput.parse(raw);
  expect(admitRunStartRead(server, input(true), "PREVIEW", "cl")!.data).toEqual(
    server,
  );
});
it("original pins are complete frozen primitive metadata and descriptor admission precedes every original getter", () => {
  let calls = 0;
  const unsafe = Object.freeze(
    Object.defineProperty({}, "nativeActorId", {
      enumerable: true,
      get() {
        calls++;
        return "n";
      },
    }),
  );
  expect(
    admitRunStartRead(
      wire(),
      input(),
      "ACCESS",
      "cl",
      unsafe as Parameters<typeof admitRunStartRead>[4],
    ),
  ).toBeNull();
  expect(calls).toBe(0);
  const origin = admitRunStartRead(wire(), input(), "ACCESS", "cl")!.origin;
  expect(
    admitRunStartRead(wire(), input(), "ACCESS", "cl", { ...origin }),
  ).toBeNull();
  expect(
    admitRunStartRead(
      wire(),
      input(),
      "ACCESS",
      "cl",
      Object.freeze({ ...origin, private: "unsupported" }),
    ),
  ).toBeNull();
  expect(
    admitRunStartRead(wire(), input(), "ACCESS", "cl", origin)!.origin,
  ).toBe(origin);
});
it.each([false, null, 0, "", [], { version: 0 }].map((value) => ({ value })))(
  "unsupported experience %j is not coerced/defaulted",
  ({ value }) => {
    const raw = wire("PREVIEW") as unknown as {
      profile: { kind: string; experience: unknown; profileHash: string };
    };
    raw.profile.experience = value;
    expect(!!admitRunStartRead(raw, input(true), "PREVIEW", "cl")).toBe(
      value === null,
    );
  },
);
it.each([
  "offerings",
  "softwareKinds",
  "gameGenres",
  "gamePlatforms",
  "multiplayerModes",
  "hardwareKinds",
  "processKinds",
  "jurisdictions",
])(
  "supported profile requires complete %s array without input defaults",
  (field) => {
    const raw = wire("PREVIEW") as ReturnType<typeof wire> & {
      profile: { experience: Record<string, unknown> };
    };
    delete raw.profile.experience[field];
    expect(admitRunStartRead(raw, input(true), "PREVIEW", "cl")).toBeNull();
  },
);
it.each([
  "offerings",
  "softwareKinds",
  "gameGenres",
  "gamePlatforms",
  "multiplayerModes",
  "hardwareKinds",
  "processKinds",
])("rejects unknown and duplicated choices in %s", (field) => {
  const raw = wire("PREVIEW") as ReturnType<typeof wire> & {
    profile: { experience: Record<string, unknown> };
  };
  raw.profile.experience[field] = ["UNKNOWN"];
  expect(admitRunStartRead(raw, input(true), "PREVIEW", "cl")).toBeNull();
  raw.profile.experience[field] = Array(33).fill("OTHER");
  expect(admitRunStartRead(raw, input(true), "PREVIEW", "cl")).toBeNull();
});
it.each([" US ", "", "X".repeat(121)])(
  "does not trim/default unsupported jurisdiction %j",
  (jurisdiction) => {
    const raw = wire("PREVIEW") as ReturnType<typeof wire> & {
      profile: { experience: { jurisdictions: string[] } };
    };
    raw.profile.experience.jurisdictions = [jurisdiction];
    expect(admitRunStartRead(raw, input(true), "PREVIEW", "cl")).toBeNull();
  },
);
it("schema contradictions and extra fields are refused, not stripped", () => {
  const raw = wire("PREVIEW") as Record<string, unknown>;
  raw.canRecover = false;
  expect(admitRunStartRead(raw, input(true), "PREVIEW", "cl")).toBeNull();
  raw.canRecover = true;
  raw.canStart = false;
  expect(admitRunStartRead(raw, input(true), "PREVIEW", "cl")).toBeNull();
  raw.canStart = true;
  raw.cohort = [];
  expect(admitRunStartRead(raw, input(true), "PREVIEW", "cl")).toBeNull();
});
it.each(
  [Array(9).fill(""), ["x".repeat(1001)], [0], [null]].map((limitations) => ({
    limitations,
  })),
)("strict limitations bounds do not clip or coerce %j", ({ limitations }) => {
  const raw = wire("PREVIEW") as Record<string, unknown>;
  raw.limitations = limitations;
  expect(admitRunStartRead(raw, input(true), "PREVIEW", "cl")).toBeNull();
});
it("inspection retains native false/null/0/empty strings with exact JSON bytes and does not mutate input", () => {
  const value = {
    n: null,
    b: false,
    zero: 0,
    text: "",
    multiline: " Raw\n prose ",
    list: [false, 0, null],
  };
  expect(inspectRunStartReadWire(value).bytes).toBe(
    new TextEncoder().encode(JSON.stringify(value)).length,
  );
  expect(value.multiline).toBe(" Raw\n prose ");
  const raw = wire("PREVIEW"),
    before = copy(raw),
    admitted = admitRunStartRead(raw, input(true), "PREVIEW", "cl")!;
  expect(raw).toEqual(before);
  expect(Object.isFrozen(raw)).toBe(false);
  raw.readContext.scope.actorId = "mutated";
  expect(admitted.data.readContext.scope.actorId).toBe("n");
});
it("getters, toJSON, non-enumerable/symbol fields and sparse arrays are rejected before access", () => {
  let calls = 0;
  const getter = Object.defineProperty({}, "readContext", {
    enumerable: true,
    get() {
      calls++;
      throw Error();
    },
  });
  expect(admitRunStartRead(getter, input(), "ACCESS", "cl")).toBeNull();
  expect(calls).toBe(0);
  for (const unsafe of [
    { toJSON: () => 1 },
    Object.defineProperty({}, "secret", { value: 1 }),
    { [Symbol("x")]: 1 },
    Array(1),
  ])
    expect(() => inspectRunStartReadWire(unsafe)).toThrow();
});
it.each([undefined, NaN, Infinity, BigInt(1), () => 1, new Date(), new Map()])(
  "unsafe non-wire primitive or object never reaches serialization",
  (unsafe) => {
    expect(() => inspectRunStartReadWire(unsafe)).toThrow();
  },
);
it("count/depth/bytes and Unicode boundaries are complete and not clipped", () => {
  expect(() => inspectRunStartReadWire(Array(1001).fill(0))).toThrow();
  expect(() =>
    inspectRunStartReadWire(
      Array.from({ length: 100 }, () => Array(1000).fill(0)),
    ),
  ).toThrow();
  expect(() =>
    inspectRunStartReadWire(
      Object.fromEntries(
        Array.from({ length: 10001 }, (_, n) => [String(n), 0]),
      ),
    ),
  ).toThrow();
  expect(inspectRunStartReadWire("", 2).bytes).toBe(2);
  expect(() => inspectRunStartReadWire("", 1)).toThrow();
  let deep: unknown = 0;
  for (let n = 0; n < 65; n++) deep = { value: deep };
  expect(() => inspectRunStartReadWire(deep)).toThrow();
  expect(() =>
    inspectRunStartReadWire("x".repeat(RUN_START_READ_BOUNDS.PREVIEW)),
  ).toThrow();
  expect(() => inspectRunStartReadWire("\ud800")).toThrow();
  expect(inspectRunStartReadWire("🙂").bytes).toBe(6);
  expect(runStartReadIdentity("x".repeat(200))).toBe(true);
  expect(runStartReadIdentity("🙂".repeat(101))).toBe(false);
  expect(runStartReadIdentity("invisible\u007f")).toBe(false);
});
it("PREVIEW request must pin native N; optional own undefined and extra request fields refuse before echo", () => {
  expect(() => runStartReviewedReadKey(input(), "PREVIEW")).toThrow();
  expect(() =>
    runStartReviewedReadKey(
      { ...input(), expectedNativeActorId: undefined },
      "ACCESS",
    ),
  ).toThrow();
  expect(() =>
    runStartReviewedReadKey(
      { ...input(), extra: 1 } as RunStartReadInput,
      "ACCESS",
    ),
  ).toThrow();
});
it("render revocation permanently blocks an old nonce, including cache/session A-B-A and stale layout", () => {
  const g = new RunStartReadRenderGuard(),
    f = {},
    v = {},
    stamp = g.observe(f, v),
    a = input().requestId,
    b = "2eeeec04-4d34-40bf-b0e9-000000000002";
  expect(g.matchesRead(stamp, a)).toBe(true);
  g.revokeCache(a);
  expect(g.matchesRead(stamp, a)).toBe(false);
  const renewed = g.observe(f, v);
  expect(g.matchesRead(renewed, a)).toBe(false);
  expect(g.matchesRead(renewed, b)).toBe(true);
  const next = g.observe({}, {});
  expect(g.matchesRender(renewed)).toBe(false);
  g.revokeActions();
  expect(g.matchesRender(next)).toBe(false);
});
it("finite retired UUID history permanently refuses whole reader exhaustion without pruning or reviving any old nonce", () => {
  const g = new RunStartReadRenderGuard();
  const nonce = (n: number) =>
    `2eeeec04-4d34-40bf-b0e9-${String(n).padStart(12, "0")}`;
  for (let n = 1; n <= RUN_START_READ_BOUNDS.retiredNonces; n++)
    g.revokeCache(nonce(n));
  expect(g.canRenew()).toBe(true);
  expect(g.isBlocked(nonce(1))).toBe(true);
  g.revokeCache(nonce(RUN_START_READ_BOUNDS.retiredNonces + 1));
  expect(g.canRenew()).toBe(false);
  expect(g.isBlocked(nonce(1))).toBe(true);
  expect(g.isBlocked(nonce(999999))).toBe(true);
  expect(g.matchesRead(g.observe({}, {}), nonce(999999))).toBe(false);
  const corrupt = new RunStartReadRenderGuard();
  corrupt.revokeCache("unsupported");
  expect(corrupt.canRenew()).toBe(false);
});
it("production dependency graph contains no runtime server/schema/core/Node import", () => {
  const files = [
    "manual-run-start-reviewed-reader.ts",
    "use-manual-run-start-reviewed-access.ts",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8"),
      ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const imports = ast.statements
      .filter(ts.isImportDeclaration)
      .filter((n) => !n.importClause?.isTypeOnly)
      .map((n) => (n.moduleSpecifier as ts.StringLiteral).text);
    expect(
      imports.every(
        (s) =>
          !s.startsWith("node:") &&
          !s.includes("/api/") &&
          !s.includes("@vaettir/core"),
      ),
    ).toBe(true);
  }
});
