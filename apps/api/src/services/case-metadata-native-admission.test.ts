// PURE/READ-ONLY source contracts. Does not import native fixture, DB or router.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  admitReviewedMetadataFixture,
  metadataFixturePath,
  metadataSha,
  metadataMigrationsFingerprint,
  metadataSourceFingerprint,
  type MetadataNativeManifest,
} from "./case-metadata-native-admission.js";
const now = Date.parse("2026-10-06T05:00:00.000Z"),
  token = "synthetic-private-once-only-token";
const sources = [
  {
    path: metadataFixturePath,
    hash: metadataSha("synthetic fixture source"),
    bytes: 24,
  },
  {
    path: "packages/db/prisma/migrations/synthetic/migration.sql",
    hash: metadataSha("synthetic migration source"),
    bytes: 26,
  },
];
const makeManifest = (): MetadataNativeManifest => ({
  kind: "VaettirReviewedMetadataNative/v1",
  owner: "Codex root Vaettir",
  route: "LOCAL_DISPOSABLE",
  database: "vaettir_day_test_1791262800000",
  fixture: metadataFixturePath,
  createdAt: new Date(now).toISOString(),
  snapshotHash: metadataSourceFingerprint(sources),
  executionTokenHash: metadataSha(token),
  sources,
  coherence: {
    schemaHash: metadataSha("schema"),
    generatedSchemaHash: metadataSha("schema"),
    clientBuildHash: metadataSha("client"),
    workspaceBuildHash: metadataSha("shared runtime"),
    migrationsHash: metadataSha(
      JSON.stringify(
        sources.filter((entry) =>
          entry.path.startsWith("packages/db/prisma/migrations/"),
        ),
      ),
    ),
    driverHash: metadataSha("driver"),
    generatedAndBuilt: true,
    migratedAndSeeded: true,
  },
  retained: true,
  cloud: false,
  customerData: false,
});
const environment = () => ({
  DATABASE_URL:
    "postgresql://synthetic:synthetic@127.0.0.1:5432/vaettir_day_test_1791262800000?schema=public&connection_limit=5",
  VAETTIR_CASE_METADATA_NATIVE_FIXTURE: "yes",
  VAETTIR_CASE_METADATA_NATIVE_TOKEN: token,
});
describe("pure exact owned metadata native admission", () => {
  it("returns only bounded database/source identity, not connection credentials", () => {
    expect(
      admitReviewedMetadataFixture(environment(), makeManifest(), sources, now),
    ).toEqual({
      database: "vaettir_day_test_1791262800000",
      snapshotHash: metadataSourceFingerprint(sources),
      retained: true,
    });
  });
  it.each([
    "VAETTIR_CASE_METADATA_NATIVE_FIXTURE",
    "VAETTIR_CASE_METADATA_NATIVE_TOKEN",
  ])("requires explicit %s", (key) => {
    const env: Record<string, string | undefined> = environment();
    delete env[key];
    expect(() =>
      admitReviewedMetadataFixture(env, makeManifest(), sources, now),
    ).toThrow();
  });
  it.each([
    "postgresql://synthetic@remote.invalid:5432/vaettir_day_test_1791262800000",
    "postgresql://synthetic@localhost:5433/vaettir_day_test_1791262800000",
    "postgresql://synthetic@localhost:5432/test",
    "postgresql://synthetic@localhost:5432/vaettir_day_test_1791262800000?schema=private",
    "postgresql://synthetic@localhost:5432/vaettir_day_test_1791262800000?connection_limit=6",
    "postgresql://synthetic@localhost:5432/vaettir_day_test_1791262800000?schema=public&schema=public",
    "postgresql://synthetic@localhost:5432/vaettir_day_test_1791262800001",
  ])("refuses unsupported or different route %s", (DATABASE_URL) => {
    expect(() =>
      admitReviewedMetadataFixture(
        { ...environment(), DATABASE_URL },
        makeManifest(),
        sources,
        now,
      ),
    ).toThrow();
  });
  it("refuses expired/future manifests, changed token and schema mismatch", () => {
    for (const delta of [-3_600_001, 1])
      expect(() =>
        admitReviewedMetadataFixture(
          environment(),
          { ...makeManifest(), createdAt: new Date(now + delta).toISOString() },
          sources,
          now,
        ),
      ).toThrow();
    expect(() =>
      admitReviewedMetadataFixture(
        { ...environment(), VAETTIR_CASE_METADATA_NATIVE_TOKEN: "wrong" },
        makeManifest(),
        sources,
        now,
      ),
    ).toThrow();
    const manifest = makeManifest();
    manifest.coherence.generatedSchemaHash = metadataSha("changed");
    expect(() =>
      admitReviewedMetadataFixture(environment(), manifest, sources, now),
    ).toThrow();
  });
  it("refuses changed source, invented migration coherence and secret/unknown manifest properties", () => {
    expect(() =>
      admitReviewedMetadataFixture(
        environment(),
        makeManifest(),
        [{ ...sources[0]!, hash: metadataSha("new source") }, sources[1]!],
        now,
      ),
    ).toThrow();
    const manifest = makeManifest();
    manifest.coherence.migrationsHash = metadataSha("invented");
    expect(() =>
      admitReviewedMetadataFixture(environment(), manifest, sources, now),
    ).toThrow();
    expect(() =>
      admitReviewedMetadataFixture(
        environment(),
        { ...makeManifest(), DATABASE_URL: "must never be in manifest" },
        sources,
        now,
      ),
    ).toThrow();
  });
  it.each([
    "../outside.ts",
    "apps/api/.env",
    "apps/api/.env.production",
    "apps/api/node_modules/runtime.js",
    "apps/api/dist/server.js",
    "apps/api/src/../../private.ts",
    "apps\\api\\src\\server.ts",
  ])("rejects unowned/credential/build inventory %s", (path) => {
    expect(() =>
      metadataSourceFingerprint([
        ...sources,
        { path, hash: metadataSha("x"), bytes: 1 },
      ]),
    ).toThrow();
  });
  it("requires the fixture, unique paths and complete source bounds", () => {
    expect(() => metadataSourceFingerprint(sources.slice(1))).toThrow();
    expect(() =>
      metadataSourceFingerprint([...sources, sources[0]!]),
    ).toThrow();
    expect(() =>
      metadataSourceFingerprint([{ ...sources[0]!, bytes: 20_000_001 }]),
    ).toThrow();
    expect(metadataSourceFingerprint([...sources].reverse())).toBe(
      metadataSourceFingerprint(sources),
    );
  });
  it("canonicalizes permuted migration/source inventories consistently", () => {
    const more = [
      ...sources,
      {
        path: "packages/db/prisma/migrations/other/migration.sql",
        hash: metadataSha("another migration"),
        bytes: 18,
      },
    ];
    const manifest = makeManifest();
    manifest.sources = more;
    manifest.snapshotHash = metadataSourceFingerprint(more);
    manifest.coherence.migrationsHash = metadataMigrationsFingerprint(more);
    expect(
      admitReviewedMetadataFixture(
        environment(),
        { ...manifest, sources: [...more].reverse() },
        [...more].reverse(),
        now,
      ).snapshotHash,
    ).toBe(manifest.snapshotHash);
    expect(metadataMigrationsFingerprint([...more].reverse())).toBe(
      manifest.coherence.migrationsHash,
    );
    expect(
      metadataMigrationsFingerprint([
        { ...more[2]!, hash: metadataSha("changed migration") },
        ...sources,
      ]),
    ).not.toBe(manifest.coherence.migrationsHash);
  });
});
describe("authored-only native fixture and driver source contracts", () => {
  const fixture = readFileSync(
    new URL("./case-metadata-reviewed.integration.test.ts", import.meta.url),
    "utf8",
  );
  function registrations(text: string) {
    const source = ts.createSourceFile(
      "fixture.ts",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const calls: ts.CallExpression[] = [];
    const family = (node: ts.Expression): string | null =>
      ts.isIdentifier(node)
        ? node.text
        : ts.isPropertyAccessExpression(node) || ts.isCallExpression(node)
          ? family(node.expression)
          : null;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    const suites = calls.filter(
      (node) =>
        family(node.expression) === "describe" &&
        node.arguments.some(
          (arg) =>
            (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) &&
            ts.isBlock(arg.body),
        ),
    );
    expect(suites).toHaveLength(1);
    const callback = suites[0]!.arguments.find(
      (arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg),
    ) as ts.ArrowFunction;
    const tests = calls.filter((node) => family(node.expression) === "it");
    return {
      tests,
      indirect: tests.filter(
        (node) =>
          !ts.isExpressionStatement(node.parent) ||
          node.parent.parent !== callback.body,
      ),
    };
  }
  it("all eight native test registrations are direct suite-body statements, not nested callbacks/helpers", () => {
    const found = registrations(fixture);
    expect(found.tests).toHaveLength(8);
    expect(found.indirect).toHaveLength(0);
  });
  it("AST registration guard catches nested it() and delayed helper registration", () => {
    expect(
      registrations(
        'describe("owned",()=>{it("outer",()=>{it("nested",()=>{});});});',
      ).indirect,
    ).toHaveLength(1);
    expect(
      registrations(
        'describe("owned",()=>{it("outer",()=>{it("nested without callback");});});',
      ).indirect,
    ).toHaveLength(1);
    expect(
      registrations(
        'describe("owned",()=>{function later(){it("delayed",()=>{});} later();});',
      ).indirect,
    ).toHaveLength(1);
    expect(
      registrations(
        'describe("owned",()=>{it("direct",()=>{const text="it(ignored text)";});});',
      ).indirect,
    ).toHaveLength(0);
  });
  it("places exact source/token admission and exclusive claim before dynamic DB/router imports", () => {
    const admission = fixture.indexOf(
        "const admitted = admitReviewedMetadataFixture",
      ),
      claim = fixture.indexOf('"fixture-claim.json"'),
      runtime = fixture.indexOf(
        'import("@vaettir/db/dist/constraintCheckedClient.js")',
      );
    expect(admission).toBeGreaterThan(0);
    expect(claim).toBeGreaterThan(admission);
    expect(runtime).toBeGreaterThan(claim);
    const driverImport = fixture.indexOf("await import(driverUrl)");
    expect(
      fixture.indexOf(
        "admitReviewedMetadataFixture(captured, manifest, manifest.sources)",
      ),
    ).toBeLessThan(driverImport);
    expect(
      fixture.indexOf('throw Error("Reviewed local driver source required")'),
    ).toBeLessThan(driverImport);
    expect(fixture).not.toMatch(
      /^import(?! type).*from ["'](?:@vaettir\/db|\.\.\/router)/m,
    );
    expect(fixture).toContain('flag: "wx"');
    expect(fixture).toContain("if (db) await db.$disconnect()");
    expect(fixture).not.toMatch(
      /hardDeleteOrganization\s*\(|DROP\s+(?:DATABASE|TABLE)|ALTER\s+TABLE/i,
    );
  });
  it("contains new scoped wrappers, raw native canaries and explicit concurrency outcome assertions", () => {
    for (const literal of [
      "restoreReviewed",
      "setReviewed",
      "reviewedSetPrerequisites",
      "readRequestId",
      "expectedNativeActorId",
      "scopeProof",
      "9007199254740993",
      "jsonNull",
      "APPLICATION_CAS_CONFLICT",
      "NATIVE_SERIALIZATION_ABORT",
      "UNEXPECTED_ABORT",
      "expectedGraphHash",
    ])
      expect(fixture).toContain(literal);
    expect(fixture).toContain("expect(won).toHaveLength(1)");
    expect(fixture).toContain('expect(code).not.toBe("UNEXPECTED_ABORT")');
    expect(fixture).not.toMatch(/\.approve\s*\(|\.worker\s*\(|\.grant\s*\(/);
  });
});
