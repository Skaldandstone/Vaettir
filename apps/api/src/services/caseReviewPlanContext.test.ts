import { readFileSync } from "node:fs";
import { DEFAULT_STEP_FIELD_LABELS } from "@vaettir/core";
import { describe, expect, it, vi } from "vitest";
import {
  admitCaseReviewPlanContext,
  caseReviewPlanContextProjection,
  validateCaseReviewPlanContext,
  linkedPlanReviewBlocked,
} from "./caseReviewPlanContext.js";
const scope = { projectId: "p", caseId: "c", organizationId: "o" };
export function linkedFixture() {
  return {
    kind: "CaseReviewPlanContext/v1",
    organizationLabels: {
      organizationId: "o",
      raw: {
        action: " Tester action \n",
        expectedActionOrData: " Technical event ",
        future: { retained: [null, false, 0, ""] },
      },
      sqlNull: false,
      resolved: {
        ...DEFAULT_STEP_FIELD_LABELS,
        action: " Tester action \n",
        expectedActionOrData: " Technical event ",
      },
    },
    references: { caseTypeId: "case-type", planTypeId: "plan-type" },
    types: [
      {
        id: "case-type",
        key: "functional",
        name: "Case role",
        category: "VALIDATION",
        description: "",
        fieldSchema: { future: [null, false, 0, ""] },
        fieldSchemaSqlNull: false,
        isBuiltIn: true,
        createdAt: "2026-10-05",
      },
      {
        id: "plan-type",
        key: "regression",
        name: "Parent role",
        category: "VALIDATION",
        description: null,
        fieldSchema: null,
        fieldSchemaSqlNull: true,
        isBuiltIn: false,
        createdAt: "2026-10-05",
      },
    ],
    plan: {
      id: "plan",
      projectId: "p",
      testPlanTypeId: "plan-type",
      releaseId: null,
      strategyId: null,
      name: " Exact\n plan ",
      description: "",
      status: "ACTIVE",
      customFields: { retained: [null, false, 0, ""] },
      customFieldsSqlNull: false,
      executionTemplate: {},
      executionTemplateSqlNull: false,
      createdById: null,
      updatedById: "author",
      createdAt: "2026-10-05",
      updatedAt: "2026-10-05",
      latestVersion: { id: "v1", versionNumber: 1 },
      criteria: [
        {
          id: "criterion",
          testPlanId: "plan",
          requirementId: null,
          description: " Exact\n criterion ",
          status: "PENDING",
          createdAt: "2026-10-05",
        },
      ],
    },
  };
}
describe("bounded complete leaf plan/type/organization labels; native SQL authored, NOT RUN", () => {
  it("preserves exact raw values, distinct global type roles, all criteria and default-only missing labels", () => {
    const raw = linkedFixture(),
      parsed = validateCaseReviewPlanContext(raw);
    expect(parsed).toEqual(raw);
    expect(parsed.organizationLabels.raw).toEqual(raw.organizationLabels.raw);
    expect(parsed.plan?.customFields).toEqual({
      retained: [null, false, 0, ""],
    });
    expect(parsed.organizationLabels.resolved.expectedResponse).toBe(
      DEFAULT_STEP_FIELD_LABELS.expectedResponse,
    );
    expect(linkedPlanReviewBlocked(parsed)).toBeNull();
  });
  it("SQL NULL and JSON null labels stay distinct and empty/whitespace custom labels are not replaced", () => {
    for (const sqlNull of [true, false]) {
      const raw = linkedFixture();
      raw.organizationLabels = {
        organizationId: "o",
        raw: null,
        sqlNull,
        resolved: { ...DEFAULT_STEP_FIELD_LABELS },
      } as never;
      expect(validateCaseReviewPlanContext(raw).organizationLabels).toEqual(
        raw.organizationLabels,
      );
    }
    const raw = linkedFixture();
    raw.organizationLabels.raw.action = "";
    raw.organizationLabels.resolved.action = "";
    expect(
      validateCaseReviewPlanContext(raw).organizationLabels.resolved.action,
    ).toBe("");
  });
  it.each([
    "missing-type",
    "duplicate-type",
    "order",
    "wrong-role",
    "wrong-criterion",
    "labels",
    "template",
    "release",
    "extra-native-key",
    "label-emoji",
    "type-size",
    "plan-size",
    "deep",
  ])("unsupported retained %s refuses without normalization", (kind) => {
    const raw = linkedFixture();
    if (kind === "missing-type") raw.types.pop();
    if (kind === "duplicate-type") raw.types.push(raw.types[0]!);
    if (kind === "order") raw.types.reverse();
    if (kind === "wrong-role") raw.references.planTypeId = "case-type";
    if (kind === "wrong-criterion") raw.plan.criteria[0]!.testPlanId = "other";
    if (kind === "labels")
      raw.organizationLabels.resolved.action = "normalized";
    if (kind === "template") raw.plan.executionTemplate = { future: true };
    if (kind === "release") raw.plan.releaseId = "r" as never;
    if (kind === "extra-native-key") Object.assign(raw.plan, { future: true });
    if (kind === "label-emoji") {
      raw.organizationLabels.raw.action = "😀".repeat(101);
      raw.organizationLabels.resolved.action =
        raw.organizationLabels.raw.action;
    }
    if (kind === "type-size")
      raw.types[0]!.fieldSchema = { large: "x".repeat(32769) } as never;
    if (kind === "plan-size")
      raw.plan.customFields = { large: "x".repeat(131073) } as never;
    if (kind === "deep") {
      let value: unknown = null;
      for (let n = 0; n < 70; n++) value = { value };
      raw.plan.customFields = value as never;
    }
    expect(() => validateCaseReviewPlanContext(raw)).toThrow();
  });
  it.each(["APPROVED", "ARCHIVED"])(
    "%s parent remains visible but refuses new case decisions",
    (status) => {
      const raw = linkedFixture();
      raw.plan.status = status;
      expect(
        linkedPlanReviewBlocked(validateCaseReviewPlanContext(raw)),
      ).toContain("Reopen the parent");
    },
  );
  it("native relationship refusal comes before private size/body; global types never fabricate organization columns", async () => {
    const events: string[] = [],
      tx = {
        $queryRaw: vi.fn(async () => {
          events.push("relationship");
          return [
            {
              linkedForeign: true,
              linkedMissing: false,
              linkedUnsupported: false,
            },
          ];
        }),
      };
    await expect(
      admitCaseReviewPlanContext(tx as never, scope),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(events).toEqual(["relationship"]);
    const sql = caseReviewPlanContextProjection(scope).sql;
    expect(sql).toContain('t.id IN (c."testPlanTypeId",pl."testPlanTypeId")');
    expect(sql).not.toContain('t."organizationId"');
    expect(sql).toContain('"executionTemplate" IS NULL');
  });
  it.each([
    { labelBytes: 4097n },
    { typeBytes: 32769n },
    { planBytes: 131073n },
    { planBytes: 3000000000n },
    { criteria: 201n },
    { typeCount: 3n },
    { labelsUnsupported: true },
    { labelBytes: -1n },
  ])(
    "mock native admission %o refuses before body/remaining locks",
    async (patch) => {
      const events: string[] = [],
        tx = {
          $queryRaw: vi.fn(async (raw: { sql: string } | readonly string[]) => {
            const sql = Array.isArray(raw)
              ? raw.join("?")
              : (raw as { sql: string }).sql;
            if (sql.includes('AS "linkedForeign"'))
              return [
                {
                  linkedForeign: false,
                  linkedMissing: false,
                  linkedUnsupported: false,
                },
              ];
            if (sql.includes('AS "labelsUnsupported"')) {
              events.push("bytes");
              return [
                {
                  labelBytes: 20n,
                  typeBytes: 20n,
                  planBytes: 20n,
                  criteria: 1n,
                  typeCount: 2n,
                  labelsUnsupported: false,
                  ...patch,
                },
              ];
            }
            events.push("lock");
            return [{ count: 1n }];
          }),
        };
      await expect(
        admitCaseReviewPlanContext(tx as never, scope),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(events).toEqual(["lock", "bytes"]);
    },
  );
  it("source native bigint promotion, complete empty-template refusal and bounded row locks are explicit; not SQL execution", () => {
    const source = readFileSync(
      new URL("./caseReviewPlanContext.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("sum(octet_length(to_jsonb(t)::text)::bigint+32)");
    expect(source).toContain('pl."executionTemplate" IS DISTINCT FROM');
    expect(source).toContain('a."requirementId" IS NOT NULL');
    expect(source).toContain("LIMIT 201 FOR SHARE OF a");
    expect(source).toContain("LIMIT 1 FOR SHARE OF v");
  });
});
