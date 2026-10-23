// SOURCE ONLY: authored NOT RUN. Read schema/helper contracts, not acceptance.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  manualExecutionReadScopeInputSchema,
  manualExecutionReadRequestKey,
  manualExecutionReadScopeOutputSchema,
} from "./manualExecutionReadScopeSchema.js";
describe("manual read scope schema (NOT RUN)", () => {
  it("retains legacy absent scope and exact optional key fields without defaults", () => {
    expect(
      manualExecutionReadScopeInputSchema.parse({ testRunId: "run" }),
    ).toEqual({ testRunId: "run" });
    expect(manualExecutionReadRequestKey({ testRunId: "run" })).toBe(
      '{"testRunId":"run"}',
    );
    const input = {
      testRunId: "run",
      projectId: "project",
      originalOrganizationId: "org",
      expectedClerkActorId: "actor",
    };
    expect(manualExecutionReadScopeInputSchema.parse(input)).toEqual(input);
    expect(manualExecutionReadRequestKey(input)).toBe(JSON.stringify(input));
  });
  it("rejects empty/oversized/control/unpaired Unicode/unknown identity fields", () => {
    for (const bad of [
      { testRunId: "" },
      { testRunId: "x".repeat(201) },
      { testRunId: "run\0" },
      { testRunId: "run\n" },
      { testRunId: "run\u007f" },
      { testRunId: "run\u0085" },
      { testRunId: "run\ud800" },
      { testRunId: "run\udfff" },
      { testRunId: "run", projectId: "" },
      { testRunId: "run", originalOrganizationId: "x".repeat(201) },
      { testRunId: "run", expectedClerkActorId: "" },
      { testRunId: "run", unsafe: true },
    ])
      expect(manualExecutionReadScopeInputSchema.safeParse(bad).success).toBe(
        false,
      );
    const unicode = {
      testRunId: "🎮".repeat(100),
      projectId: "é".repeat(200),
      originalOrganizationId: '"'.repeat(200),
      expectedClerkActorId: "\\".repeat(200),
    };
    expect(manualExecutionReadScopeInputSchema.parse(unicode)).toEqual(unicode);
    expect(
      manualExecutionReadScopeOutputSchema.shape.readRequestKey.safeParse(
        manualExecutionReadRequestKey(unicode),
      ).success,
    ).toBe(true);
  });
  it("rejects all C0 and C1 controls while preserving visible Unicode identities", () => {
    for (const code of [
      ...Array.from({ length: 32 }, (_, i) => i),
      ...Array.from({ length: 33 }, (_, i) => i + 127),
    ])
      expect(
        manualExecutionReadScopeInputSchema.safeParse({
          testRunId: `run${String.fromCharCode(code)}id`,
        }).success,
      ).toBe(false);
    expect(
      manualExecutionReadScopeInputSchema.parse({ testRunId: "🎮-é" }),
    ).toEqual({ testRunId: "🎮-é" });
  });
  it("echo schema requires exact bounded actor/org/run identity and boolean write capability", () => {
    const value = {
      testRunId: "run",
      projectId: "p",
      organizationId: "org",
      originalOrganizationId: "org",
      actorId: "internal",
      clerkActorId: "signed",
      canWrite: false,
      readRequestKey: '{"testRunId":"run"}',
    };
    expect(manualExecutionReadScopeOutputSchema.parse(value)).toEqual(value);
    expect(
      manualExecutionReadScopeOutputSchema.safeParse({
        ...value,
        canWrite: "true",
      }).success,
    ).toBe(false);
    expect(
      manualExecutionReadScopeOutputSchema.safeParse({
        ...value,
        recordedActor: "invented",
      }).success,
    ).toBe(false);
  });
  it("identity discovery/locks precede private preflight and projection is aggregate-only", () => {
    const source = readFileSync(
      new URL("./manualExecutionReadScope.ts", import.meta.url),
      "utf8",
    );
    const discovery = source.slice(
      source.indexOf("// Indexed identity-only"),
      source.indexOf("const projectId"),
    );
    expect(discovery).not.toMatch(
      /executionContext|manualTestCaseIds|include:|SELECT \*/,
    );
    const lockPositions = [
      'FROM "Organization"',
      'FROM "Membership"',
      'FROM "Project"',
      'FROM "User"',
      'FROM "TestRun" WHERE id=${input.testRunId} FOR SHARE',
    ].map((s) => source.indexOf(s, source.indexOf("const projectId")));
    expect(lockPositions.every((p) => p >= 0)).toBe(true);
    expect(lockPositions).toEqual([...lockPositions].sort((a, b) => a - b));
    expect(
      source.indexOf("await preflightManualExecutionRead"),
    ).toBeGreaterThan(lockPositions[4]!);
    expect(source).toContain("actor.clerkUserId !== authenticatedClerkActorId");
    expect(source).toContain('member.seatType === "FULL"');
    expect(source).not.toContain(
      'member.seatType === "READ_ONLY" && member.role !== "VIEWER"',
    );
  });
  it("refuses ambiguous native results/dangling libraries and bounds graph and real shared-step parser before bodies", () => {
    const source = readFileSync(
      new URL("./manualExecutionReadScope.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('count(*)<>count(DISTINCT t."testCaseId")');
    expect(source).toContain("results.duplicateCases");
    expect(source).toContain("foreign.danglingLibrary");
    expect(source).toContain("z.array(TestCaseStepInputSchema).max(500)");
    expect(source).toContain("edges > 10000");
    expect(source).toContain("!ids.has(dependency)");
    expect(source).not.toMatch(/sum\(steps\)[^\n]*::int/);
  });
});
