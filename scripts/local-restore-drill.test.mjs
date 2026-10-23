import assert from "node:assert/strict";
import test from "node:test";
import {
  compareRestoreEvidence,
  validateRestoreDrillUrls,
} from "./local-restore-drill.mjs";

const source =
  "postgresql://postgres:local@127.0.0.1:55452/vaettir_beta_restore_source_test?schema=public";
const target =
  "postgresql://postgres:local@127.0.0.1:55452/vaettir_beta_restore_target_test?schema=public";

test("accepts separate isolated local restore-drill databases", () => {
  const result = validateRestoreDrillUrls(source, target);
  assert.equal(result.source.database, "vaettir_beta_restore_source_test");
  assert.equal(result.target.database, "vaettir_beta_restore_target_test");
});

test("rejects remote, shared, production-like, or differently scoped targets", () => {
  assert.throws(
    () =>
      validateRestoreDrillUrls(
        source,
        target.replace("127.0.0.1", "database.example"),
      ),
    /must be local/,
  );
  assert.throws(
    () =>
      validateRestoreDrillUrls(
        source,
        target.replace("restore_target_test", "restore"),
      ),
    /safety pattern/,
  );
  assert.throws(
    () =>
      validateRestoreDrillUrls(
        source,
        target.replace("postgres:local", "another:local"),
      ),
    /username must match/,
  );
});

test("rejects unsupported URL options that could redirect the connection", () => {
  assert.throws(
    () => validateRestoreDrillUrls(`${source}&host=database.example`, target),
    /unsupported option/,
  );
});

test("requires completed migrations, application tables, and exact restored counts", () => {
  const evidence = {
    migrations: ["20260101000000_initial", "20260201000000_feature"],
    tables: [
      ["public.Organization", 2],
      ["public.Project", 4],
    ],
  };
  assert.equal(
    compareRestoreEvidence(evidence, structuredClone(evidence)),
    true,
  );
  assert.throws(
    () => compareRestoreEvidence({ ...evidence, migrations: [] }, evidence),
    /no completed/,
  );
  assert.throws(
    () => compareRestoreEvidence({ ...evidence, tables: [] }, evidence),
    /no application tables/,
  );
  assert.throws(
    () =>
      compareRestoreEvidence(evidence, {
        ...evidence,
        tables: [["public.Organization", 1]],
      }),
    /does not match/,
  );
});
