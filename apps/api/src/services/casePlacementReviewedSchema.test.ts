import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  placementRawPath,
  placementMoveInput,
  placementMoveRequestHash,
  placementCohortHash,
  reviewedPlacementOrders,
  type placementMetadata,
  placementAccessInput,
} from "./casePlacementReviewedSchema.js";
import * as wire from "./casePlacementReviewedWireSchema.js";
import type { z } from "zod";
const scope = {
  projectId: "project",
  organizationId: "org",
  actorId: "native",
  actorClerkUserId: "clerk",
};
const intent = {
  projectId: scope.projectId,
  caseId: "main",
  originalOrganizationId: scope.organizationId,
  expectedClerkActorId: scope.actorClerkUserId,
  expectedNativeActorId: scope.actorId,
  expectedSuitePath: null,
  expectedSortPosition: 0,
  targetSuitePath: "auth",
  beforeCaseId: null,
};
const row = (
  id: string,
  suitePath: string | null,
  sortPosition = 0,
): z.infer<typeof placementMetadata> => ({
  id,
  displayId: `SYN-${id}`,
  suitePath,
  sortPosition,
  createdAtText: "2026-10-06 00:00:00.000001+00",
  reviewStatus: "APPROVED",
});
describe("reviewed placement exact native metadata (pure)", () => {
  it("access pins admit all three or none and refuse every partial combination", () => {
    const base = {
      projectId: "project",
      caseId: "main",
      readRequestId: randomUUID(),
    };
    expect(placementAccessInput.parse(base)).toEqual(base);
    const pins = {
      originalOrganizationId: "org",
      expectedClerkActorId: "clerk",
      expectedNativeActorId: "native",
    };
    expect(placementAccessInput.parse({ ...base, ...pins })).toEqual({
      ...base,
      ...pins,
    });
    const keys = Object.keys(pins) as Array<keyof typeof pins>;
    for (let mask = 1; mask < 7; mask++) {
      const partial = Object.fromEntries(
        keys
          .filter((_, index) => mask & (1 << index))
          .map((key) => [key, pins[key]]),
      );
      expect(() => placementAccessInput.parse({ ...base, ...partial })).toThrow(
        "must be supplied together",
      );
    }
  });
  it("wire is browser-pure: only zod import, no service/native/Node or dynamic graph", () => {
    const source = readFileSync(
        new URL("./casePlacementReviewedWireSchema.ts", import.meta.url),
        "utf8",
      ),
      ast = ts.createSourceFile(
        "wire.ts",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
    const imports: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier)
          imports.push((node.moduleSpecifier as ts.StringLiteral).text);
      }
      if (ts.isCallExpression(node))
        expect(node.expression.getText(ast)).not.toMatch(
          /^(?:require|import)$/,
        );
      ts.forEachChild(node, visit);
    };
    visit(ast);
    expect(imports).toEqual(["zod"]);
    expect(source).not.toMatch(
      /@vaettir\/db|node:crypto|caseFieldReadScope\.js|Prisma|process\.env/,
    );
  });
  it("Node schema reexports actual wire DTOs and preserves v1 canonical field order and fixed hash", () => {
    expect(placementAccessInput).toBe(wire.placementAccessInput);
    expect(placementMoveInput).toBe(wire.placementMoveInput);
    const input = {
      ...intent,
      requestId: "11111111-1111-4111-8111-111111111111",
      expectedCohortHash: "a".repeat(64),
      confirmed: true as const,
    };
    expect(Object.keys(wire.placementMoveInput.parse(input))).toEqual([
      "projectId",
      "caseId",
      "originalOrganizationId",
      "expectedClerkActorId",
      "expectedNativeActorId",
      "expectedSuitePath",
      "expectedSortPosition",
      "targetSuitePath",
      "beforeCaseId",
      "requestId",
      "expectedCohortHash",
      "confirmed",
    ]);
    expect(placementMoveRequestHash(input)).toBe(
      "24aba687298389417c31921fc4d5f5f766690811c3cbc36a7a49220d0816006d",
    );
  });
  it("refuses NUL and unpaired UTF-16 before PostgreSQL encoding but retains valid astral paths", () => {
    for (const path of ["bad\0path", "bad\ud800", "\udc00bad"])
      expect(() => placementRawPath.parse(path)).toThrow(
        "Unsupported native path",
      );
    expect(placementRawPath.parse(" 🧭 auth ")).toBe(" 🧭 auth ");
  });
  it("distinguishes raw NULL/empty/whitespace and keeps embedded prose exact", () => {
    for (const path of [null, "", "  auth  ", " a\nb "])
      expect(placementRawPath.parse(path)).toBe(path);
  });
  it("strict reviewed input pins all original native scope/CAS/UUID without normalization", () => {
    const input = {
      ...intent,
      requestId: randomUUID(),
      confirmed: true as const,
      expectedCohortHash: "a".repeat(64),
      expectedSuitePath: "  legacy ",
      targetSuitePath: "",
    };
    expect(placementMoveInput.parse(input)).toEqual(input);
    expect(() =>
      placementMoveInput.parse({ ...input, guessed: true }),
    ).toThrow();
    expect(() =>
      placementMoveInput.parse({ ...input, expectedNativeActorId: undefined }),
    ).toThrow();
  });
  it("domain separates move identity; raw paths and every hidden native order key affect hash", () => {
    const input = {
      ...intent,
      requestId: randomUUID(),
      confirmed: true as const,
      expectedCohortHash: "a".repeat(64),
    };
    expect(placementMoveRequestHash(input)).toBe(
      placementMoveRequestHash({ ...input }),
    );
    expect(
      placementMoveRequestHash({ ...input, targetSuitePath: " auth " }),
    ).not.toBe(placementMoveRequestHash(input));
    const rows = [
      row("main", null),
      { ...row("hidden", null), reviewStatus: "PENDING_REVIEW" as const },
    ];
    const hash = placementCohortHash(scope, intent, rows);
    expect(
      placementCohortHash(scope, intent, [
        rows[0]!,
        { ...rows[1]!, sortPosition: 2 },
      ]),
    ).not.toBe(hash);
    expect(
      placementCohortHash(scope, intent, [
        rows[0]!,
        { ...rows[1]!, createdAtText: "2026-10-06 00:00:00.000002+00" },
      ]),
    ).not.toBe(hash);
  });
  it("reorders complete hidden sibling cohort without changing native source definitions/statuses", () => {
    const rows = [
      row("main", null),
      { ...row("hidden", null), reviewStatus: "REJECTED" as const },
      row("target", "auth"),
    ];
    const result = reviewedPlacementOrders(rows, {
      ...intent,
      beforeCaseId: "target",
    });
    expect(result.index).toBe(0);
    expect(result.after).toEqual([
      { ...rows[0], suitePath: "auth", sortPosition: 0 },
      { ...rows[1], sortPosition: 0 },
      { ...rows[2], sortPosition: 1 },
    ]);
    expect(rows[0]!.suitePath).toBeNull();
  });
  it("same-suite move-down and native tie order remain deterministic", () => {
    const rows = [
      row("first", "auth"),
      row("main", "auth"),
      row("last", "auth"),
    ];
    const result = reviewedPlacementOrders(rows, {
      ...intent,
      expectedSuitePath: "auth",
      targetSuitePath: "auth",
      beforeCaseId: null,
    });
    expect(result.after.map((r) => [r.id, r.sortPosition])).toEqual([
      ["first", 0],
      ["main", 2],
      ["last", 1],
    ]);
  });
  it("refuses missing/duplicate/foreign anchor and source >2000 without taking a smaller subset", () => {
    const rows = [row("main", null), row("target", "auth")];
    for (const input of [
      { ...intent, beforeCaseId: "missing" },
      { ...intent, beforeCaseId: "main" },
      { ...intent, expectedSuitePath: "other" },
    ])
      expect(() => reviewedPlacementOrders(rows, input)).toThrow();
    expect(() =>
      reviewedPlacementOrders([...rows, rows[0]!], intent),
    ).toThrow();
    expect(() =>
      reviewedPlacementOrders(
        [
          row("main", null),
          ...Array.from({ length: 2000 }, (_, i) => row(String(i), null)),
        ],
        intent,
      ),
    ).toThrow();
  });
});
