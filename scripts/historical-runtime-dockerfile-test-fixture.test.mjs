import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  historicalRuntimeDockerfileFixture,
  HISTORICAL_DOCKERFILE_SHA256,
} from "./historical-runtime-dockerfile-test-fixture.mjs";
const current = Buffer.from(readFileSync(new URL("../Dockerfile.api", import.meta.url), "utf8").replaceAll("\r\n", "\n"));
test("exact two-change inverse restores immutable historical synthetic input", () => {
  const historical = historicalRuntimeDockerfileFixture(current);
  assert.equal(createHash("sha256").update(historical.bytes).digest("hex"), HISTORICAL_DOCKERFILE_SHA256);
  assert.deepEqual(historicalRuntimeDockerfileFixture(historical.bytes).bytes, historical.bytes);
  assert.match(historical.bytes.toString(), /test -z.*Status-Abbrev.*libxml2/);
});
test("unknown complete edits, missing/duplicate additions and invalid encodings reject", () => {
  for (const bytes of [Buffer.concat([current, Buffer.from("# unrelated\n")]), Buffer.from(current.toString().replace("git --version", "git --help")), Buffer.from(current.toString().replace("COPY scripts/check-runtime-package-absence.mjs", "COPY scripts/other.mjs")), Buffer.from(current.toString().replaceAll("\n", "\r\n")), Buffer.from([0xff])])
    assert.throws(() => historicalRuntimeDockerfileFixture(bytes));
});
