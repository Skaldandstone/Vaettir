import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@vaettir/db";
import {
  androidCaseReplayRevision,
  readAndroidReplayCase,
  patchAndroidReplayCase,
  listAndroidReplayCases,
} from "./androidCaseReplay.js";
import {
  androidReplayPatchInput,
  androidReplayPatchedAction,
} from "./androidCaseReplaySchema.js";
type Case = Parameters<typeof androidCaseReplayRevision>[0];
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const authority = { nativeActorId: "native", clerkActorId: "clerk" };
const scope = {
  projectId: "project",
  originalOrganizationId: "org",
  expectedNativeActorId: "native",
  expectedClerkActorId: "clerk",
};
function fixture() {
  const initial = {
    id: "case",
    projectId: "project",
    title: "Catalog",
    background: null,
    given: ["Open home"],
    when: ["Open catalog"],
    then: ["Catalog is visible"],
    tags: ["android"],
    testType: "FUNCTIONAL",
    priority: "MEDIUM",
    suitePath: "preserved",
    testPlanId: null,
    validationDomain: "SOFTWARE",
    verificationProfile: {},
    sharedStepGroupId: null,
    archived: false,
    reviewStatus: "APPROVED",
    reviewedAt: new Date(1000),
    reviewedById: "old-reviewer",
    reviewNote: "Old review",
    updatedAt: new Date(1000),
    source: null,
    steps: [
      {
        id: "step",
        testCaseId: "case",
        order: 0,
        action: "Open catalog",
        expectedResult: "Catalog is visible",
        expectedActionOrData: "Keep original expectation",
        expectedResponse: "Keep response",
        mediaAttachmentIds: ["image"],
      },
    ],
  } as unknown as Case;
  let tc = structuredClone(initial),
    suspended = false,
    role = "EDITOR",
    seatType = "FULL",
    projectOrg = "org",
    mapped = "clerk",
    bytes = 1024n,
    failAudit = false,
    readCount = 0;
  const versions: Record<string, unknown>[] = [],
    audits: { metadata: unknown }[] = [],
    queries: string[] = [];
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.join("?");
      queries.push(sql);
      if (sql.includes('FROM "Organization"'))
        return [{ suspendedAt: suspended ? new Date() : null }];
      if (sql.includes('FROM "Membership"')) return [{ role, seatType }];
      if (sql.includes('FROM "Project"'))
        return [{ organizationId: projectOrg }];
      if (sql.includes('FROM "User"')) return [{ clerkUserId: mapped }];
      if (sql.includes(" AS bytes"))
        return [{ bytes, count: BigInt(tc.steps.length) }];
      if (sql.startsWith("SELECT id,CASE"))
        return [{ id: tc.id, title: tc.title }];
      if (sql.startsWith('SELECT id FROM "TestCase"'))
        return values[0] === tc.id &&
          values[1] === tc.projectId &&
          !tc.archived &&
          !tc.sharedStepGroupId
          ? [{ id: tc.id }]
          : [];
      return [];
    },
    testCase: {
      findUniqueOrThrow: async () => {
        readCount++;
        return structuredClone(tc);
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        tc = { ...tc, ...data, updatedAt: new Date(2000) } as Case;
        return structuredClone(tc);
      },
    },
    testCaseStep: {
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { action: string };
      }) => {
        const s = tc.steps.find((s) => s.id === where.id);
        if (!s) throw Error();
        Object.assign(s, data);
        return s;
      },
    },
    testCaseVersion: {
      findFirst: async () =>
        versions.length ? { versionNumber: versions.length } : null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        versions.push(data);
        return data;
      },
      findFirstOrThrow: async () => ({ versionNumber: versions.length }),
    },
    auditLog: {
      findFirst: async () => audits[0] ?? null,
      create: async ({ data }: { data: { metadata: unknown } }) => {
        if (failAudit) throw Error("synthetic audit failure");
        audits.push(data);
        return data;
      },
    },
  };
  const db = {
    $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => {
      const backup = structuredClone(tc),
        v = versions.length,
        a = audits.length;
      try {
        return await fn(tx);
      } catch (e) {
        tc = backup;
        versions.splice(v);
        audits.splice(a);
        throw e;
      }
    },
  } as unknown as PrismaClient;
  const locator = {
    kind: "RESOURCE_ID" as const,
    value: "com.example.qa:id/catalog",
    className: "android.widget.Button",
  };
  const plan = {
    caseId: tc.id,
    revision: androidCaseReplayRevision(tc),
    packageName: "com.example.qa",
    steps: [
      {
        stepId: "step",
        label: "Open catalog",
        expectedResult: "Catalog is visible",
        locator,
        assertion: {
          kind: "VISIBLE_LABEL",
          value: "Catalog",
          relationReviewed: true,
        },
      },
    ],
  };
  const input = androidReplayPatchInput.parse({
    ...scope,
    requestId: "10000000-0000-4000-8000-000000000001",
    plan,
    planHash: hash(plan),
    runId: "a".repeat(48),
    receipts: [
      {
        stepId: "step",
        expectedResult: "Catalog is visible",
        requestId: "20000000-0000-4000-8000-000000000001",
        sequence: 1,
        from: "b".repeat(64),
        to: "c".repeat(64),
        observedAt: 1200,
        originalLocator: locator,
        target: {
          packageName: "com.example.qa",
          objectId: locator.value,
          className: locator.className,
          selector: { kind: locator.kind, value: locator.value },
          bounds: [0, 0, 100, 100],
        },
        commandArgs: ["shell", "input", "tap", "50", "50"],
        assertion: {
          kind: "VISIBLE_LABEL",
          value: "Catalog",
          relationReviewed: true,
          matches: 1,
          passed: true,
        },
        repaired: false,
        repairApproval: null,
      },
    ],
    network: null,
    networkSelection: null,
    localReportedEvidenceReviewed: true,
    patchReviewed: true,
    disclosureApproved: true,
  });
  return {
    db,
    input,
    initial,
    versions,
    audits,
    queries,
    get tc() {
      return tc;
    },
    get reads() {
      return readCount;
    },
    mutate: (f: (c: Case) => void) => f(tc),
    deny: (key: string) => {
      if (key === "suspended") suspended = true;
      if (key === "role") role = "VIEWER";
      if (key === "seat") seatType = "READ_ONLY";
      if (key === "tenant") projectOrg = "other";
      if (key === "actor") mapped = "other";
      if (key === "size") bytes = 262145n;
    },
    fail: () => (failAudit = true),
  };
}
function correlatedFixture() {
  const f = fixture(),
    catalog = {
      id: "qa",
      revision: 1,
      routes: [
        {
          routeKey: "catalog",
          method: "GET" as const,
          template: "/catalog/{item_id}",
        },
      ],
    };
  f.input.receipts[0]!.timing = {
    clockId: "c".repeat(48),
    startedAt: 1100,
    endedAt: 1200,
  };
  f.input.network = {
    version: 2,
    capability: "DEBUG_APP_HTTP_CALLBACKS",
    debugBuild: true,
    metadataOnly: true,
    packageName: f.input.plan.packageName,
    runId: f.input.runId,
    sourceId: "qa",
    approvedRouteKeys: ["catalog"],
    catalog,
    clockId: "b".repeat(48),
    pendingRequests: 0,
    events: [
      {
        routeKey: "catalog",
        method: "GET",
        status: 200,
        startedAt: 620,
        durationMs: 10,
        outcome: "RESPONSE",
      },
    ],
  };
  f.input.networkSelection = {
    sourceId: "qa",
    approvedRouteKeys: ["catalog"],
    startedAt: 500,
    endedAt: 1000,
    correlation: {
      captureClock: { domain: "APP_REPORTED", clockId: "b".repeat(48) },
      catalog,
      sourceReviewed: true,
      catalogReviewed: true,
      temporalOnlyReviewed: true,
      clockCalibration: {
        appClockId: "b".repeat(48),
        connectorClockId: "c".repeat(48),
        method: "REPORTED_ROUND_TRIP_CALLBACK",
        samples: [
          {
            challengeId: "d".repeat(48),
            sentAt: 999,
            appObservedAt: 500,
            receivedAt: 1001,
          },
          {
            challengeId: "e".repeat(48),
            sentAt: 1499,
            appObservedAt: 1000,
            receivedAt: 1501,
          },
        ],
      },
    },
  };
  return f;
}
it("persists reported HTTP association with reviewed version and audit without raw clock equality", async () => {
  const f = correlatedFixture();
  const result = await patchAndroidReplayCase(f.db, f.input, authority);
  expect(result.nativeExecutionIndependentlyVerified).toBe(false);
  expect(f.versions).toHaveLength(1);
  expect(f.tc.steps[0]!.action).toContain("GET /catalog/{item_id} 200");
  expect(f.tc.steps[0]!.action).toContain("no causality");
  expect(f.tc.steps[0]!.expectedResult).toBe(
    f.initial.steps[0]!.expectedResult,
  );
  expect(f.audits[0]!.metadata).toMatchObject({
    networkCorrelation: {
      trust: "LOCAL_REPORTED_TEMPORAL_ONLY",
      matched: [{ stepId: "step", eventIndex: 0 }],
      unassigned: [],
    },
  });
});
it("catalog refusal creates no version; clock ambiguity is retained unassigned", async () => {
  const f = correlatedFixture();
  f.input.networkSelection!.correlation!.catalog = structuredClone(
    f.input.networkSelection!.correlation!.catalog,
  );
  f.input.networkSelection!.correlation!.catalog.revision++;
  await expect(
    patchAndroidReplayCase(f.db, f.input, authority),
  ).rejects.toThrow();
  expect(f.versions).toHaveLength(0);
  expect(f.tc).toEqual(f.initial);
  const g = correlatedFixture();
  g.input.networkSelection!.correlation!.clockCalibration!.connectorClockId =
    "f".repeat(48);
  await patchAndroidReplayCase(g.db, g.input, authority);
  expect(g.tc.steps[0]!.action).toContain("No HTTP event correlated");
  expect(g.tc.steps[0]!.action).not.toContain("GET /catalog");
  expect(g.audits[0]!.metadata).toMatchObject({
    networkCorrelation: { matched: [], unassigned: [{ eventIndex: 0 }] },
  });
});
it.each(["suspended", "role", "seat", "tenant", "actor"])(
  "HTTP metadata does not bypass current %s authority",
  async (key) => {
    const f = correlatedFixture();
    f.deny(key);
    await expect(
      patchAndroidReplayCase(f.db, f.input, authority),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.reads).toBe(0);
    expect(f.versions).toHaveLength(0);
  },
);
describe("APP-NAV-02 actual service with synthetic transaction delegates, no database or device", () => {
  it("reads original supported case revision and a bounded list under current locked authority", async () => {
    const f = fixture();
    const c = await readAndroidReplayCase(
      f.db,
      { ...scope, caseId: "case" },
      authority,
    );
    expect(c.revision).toBe(f.input.plan.revision);
    expect(c.steps[0]?.expectedResult).toBe("Catalog is visible");
    expect(c.steps[0]?.locator).toBeNull();
    expect(await listAndroidReplayCases(f.db, scope, authority)).toEqual([
      { id: "case", title: "Catalog" },
    ]);
    expect(f.queries.some((q) => q.includes("FOR UPDATE"))).toBe(true);
  });
  it.each(["suspended", "role", "seat", "tenant", "actor"])(
    "denies %s before reading private case or writing",
    async (key) => {
      const f = fixture();
      f.deny(key);
      await expect(
        readAndroidReplayCase(f.db, { ...scope, caseId: "case" }, authority),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        patchAndroidReplayCase(f.db, f.input, authority),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.reads).toBe(0);
      expect(f.audits).toHaveLength(0);
    },
  );
  it("refuses mismatched independent authentication and foreign cases", async () => {
    const f = fixture();
    await expect(
      readAndroidReplayCase(
        f.db,
        { ...scope, caseId: "case" },
        { ...authority, clerkActorId: "other" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      readAndroidReplayCase(f.db, { ...scope, caseId: "foreign" }, authority),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.reads).toBe(0);
  });
  it("rejects oversized, shared or unsupported procedures", async () => {
    const f = fixture();
    f.deny("size");
    await expect(
      readAndroidReplayCase(f.db, { ...scope, caseId: "case" }, authority),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.reads).toBe(0);
    const g = fixture();
    g.mutate((c) => (c.sharedStepGroupId = "shared"));
    await expect(
      readAndroidReplayCase(g.db, { ...scope, caseId: "case" }, authority),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("patches only reviewed technical action text, versions it and preserves expectations/media/source", async () => {
    const f = fixture();
    const r = await patchAndroidReplayCase(f.db, f.input, authority);
    expect(r.versionNumber).toBe(1);
    expect(f.tc.steps[0]?.action).toBe(
      androidReplayPatchedAction(
        "Open catalog",
        f.input.runId,
        f.input.receipts[0]!,
        null,
        f.input.requestId,
      ),
    );
    expect(f.tc.steps[0]).toMatchObject({
      expectedResult: "Catalog is visible",
      expectedResponse: "Keep response",
      expectedActionOrData: "Keep original expectation",
      mediaAttachmentIds: ["image"],
    });
    expect(f.tc).toMatchObject({
      given: f.initial.given,
      when: f.initial.when,
      then: f.initial.then,
      suitePath: "preserved",
      source: null,
      reviewStatus: "PENDING_REVIEW",
      reviewedById: null,
      reviewedAt: null,
    });
    expect(f.versions).toHaveLength(1);
    expect(f.audits[0]?.metadata).toMatchObject({
      receipt: r,
      automationSuggestion: {
        framework: "UI_AUTOMATOR",
        caseVersion: 1,
        paidGenerationPerformed: false,
      },
    });
  });
  it("recovers exact lost patch response without a second version or overwritten later human edit", async () => {
    const f = fixture();
    const first = await patchAndroidReplayCase(f.db, f.input, authority);
    f.mutate((c) => (c.title = "Later human edit"));
    expect(await patchAndroidReplayCase(f.db, f.input, authority)).toEqual(
      first,
    );
    expect(f.versions).toHaveLength(1);
    expect(f.tc.title).toBe("Later human edit");
    f.deny("suspended");
    await expect(
      patchAndroidReplayCase(f.db, f.input, authority),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("same request ID with different evidence conflicts", async () => {
    const f = fixture();
    await patchAndroidReplayCase(f.db, f.input, authority);
    const altered = structuredClone(f.input);
    altered.receipts[0]!.observedAt++;
    await expect(
      patchAndroidReplayCase(f.db, altered, authority),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.versions).toHaveLength(1);
  });
  it("change and restore of case content cannot revive an old revision", async () => {
    const f = fixture();
    f.mutate((c) => (c.updatedAt = new Date(3000)));
    await expect(
      patchAndroidReplayCase(f.db, f.input, authority),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.versions).toHaveLength(0);
  });
  it.each([
    "expectation",
    "assertion",
    "target",
    "sequence",
    "step",
    "planHash",
  ])("rejects altered %s evidence", async (key) => {
    const f = fixture(),
      v = structuredClone(f.input);
    if (key === "expectation") v.receipts[0]!.expectedResult = "Changed";
    if (key === "assertion") v.receipts[0]!.assertion.value = "Other";
    if (key === "target") v.receipts[0]!.target.packageName = "com.other.app";
    if (key === "sequence") v.receipts[0]!.sequence = 0;
    if (key === "step") v.receipts[0]!.stepId = "other";
    if (key === "planHash") v.planHash = "d".repeat(64);
    await expect(
      patchAndroidReplayCase(f.db, v, authority),
    ).rejects.toBeDefined();
    expect(f.versions).toHaveLength(0);
  });
  it("transaction failure leaves no partial case edit or version", async () => {
    const f = fixture();
    f.fail();
    await expect(
      patchAndroidReplayCase(f.db, f.input, authority),
    ).rejects.toThrow("synthetic audit failure");
    expect(f.tc).toEqual(f.initial);
    expect(f.versions).toHaveLength(0);
    expect(f.audits).toHaveLength(0);
  });
});

it("a repaired durable patch retains approved candidate and screen while preserving expected result", async () => {
  const f = fixture(),
    r = f.input.receipts[0]!;
  r.target.selector.value = "com.example.qa:id/new_catalog";
  r.target.objectId = r.target.selector.value;
  r.repaired = true;
  r.repairApproval = {
    candidateId: "d".repeat(64),
    screenId: r.from,
    reasons: ["SAME_LABEL"],
    retryApproved: true,
  };
  await patchAndroidReplayCase(f.db, f.input, authority);
  expect(f.audits[0]?.metadata).toMatchObject({
    evidence: {
      receipts: [
        {
          repairApproval: r.repairApproval,
          expectedResult: "Catalog is visible",
        },
      ],
    },
  });
});
it("repair flag without its separately approved original-screen receipt is refused before writes", async () => {
  const f = fixture();
  f.input.receipts[0]!.repaired = true;
  await expect(
    patchAndroidReplayCase(f.db, f.input, authority),
  ).rejects.toBeDefined();
  expect(f.versions).toHaveLength(0);
});
