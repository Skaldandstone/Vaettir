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
import {
  NODE26_API_DOCKERFILE_SHA256,
  NODE26_WEB_DOCKERFILE_SHA256,
  PRE_NODE26_WEB_DOCKERFILE_SHA256,
  restorePreNode26DockerfileFixture,
} from "./node26-dockerfile-inverse-fixture.mjs";
const node26Current = Buffer.from(readFileSync(new URL("../Dockerfile.api", import.meta.url), "utf8").replaceAll("\r\n", "\n"));
const current = restorePreNode26DockerfileFixture(node26Current);
test("Node 26 inverse is bound to the exact reviewed API Dockerfile", () => {
  assert.equal(createHash("sha256").update(node26Current).digest("hex"), NODE26_API_DOCKERFILE_SHA256);
  assert.equal(createHash("sha256").update(current).digest("hex"), API_DIRECT_PRISMA_DOCKERFILE_SHA256);
  assert.equal(historicalRuntimeDockerfileFixture(node26Current).sourceSha256, NODE26_API_DOCKERFILE_SHA256);
  for (const bytes of [Buffer.concat([node26Current, Buffer.from("# unrelated\n")]), Buffer.from(node26Current.toString().replace("node:26-trixie-slim", "node:25-trixie-slim"))])
    assert.throws(() => restorePreNode26DockerfileFixture(bytes));
});
test("Node 26 web inverse restores only the exact reviewed pin diff", () => {
  const source = Buffer.from(readFileSync(new URL("../Dockerfile.web", import.meta.url), "utf8").replaceAll("\r\n", "\n"));
  assert.equal(createHash("sha256").update(source).digest("hex"), NODE26_WEB_DOCKERFILE_SHA256);
  assert.equal(createHash("sha256").update(restorePreNode26DockerfileFixture(source)).digest("hex"), PRE_NODE26_WEB_DOCKERFILE_SHA256);
});
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
