import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  manualRunStartReviewedAccessInput as access,
  manualRunStartReviewedPreviewInput as preview,
  manualRunStartReviewedAccessOutput as accessOutput,
  manualRunStartReviewedPreviewOutput as previewOutput,
  manualRunStartReviewedReadKey as key,
} from "./manualRunStartReviewedWireSchema.js";
const input = {
  projectId: "project",
  originalOrganizationId: "org",
  expectedClerkActorId: "clerk",
  requestId: "00000000-0000-4000-8000-000000000001",
};
const readContext = {
  requestId: input.requestId,
  requestedKey: key(input, "ACCESS"),
  projection: "ACCESS",
  scope: {
    projectId: "project",
    organizationId: "org",
    actorId: "native",
    actorClerkUserId: "clerk",
  },
};
describe("reviewed run-start read wire (no write/hash contract)", () => {
  it("bootstrap access preserves absent native pin while preview requires one", () => {
    expect(access.parse(input)).toEqual(input);
    expect(access.parse(input)).not.toHaveProperty("expectedNativeActorId");
    expect(() => preview.parse(input)).toThrow();
    expect(
      preview.parse({ ...input, expectedNativeActorId: "native" }),
    ).toMatchObject({ expectedNativeActorId: "native" });
  });
  it.each([
    "projectId",
    "originalOrganizationId",
    "expectedClerkActorId",
    "requestId",
  ])("%s is mandatory, not discovered from a cached response", (field) => {
    const body: Record<string, unknown> = { ...input };
    delete body[field];
    expect(access.safeParse(body).success).toBe(false);
  });
  it.each(["", "x".repeat(201), "nul\0id"])(
    "refuses unsupported identity %j without trimming or coercion",
    (identity) => {
      expect(access.safeParse({ ...input, projectId: identity }).success).toBe(
        false,
      );
    },
  );
  it("strict unknown fields and client capabilities cannot become native scope authority", () => {
    expect(
      access.safeParse({ ...input, actorId: "native", canRecover: true })
        .success,
    ).toBe(false);
    expect(
      accessOutput.safeParse({
        readContext,
        canConfigure: true,
        canRecover: false,
      }).success,
    ).toBe(false);
  });
  it("nonce/projection/native-pin changes cannot join old observer responses", () => {
    expect(key(input, "ACCESS")).not.toBe(key(input, "PREVIEW"));
    expect(key(input, "ACCESS")).not.toBe(
      key({ ...input, expectedNativeActorId: "native" }, "ACCESS"),
    );
    expect(key(input, "ACCESS")).not.toBe(
      key(
        { ...input, requestId: "00000000-0000-4000-8000-000000000002" },
        "ACCESS",
      ),
    );
    expect(key(input, "ACCESS")).not.toBe(
      key({ ...input, originalOrganizationId: "other" }, "ACCESS"),
    );
  });
  it("unsupported profile has no fabricated hash while full-editor recovery remains independent", () => {
    const body = {
      readContext: { ...readContext, projection: "PREVIEW" },
      canConfigure: true,
      canRecover: true,
      canStart: false,
      profile: { kind: "UNSUPPORTED", reason: "PROFILE_UNAVAILABLE" },
      limitations: [],
    };
    expect(previewOutput.parse(body).profile).not.toHaveProperty("profileHash");
    expect(previewOutput.safeParse({ ...body, canStart: true }).success).toBe(
      false,
    );
    expect(
      previewOutput.safeParse({
        ...body,
        profile: { ...body.profile, profileHash: "a".repeat(64) },
      }).success,
    ).toBe(false);
  });
  it("supported empty experience is explicitly null; readonly does not acquire start/recovery permission", () => {
    const body = {
      readContext: { ...readContext, projection: "PREVIEW" },
      canConfigure: false,
      canRecover: false,
      canStart: false,
      profile: {
        kind: "SUPPORTED",
        experience: null,
        profileHash: "a".repeat(64),
      },
      limitations: [],
    };
    expect(previewOutput.parse(body).profile).toMatchObject({
      experience: null,
    });
    expect(previewOutput.safeParse({ ...body, canStart: true }).success).toBe(
      false,
    );
  });
  it("the wire import graph contains only browser schema/core primitives, no native implementation or old start mutation", () => {
    const source = readFileSync(
        new URL("./manualRunStartReviewedWireSchema.ts", import.meta.url),
        "utf8",
      ),
      ast = ts.createSourceFile(
        "wire.ts",
        source,
        ts.ScriptTarget.Latest,
        true,
      );
    const imports = ast.statements
      .filter(ts.isImportDeclaration)
      .map((node) => (node.moduleSpecifier as ts.StringLiteral).text);
    expect(imports).toEqual([
      "zod",
      "@vaettir/core",
      "./manualExecutionReadScopeSchema.js",
    ]);
    expect(source).not.toMatch(
      /@vaettir\/db|node:crypto|caseFieldReadScope|\.mutation\(|idempotencyKey|startRequestHash/,
    );
  });
});
