import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
import {
  readCiRunDetailAccess,
  readCiRunDetailPage,
} from "./ciRunDetailRead.js";
import {
  ciRunDetailReadKey,
  type CiRunDetailPageInput,
} from "./ciRunDetailReadSchema.js";
import { ciRunDetailsRouter } from "../routers/ciRunDetails.js";
function fixture() {
  const input: CiRunDetailPageInput = {
    projectId: "p",
    testRunId: "run",
    originalOrganizationId: "o",
    expectedClerkActorId: "cl",
    expectedNativeActorId: "n",
    requestId: randomUUID(),
    throughResultId: "result-z",
    limit: 2,
  };
  const flat = (id: string) => ({
    id,
    testRunId: "run",
    testCaseId: "case" as string | null,
    externalTestId: null as string | null,
    externalFilePath: " reported.ts " as string | null,
    status: "FAIL",
    durationMs: null as number | null,
    errorMessage: "" as string | null,
    note: " exact\n note " as string | null,
    caseId: "case" as string | null,
    caseDisplayId: null as string | null,
    caseTitle: "" as string | null,
    caseArchived: false as boolean | null,
    caseReviewStatus: "APPROVED" as string | null,
    sourceId: "source" as string | null,
    sourceFilePath: " src/case.ts " as string | null,
    sourceFunctionName: "" as string | null,
    sourceFramework: "vitest" as string | null,
    sourceFrameworkFamily: "VITEST" as string | null,
    sourceExternalTestId: "old-source-id" as string | null,
    sourceLastCommit: null as string | null,
    sourceLastAt: null as Date | null,
  });
  const events: string[] = [],
    queries: string[] = [],
    state = {
      org: "o",
      role: "VIEWER",
      seat: "READ_ONLY",
      nativeClerk: "cl",
      nativeExists: true,
      suspendedAt: null as Date | null,
      runExists: true,
      manual: false as boolean | null,
      cursor: true,
      anchor: "result-z" as string | null,
      cohort: {
        count: 3n,
        identityBytes: 200n,
        invalid: false,
        foreign: false,
        incoherent: false,
      },
      headerAdmission: { bytes: 300n, valid: true },
      pageAdmission: { bytes: 4000n, artifacts: 1n, valid: true },
      candidates: [{ id: "result-a" }, { id: "result-b" }, { id: "result-z" }],
      header: {
        id: "run",
        projectId: "p",
        ciProvider: "github",
        branch: "",
        commitSha: "",
        status: "FAILED",
        startedAt: new Date("2026-09-01T00:00:00.000Z"),
        finishedAt: null as Date | null,
      },
      rows: [
        flat("result-a"),
        { ...flat("result-b"), note: null, errorMessage: " failure\n detail " },
      ],
      artifacts: [
        {
          id: "artifact",
          testResultId: "result-a",
          type: "SCREENSHOT",
          capturedAt: new Date("2026-09-01T00:01:00.000Z"),
          durationMs: null as number | null,
        },
      ],
      groups: [{ status: "FAIL", count: 3n }],
    };
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    project: { findUnique: vi.fn(async () => ({ organizationId: state.org })) },
    $queryRaw: vi.fn(async (raw: readonly string[] | { sql: string }) => {
      const sql = Array.isArray(raw)
        ? raw.join("?")
        : (raw as { sql: string }).sql;
      queries.push(sql);
      if (sql.includes('FROM "Organization"')) {
        events.push("org-auth");
        return [{ suspendedAt: state.suspendedAt }];
      }
      if (sql.includes('FROM "Membership"')) {
        events.push("member-auth");
        return [{ role: state.role, seatType: state.seat }];
      }
      if (sql.includes('FROM "Project"') && sql.includes("FOR SHARE")) {
        events.push("project-auth");
        return [{ organizationId: state.org }];
      }
      if (sql.includes('FROM "User"')) {
        events.push("native-auth");
        return state.nativeExists ? [{ clerkUserId: state.nativeClerk }] : [];
      }
      const marker = sql.match(/CI_DETAIL_([A-Z_]+)/)?.[1];
      if (!marker) throw Error("Unexpected mocked native query");
      events.push(marker);
      if (marker === "RUN_SCOPE")
        return state.runExists
          ? [{ id: "run", projectId: "p", manual: state.manual }]
          : [];
      if (marker === "COHORT_ADMISSION") return [state.cohort];
      if (marker === "ANCHOR") return [{ id: state.anchor }];
      if (marker === "WINDOW") return [{ present: state.cursor }];
      if (marker === "CANDIDATES") return state.candidates;
      if (marker === "CASE_SOURCE_LOCKS" || marker === "SOURCE_LOCKS")
        return [];
      if (marker === "HEADER_ADMISSION") return [state.headerAdmission];
      if (marker === "PAGE_ADMISSION") return [state.pageAdmission];
      if (marker === "HEADER_BODY") return [state.header];
      if (marker === "RESULT_BODY") return state.rows;
      if (marker === "ARTIFACT_METADATA") return state.artifacts;
      if (marker === "RAW_STATUS_COUNTS") return state.groups;
      throw Error("Unknown mocked CI marker");
    }),
  };
  const db = {
    $transaction: vi.fn(
      async (work: (value: typeof tx) => unknown, options: unknown) => {
        expect(options).toEqual({
          isolationLevel: "RepeatableRead",
          timeout: 10000,
          maxWait: 5000,
        });
        return work(tx);
      },
    ),
  };
  return { input, state, events, queries, tx, db: db as never };
}
const authority = { clerkActorId: "cl" };
describe("additive CI reader, exact native-shaped mocked SQL; native SQL NOT RUN", () => {
  it.each([undefined, null, {}, { clerkActorId: "" }])(
    "direct service missing/empty independent authority %j refuses before even native discovery",
    async (authorization) => {
      const h = fixture(),
        { throughResultId: _anchor, limit: _limit, ...accessInput } = h.input;
      for (const read of [
        () =>
          readCiRunDetailAccess(h.db, "n", accessInput, authorization as never),
        () => readCiRunDetailPage(h.db, "n", h.input, authorization as never),
      ])
        await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(h.db.$transaction).not.toHaveBeenCalled();
      expect(h.tx.project.findUnique).not.toHaveBeenCalled();
      expect(h.events).toEqual([]);
    },
  );
  it("access/page echo original native reader/run/nonce/window, READ_ONLY is not upgraded and no private URL/body substitute is returned", async () => {
    const h = fixture(),
      { throughResultId: _window, limit: _limit, ...accessInput } = h.input;
    const access = await readCiRunDetailAccess(
      h.db,
      "n",
      accessInput,
      authority,
    );
    expect(access.throughResultId).toBe("result-z");
    expect(access.readContext.scope).toEqual({
      projectId: "p",
      testRunId: "run",
      organizationId: "o",
      actorId: "n",
      actorClerkUserId: "cl",
    });
    const page = await readCiRunDetailPage(h.db, "n", h.input, authority);
    expect(page.readContext.requestedKey).toBe(ciRunDetailReadKey(h.input));
    expect(page.rows.map((row) => row.id)).toEqual(["result-a", "result-b"]);
    expect(page.hasMore).toBe(true);
    expect(page.nextAfterId).toBe("result-b");
    expect(page.rows[0]!.linkedCase!.title).toBe("");
    expect(page.rows[0]!.linkState).toBe("LINKED_CURRENT_CASE");
    expect(page.rows[0]!.errorMessage).toBe("");
    expect(page.rows[0]!.note).toBe(" exact\n note ");
    expect(page.rows[1]!.note).toBeNull();
    expect(page.rows[0]!.linkedCase!.source!.filePath).toBe(" src/case.ts ");
    expect(page.rows[0]!.artifacts[0]!.capturedAt).toBe(
      "2026-09-01T00:01:00.000Z",
    );
    expect(page.header.startedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(page.header).not.toHaveProperty("ciRunUrl");
    expect(page.rows[0]).not.toHaveProperty("observations");
    expect(page.rows[0]!.artifacts[0]).not.toHaveProperty("storageUrl");
    expect(h.state.seat).toBe("READ_ONLY");
    for (const event of [
      "RUN_SCOPE",
      "COHORT_ADMISSION",
      "HEADER_ADMISSION",
      "PAGE_ADMISSION",
    ])
      expect(h.events.indexOf("native-auth")).toBeLessThan(
        h.events.indexOf(event),
      );
    expect(h.events.indexOf("PAGE_ADMISSION")).toBeLessThan(
      h.events.indexOf("RESULT_BODY"),
    );
  });
  it.each(["org", "role", "seat", "native", "jwt", "missing", "suspended"])(
    "current native %s refusal precedes run/private reads even with valid-shaped stale request",
    async (kind) => {
      const h = fixture();
      let authenticated = authority;
      if (kind === "org") h.state.org = "other";
      if (kind === "role") h.state.role = "UNSUPPORTED";
      if (kind === "seat") h.state.seat = "UNSUPPORTED";
      if (kind === "native") h.input.expectedNativeActorId = "other";
      if (kind === "jwt") authenticated = { clerkActorId: "other" };
      if (kind === "missing") h.state.nativeExists = false;
      if (kind === "suspended") h.state.suspendedAt = new Date();
      await expect(
        readCiRunDetailPage(h.db, "n", h.input, authenticated),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(h.events).not.toContain("RUN_SCOPE");
      expect(h.events).not.toContain("HEADER_BODY");
    },
  );
  it("missing/foreign target run is not discovered from full body; manual/unknown provider family refuses CI scope", async () => {
    const h = fixture();
    h.state.runExists = false;
    await expect(
      readCiRunDetailPage(h.db, "n", h.input, authority),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.events).not.toContain("COHORT_ADMISSION");
    for (const manual of [true, null]) {
      const f = fixture();
      f.state.manual = manual;
      await expect(
        readCiRunDetailPage(f.db, "n", f.input, authority),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(f.events).not.toContain("COHORT_ADMISSION");
    }
  });
  it("whole foreign/missing current-case or related stored-healing scope refuses BEFORE header/count/body publication, never masked as unmatched", async () => {
    const h = fixture();
    h.state.cohort.foreign = true;
    await expect(
      readCiRunDetailPage(h.db, "n", h.input, authority),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.events).not.toContain("CANDIDATES");
    expect(h.events).not.toContain("HEADER_BODY");
    expect(
      h.queries.find((query) => query.includes("CI_DETAIL_COHORT_ADMISSION")),
    ).toMatch(/actual_run\."projectId"|hc\."projectId"/);
  });
  it.each(["count", "identityBytes", "invalid", "incoherent", "negative"])(
    "unsupported whole cohort %s refuses without partial selected rows",
    async (kind) => {
      const h = fixture();
      if (kind === "count") h.state.cohort.count = 100001n;
      if (kind === "identityBytes") h.state.cohort.identityBytes = 16777217n;
      if (kind === "invalid") h.state.cohort.invalid = true;
      if (kind === "incoherent") h.state.cohort.incoherent = true;
      if (kind === "negative") h.state.cohort.count = -1n;
      await expect(
        readCiRunDetailPage(h.db, "n", h.input, authority),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(h.events).not.toContain("CANDIDATES");
    },
  );
  it.each([
    "header",
    "page",
    "combined",
    "artifactCount",
    "timestamp",
    "negative",
    "notBigint",
  ])(
    "native selected %s admission refuses before body materialization",
    async (kind) => {
      const h = fixture();
      if (kind === "header") h.state.headerAdmission.bytes = 131073n;
      if (kind === "page") h.state.pageAdmission.valid = false;
      if (kind === "combined") h.state.pageAdmission.bytes = 491221n;
      if (kind === "artifactCount") h.state.pageAdmission.artifacts = 201n;
      if (kind === "timestamp") h.state.headerAdmission.valid = false;
      if (kind === "negative") h.state.pageAdmission.bytes = -1n;
      if (kind === "notBigint")
        Object.assign(h.state.pageAdmission, { bytes: 12 });
      await expect(
        readCiRunDetailPage(h.db, "n", h.input, authority),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(h.events).not.toContain("HEADER_BODY");
      expect(h.events).not.toContain("RESULT_BODY");
    },
  );
  it("exact native combined boundary is admitted, +1 refuses (mocked byte result, not actual PostgreSQL proof)", async () => {
    for (const delta of [0n, 1n]) {
      const h = fixture();
      h.state.pageAdmission.bytes =
        524288n - 32768n - h.state.headerAdmission.bytes + delta;
      if (delta === 0n)
        await expect(
          readCiRunDetailPage(h.db, "n", h.input, authority),
        ).resolves.toMatchObject({ limit: 2 });
      else
        await expect(
          readCiRunDetailPage(h.db, "n", h.input, authority),
        ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    }
  });
  it("current missing cursor/anchor requires explicit refresh instead of silently rebasing", async () => {
    const h = fixture();
    h.state.cursor = false;
    await expect(
      readCiRunDetailPage(h.db, "n", h.input, authority),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events).not.toContain("COHORT_ADMISSION");
  });
  it.each(["duplicate", "reverse", "outside", "overlimit"])(
    "%s native candidate projection refuses before body",
    async (kind) => {
      const h = fixture();
      if (kind === "duplicate")
        h.state.candidates = [{ id: "result-a" }, { id: "result-a" }];
      if (kind === "reverse")
        h.state.candidates = [{ id: "result-b" }, { id: "result-a" }];
      if (kind === "outside") h.state.candidates = [{ id: "result-zz" }];
      if (kind === "overlimit") h.state.candidates.push({ id: "result-zz" });
      await expect(
        readCiRunDetailPage(h.db, "n", h.input, authority),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(h.events).not.toContain("HEADER_BODY");
    },
  );
  it("unmatched is exact native NULL, linked metadata does not invent source/notes or coalesce empty title", async () => {
    const h = fixture();
    Object.assign(h.state.rows[0]!, {
      testCaseId: null,
      caseId: null,
      caseTitle: null,
      sourceId: null,
    });
    const page = await readCiRunDetailPage(h.db, "n", h.input, authority);
    expect(page.rows[0]!.linkState).toBe("UNMATCHED");
    expect(page.rows[0]!.linkedCase).toBeNull();
    expect(page.rows[0]!.errorMessage).toBe("");
    expect(page.rows[0]!.note).toBe(" exact\n note ");
  });
  it("whole DTO mismatch/error is generic without private text or clipped partial content", async () => {
    const h = fixture();
    h.state.rows[0]!.note = "private body not echoed";
    h.state.rows[0]!.caseArchived = null;
    await expect(
      readCiRunDetailPage(h.db, "n", h.input, authority),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    try {
      await readCiRunDetailPage(h.db, "n", h.input, authority);
    } catch (error) {
      expect(String(error)).not.toContain("private body not echoed");
    }
  });
  it("empty window preserves scoped zero only, not a fabricated whole-project count or missing aggregate anchor", async () => {
    const h = fixture();
    h.input.throughResultId = null;
    h.state.cohort.count = 0n;
    h.state.candidates = [];
    h.state.rows = [];
    h.state.artifacts = [];
    h.state.pageAdmission.artifacts = 0n;
    h.state.groups = [];
    const page = await readCiRunDetailPage(h.db, "n", h.input, authority);
    expect(page.rows).toEqual([]);
    expect(page.summary.total).toBe(0);
    expect(page.limitations.join(" ")).toContain("not a globally frozen");
  });
  it("unsupported prototype-like future status counts as Other without object-key substitution", async () => {
    const h = fixture();
    h.state.groups = [{ status: "toString", count: 3n }];
    const page = await readCiRunDetailPage(h.db, "n", h.input, authority);
    expect(page.summary.other).toBe(3);
  });
  it.each([null, undefined])(
    "router verified JWT subject %s fails closed before transaction, not fallback native mapping",
    async (subject) => {
      const h = fixture(),
        ctx = {
          prisma: h.db,
          user: { id: "n", clerkUserId: "cl", memberships: [] },
          staff: null,
          authenticatedClerkSubject: subject,
        } as unknown as Context;
      const caller = ciRunDetailsRouter.createCaller(ctx);
      await expect(caller.page(h.input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(h.db.$transaction).not.toHaveBeenCalled();
    },
  );
  it("router uses verified subject despite stale cached mapping; mismatch with locked User refuses before private run", async () => {
    const h = fixture(),
      ctx = {
        prisma: h.db,
        user: { id: "n", clerkUserId: "cached-other", memberships: [] },
        staff: null,
        authenticatedClerkSubject: "cl",
      } as unknown as Context;
    await expect(
      ciRunDetailsRouter.createCaller(ctx).page(h.input),
    ).resolves.toMatchObject({
      readContext: { scope: { actorClerkUserId: "cl" } },
    });
    h.state.nativeClerk = "remapped";
    h.events.length = 0;
    await expect(
      ciRunDetailsRouter.createCaller(ctx).page(h.input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.events).not.toContain("RUN_SCOPE");
  });
  it("auth/native source contracts bind admission and contain no whole model/URL/source/provider/healing action", () => {
    const source = readFileSync(
        new URL("./ciRunDetailRead.ts", import.meta.url),
        "utf8",
      ),
      router = readFileSync(
        new URL("../routers/ciRunDetails.ts", import.meta.url),
        "utf8",
      );
    expect(router).toContain("ctx.authenticatedClerkSubject");
    expect(router).not.toContain("ctx.user.clerkUserId");
    expect(source).toContain("date_trunc('milliseconds'");
    expect(source).toContain("jsonb_build_array");
    expect(source).toContain("ELSE 524289::bigint");
    expect(source).toContain("octet_length(r.id)::bigint");
    expect(source).toContain("HEADER_ADMISSION");
    expect(source).toContain("PAGE_ADMISSION");
    expect(source).not.toMatch(
      /SELECT\s+(?:r\.\*|\*)|\.findMany\(|\.findUniqueOrThrow\(|createViewUrl|classifyAndSuggest|linkExternalTestResult|autoEnqueue|storageUrl|ciRunUrl|importSnapshot/,
    );
  });
});
