import { describe, expect, it } from "vitest";
import { defaultCaseQuery, caseQuerySchema } from "./caseQuerySchema.js";
import {
  caseQueryHash,
  caseQueryWhere,
  encodeCaseQueryCursor,
  decodeCaseQueryCursor,
} from "./caseQuery.js";

const env = {
  PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};
const now = new Date("2026-10-03T12:00:00.000Z");
const binding = {
  actor: "viewer",
  organizationId: "org",
  projectId: "project",
  queryHash: caseQueryHash(defaultCaseQuery()),
};
const body = {
  purpose: "vaettir-case-query-v1" as const,
  ...binding,
  watermark: now.toISOString(),
  expiresAt: new Date(now.getTime() + 900000).toISOString(),
  anchor: { id: "case", updatedAt: now.toISOString() },
};
describe("bounded typed case queries", () => {
  it("allows explicit group semantics and rejects unknown fields/operators and unbounded rules", () => {
    const rule = { field: "priority", operator: "equals", value: "HIGH" };
    expect(
      caseQuerySchema.parse({
        ...defaultCaseQuery(),
        match: "any",
        groups: [{ match: "all", rules: [rule] }],
      }).match,
    ).toBe("any");
    for (const changed of [
      { sql: "select *" },
      { groups: [{ match: "all", rules: [{ ...rule, field: "password" }] }] },
      { groups: [{ match: "all", rules: [{ ...rule, operator: "raw" }] }] },
      { groups: [{ match: "all", rules: Array(9).fill(rule) }] },
      { groups: Array(3).fill({ match: "all", rules: Array(5).fill(rule) }) },
    ])
      expect(
        caseQuerySchema.safeParse({ ...defaultCaseQuery(), ...changed })
          .success,
      ).toBe(false);
    expect(
      caseQuerySchema.safeParse({
        ...defaultCaseQuery(),
        groups: [
          {
            match: "all",
            rules: [{ field: "suite", operator: "equals", value: "" }],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("builds allowlisted nested predicates with literal wildcard escaping and nullable risk", () => {
    const query = caseQuerySchema.parse({
      ...defaultCaseQuery(),
      match: "any",
      groups: [
        {
          match: "all",
          rules: [
            { field: "title", operator: "contains", value: "100%_\\" },
            { field: "riskScore", operator: "unassessed", value: 0 },
          ],
        },
        {
          match: "any",
          rules: [{ field: "domain", operator: "equals", value: "HIL" }],
        },
      ],
    });
    expect(caseQueryWhere("project", query, now)).toEqual({
      projectId: "project",
      updatedAt: { lte: now },
      archived: false,
      OR: [
        {
          AND: [
            { title: { contains: "100\\%\\_\\\\", mode: "insensitive" } },
            { riskScore: null },
          ],
        },
        { OR: [{ validationDomain: "HIL" }] },
      ],
    });
  });
  it("encrypts the authoritative cursor and binds it to actor, organization, project and criteria", () => {
    const token = encodeCaseQueryCursor(body, env);
    expect(token).not.toContain("viewer");
    expect(decodeCaseQueryCursor(token, binding, now, env)).toEqual(body);
    for (const key of [
      "actor",
      "organizationId",
      "projectId",
      "queryHash",
    ] as const)
      expect(() =>
        decodeCaseQueryCursor(token, { ...binding, [key]: "other" }, now, env),
      ).toThrow(/different criteria/);
    expect(() =>
      decodeCaseQueryCursor(token.slice(0, -4) + "AAAA", binding, now, env),
    ).toThrow(/different criteria/);
    expect(() =>
      decodeCaseQueryCursor(
        token,
        binding,
        new Date(now.getTime() + 900000),
        env,
      ),
    ).toThrow(/expired/);
    expect(() =>
      decodeCaseQueryCursor(token, binding, now, {
        PRODUCTION_SIGNAL_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString(
          "base64",
        ),
      }),
    ).toThrow();
  });
  it("fails visibly without configured encryption instead of falling back to process state", () => {
    expect(() => encodeCaseQueryCursor(body, {})).toThrow(
      /platform encryption key/,
    );
    expect(() =>
      encodeCaseQueryCursor(body, {
        PRODUCTION_SIGNAL_ENCRYPTION_KEY: "invalid",
      }),
    ).toThrow(/platform encryption key/);
    const shortened = {
      ...body,
      expiresAt: new Date(now.getTime() + 1000).toISOString(),
    };
    expect(() =>
      decodeCaseQueryCursor(
        encodeCaseQueryCursor(shortened, env),
        binding,
        now,
        env,
      ),
    ).toThrow();
  });
});
