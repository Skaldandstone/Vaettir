import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const config = JSON.parse(readFileSync(`${root}/turbo.json`, "utf8"));
const workflow = readFileSync(`${root}/.github/workflows/ci.yml`, "utf8").replaceAll("\r\n", "\n");

describe("test-only CI metadata forwarding", () => {
  it("forwards exactly database identity and non-secret GitHub fixture metadata", () => {
    expect(config.tasks.test.env).toEqual([
      "DATABASE_URL", "CI", "GITHUB_ACTIONS", "GITHUB_REPOSITORY",
      "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA",
      "GITHUB_WORKFLOW", "GITHUB_JOB", "GITHUB_WORKFLOW_REF", "GITHUB_REF",
    ]);
    expect(config.tasks.test.passThroughEnv ?? []).toEqual([]);
    expect(config.globalEnv ?? []).toEqual([]);
    expect(config.globalPassThroughEnv ?? []).toEqual([]);
    expect(config.tasks.test.dependsOn).toEqual(["^build"]);
  });
  it("preserves the existing exact CI service and strict normal test runner", () => {
    expect(workflow).toContain("name: CI");
    expect(workflow).toContain("  build:\n");
    expect(workflow).toContain("POSTGRES_DB: vaettir_test");
    expect(workflow).toContain("@localhost:5432/vaettir_test?schema=public&connection_limit=5");
    expect(workflow).toContain("run: pnpm test");
    expect(workflow).not.toContain("--env-mode=loose");
    expect(workflow).not.toContain("--env-mode loose");
    expect(workflow).not.toContain("TURBO_ENV_MODE: loose");
  });
});
