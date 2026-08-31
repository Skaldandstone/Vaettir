import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { prisma } from "@vaettir/db";

const target = new URL(process.env.DATABASE_URL ?? "missing:");
if (!["127.0.0.1", "localhost"].includes(target.hostname) || !/^\/vaettir_permissions[a-z0-9_]*test$/.test(target.pathname)) {
  throw new Error("Use an isolated local vaettir_permissions*test database only");
}
const migration = readFileSync(new URL("../../../packages/db/prisma/migrations/20260831000000_project_scoped_ci_mapping/migration.sql", import.meta.url), "utf8");
const rollback = new Error("Expected test-only transaction rollback");
try {
  await prisma.$transaction(async (tx) => {
    // Reconstruct the prior index contract inside this disposable transaction.
    // The complete current schema was installed separately by migrate deploy.
    await tx.$executeRawUnsafe('DROP INDEX "TestCaseSource_externalTestId_idx"');
    await tx.$executeRawUnsafe('CREATE UNIQUE INDEX "TestCaseSource_externalTestId_key" ON "TestCaseSource"("externalTestId")');
    const suffix = randomUUID();
    const tier = await tx.planTier.findUniqueOrThrow({ where: { key: "private-beta" } });
    const org = await tx.organization.create({ data: { name: suffix, slug: suffix, planTierId: tier.id } });
    const firstProject = await tx.project.create({ data: { organizationId: org.id, name: "one", slug: "one" } });
    const secondProject = await tx.project.create({ data: { organizationId: org.id, name: "two", slug: "two" } });
    const firstCase = await tx.testCase.create({ data: { projectId: firstProject.id, title: "Preserved", testType: "FUNCTIONAL", source: { create: { filePath: "fixture", framework: "vitest", externalTestId: suffix } } }, include: { source: true } });
    const before = firstCase.source!;
    for (const statement of migration.replace(/--[^\n]*/g, "").split(";").map((sql) => sql.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
    assert.deepEqual(await tx.testCaseSource.findUniqueOrThrow({ where: { id: before.id } }), before);
    await tx.testCase.create({ data: { projectId: secondProject.id, title: "Independent", testType: "FUNCTIONAL", source: { create: { filePath: "fixture", framework: "vitest", externalTestId: suffix } } } });
    assert.equal(await tx.testCaseSource.count({ where: { externalTestId: suffix } }), 2);
    const indexes = await tx.$queryRaw<Array<{ unique: boolean }>>`SELECT indisunique AS unique FROM pg_index WHERE indexrelid = '"TestCaseSource_externalTestId_idx"'::regclass`;
    assert.equal(indexes[0].unique, false);
    console.log("PASS: prior unique-index schema -> actual migration SQL; original mapping unchanged; identical IDs accepted in separate projects.");
    throw rollback;
  }, { timeout: 20000 });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await prisma.$disconnect();
}
console.log("PASS: all migration-check fixture data and temporary DDL rolled back.");
