import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  readProjectTagPage,
  projectTagMetadataRow,
  projectTagScopeHash,
  projectTagIdsOrdered,
  projectTagPopulationHash,
} from "./projectTags.js";
import {
  projectTagPageInput,
  MAX_TAG_PAGE_BYTES,
  MAX_TAG_COHORT_BYTES,
  MAX_TAG_MATCHING_CASES,
  MAX_TAG_IDENTITY_BYTES,
  MAX_TAG_RELATION_BYTES,
  MAX_TAG_RELATIONSHIPS,
  type ProjectTagPageInput,
} from "./projectTagsSchema.js";

const scope = {
  projectId: "project",
  organizationId: "org",
  actorId: "native-user",
  actorClerkUserId: "clerk-user",
};
const request = (
  section: ProjectTagPageInput["section"] = "CASES",
): ProjectTagPageInput => ({
  projectId: scope.projectId,
  originalOrganizationId: scope.organizationId,
  expectedClerkActorId: scope.actorClerkUserId,
  requestId: randomUUID(),
  tag: " exact tag ",
  section,
  archive: "ACTIVE",
  review: "APPROVED",
});
const row = (id = "case-001") => ({
  id,
  title: "Raw synthetic\nlabel",
  displayId: "TC-1",
  caseNumber: 1,
  reviewStatus: "APPROVED",
  archived: false,
  status: "DRAFT",
  matchingCaseCount: 1,
  memberHash: "d".repeat(32),
});
function fixture() {
  const state = {
    organizationId: scope.organizationId as string | null,
    suspendedAt: null as Date | null,
    member: { role: "VIEWER", seatType: "READ_ONLY" } as {
      role: string;
      seatType: string;
    } | null,
    clerkActorId: scope.actorClerkUserId as string | null,
    caseGate: { cases: 1n, identityBytes: 10n, unsupported: false },
    relation: { foreign: false },
    requirement: {
      links: 1n,
      identityBytes: 20n,
      foreign: false,
      unsupported: false,
    },
    gate: {
      entities: 1n,
      bytes: 200n,
      unsupported: false,
      anchorPresent: true,
    },
    populationHash: "a".repeat(32),
    basePopulationHash: "c".repeat(32),
    pageGate: { rows: 1n, bytes: 200n },
    rows: [row()],
  };
  const events: string[] = [],
    sqlReads: Array<{ sql: string; values: unknown[] }> = [];
  const tx = {
    $executeRaw: vi.fn(async () => {
      events.push("bounded-statement");
      return 0;
    }),
    project: {
      findUnique: vi.fn(async () => {
        events.push("project-identity");
        return state.organizationId
          ? { organizationId: state.organizationId }
          : null;
      }),
    },
    $queryRaw: vi.fn(
      async (
        raw: TemplateStringsArray | { sql: string; values: unknown[] },
      ) => {
        const sql = Array.isArray(raw)
          ? raw.join("?")
          : (raw as { sql: string }).sql;
        const values = Array.isArray(raw)
          ? []
          : (raw as { values: unknown[] }).values;
        sqlReads.push({ sql, values });
        if (sql.includes('FROM "Organization"')) {
          events.push("organization-lock");
          return [{ suspendedAt: state.suspendedAt }];
        }
        if (sql.includes('FROM "Membership"')) {
          events.push("membership-lock");
          return state.member ? [state.member] : [];
        }
        if (sql.includes('FROM "Project"')) {
          events.push("project-lock");
          return [{ organizationId: state.organizationId }];
        }
        if (sql.includes('FROM "User"')) {
          events.push("actor-lock");
          return [{ clerkUserId: state.clerkActorId }];
        }
        if (sql.includes("AS cases")) {
          events.push("case-identity-gate");
          return [state.caseGate];
        }
        if (sql.includes("AS links")) {
          events.push("requirement-reference-gate");
          return [state.requirement];
        }
        if (sql.includes("AS foreign")) {
          events.push("plan-release-relation-gate");
          return [state.relation];
        }
        if (sql.includes("AS entities")) {
          events.push("cohort-metadata-gate");
          return [state.gate];
        }
        if (sql.includes('AS "populationHash"')) {
          events.push("native-population-hash");
          return [
            {
              populationHash: state.populationHash,
              basePopulationHash: state.basePopulationHash,
              baseCases: state.caseGate.cases,
            },
          ];
        }
        if (sql.includes("WITH page AS")) {
          events.push("page-metadata-gate");
          return [state.pageGate];
        }
        if (sql.includes("ORDER BY id COLLATE")) {
          events.push("bounded-metadata-projection");
          return state.rows;
        }
        throw new Error(`Unexpected mocked native SQL ${sql}`);
      },
    ),
  };
  const db = {
    $transaction: vi.fn(async (work: (tx: typeof tx) => unknown) => work(tx)),
  };
  const read = (
    input = request(),
    authorized = { clerkActorId: scope.actorClerkUserId },
  ) => readProjectTagPage(db as never, scope.actorId, input, authorized);
  return { state, events, sqlReads, tx, db, read };
}
describe("exact project tag hub, isolated mocked source proof", () => {
  it("strict inputs preserve empty, whitespace and Unicode tags and never inject scope filters", () => {
    for (const tag of ["", " ", " tag ", "a,b", "λ 🎮", "<script>x</script>"])
      expect(projectTagPageInput.parse({ ...request(), tag }).tag).toBe(tag);
    for (const patch of [
      { requestId: undefined },
      { originalOrganizationId: undefined },
      { expectedClerkActorId: undefined },
      { review: undefined },
      { archive: undefined },
      { section: "RUNS" },
      { tag: "x".repeat(2001) },
      { tag: "\ud800" },
      { tag: "\0" },
      { source: "private body" },
    ])
      expect(
        projectTagPageInput.safeParse({ ...request(), ...patch }).success,
      ).toBe(false);
  });
  it("scope hash binds exact tag/section/current pins/filters, excluding activation UUID and cursor", () => {
    const input = request(),
      hash = projectTagScopeHash(input);
    expect(projectTagScopeHash({ ...input, requestId: randomUUID() })).toBe(
      hash,
    );
    expect(
      projectTagScopeHash({
        ...input,
        cursor: {
          scopeHash: hash,
          populationHash: "a".repeat(32),
          afterId: "case",
        },
      }),
    ).toBe(hash);
    for (const patch of [
      { tag: "exact tag" },
      { tag: "" },
      { section: "PLANS" as const },
      { archive: "ALL" as const },
      { review: "ALL" as const },
      { originalOrganizationId: "other-org" },
      { expectedClerkActorId: "other-clerk" },
    ])
      expect(projectTagScopeHash({ ...input, ...patch })).not.toBe(hash);
  });
  it("actual current read authorization locks original organization/member/project/actor before all private native joins", async () => {
    const f = fixture(),
      input = request(),
      output = await f.read(input);
    expect(f.events).toEqual([
      "bounded-statement",
      "project-identity",
      "organization-lock",
      "membership-lock",
      "project-lock",
      "actor-lock",
      "case-identity-gate",
      "cohort-metadata-gate",
      "native-population-hash",
      "page-metadata-gate",
      "bounded-metadata-projection",
    ]);
    expect(output).toMatchObject({
      readScope: scope,
      requestId: input.requestId,
      clerkActorId: scope.actorClerkUserId,
      matchingCases: 1,
      total: 1,
      nextCursor: null,
    });
    expect(output.items[0]).toEqual({
      id: "case-001",
      title: "Raw synthetic\nlabel",
      displayId: "TC-1",
      caseNumber: 1,
      reviewStatus: "APPROVED",
      archived: false,
      matchingCaseCount: 1,
      edge: "DIRECT_CASE_TAG",
    });
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
      timeout: 20000,
      maxWait: 5000,
    });
    for (const forbidden of [
      "values",
      "customFields",
      "executionTemplate",
      "memberHash",
      "background",
      "tags",
      "source",
      "notes",
      "shareToken",
    ])
      expect(output.items[0]).not.toHaveProperty(forbidden);
  });
  it("current Viewer/read-only is allowed while missing membership, revoked actor, suspension, role/seat or relocated org refuse before private joins", async () => {
    for (const change of [
      { member: null },
      { member: { role: "unknown", seatType: "FULL" } },
      { member: { role: "VIEWER", seatType: "unknown" } },
      { suspendedAt: new Date() },
      { organizationId: "relocated-org" },
      { clerkActorId: "new-clerk" },
    ]) {
      const f = fixture();
      Object.assign(f.state, change);
      await expect(f.read()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.events).not.toContain("case-identity-gate");
      expect(f.events).not.toContain("bounded-metadata-projection");
    }
    const f = fixture();
    await expect(
      f.read(request(), { clerkActorId: "changed-authenticated-subject" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.events).not.toContain("case-identity-gate");
  });
  it("native count, identity and complete metadata bytes refuse before any body projection", async () => {
    for (const change of [
      {
        caseGate: {
          cases: BigInt(MAX_TAG_MATCHING_CASES + 1),
          identityBytes: 1n,
          unsupported: false,
        },
      },
      {
        caseGate: {
          cases: 1n,
          identityBytes: BigInt(MAX_TAG_IDENTITY_BYTES + 1),
          unsupported: false,
        },
      },
      { caseGate: { cases: 1n, identityBytes: 1n, unsupported: true } },
      {
        gate: {
          entities: 1n,
          bytes: BigInt(MAX_TAG_COHORT_BYTES + 1),
          unsupported: false,
          anchorPresent: true,
        },
      },
      {
        gate: {
          entities: 1n,
          bytes: 1n,
          unsupported: true,
          anchorPresent: true,
        },
      },
      {
        gate: {
          entities: BigInt(MAX_TAG_MATCHING_CASES + 1),
          bytes: 1n,
          unsupported: false,
          anchorPresent: true,
        },
      },
      { pageGate: { rows: 1n, bytes: BigInt(MAX_TAG_PAGE_BYTES + 1) } },
    ]) {
      const f = fixture();
      Object.assign(f.state, change);
      await expect(f.read()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(f.events).not.toContain("bounded-metadata-projection");
    }
  });
  it("direct plan/release relation refusal cannot silently drop missing or foreign parents", async () => {
    for (const section of ["PLANS", "RELEASES"] as const) {
      const f = fixture();
      f.state.relation.foreign = true;
      await expect(f.read(request(section))).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(f.events).not.toContain("cohort-metadata-gate");
      const valid = fixture(),
        output = await valid.read(request(section));
      expect(output.items[0]!.edge).toBe(
        section === "PLANS" ? "DIRECT_CASE_PLAN" : "DIRECT_CASE_PLAN_RELEASE",
      );
      expect(output.items[0]).not.toHaveProperty("displayId");
      expect(output.items[0]!.status).toBe("DRAFT");
    }
  });
  it("active requirement references are admitted and bounded before deduplication or title projection", async () => {
    for (const change of [
      { foreign: true },
      { unsupported: true },
      { links: BigInt(MAX_TAG_RELATIONSHIPS + 1) },
      { identityBytes: BigInt(MAX_TAG_RELATION_BYTES + 1) },
    ]) {
      const f = fixture();
      Object.assign(f.state.requirement, change);
      await expect(f.read(request("REQUIREMENTS"))).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(f.events).not.toContain("cohort-metadata-gate");
    }
    const f = fixture();
    f.state.requirement.links = 2n;
    const result = await f.read(request("REQUIREMENTS"));
    expect(result.total).toBe(1);
    expect(result.items[0]!.matchingCaseCount).toBe(1);
    expect(result.items[0]!.edge).toBe("ACTIVE_CASE_REQUIREMENT_REFERENCE");
    const joins = f.sqlReads.map((read) => read.sql).join("\n");
    expect(joins).toContain('l."removedAt" IS NULL');
    expect(joins).toContain('s."organizationId" IS DISTINCT FROM');
    expect(joins).toContain("SELECT DISTINCT m.id");
    expect(joins).toContain("count(DISTINCT m.id)");
  });
  it("51st bounded metadata row only creates the next cursor; complete distinct section counts never become page counts", async () => {
    const f = fixture(),
      input = request();
    f.state.caseGate.cases = 851n;
    f.state.gate.entities = 851n;
    f.state.rows = Array.from({ length: 51 }, (_, index) =>
      row(`case-${String(index).padStart(3, "0")}`),
    );
    f.state.pageGate.rows = 51n;
    const result = await f.read(input);
    expect(result.items).toHaveLength(50);
    expect(result.matchingCases).toBe(851);
    expect(result.total).toBe(851);
    expect(result.nextCursor).toEqual({
      scopeHash: projectTagScopeHash(input),
      populationHash: projectTagPopulationHash(
        851,
        f.state.basePopulationHash,
        f.state.populationHash,
      ),
      afterId: "case-049",
    });
    const activation = {
      ...input,
      requestId: randomUUID(),
      cursor: result.nextCursor!,
    };
    f.state.rows = Array.from({ length: 51 }, (_, index) =>
      row(`case-${String(index + 50).padStart(3, "0")}`),
    );
    const next = await f.read(activation);
    expect(next.requestId).toBe(activation.requestId);
    expect(next.scopeHash).toBe(result.scopeHash);
  });
  it("cursor scope/population/anchor mismatch and inconsistent projection refuse, rather than invent an empty or smaller page", async () => {
    const input = request(),
      cursor = {
        scopeHash: projectTagScopeHash(input),
        populationHash: "a".repeat(32),
        afterId: "case-001",
      };
    const wrongScope = fixture();
    await expect(
      wrongScope.read({
        ...input,
        cursor: { ...cursor, scopeHash: "f".repeat(64) },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(wrongScope.tx.project.findUnique).not.toHaveBeenCalled();
    const changed = fixture();
    changed.state.populationHash = "b".repeat(32);
    await expect(changed.read({ ...input, cursor })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(changed.events).not.toContain("bounded-metadata-projection");
    const anchor = fixture();
    anchor.state.gate.anchorPresent = false;
    await expect(anchor.read({ ...input, cursor })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    for (const bad of [[], [row(), row()], [row("z"), row("a")]]) {
      const f = fixture();
      f.state.rows = bad;
      await expect(f.read()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    }
  });
  it("an admitted real zero count stays zero with explicit scope and omissions, not unsupported-failure success", async () => {
    const f = fixture();
    f.state.caseGate.cases = 0n;
    f.state.gate.entities = 0n;
    f.state.pageGate.rows = 0n;
    f.state.rows = [];
    const input = { ...request(), tag: "" },
      output = await f.read(input);
    expect(output).toMatchObject({
      tag: "",
      total: 0,
      matchingCases: 0,
      items: [],
      nextCursor: null,
      archive: "ACTIVE",
      review: "APPROVED",
    });
    expect(output.limitations.join(" ")).toContain("not directly tagged");
    expect(output.limitations.join(" ")).toContain("Saved execution-template");
    expect(output.limitations.join(" ")).toContain("Runs, historical");
    expect(f.sqlReads.some((read) => read.values.includes(""))).toBe(true);
    expect(f.sqlReads[4]?.sql).toContain("ANY(c.tags)");
  });
  it("whitelisting preserves exact labels and distinct unsupported fields cannot leak through DTO projection", () => {
    const output = projectTagMetadataRow("REQUIREMENTS", {
      ...row(),
      title: "  raw requirement\n ",
      secretBody: "never returned",
    } as never);
    expect(output.title).toBe("  raw requirement\n ");
    expect(output).not.toHaveProperty("secretBody");
    expect(output).not.toHaveProperty("memberHash");
    expect(output).not.toHaveProperty("status");
  });
  it("source stays read-only, scopes every actual relation, gates bytes before projection and does not fabricate historical or provider associations", () => {
    const source = readFileSync(
        new URL("./projectTags.ts", import.meta.url),
        "utf8",
      ),
      router = readFileSync(
        new URL("../routers/projectTags.ts", import.meta.url),
        "utf8",
      );
    expect(source).not.toMatch(
      /\b(?:tx|db)\.[\w.]*\.(?:create|update|delete)\(|\$queryRawUnsafe|fetch\(|invokeModel|executionTemplate|AcceptanceCriterion|TestRun/,
    );
    const nativeLock = source.match(/lockCaseFieldReadScope\(\s*tx/);
    expect(nativeLock).not.toBeNull();
    expect(nativeLock!.index).toBeLessThan(source.indexOf("const [caseGate]"));
    expect(source.indexOf("pageGate.bytes")).toBeLessThan(
      source.indexOf("const page ="),
    );
    expect(source).toContain('p."projectId"=${input.projectId}');
    expect(source).toContain('r."projectId"=${input.projectId}');
    expect(source).toContain('q."projectId"=${input.projectId}');
    expect(router).toContain("requireProjectAccess(ctx, input.projectId)");
    expect(router).toContain("ctx.user.clerkUserId");
    expect(router).not.toContain("EDITOR");
  });
  it("native C-collation identity checks retain exact UTF8 ordering and refuse anchors/order outside scope", () => {
    expect(projectTagIdsOrdered(["a", "b"], "0")).toBe(true);
    expect(projectTagIdsOrdered(["b", "a"])).toBe(false);
    expect(projectTagIdsOrdered(["a"], "a")).toBe(false);
    expect(projectTagIdsOrdered(["a", "a"])).toBe(false);
    expect(projectTagIdsOrdered(["λ", "🎮"])).toBe(true);
  });
  it("linked-section cursors bind the bounded base identities/count, including unassigned exact-tag cases", async () => {
    for (const section of ["PLANS", "RELEASES", "REQUIREMENTS"] as const) {
      const f = fixture(),
        input = request(section);
      f.state.caseGate.cases = 52n;
      f.state.gate.entities = 51n;
      f.state.rows = Array.from({ length: 51 }, (_, index) =>
        row(`entity-${String(index).padStart(3, "0")}`),
      );
      f.state.pageGate.rows = 51n;
      f.state.requirement.links = 51n;
      const first = await f.read(input),
        originalEntityHash = f.state.populationHash;
      expect(first.nextCursor).not.toBeNull();
      expect(first.matchingCases).toBe(52);
      // No plan/release/requirement row or associated member changes. Only an
      // unrelated-to-this-section matched case was added or removed.
      f.state.caseGate.cases = 53n;
      f.state.basePopulationHash = "d".repeat(32);
      const before = f.events.length;
      await expect(
        f.read({
          ...input,
          requestId: randomUUID(),
          cursor: first.nextCursor!,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.state.populationHash).toBe(originalEntityHash);
      expect(f.events.slice(before)).not.toContain(
        "bounded-metadata-projection",
      );
      f.state.caseGate.cases = 51n;
      f.state.basePopulationHash = "e".repeat(32);
      await expect(
        f.read({ ...input, cursor: first.nextCursor! }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      f.state.caseGate.cases = 52n; // A same-count identity replacement also changes the cursor.
      await expect(
        f.read({ ...input, cursor: first.nextCursor! }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const fingerprints = f.sqlReads.find((read) =>
        read.sql.includes('AS "basePopulationHash"'),
      )!.sql;
      expect(fingerprints).toContain("base AS (");
      expect(fingerprints).toContain("SELECT count(*) FROM base");
      expect(f.events.indexOf("case-identity-gate")).toBeLessThan(
        f.events.indexOf("native-population-hash"),
      );
    }
  });
  it("malformed native base/section fingerprints refuse without projection or a zero-count success", async () => {
    for (const changes of [
      { basePopulationHash: "bad" },
      { populationHash: "bad" },
    ]) {
      const f = fixture();
      Object.assign(f.state, changes);
      await expect(f.read()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(f.events).not.toContain("bounded-metadata-projection");
    }
    expect(() => projectTagPopulationHash(1, "bad", "a".repeat(32))).toThrow(
      "could not be identified",
    );
  });
  it("native codepoint/DTO codeunit width mismatch returns only a generic unsupported-metadata refusal", async () => {
    for (const change of [
      { title: "🎮".repeat(6000) },
      { id: "🎮".repeat(101) },
    ]) {
      const f = fixture();
      Object.assign(f.state.rows[0]!, change);
      // Mocked native codepoint/byte gates pass; DTO UTF-16-unit limits differ.
      // This is not executed PostgreSQL Unicode acceptance evidence.
      const error = await f.read().then(
        () => {
          throw new Error("Expected refusal");
        },
        (cause) => cause,
      );
      expect(error.code).toBe("PRECONDITION_FAILED");
      expect(error.message).toContain("typed metadata boundary");
      expect(error.message).not.toContain("🎮");
      expect(error.message).not.toContain("Zod");
      expect(error.cause).toBeUndefined();
    }
  });
});
