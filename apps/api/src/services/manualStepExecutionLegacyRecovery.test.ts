import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  recordManualStepResult,
  recordStepResultInputSchema,
} from "./manualStepExecution.js";
import { observationsSchema } from "./physicalValidation.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";

const actor = {
  id: "native-original",
  name: "Synthetic member",
  clerkUserId: "clerk-original",
};
const source = readFileSync(
  new URL("./manualStepExecution.ts", import.meta.url),
  "utf8",
);
function oldHash(input: ReturnType<typeof recordStepResultInputSchema.parse>) {
  return qualityProfileHash({
    testCaseId: input.testCaseId,
    stepIndex: input.stepIndex,
    status: input.status,
    note: input.note?.trim() || null,
    observations: observationsSchema.parse(input.observations ?? {}),
    evidenceAttachmentIds: [...input.evidenceAttachmentIds].sort(),
    expectedRevisionId: input.expectedRevisionId,
    correctionReason: input.correctionReason?.trim() || null,
  });
}
function fixture() {
  const input = recordStepResultInputSchema.parse({
    testRunId: "run-a",
    testCaseId: "case-a",
    stepIndex: 2,
    status: "FAIL",
    note: " retained\n legacy text ",
    observations: {
      environment: " raw environment ",
      measurements: [{ name: " Meter ", unit: " V ", value: 0 }],
    },
    evidenceAttachmentIds: ["evidence-z", "evidence-a"],
    expectedRevisionId: null,
    correctionReason: " reason ",
    idempotencyKey: randomUUID(),
  });
  const originalReceipt = {
    id: "legacy-revision-a",
    testRunId: input.testRunId,
    testCaseId: input.testCaseId,
    stepIndex: input.stepIndex,
    actorId: actor.id,
    idempotencyKey: input.idempotencyKey,
    requestHash: oldHash(input),
    status: input.status,
    caseStatusAtRecord: "FAIL" as string | null,
  };
  const state = {
    organizationId: "org-a",
    projectId: "project-a",
    lockedProjectId: "project-a" as string | null,
    role: "EDITOR",
    seatType: "FULL",
    suspendedAt: null as Date | null,
    nativeClerk: actor.clerkUserId,
    nativeExists: true,
    runExists: true,
    legacyCount: 1n,
    legacyBytes: 512n,
    receipt: originalReceipt as Record<string, unknown>,
    legacyRows: 1,
    reviewedCount: 0n,
    reviewedBytes: 0n,
    corroboratedRows: 1,
    corroborated: {
      revisionId: "reviewed-revision-b",
      testRunId: "run-b",
      testCaseId: "case-b",
      projectId: "project-b",
      organizationId: "org-b",
      actorId: actor.id,
      actorClerkUserId: actor.clerkUserId,
      valid: true,
    },
  };
  const events: string[] = [],
    queries: string[] = [];
  const forbiddenBody = vi.fn(() => {
    throw Error(
      "No private run/procedure/note/evidence/head/foreign JSON may be materialized",
    );
  });
  const write = vi.fn(() => {
    throw Error("Legacy recovery must not write");
  });
  const tx = {
    $executeRaw: vi.fn(async () => {
      events.push("timeout");
      return 0;
    }),
    $queryRaw: vi.fn(async (raw: readonly string[] | { sql: string }) => {
      const sql = Array.isArray(raw)
        ? raw.join("?")
        : (raw as { sql: string }).sql;
      queries.push(sql);
      if (sql.includes('FROM "Organization"')) {
        events.push("organization-lock");
        return [{ suspendedAt: state.suspendedAt }];
      }
      if (sql.includes('FROM "Membership"')) {
        events.push("membership-lock");
        return [{ role: state.role, seatType: state.seatType }];
      }
      if (sql.includes("pg_advisory_xact_lock")) {
        events.push(
          sql.includes("ManualStepExecutionReview/v1")
            ? "uuid-lock"
            : "project-advisory",
        );
        return [];
      }
      if (sql.includes('FROM "Project"') && !sql.includes('FROM "AuditLog"')) {
        events.push("project-lock");
        return [{ organizationId: state.organizationId }];
      }
      if (sql.includes('FROM "User"') && !sql.includes('FROM "AuditLog"')) {
        events.push("native-clerk-lock");
        return state.nativeExists ? [{ clerkUserId: state.nativeClerk }] : [];
      }
      if (sql.includes('FROM "TestRun"') && !sql.includes('FROM "AuditLog"')) {
        events.push(sql.includes("FOR UPDATE") ? "run-lock" : "run-discovery");
        return state.runExists
          ? [
              {
                projectId: sql.includes("FOR UPDATE")
                  ? state.lockedProjectId
                  : state.projectId,
              },
            ]
          : [];
      }
      if (sql.includes('FROM "ManualStepResultRevision"')) {
        if (sql.includes("count(*)")) {
          events.push("legacy-admission");
          return [{ count: state.legacyCount, bytes: state.legacyBytes }];
        }
        events.push("legacy-scalars");
        return state.legacyRows === 1
          ? [state.receipt]
          : state.legacyRows === 0
            ? []
            : [state.receipt, state.receipt];
      }
      if (sql.includes('FROM "AuditLog"')) {
        if (sql.includes("count(*) AS count")) {
          events.push("reviewed-admission");
          return [{ count: state.reviewedCount, bytes: state.reviewedBytes }];
        }
        events.push("reviewed-scalars");
        return state.corroboratedRows === 1 ? [state.corroborated] : [];
      }
      return forbiddenBody();
    }),
    project: {
      findUnique: vi.fn(async () => {
        events.push("project-identity");
        return { organizationId: state.organizationId };
      }),
    },
    testRun: {
      findUnique: forbiddenBody,
      findUniqueOrThrow: forbiddenBody,
      update: write,
    },
    manualStepResultRevision: { findUnique: forbiddenBody, create: write },
    manualStepResultHead: {
      findMany: forbiddenBody,
      aggregate: forbiddenBody,
      upsert: write,
    },
    manualCaseResultHead: { count: forbiddenBody },
    testResult: {
      findFirst: forbiddenBody,
      count: forbiddenBody,
      create: write,
      update: write,
    },
    testCaseAttachment: { findMany: forbiddenBody },
    auditLog: { findMany: forbiddenBody, create: write },
  };
  const db = {
    $transaction: vi.fn(
      async (run: (transaction: typeof tx) => unknown, options: unknown) => {
        expect(options).toEqual({
          isolationLevel: "ReadCommitted",
          timeout: 20000,
          maxWait: 5000,
        });
        return run(tx);
      },
    ),
  };
  function reviewed() {
    state.reviewedCount = 1n;
    state.reviewedBytes = 1024n;
  }
  return {
    input,
    state,
    events,
    queries,
    tx,
    db: db as never,
    transaction: db.$transaction,
    write,
    forbiddenBody,
    reviewed,
  };
}
async function expectRefusal(
  h: ReturnType<typeof fixture>,
  code: string,
  transport = actor,
) {
  await expect(
    recordManualStepResult(h.db, transport, h.input),
  ).rejects.toMatchObject({ code });
  expect(h.write).not.toHaveBeenCalled();
  expect(h.forbiddenBody).not.toHaveBeenCalled();
}
describe("legacy step recovery-only adapter; native-shaped mocks, native SQL NOT RUN", () => {
  it("keeps exact original schema and normalized hash AST/order/default semantics", () => {
    const sf = ts.createSourceFile(
      "x.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    function tree(node: ts.Node): unknown {
      const children: unknown[] = [];
      ts.forEachChild(node, (child) => {
        children.push(tree(child));
      });
      return [
        node.kind,
        ts.isIdentifier(node) ||
        ts.isStringLiteral(node) ||
        ts.isNumericLiteral(node)
          ? node.text
          : null,
        children,
      ];
    }
    const digest = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const declaration = sf.statements
      .flatMap((statement) =>
        ts.isVariableStatement(statement)
          ? [...statement.declarationList.declarations]
          : [],
      )
      .find((node) => node.name.getText(sf) === "recordStepResultInputSchema");
    const fn = sf.statements.find(
      (node) =>
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "recordManualStepResult",
    ) as ts.FunctionDeclaration;
    const names = [
      "observations",
      "evidenceIds",
      "note",
      "correctionReason",
      "requestHash",
    ];
    const hashStatements = fn.body!.statements.filter(
      (node) =>
        ts.isVariableStatement(node) &&
        names.includes(node.declarationList.declarations[0]!.name.getText(sf)),
    );
    // Fingerprints taken from the accepted pre-edit source, not generated from this implementation.
    expect(digest(tree(declaration!))).toBe(
      "ff0c618b26faaf5ca93c9e97fb48c38285165ed82253fb10e9eb76cca50cc997",
    );
    expect(digest(hashStatements.map(tree))).toBe(
      "2578f1387f05fe5fd8e3f6f1e50202f330dd631a11f2ab9dfda7a8c41ebf6873",
    );
    const h = fixture();
    expect(h.input.note).toBe("retained\n legacy text");
    expect(h.input.observations?.environment).toBe("raw environment");
    expect(h.input.observations?.measurements[0]).toEqual({
      name: "Meter",
      unit: "V",
      value: 0,
      instrument: "",
    });
    const {
      evidenceAttachmentIds: _ids,
      observations: _observations,
      note: _note,
      ...bare
    } = h.input;
    expect(
      recordStepResultInputSchema.parse(bare).evidenceAttachmentIds,
    ).toEqual([]);
    expect(oldHash(h.input)).toBe(
      oldHash({
        ...h.input,
        evidenceAttachmentIds: [...h.input.evidenceAttachmentIds].reverse(),
      }),
    );
  });
  it("recovers the old compound tuple with the old ACK despite later completed/oversized run state", async () => {
    const h = fixture();
    expect(await recordManualStepResult(h.db, actor, h.input)).toEqual({
      revisionId: "legacy-revision-a",
      caseStatus: "FAIL",
      recovered: true,
    });
    expect(h.write).not.toHaveBeenCalled();
    expect(h.forbiddenBody).not.toHaveBeenCalled();
    expect(h.events).toEqual([
      "run-discovery",
      "timeout",
      "project-identity",
      "organization-lock",
      "membership-lock",
      "project-advisory",
      "project-lock",
      "native-clerk-lock",
      "run-lock",
      "uuid-lock",
      "legacy-admission",
      "legacy-scalars",
      "reviewed-admission",
    ]);
  });
  it("preserves original null derived-case status without consulting or healing current projection", async () => {
    const h = fixture();
    h.state.receipt.caseStatusAtRecord = null;
    expect(await recordManualStepResult(h.db, actor, h.input)).toEqual({
      revisionId: "legacy-revision-a",
      caseStatus: null,
      recovered: true,
    });
    expect(h.forbiddenBody).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
  });
  it.each([null, undefined, "", "x".repeat(201), "bad\0actor"])(
    "rejects missing/invalid independent Clerk %s before any DB",
    async (clerkUserId) => {
      const h = fixture();
      await expectRefusal(h, "FORBIDDEN", {
        ...actor,
        clerkUserId,
      } as typeof actor);
      expect(h.transaction).not.toHaveBeenCalled();
      expect(h.queries).toEqual([]);
    },
  );
  it.each([
    { role: "VIEWER" },
    { role: "COMPLIANCE_AUDITOR" },
    { seatType: "READ_ONLY" },
    { suspendedAt: new Date() },
    { nativeClerk: "switched-clerk" },
    { nativeExists: false },
  ])(
    "requires current FULL/native/org authority before receipt %s",
    async (patch) => {
      const h = fixture();
      Object.assign(h.state, patch);
      await expectRefusal(h, "FORBIDDEN");
      expect(h.events).not.toContain("legacy-admission");
      expect(h.events).not.toContain("reviewed-admission");
    },
  );
  it("rejects a reparented run before private receipt access", async () => {
    const h = fixture();
    h.state.lockedProjectId = "other-project";
    await expectRefusal(h, "FORBIDDEN");
    expect(h.events).not.toContain("legacy-admission");
  });
  it("preserves NOT_FOUND without any private receipt", async () => {
    const h = fixture();
    h.state.runExists = false;
    await expectRefusal(h, "NOT_FOUND");
    expect(h.events).toEqual(["run-discovery"]);
  });
  it("refuses new intents without receipt before later run/body/namespace work or any writes", async () => {
    const h = fixture();
    h.state.legacyCount = 0n;
    h.state.legacyBytes = 0n;
    await expectRefusal(h, "PRECONDITION_FAILED");
    expect(h.events).not.toContain("legacy-scalars");
    expect(h.events).not.toContain("reviewed-admission");
  });
  it.each([
    { legacyCount: 2n },
    { legacyCount: -1n },
    { legacyBytes: -1n },
    { legacyBytes: 0n },
    { legacyBytes: 8193n },
    { legacyCount: 0n, legacyBytes: 1n },
    { legacyCount: 1 as unknown as bigint },
  ])(
    "refuses unsupported native legacy admission before scalar projection %s",
    async (patch) => {
      const h = fixture();
      Object.assign(h.state, patch);
      await expectRefusal(h, "PRECONDITION_FAILED");
      expect(h.events).not.toContain("legacy-scalars");
    },
  );
  it.each([
    { requestHash: "b".repeat(64) },
    { status: "PASS" },
    { testCaseId: "other-case" },
    { stepIndex: 3 },
    { testRunId: "other-run" },
    { actorId: "other-native" },
    { idempotencyKey: randomUUID() },
  ])("conflicts on exact old request/coordinate mismatch %s", async (patch) => {
    const h = fixture();
    Object.assign(h.state.receipt, patch);
    await expectRefusal(h, "CONFLICT");
    expect(h.events).not.toContain("reviewed-admission");
  });
  it.each([
    { caseStatusAtRecord: "UNKNOWN" },
    { requestHash: "bad" },
    { id: "x".repeat(201) },
    { stepIndex: -1 },
    { note: "must not be projected" },
    { id: "😀".repeat(101) },
  ])(
    "refuses unsupported projected scalar metadata generically %s",
    async (patch) => {
      const h = fixture();
      Object.assign(h.state.receipt, patch);
      await expectRefusal(h, "PRECONDITION_FAILED");
    },
  );
  it.each([0, 2])(
    "refuses changed/missing projected receipt count %s",
    async (count) => {
      const h = fixture();
      h.state.legacyRows = count;
      await expectRefusal(h, "PRECONDITION_FAILED");
    },
  );
  it("does not invent global legacy uniqueness: corroborated DISTINCT reviewed run B permits old run A replay", async () => {
    const h = fixture();
    h.reviewed();
    expect(await recordManualStepResult(h.db, actor, h.input)).toEqual({
      revisionId: "legacy-revision-a",
      caseStatus: "FAIL",
      recovered: true,
    });
    expect(h.events.slice(-2)).toEqual([
      "reviewed-admission",
      "reviewed-scalars",
    ]);
    expect(h.forbiddenBody).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
  });
  it.each([{ revisionId: "legacy-revision-a" }, { testRunId: "run-a" }])(
    "refuses adoption/downgrade of current reviewed inner revision %s",
    async (patch) => {
      const h = fixture();
      h.reviewed();
      Object.assign(h.state.corroborated, patch);
      await expectRefusal(h, "CONFLICT");
    },
  );
  it.each([
    { reviewedCount: 2n },
    { reviewedCount: -1n },
    { reviewedBytes: 8193n },
    { reviewedBytes: -1n },
    { reviewedBytes: 0n },
  ])("refuses bounded reviewed namespace admission %s", async (patch) => {
    const h = fixture();
    h.reviewed();
    Object.assign(h.state, patch);
    await expectRefusal(h, "PRECONDITION_FAILED");
    expect(h.events).not.toContain("reviewed-scalars");
  });
  it.each([
    { valid: false },
    { revisionId: null },
    { testRunId: null },
    { revisionId: "😀".repeat(101) },
    { testCaseId: "😀".repeat(101) },
    { projectId: "😀".repeat(101) },
    { actorClerkUserId: "😀".repeat(101) },
    { organizationId: "" },
  ])(
    "refuses corrupt/unsupported foreign corroboration with no details or bodies %s",
    async (patch) => {
      const h = fixture();
      h.reviewed();
      Object.assign(h.state.corroborated, patch);
      await expectRefusal(h, "PRECONDITION_FAILED");
    },
  );
  it("refuses missing reviewed native references rather than guessing original provenance", async () => {
    const h = fixture();
    h.reviewed();
    h.state.corroboratedRows = 0;
    await expectRefusal(h, "PRECONDITION_FAILED");
  });
  it("native source admits before projection, corroborates exact namespaces/FKs, and never loads private bodies or writes", () => {
    const body = source.slice(
      source.indexOf("export async function recordManualStepResult("),
    );
    expect(body.indexOf("lockManualRetestAccess")).toBeLessThan(
      body.indexOf('FROM "ManualStepResultRevision"'),
    );
    expect(body.indexOf("const count = admittedCount")).toBeLessThan(
      body.indexOf("const rows ="),
    );
    expect(body.indexOf("const reviewedCount = admittedCount")).toBeLessThan(
      body.indexOf("const corroborated ="),
    );
    expect(body).toContain("hashtext('ManualStepExecutionReview/v1')");
    expect(body).toContain("LIKE 'ManualStepExecutionReview/%'");
    expect(body).toContain("jsonb_object_keys");
    expect(body).toContain("REVIEWED_REQUEST_BOUND_AT_WRITE");
    expect(body).toContain('LEFT JOIN "ManualStepResultRevision"');
    expect(body).toContain('LEFT JOIN "Project"');
    expect(body).toContain('LEFT JOIN "User"');
    expect(body).toContain('a."actorId"=v."actorId"');
    expect(body).toContain('a."organizationId"=p."organizationId"');
    expect(body).not.toMatch(
      /SELECT\s+(?:\w+\.)?\*|\.findUnique|\.findMany|\.create\(|\.update\(|\.upsert\(|set_config|recomputeFlaky|resolveHealing/,
    );
    expect(body).not.toMatch(
      /(?:SELECT|THEN)\s+(?:a\.)?metadata\s+(?:AS|FROM)/,
    );
    expect(body).toContain('isolationLevel: "ReadCommitted"');
  });
});
