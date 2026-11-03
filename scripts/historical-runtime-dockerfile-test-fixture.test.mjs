import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  API_DIRECT_PRISMA_DOCKERFILE_SHA256,
  PRE_API_DIRECT_PRISMA_DOCKERFILE_SHA256,
  restorePreApiDirectPrismaDockerfileFixture,
} from "./api-startup-dockerfile-inverse-fixture.mjs";
import {SQLITE_DOCKERFILE_SHA256, restorePreSqliteDockerfileFixture} from "./sqlite-dockerfile-inverse-fixture.mjs";
import {restorePreNodeBrotliDockerfileFixture} from "./node-brotli-dockerfile-inverse-fixture.mjs";
import {
  historicalRuntimeDockerfileFixture,
  HISTORICAL_DOCKERFILE_SHA256,
} from "./historical-runtime-dockerfile-test-fixture.mjs";
const current = Buffer.from(readFileSync(new URL("../Dockerfile.api", import.meta.url), "utf8").replaceAll("\r\n", "\n"));
test("exact inverse chain restores immutable historical synthetic input", () => {
  const historical = historicalRuntimeDockerfileFixture(current);
  assert.equal(createHash("sha256").update(historical.bytes).digest("hex"), HISTORICAL_DOCKERFILE_SHA256);
  assert.deepEqual(historicalRuntimeDockerfileFixture(historical.bytes).bytes, historical.bytes);
  assert.match(historical.bytes.toString(), /test -z.*Status-Abbrev.*libxml2/);
});

test("startup inverse restores exact pre-startup bytes and all historical entrypoints", () => {
  const prior = restorePreApiDirectPrismaDockerfileFixture(current);
  assert.equal(createHash("sha256").update(prior).digest("hex"), PRE_API_DIRECT_PRISMA_DOCKERFILE_SHA256);
  assert.equal(PRE_API_DIRECT_PRISMA_DOCKERFILE_SHA256, SQLITE_DOCKERFILE_SHA256);
  const boundary = current.indexOf("# Keep assignment separate from export");
  assert.ok(boundary > 0);
  assert.deepEqual(prior.subarray(0, boundary), current.subarray(0, boundary));
  for (const inverse of [restorePreSqliteDockerfileFixture, restorePreNodeBrotliDockerfileFixture]) {
    assert.deepEqual(inverse(current), inverse(prior));
  }
  const historical = historicalRuntimeDockerfileFixture(current);
  assert.equal(historical.sourceSha256, API_DIRECT_PRISMA_DOCKERFILE_SHA256);
  assert.deepEqual(historical.bytes, historicalRuntimeDockerfileFixture(prior).bytes);
});

test("startup inverse refuses unknown full inputs, malformed bytes and extra arguments", () => {
  for (const bytes of [
    Buffer.concat([current, Buffer.from("# unrelated\n")]),
    Buffer.from(current.toString().replace("&& exec node apps/api/dist/server.js", "&& node apps/api/dist/server.js")),
    Buffer.from(current.toString().replace("--schema packages/db/prisma/schema.prisma", "--schema other.prisma")),
    Buffer.from(current.toString().replace("check-sqlite-runtime.mjs", "other.mjs")),
    Buffer.from(current.toString().replaceAll("\n", "\r\n")),
    Buffer.from([0xff]),
    restorePreApiDirectPrismaDockerfileFixture(current),
  ]) assert.throws(() => restorePreApiDirectPrismaDockerfileFixture(bytes));
  assert.throws(() => restorePreApiDirectPrismaDockerfileFixture(current.toString()));
  assert.throws(() => restorePreApiDirectPrismaDockerfileFixture(current, "override"));
});
test("unknown complete edits, missing/duplicate additions and invalid encodings reject", () => {
  for (const bytes of [Buffer.concat([current, Buffer.from("# unrelated\n")]), Buffer.from(current.toString().replace("git --version", "git --help")), Buffer.from(current.toString().replace("COPY scripts/check-runtime-package-absence.mjs", "COPY scripts/other.mjs")), Buffer.from(current.toString().replaceAll("\n", "\r\n")), Buffer.from([0xff])])
    assert.throws(() => historicalRuntimeDockerfileFixture(bytes));
});
