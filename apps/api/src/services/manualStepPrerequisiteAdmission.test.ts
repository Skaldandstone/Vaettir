import { readFileSync } from "node:fs";
import type { Prisma } from "@vaettir/db";
import { describe, expect, it, vi } from "vitest";
import { loadBoundedStepPrerequisites } from "./manualStepPrerequisiteAdmission.js";

const input = {
  projectId: "project",
  testRunId: "run",
  caseIds: ["first", "second"],
};
function fixture() {
  const admission = {
    count: 2n,
    distinctCases: 2n,
    bytes: 100n,
    maxBytes: 50n,
    invalid: false,
  };
  const rows = [
    { testCaseId: "first", status: "PASS" },
    { testCaseId: "second", status: "PASS" },
  ];
  const events: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (...args: unknown[]) => {
      expect(args.length).toBeGreaterThan(0);
      events.push("native-admission");
      return [admission];
    }),
    testResult: {
      findMany: vi.fn(async (...args: unknown[]) => {
        expect(args).toHaveLength(1);
        events.push("scalar-projection");
        return rows;
      }),
    },
  };
  return {
    admission,
    rows,
    events,
    tx,
    client: tx as unknown as Prisma.TransactionClient,
  };
}
describe("step prerequisite complete scalar admission; mocked native only", () => {
  it("admits native counts/bytes/identity before fetching exact scalar cohort", async () => {
    const h = fixture();
    expect(await loadBoundedStepPrerequisites(h.client, input)).toEqual(h.rows);
    expect(h.events).toEqual(["native-admission", "scalar-projection"]);
    expect(h.tx.testResult.findMany).toHaveBeenCalledWith({
      where: { testRunId: "run", testCaseId: { in: ["first", "second"] } },
      select: { testCaseId: true, status: true },
    });
    const [strings, ...values] = h.tx.$queryRaw.mock.calls[0]! as unknown as [
      readonly string[],
      ...unknown[],
    ];
    expect(strings.join("?")).toContain(
      'FROM "TestResult" r LEFT JOIN "TestCase"',
    );
    expect(strings.join("?")).toContain('WHERE r."testRunId"=');
    expect(values.slice(0, 2)).toEqual(["project", "run"]);
  });
  it("empty valid cohort performs zero native/fetch calls", async () => {
    const h = fixture();
    expect(
      await loadBoundedStepPrerequisites(h.client, { ...input, caseIds: [] }),
    ).toEqual([]);
    expect(h.events).toEqual([]);
  });
  it.each([
    null,
    { count: -1n },
    { count: 3n },
    { count: 1001n },
    { count: 2 },
    { distinctCases: 1n },
    { distinctCases: null },
    { bytes: -1n },
    { bytes: 1048577n },
    { bytes: 100 },
    { maxBytes: -1n },
    { maxBytes: 1025n },
    { maxBytes: 0n },
    { maxBytes: 101n },
    { maxBytes: null },
    { invalid: true },
    { invalid: null },
  ])(
    "native unsupported metadata refuses before projection %#",
    async (patch) => {
      const h = fixture();
      if (patch === null) h.tx.$queryRaw.mockResolvedValue([]);
      else Object.assign(h.admission, patch);
      await expect(
        loadBoundedStepPrerequisites(h.client, input),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(h.tx.testResult.findMany).not.toHaveBeenCalled();
    },
  );
  it.each([
    { projectId: "" },
    { testRunId: "x\0y" },
    { caseIds: ["first", "first"] },
    { caseIds: [""] },
    { caseIds: ["x".repeat(201)] },
    { caseIds: ["\ud800"] },
    { caseIds: Array.from({ length: 1001 }, (_, index) => `case-${index}`) },
  ])("invalid original cohort refuses before any SQL %#", async (patch) => {
    const h = fixture();
    await expect(
      loadBoundedStepPrerequisites(h.client, { ...input, ...patch }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events).toEqual([]);
  });
  it("native duplicate rows cannot be collapsed into an apparent Pass", async () => {
    const h = fixture();
    h.admission.distinctCases = 1n;
    await expect(
      loadBoundedStepPrerequisites(h.client, input),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events).toEqual(["native-admission"]);
  });
  it("native missing valid cohort returns literal absence, not a fabricated Pass", async () => {
    const h = fixture();
    Object.assign(h.admission, {
      count: 0n,
      distinctCases: 0n,
      bytes: 0n,
      maxBytes: 0n,
    });
    h.rows.length = 0;
    expect(await loadBoundedStepPrerequisites(h.client, input)).toEqual([]);
  });
  it.each(["FAIL", "BLOCKED", "SKIP"])(
    "valid native non-Pass %s remains literal for business policy",
    async (status) => {
      const h = fixture();
      Object.assign(h.admission, { count: 1n, distinctCases: 1n });
      h.rows.splice(0, 2, { testCaseId: "first", status });
      expect(await loadBoundedStepPrerequisites(h.client, input)).toEqual([
        { testCaseId: "first", status },
      ]);
    },
  );
  it.each([
    "short",
    "large",
    "duplicate",
    "foreign",
    "null-id",
    "null-status",
    "false-status",
    "flaky",
  ])("projected disagreement %s fails closed", async (kind) => {
    const h = fixture();
    if (kind === "short") h.rows.pop();
    if (kind === "large") h.rows.push({ testCaseId: "extra", status: "PASS" });
    if (kind === "duplicate") h.rows[1]!.testCaseId = "first";
    if (kind === "foreign") h.rows[1]!.testCaseId = "other";
    if (kind === "null-id") Object.assign(h.rows[1]!, { testCaseId: null });
    if (kind === "null-status" || kind === "false-status")
      Object.assign(h.rows[1]!, {
        status: kind === "null-status" ? null : false,
      });
    if (kind === "flaky") h.rows[1]!.status = "FLAKY";
    await expect(
      loadBoundedStepPrerequisites(h.client, input),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events).toEqual(["native-admission", "scalar-projection"]);
  });
  it("1000 unique supported cases are admitted without order/filter loss", async () => {
    const h = fixture();
    const ids = Array.from({ length: 1000 }, (_, index) => `case-${index}`);
    Object.assign(h.admission, {
      count: 1000n,
      distinctCases: 1000n,
      bytes: 100000n,
      maxBytes: 100n,
    });
    h.rows.splice(
      0,
      2,
      ...ids.map((testCaseId) => ({ testCaseId, status: "PASS" })),
    );
    expect(
      await loadBoundedStepPrerequisites(h.client, { ...input, caseIds: ids }),
    ).toEqual(h.rows);
    expect(h.tx.testResult.findMany.mock.calls[0]?.[0]).not.toHaveProperty(
      "take",
    );
  });
  it("retains supported raw whitespace and astral IDs without normalization", async () => {
    const h = fixture();
    const ids = ["  raw ID  ", "😀".repeat(100)];
    h.rows.splice(
      0,
      2,
      ...ids.map((testCaseId) => ({ testCaseId, status: "PASS" })),
    );
    expect(
      await loadBoundedStepPrerequisites(h.client, { ...input, caseIds: ids }),
    ).toEqual(h.rows);
  });
  it("zero native count with nonzero bytes is corrupt, not missing evidence", async () => {
    const h = fixture();
    Object.assign(h.admission, { count: 0n, distinctCases: 0n });
    await expect(
      loadBoundedStepPrerequisites(h.client, input),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.tx.testResult.findMany).not.toHaveBeenCalled();
  });
  it("captures original scalar scope/cohort before an await without rebinding", async () => {
    const h = fixture();
    const original = {
      projectId: "project",
      testRunId: "run",
      caseIds: ["first", "second"],
    };
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.tx.$queryRaw.mockImplementationOnce(async (...args: unknown[]) => {
      expect(args.length).toBeGreaterThan(0);
      await paused;
      return [h.admission];
    });
    const pending = loadBoundedStepPrerequisites(h.client, original);
    original.projectId = "foreign-project";
    original.testRunId = "foreign-run";
    original.caseIds.splice(0, 2, "foreign-case");
    release();
    expect(await pending).toEqual(h.rows);
    expect(h.tx.testResult.findMany).toHaveBeenCalledWith({
      where: { testRunId: "run", testCaseId: { in: ["first", "second"] } },
      select: { testCaseId: true, status: true },
    });
  });
  it("source admits metadata before scalar fetch; never reads result bodies or clips", () => {
    const source = readFileSync(
      new URL("./manualStepPrerequisiteAdmission.ts", import.meta.url),
      "utf8",
    );
    expect(source.indexOf("const [admission]")).toBeLessThan(
      source.indexOf("const rows = await"),
    );
    expect(source).toContain('count(DISTINCT r."testCaseId")');
    expect(source).toContain("admission.distinctCases !== admission.count");
    expect(source).toContain(
      "r.status::text NOT IN ('PASS','FAIL','BLOCKED','SKIP')",
    );
    expect(source).not.toMatch(
      /\b(?:note|observations|evidenceAttachments|externalTestId|externalFilePath|errorMessage|durationMs)\s*[:.]/,
    );
    expect(source).not.toMatch(/\b(?:take|skip|distinct)\s*:/);
    expect(source).not.toMatch(
      /\bLIMIT\b|SELECT\s+DISTINCT|\.(?:create|update|delete|upsert|connect|disconnect)\(/,
    );
  });
});
