import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
const read = name => readFileSync(new URL(`../packages/db/prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
test("manual case trigger preserves every non-authorization guard verbatim", () => {
  const old = read("20261004080000_manual_case_result_history").match(/CREATE FUNCTION vaettir_manual_case_revision_insert_guard\(\)[\s\S]+?END; \$\$;/)?.[0];
  const next = read("20261022090000_identity_manual_run_authorization").match(/CREATE OR REPLACE FUNCTION vaettir_manual_case_revision_insert_guard\(\)[\s\S]+?END; \$\$;/)?.[0];
  assert.ok(old && next);
  const restored = next.replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION")
    .replace("(m.role::text IN ('OWNER','ADMIN','EDITOR') OR\n      vaettir_identity_may_execute(NEW.\"organizationId\",NEW.\"projectId\",NEW.\"actorId\",NEW.\"actorClerkUserId\"))", "m.role::text IN ('OWNER','ADMIN','EDITOR')")
    .replace("Current full human execution permission and an active native manual run are required.", "A current full human editor and active native manual run are required.");
  assert.equal(restored, old);
});
