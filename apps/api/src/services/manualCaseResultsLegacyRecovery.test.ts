import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  recordManualCaseResult,
  manualCaseResultRequestHash,
} from "./manualCaseResults.js";
import {
  manualCaseResultWriteSchema,
  manualCaseResultAckSchema,
  manualCaseResultWriteKey,
} from "./manualCaseResultSchema.js";
import { manualCaseReviewedRequestHash } from "./manualCaseResultsReviewed.js";
const actor = { id: "native-original", clerkUserId: "clerk-original" };
function fixture() {
  const input = manualCaseResultWriteSchema.parse({
    projectId: "p",
    testRunId: "run",
    testCaseId: "case",
    expectedScope: {
      projectId: "p",
      organizationId: "o",
      clerkActorId: actor.clerkUserId,
    },
    expectedRevisionId: null,
    expectedCurrentFingerprint: "a".repeat(64),
    status: "FAIL",
    note: " Exact\n raw note ",
    observations: {
      environment: " raw environment ",
      measurements: [{ name: " Meter ", unit: " V ", value: 0 }],
    },
    correctionReason: null,
    idempotencyKey: randomUUID(),
  });
  const events: string[] = [],
    state = {
      organizationId: "o",
      role: "EDITOR",
      seatType: "FULL",
      suspendedAt: null as Date | null,
      nativeExists: true,
      nativeClerk: actor.clerkUserId,
      receipt: null as null | {
        id: string;
        projectId: string;
        testRunId: string;
        testCaseId: string;
        testResultId: string;
        revisionNumber: number;
        requestHash: string;
        actorClerkUserId: string;
      },
    };
  const noBody = () => {
    events.push("forbidden-private-body");
    throw Error(
      "Later completed/oversized/unsupported run or private evidence must not be loaded for legacy recovery",
    );
  };
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (raw: readonly string[] | { sql: string }) => {
      const sql = Array.isArray(raw)
        ? raw.join("?")
        : (raw as { sql: string }).sql;
      if (sql.includes('FROM "Organization"')) {
        events.push("organization-lock");
        return [{ suspendedAt: state.suspendedAt }];
      }
      if (sql.includes('FROM "Membership"')) {
        events.push("membership-lock");
        return [{ role: state.role, seatType: state.seatType }];
      }
      if (sql.includes("pg_advisory_xact_lock")) {
        events.push("write-advisory");
        return [];
      }
      if (sql.includes('FROM "Project"')) {
        events.push("project-lock");
        return [{ organizationId: state.organizationId }];
      }
      if (sql.includes('FROM "User"')) {
        events.push("native-clerk-lock");
        return state.nativeExists ? [{ clerkUserId: state.nativeClerk }] : [];
      }
      return noBody();
    }),
    project: {
      findUnique: vi.fn(async () => {
        events.push("minimal-project-identity");
        return { organizationId: state.organizationId };
      }),
    },
    membership: {
      findUniqueOrThrow: vi.fn(async () => ({
        role: state.role,
        seatType: state.seatType,
      })),
    },
    manualCaseResultRevision: {
      findUnique: vi.fn(
        async (args: {
          where: {
            organizationId_actorId_idempotencyKey: {
              organizationId: string;
              actorId: string;
              idempotencyKey: string;
            };
          };
        }) => {
          events.push("receipt");
          return args.where.organizationId_actorId_idempotencyKey
            .idempotencyKey === input.idempotencyKey
            ? state.receipt
            : null;
        },
      ),
      create: vi.fn(),
    },
    testRun: { findUnique: vi.fn(noBody) },
    testResult: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(noBody) },
    manualCaseResultHead: { create: vi.fn(), update: vi.fn() },
  };
  const db = {
    $transaction: vi.fn(
      async (run: (transaction: typeof tx) => unknown, options: unknown) => {
        expect(options).toMatchObject({
          isolationLevel: "RepeatableRead",
          timeout: 20000,
        });
        return run(tx);
      },
    ),
  };
  function accept() {
    state.receipt = {
      id: "revision",
      projectId: "p",
      testRunId: "run",
      testCaseId: "case",
      testResultId: "result",
      revisionNumber: 2,
      requestHash: manualCaseResultRequestHash(input),
      actorClerkUserId: actor.clerkUserId,
    };
  }
  return { input, state, events, tx, db: db as never, accept };
}
describe("old whole-case route recovery-only adapter; native-shaped mocks, SQL NOT RUN", () => {
  it("keeps historical parsing/defaults/property serialization/hash and old wire ACK, with no additive mode", async () => {
    const h = fixture();
    h.accept();
    const expected = manualCaseResultRequestHash(h.input);
    expect(
      manualCaseReviewedRequestHash({
        mode: "LEGACY_PARSED",
        expectedNativeActorId: actor.id,
        request: h.input,
      }),
    ).toBe(expected);
    expect(h.input.observations.environment).toBe("raw environment");
    expect(h.input.observations.measurements[0]).toEqual({
      name: "Meter",
      unit: "V",
      value: 0,
      instrument: "",
    });
    const ack = await recordManualCaseResult(h.db, actor, h.input);
    expect(ack).toEqual(
      manualCaseResultAckSchema.parse({
        scope: {
          projectId: "p",
          organizationId: "o",
          actorId: actor.id,
          clerkActorId: actor.clerkUserId,
        },
        testRunId: "run",
        testCaseId: "case",
        resultId: "result",
        revisionId: "revision",
        revisionNumber: 2,
        idempotencyKey: h.input.idempotencyKey,
        requestHash: expected,
        recovered: true,
      }),
    );
    expect(ack).not.toHaveProperty("mode");
    expect(manualCaseResultWriteKey(h.input)).toContain(
      '"note":" Exact\\n raw note "',
    );
    expect(h.tx.testResult.create).not.toHaveBeenCalled();
    expect(h.tx.manualCaseResultRevision.create).not.toHaveBeenCalled();
  });
  it("absence of exact accepted UUID refuses new rows before any later private run/current evidence", async () => {
    const h = fixture();
    await expect(
      recordManualCaseResult(h.db, actor, h.input),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events.at(-1)).toBe("receipt");
    expect(h.events).not.toContain("forbidden-private-body");
    for (const mutation of [
      h.tx.testResult.create,
      h.tx.testResult.update,
      h.tx.manualCaseResultRevision.create,
      h.tx.manualCaseResultHead.create,
      h.tx.manualCaseResultHead.update,
    ])
      expect(mutation).not.toHaveBeenCalled();
  });
  it.each(["organization", "FULL", "native", "Clerk", "suspension"])(
    "current %s authorization refusal precedes receipt/private body",
    async (mode) => {
      const h = fixture();
      h.accept();
      if (mode === "organization") h.state.organizationId = "other";
      if (mode === "FULL") h.state.seatType = "READ_ONLY";
      if (mode === "native") h.state.nativeExists = false;
      if (mode === "Clerk") h.state.nativeClerk = "changed-current";
      if (mode === "suspension") h.state.suspendedAt = new Date();
      await expect(
        recordManualCaseResult(h.db, actor, h.input),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(h.events).not.toContain("receipt");
      expect(h.events).not.toContain("forbidden-private-body");
      expect(h.tx.manualCaseResultRevision.create).not.toHaveBeenCalled();
    },
  );
  it.each([
    "requestHash",
    "projectId",
    "testRunId",
    "testCaseId",
    "actorClerkUserId",
  ] as const)(
    "receipt %s disagreement conflicts, never repairs body/UUID",
    async (key) => {
      const h = fixture();
      h.accept();
      h.state.receipt![key] = "different";
      await expect(
        recordManualCaseResult(h.db, actor, h.input),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(h.events).not.toContain("forbidden-private-body");
      expect(h.tx.testResult.update).not.toHaveBeenCalled();
    },
  );
  it("changed original note/status/UUID cannot inherit accepted acknowledgement", async () => {
    const h = fixture();
    h.accept();
    await expect(
      recordManualCaseResult(h.db, actor, {
        ...h.input,
        note: "changed exact text",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      recordManualCaseResult(h.db, actor, { ...h.input, status: "PASS" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      recordManualCaseResult(h.db, actor, {
        ...h.input,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      h.tx.manualCaseResultRevision.findUnique.mock.calls[0]![0],
    ).toMatchObject({
      where: {
        organizationId_actorId_idempotencyKey: {
          organizationId: "o",
          actorId: actor.id,
          idempotencyKey: h.input.idempotencyKey,
        },
      },
    });
    expect(h.tx.testResult.create).not.toHaveBeenCalled();
  });
  it("accepted original receipt recovers before later completion, oversized or unsupported native run admission", async () => {
    const h = fixture();
    h.accept();
    const ack = await recordManualCaseResult(h.db, actor, h.input);
    expect(ack.recovered).toBe(true);
    expect(h.events.indexOf("native-clerk-lock")).toBeLessThan(
      h.events.indexOf("receipt"),
    );
    expect(h.events).not.toContain("forbidden-private-body");
    expect(h.tx.testRun.findUnique).not.toHaveBeenCalled();
    expect(h.tx.testResult.findFirst).not.toHaveBeenCalled();
  });
  it("adapter/reviewed import direction is one-way and old service contains no revision/observation writer", () => {
    const old = readFileSync(
        new URL("./manualCaseResults.ts", import.meta.url),
        "utf8",
      ),
      reviewed = readFileSync(
        new URL("./manualCaseResultsReviewed.ts", import.meta.url),
        "utf8",
      ),
      adapter = old.slice(
        old.indexOf("export async function recordManualCaseResult"),
      );
    expect(adapter).toContain('mode: "LEGACY_PARSED"');
    expect(adapter).toContain("manualCaseResultWriteSchema.parse(raw)");
    expect(adapter).not.toMatch(
      /testResult\.(create|update)|manualCaseResult(Head|Revision)\.(create|update)|randomUUID/,
    );
    expect(reviewed).not.toMatch(/from ["']\.\/manualCaseResults\.js["']/);
  });
});
