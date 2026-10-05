// Real PostgreSQL TEMP/native-scope regressions. Never run on a customer DB.
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

const familyNames = ["Project", "TestCase", "TestPlan", "TestRun", "Release", "TestSelectionRun", "CoverageReport", "ExploratorySession", "WebhookEndpoint", "TestResult"];
function sqlText(value: unknown) {
  const strings = Array.isArray(value) ? value : value && typeof value === "object" && "strings" in value && Array.isArray(value.strings) ? value.strings : [];
  return strings.join("").replace(/\s+/g, " ").trim();
}
type CatalogFault = "MISSING" | "NONDETERMINISTIC_PURE_GUARD" | "MALFORMED" | "CATALOG_ERROR";
function transactionClient(effect: (tx: Prisma.TransactionClient) => Promise<void>, observations: unknown[][], catalogFault?: CatalogFault, catalogObservations?: unknown[][]) {
  return new Proxy(prisma, { get(target, property) {
    if (property === "$transaction") return (...args: unknown[]) => {
      const work = args[0];
      if (typeof work !== "function") throw Error("Real erasure interactive transaction required");
      return Reflect.apply(target.$transaction, target, [async (tx: Prisma.TransactionClient) => work(new Proxy(tx, { get(transaction, member) {
        if (member === "$executeRaw") return async (...query: unknown[]) => {
          const result = await Reflect.apply(transaction.$executeRaw, transaction, query);
          if (sqlText(query[0]) === "ANALYZE pg_temp.vaettir_native_erasure_scope") await effect(transaction);
          return result;
        };
        if (member === "$queryRaw") return async (...query: unknown[]) => {
          const result: unknown = await Reflect.apply(transaction.$queryRaw, transaction, query);
          if (sqlText(query[0]).includes("table_info.relnamespace=pg_my_temp_schema()")) {
            if (!Array.isArray(result)) throw Error("Actual native catalog eligibility rows required before scoped fault");
            catalogObservations?.push(result);
            // Pure response-fault fixtures only; no catalog/collation mutation,
            // disabled guard or claim of an actual nondeterministic server.
            if (catalogFault === "CATALOG_ERROR") throw Error("Synthetic bounded catalog-read refusal");
            if (catalogFault === "MISSING") return [];
            if (catalogFault === "NONDETERMINISTIC_PURE_GUARD") return [{ eligible: false }];
            if (catalogFault === "MALFORMED") return [{ eligible: null }];
          }
          if (sqlText(query[0]).includes("current_scope AS MATERIALIZED") && sqlText(query[0]).includes("captured_scope AS MATERIALIZED")) {
            if (!Array.isArray(result)) throw Error("Actual full native reconciliation rows required");
            observations.push(result);
          }
          return result;
        };
        const value = Reflect.get(transaction, member);
        return typeof value === "function" ? value.bind(transaction) : value;
      } })), ...args.slice(1)]); // Exact original transaction options preserved.
    };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

describe("fixed-family native erasure staging and exact set reconciliation", () => {
  const tag = `native-set-${randomUUID()}`;
  const owned = new Map<string, string>();
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host")) throw Error("Owned disposable loopback DB required");
  });
  afterEach(async () => {
    for (const [organizationId, actorId] of owned) {
      const org = await prisma.organization.findUnique({ where: { id: organizationId } });
      if (org) {
        if (!org.slug.startsWith(tag)) throw Error("Synthetic native set fixture ownership mismatch");
        await hardDeleteOrganization(prisma, organizationId, actorId, "Owned native set regression cleanup");
      }
      expect(await prisma.organizationDeletionLog.count({ where: { organizationId, deletedById: actorId } })).toBe(1);
    }
    // Retain all permanent deletion receipts and their dedicated synthetic actors.
    owned.clear();
  });
  async function setup() {
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const actor = await prisma.user.create({ data: { clerkUserId: `${tag}-${randomUUID()}`, email: `${tag}-${randomUUID()}@example.com` } });
    async function cohort() {
      const slug = `${tag}-${randomUUID()}`;
      const org = await prisma.organization.create({ data: {
        name: slug, slug, planTierId: tier.id,
        memberships: { create: { userId: actor.id, role: "OWNER", seatType: "FULL" } },
      } });
      owned.set(org.id, actor.id);
      const project = await prisma.project.create({ data: { organizationId: org.id, name: slug, slug, caseKey: `s${randomUUID().replaceAll("-", "").slice(0, 14)}` } });
      const cases = [];
      for (let index = 0; index < 2; index++) {
        const tc = await prisma.testCase.create({ data: { projectId: project.id, title: `Synthetic retained case ${index}`, testType: "FUNCTIONAL", given: ["Synthetic given"], when: ["Synthetic when"], then: ["Synthetic then"], tags: [], createdById: actor.id } });
        cases.push(tc);
        await prisma.testCaseStep.create({ data: { testCaseId: tc.id, order: 0, action: "Synthetic unchanged action" } });
        await prisma.testCaseVersion.create({ data: { testCaseId: tc.id, versionNumber: 1, title: tc.title, given: tc.given, when: tc.when, then: tc.then, tags: [], steps: [], priority: "MEDIUM", testType: "FUNCTIONAL", createdById: actor.id } });
      }
      const run = await prisma.testRun.create({ data: { projectId: project.id, ciProvider: "synthetic-native-set", commitSha: "synthetic-only", branch: "synthetic", startedAt: new Date("2026-01-01T00:00:00Z") } });
      await prisma.testResult.createMany({ data: cases.map(tc => ({ testRunId: run.id, testCaseId: tc.id, status: "FAIL" as const })) });
      return { org, project, cases, run };
    }
    const own = await cohort(), foreign = await cohort();
    const receiptOrg = await prisma.organization.create({ data: { name: `${tag}-receipt`, slug: `${tag}-${randomUUID()}`, planTierId: tier.id } });
    owned.set(receiptOrg.id, actor.id);
    const deleted = await hardDeleteOrganization(prisma, receiptOrg.id, actor.id, "Synthetic retained foreign receipt sentinel");
    const retainedReceipt = await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: deleted.deletionLogId } });
    return { own, foreign, actor, retainedReceipt };
  }
  async function snapshot(scope: Awaited<ReturnType<typeof setup>>["own"]) {
    return {
      org: await prisma.organization.findUniqueOrThrow({ where: { id: scope.org.id } }),
      project: await prisma.project.findUniqueOrThrow({ where: { id: scope.project.id } }),
      cases: await prisma.testCase.findMany({ where: { projectId: scope.project.id }, orderBy: { id: "asc" }, include: { steps: { orderBy: { order: "asc" } }, versions: { orderBy: { versionNumber: "asc" } } } }),
      run: await prisma.testRun.findUniqueOrThrow({ where: { id: scope.run.id }, include: { results: { orderBy: { id: "asc" } } } }),
    };
  }
  async function preserved(fixture: Awaited<ReturnType<typeof setup>>, ownBefore: unknown, foreignBefore: unknown) {
    expect(await snapshot(fixture.own)).toEqual(ownBefore);
    expect(await snapshot(fixture.foreign)).toEqual(foreignBefore);
    expect(await prisma.organizationDeletionLog.count({ where: { organizationId: fixture.own.org.id } })).toBe(0);
    expect(await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: fixture.retainedReceipt.id } })).toEqual(fixture.retainedReceipt);
  }
  async function verifyActualPrivateIndex(tx: Prisma.TransactionClient, expectedOpclass: "text_ops" | "text_pattern_ops") {
    const rows = await tx.$queryRaw<Array<{ sessionOwned: boolean; nativeTypes: boolean; nativeNullGuards: boolean; nativeCollation: boolean; uniqueReady: boolean; nativeKeys: boolean; modelOpclass: string; idOpclass: string; nativeNamespace: boolean }>>`SELECT
      table_info.relnamespace=pg_my_temp_schema() AND table_info.relpersistence='t' AS "sessionOwned",
      model_column.atttypid='pg_catalog.int2'::regtype AND id_column.atttypid='pg_catalog.text'::regtype AS "nativeTypes",
      model_column.attnotnull AND id_column.attnotnull AS "nativeNullGuards",
      id_column.attcollation='pg_catalog."default"'::regcollation AND index_info.indcollation[0]=0
        AND index_info.indcollation[1]=id_column.attcollation AS "nativeCollation",
      index_info.indisunique AND index_info.indisvalid AND index_info.indisready AND index_info.indislive AS "uniqueReady",
      index_info.indpred IS NULL AND index_info.indexprs IS NULL AND index_info.indnkeyatts=2
        AND index_info.indkey[0]=model_column.attnum AND index_info.indkey[1]=id_column.attnum AS "nativeKeys",
      model_opclass.opcname AS "modelOpclass",id_opclass.opcname AS "idOpclass",
      model_opclass.opcnamespace='pg_catalog'::regnamespace AND id_opclass.opcnamespace='pg_catalog'::regnamespace AS "nativeNamespace"
      FROM pg_class table_info
      JOIN pg_attribute model_column ON model_column.attrelid=table_info.oid AND model_column.attname='model' AND NOT model_column.attisdropped
      JOIN pg_attribute id_column ON id_column.attrelid=table_info.oid AND id_column.attname='id' AND NOT id_column.attisdropped
      JOIN pg_index index_info ON index_info.indrelid=table_info.oid
      JOIN pg_class index_name ON index_name.oid=index_info.indexrelid AND index_name.relname='vaettir_native_erasure_scope_identity_idx'
      JOIN pg_opclass model_opclass ON model_opclass.oid=index_info.indclass[0]
      JOIN pg_opclass id_opclass ON id_opclass.oid=index_info.indclass[1]
      WHERE table_info.oid='pg_temp.vaettir_native_erasure_scope'::regclass LIMIT 2`;
    expect(rows).toEqual([{ sessionOwned: true, nativeTypes: true, nativeNullGuards: true, nativeCollation: true, uniqueReady: true,
      nativeKeys: true, modelOpclass: "int2_ops", idOpclass: expectedOpclass, nativeNamespace: true }]);
  }
  for (const fault of [undefined, "MISSING", "NONDETERMINISTIC_PURE_GUARD", "MALFORMED"] as const) it(`selects actual private ${fault ? "default fallback" : "catalog-proven pattern"} index (${fault ?? "REAL_CATALOG"}) with unchanged equality/constraints`, async () => {
    const fixture = await setup(), observations: unknown[][] = [], catalogObservations: unknown[][] = [];
    const foreignBefore = await snapshot(fixture.foreign);
    let inspected = false;
    const client = transactionClient(async tx => {
      inspected = true;
      await verifyActualPrivateIndex(tx, fault ? "text_ops" : "text_pattern_ops");
      // Native TEXT equality remains distinct for case, padding and NFC/NFD.
      // Scope3 is actually empty; rollback only these synthetic TEMP strings.
      await tx.$executeRaw`SAVEPOINT synthetic_index_equality`;
      try {
        await tx.$executeRaw`INSERT INTO pg_temp.vaettir_native_erasure_scope(model,id)
          VALUES(3,'ASCII-id'),(3,'ascii-id'),(3,'é'),(3,'é'),(3,' space'),(3,'space'),(3,'𐀀'),(3,'�')`;
        const rows = await tx.$queryRaw<Array<{ count: bigint; distinctCount: bigint }>>`SELECT count(*)::bigint AS count,
          count(DISTINCT id)::bigint AS "distinctCount" FROM pg_temp.vaettir_native_erasure_scope WHERE model=3`;
        expect(rows).toEqual([{ count: 8n, distinctCount: 8n }]);
      } finally {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT synthetic_index_equality`;
        await tx.$executeRaw`RELEASE SAVEPOINT synthetic_index_equality`;
      }
      for (const violation of ["DUPLICATE", "NULL_ID", "NULL_FAMILY", "FAMILY_RANGE", "FAMILY_TYPE"] as const) {
        await tx.$executeRaw`SAVEPOINT synthetic_index_constraint`;
        let refused = false;
        try {
          if (violation === "DUPLICATE") await tx.$executeRaw`INSERT INTO pg_temp.vaettir_native_erasure_scope(model,id) VALUES(2,${fixture.own.cases[0]!.id})`;
          else if (violation === "NULL_ID") await tx.$executeRaw`INSERT INTO pg_temp.vaettir_native_erasure_scope(model,id) VALUES(3,NULL)`;
          else if (violation === "NULL_FAMILY") await tx.$executeRaw`INSERT INTO pg_temp.vaettir_native_erasure_scope(model,id) VALUES(NULL,'synthetic-null-family')`;
          else if (violation === "FAMILY_RANGE") await tx.$executeRaw`INSERT INTO pg_temp.vaettir_native_erasure_scope(model,id) VALUES(11,'synthetic-invalid-family')`;
          else await tx.$executeRaw`INSERT INTO pg_temp.vaettir_native_erasure_scope(model,id) VALUES(${"synthetic-not-smallint"}::smallint,'synthetic-invalid-type')`;
        } catch (error) {
          expect(error).toMatchObject({ code: "P2010", meta: { code: violation === "DUPLICATE" ? "23505" : violation === "FAMILY_RANGE" ? "23514" : violation === "FAMILY_TYPE" ? "22P02" : "23502" } });
          refused = true;
        } finally {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT synthetic_index_constraint`;
          await tx.$executeRaw`RELEASE SAVEPOINT synthetic_index_constraint`;
        }
        expect(refused).toBe(true);
      }
    }, observations, fault, catalogObservations);
    const deleted = await hardDeleteOrganization(client, fixture.own.org.id, fixture.actor.id, "Synthetic private index branch with exact native scope");
    expect(inspected).toBe(true);
    expect(catalogObservations).toEqual([[{ eligible: true }]]); // Actual supported deterministic catalog; fault applied only afterward.
    expect(observations).toHaveLength(1);
    expect(observations[0]).toHaveLength(10);
    expect(observations[0]).toEqual(expect.arrayContaining(familyNames.map(model => expect.objectContaining({ model, changed: false }))));
    expect(deleted.rowCounts).toMatchObject({ Project: 1, TestCase: 2, TestResult: 2, TestRun: 1, TestCaseStep: 2, TestCaseVersion: 2 });
    expect(await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: deleted.deletionLogId } })).toMatchObject({ organizationId: fixture.own.org.id, deletedById: fixture.actor.id, rowCounts: deleted.rowCounts });
    expect(await snapshot(fixture.foreign)).toEqual(foreignBefore);
    expect(await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: fixture.retainedReceipt.id } })).toEqual(fixture.retainedReceipt);
  });
  it("does not treat a catalog-read exception as permission to bypass native staging guards", async () => {
    const fixture = await setup(), observations: unknown[][] = [], catalogObservations: unknown[][] = [];
    const ownBefore = await snapshot(fixture.own), foreignBefore = await snapshot(fixture.foreign);
    let indexBuilt = false;
    const client = transactionClient(async () => { indexBuilt = true; }, observations, "CATALOG_ERROR", catalogObservations);
    await expect(hardDeleteOrganization(client, fixture.own.org.id, fixture.actor.id, "Synthetic catalog refusal must roll back all native bodies")).rejects.toThrow("Synthetic bounded catalog-read refusal");
    expect(catalogObservations).toEqual([[{ eligible: true }]]);
    expect(indexBuilt).toBe(false);
    expect(observations).toHaveLength(0);
    await preserved(fixture, ownBefore, foreignBefore);
  });
  for (const scenario of ["SAME_COUNT_SUBSTITUTION", "MISSING", "EXTRA", "EMPTY_CAPTURE"] as const) it(`refuses genuine TEMP ${scenario} with all native bodies/history retained atomically`, async () => {
    const fixture = await setup();
    const ownBefore = await snapshot(fixture.own), foreignBefore = await snapshot(fixture.foreign), observations: unknown[][] = [];
    let applied = false;
    const client = transactionClient(async tx => {
      expect(applied).toBe(false); applied = true;
      const [{ kind }] = await tx.$queryRaw<Array<{ kind: string }>>`SELECT format_type(atttypid,atttypmod) AS kind FROM pg_attribute WHERE attrelid='pg_temp.vaettir_native_erasure_scope'::regclass AND attname='model' AND NOT attisdropped`;
      expect(kind).toBe("smallint");
      const ownCase = fixture.own.cases[0]!.id, foreignCase = fixture.foreign.cases[0]!.id;
      if (scenario === "SAME_COUNT_SUBSTITUTION" || scenario === "MISSING") await tx.$executeRaw`DELETE FROM pg_temp.vaettir_native_erasure_scope WHERE model=2 AND id=${ownCase}`;
      if (scenario === "SAME_COUNT_SUBSTITUTION" || scenario === "EXTRA") await tx.$executeRaw`INSERT INTO pg_temp.vaettir_native_erasure_scope(model,id) VALUES(2,${foreignCase})`;
      if (scenario === "EMPTY_CAPTURE") await tx.$executeRaw`DELETE FROM pg_temp.vaettir_native_erasure_scope WHERE model=2`;
    }, observations);
    await expect(hardDeleteOrganization(client, fixture.own.org.id, fixture.actor.id, "Synthetic adversarial native set must refuse")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(applied).toBe(true);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toHaveLength(10);
    const rows = observations[0]!;
    if (!rows.every((row): row is { model: string; count: bigint; bytes: bigint; changed: boolean } => row !== null && typeof row === "object" && "model" in row && typeof row.model === "string" && "count" in row && typeof row.count === "bigint" && "bytes" in row && typeof row.bytes === "bigint" && "changed" in row && typeof row.changed === "boolean")) throw Error("Actual supported native reconciliation metadata required");
    expect(new Set(rows.map(row => row.model))).toEqual(new Set(familyNames));
    expect(rows.filter(row => row.changed).map(row => row.model)).toEqual(["TestCase"]);
    expect(rows.find(row => row.model === "TestCase")?.count).toBe(2n);
    expect(rows.find(row => row.model === "TestPlan")).toMatchObject({ count: 0n, bytes: 2n, changed: false });
    await preserved(fixture, ownBefore, foreignBefore);
  });
  for (const kind of ["DUPLICATE", "NULL"] as const) it(`retains native TEMP ${kind} constraint refusal and complete atomic rollback`, async () => {
    const fixture = await setup(), observations: unknown[][] = [];
    const ownBefore = await snapshot(fixture.own), foreignBefore = await snapshot(fixture.foreign);
    let attempted = false;
    const client = transactionClient(async tx => {
      attempted = true;
      if (kind === "DUPLICATE") await tx.$executeRaw`INSERT INTO pg_temp.vaettir_native_erasure_scope(model,id) VALUES(2,${fixture.own.cases[0]!.id})`;
      else await tx.$executeRaw`INSERT INTO pg_temp.vaettir_native_erasure_scope(model,id) VALUES(2,NULL)`;
    }, observations);
    await expect(hardDeleteOrganization(client, fixture.own.org.id, fixture.actor.id, "Synthetic native invalid scope must refuse")).rejects.toMatchObject({ code: "P2010", meta: { code: kind === "DUPLICATE" ? "23505" : "23502" } });
    expect(attempted).toBe(true);
    expect(observations).toHaveLength(0);
    await preserved(fixture, ownBefore, foreignBefore);
  });
  it("refuses a genuine changed current native cardinality and rolls its added row back with the entire attempt", async () => {
    const fixture = await setup(), observations: unknown[][] = [];
    const ownBefore = await snapshot(fixture.own), foreignBefore = await snapshot(fixture.foreign);
    let insertedId: string | undefined;
    const client = transactionClient(async tx => {
      // Synthetic DML inside the actual erasure transaction, not a fabricated
      // reconciliation count. The native PK/identity/field guards stay enabled.
      const extra = await tx.testCase.create({ data: { projectId: fixture.own.project.id, title: "Synthetic source cardinality changed", testType: "FUNCTIONAL" } });
      insertedId = extra.id;
    }, observations);
    await expect(hardDeleteOrganization(client, fixture.own.org.id, fixture.actor.id, "Synthetic current source cardinality must refuse")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(insertedId).toBeDefined();
    expect(observations).toHaveLength(1);
    expect(observations[0]).toHaveLength(10);
    expect(observations[0]).toEqual(expect.arrayContaining([expect.objectContaining({ model: "TestCase", count: 3n, changed: true })]));
    expect(await prisma.testCase.count({ where: { id: insertedId } })).toBe(0);
    await preserved(fixture, ownBefore, foreignBefore);
  });
  for (const kind of ["DUPLICATE", "NULL"] as const) it(`refuses narrowly fault-injected ${kind} capture while native primary-key constraints remain intact`, async () => {
    const fixture = await setup();
    const ownBefore = await snapshot(fixture.own), foreignBefore = await snapshot(fixture.foreign);
    let injected = false;
    const client = new Proxy(prisma, { get(target, property) {
      if (property === "$queryRaw") return async (...args: unknown[]) => {
        const rows: unknown = await Reflect.apply(target.$queryRaw, target, args);
        if (!injected && sqlText(args[0]).startsWith('SELECT id FROM "TestCase" WHERE ')) {
          if (!Array.isArray(rows) || rows.length !== 2 || !rows.every(row => fixture.own.cases.some(tc => tc.id === row.id))) throw Error("Exact actual owned capture required before scoped fault");
          injected = true;
          return [rows[0], { ...rows[1], id: kind === "NULL" ? null : rows[0].id }];
        }
        return rows;
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(hardDeleteOrganization(client, fixture.own.org.id, fixture.actor.id, "Synthetic malformed capture must refuse")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(injected).toBe(true);
    await preserved(fixture, ownBefore, foreignBefore);
  });
  it("reconciles every actual complete family including zeros before real small erasure with exact counts", async () => {
    const fixture = await setup(), observations: unknown[][] = [];
    const foreignBefore = await snapshot(fixture.foreign);
    const client = transactionClient(async tx => {
      const [{ count }] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM pg_temp.vaettir_native_erasure_scope WHERE model BETWEEN 1 AND 10`;
      expect(count).toBe(6n); // One project, two cases, one run, two results.
    }, observations);
    const deleted = await hardDeleteOrganization(client, fixture.own.org.id, fixture.actor.id, "Synthetic complete fixed-key scope erasure");
    expect(observations).toHaveLength(1);
    expect(observations[0]).toHaveLength(10);
    expect(observations[0]).toEqual(expect.arrayContaining(familyNames.map(model => expect.objectContaining({ model, changed: false }))));
    expect(deleted.rowCounts).toMatchObject({ Project: 1, TestCase: 2, TestResult: 2, TestRun: 1, TestCaseStep: 2, TestCaseVersion: 2 });
    expect(await prisma.organization.count({ where: { id: fixture.own.org.id } })).toBe(0);
    expect(await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: deleted.deletionLogId } })).toMatchObject({ organizationId: fixture.own.org.id, deletedById: fixture.actor.id, rowCounts: deleted.rowCounts });
    expect(await snapshot(fixture.foreign)).toEqual(foreignBefore);
    expect(await prisma.organizationDeletionLog.findUniqueOrThrow({ where: { id: fixture.retainedReceipt.id } })).toEqual(fixture.retainedReceipt);
  });
});
