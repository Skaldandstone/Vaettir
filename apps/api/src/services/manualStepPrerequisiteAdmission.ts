import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { reviewedStepStatusSchema } from "./manualStepExecutionReviewSchema.js";

const MAX_CASES = 1000;
const MAX_NATIVE_BYTES = 1048576n;
const MAX_ROW_BYTES = 1024n;
const identity = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= 200 &&
  !value.includes("\0") &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
    value,
  );

const refused = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "The complete prerequisite result metadata is unsupported within native bounds. No prerequisite cohort was clipped or substituted.",
  });

type Admission = {
  count: bigint;
  distinctCases: bigint;
  bytes: bigint;
  maxBytes: bigint;
  invalid: boolean;
};
export type StepPrerequisiteResult = {
  testCaseId: string;
  status: "PASS" | "FAIL" | "BLOCKED" | "SKIP";
};

/**
 * Call only inside the existing locked, current-authorized reviewed transaction,
 * after accepted-receipt recovery and frozen graph admission. This helper grants
 * no authority. Its fixed RR snapshot is not a latest-live/all-writer fence.
 * Native aggregation bounds transferred scalar rows, not database scan cost.
 */
export async function loadBoundedStepPrerequisites(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    testRunId: string;
    caseIds: readonly string[];
  },
): Promise<StepPrerequisiteResult[]> {
  const { projectId, testRunId } = input;
  if (input.caseIds.length > MAX_CASES) throw refused();
  const caseIds = [...input.caseIds];
  if (
    !identity(projectId) ||
    !identity(testRunId) ||
    caseIds.length > MAX_CASES ||
    caseIds.some((id) => !identity(id)) ||
    new Set(caseIds).size !== caseIds.length
  )
    throw refused();
  // No empty IN query and no unnecessary native or materialized read.
  if (caseIds.length === 0) return [];

  const [admission] = await tx.$queryRaw<Admission[]>`
    SELECT count(*) AS count,count(DISTINCT r."testCaseId") AS "distinctCases",
      coalesce(sum(octet_length(jsonb_build_object('testCaseId',r."testCaseId",'status',r.status::text)::text)),0)::bigint AS bytes,
      coalesce(max(octet_length(jsonb_build_object('testCaseId',r."testCaseId",'status',r.status::text)::text)),0)::bigint AS "maxBytes",
      coalesce(bool_or(c.id IS NULL OR c."projectId"<>${projectId} OR r."testCaseId" IS NULL OR octet_length(r."testCaseId")>800 OR r.status::text NOT IN ('PASS','FAIL','BLOCKED','SKIP')),false) AS invalid
    FROM "TestResult" r LEFT JOIN "TestCase" c ON c.id=r."testCaseId"
    WHERE r."testRunId"=${testRunId} AND r."testCaseId" IN (${Prisma.join(caseIds)})`;
  const expectedMaximum = BigInt(caseIds.length);
  if (
    !admission ||
    typeof admission.count !== "bigint" ||
    admission.count < 0n ||
    admission.count > expectedMaximum ||
    typeof admission.distinctCases !== "bigint" ||
    admission.distinctCases !== admission.count ||
    typeof admission.bytes !== "bigint" ||
    admission.bytes < 0n ||
    admission.bytes > MAX_NATIVE_BYTES ||
    typeof admission.maxBytes !== "bigint" ||
    admission.maxBytes < 0n ||
    admission.maxBytes > MAX_ROW_BYTES ||
    admission.maxBytes > admission.bytes ||
    (admission.count === 0n &&
      (admission.bytes !== 0n || admission.maxBytes !== 0n)) ||
    (admission.count > 0n && admission.maxBytes === 0n) ||
    admission.invalid !== false
  )
    throw refused();

  // Fetch the complete admitted cohort, not DISTINCT/take/first-row evidence.
  const rows = await tx.testResult.findMany({
    where: {
      testRunId,
      testCaseId: { in: caseIds },
    },
    select: { testCaseId: true, status: true },
  });
  if (
    BigInt(rows.length) !== admission.count ||
    new Set(rows.map((row) => row.testCaseId)).size !== rows.length
  )
    throw refused();
  const requested = new Set(caseIds);
  let bytes = 0;
  const results: StepPrerequisiteResult[] = [];
  for (const row of rows) {
    const status = reviewedStepStatusSchema.safeParse(row.status);
    if (
      !identity(row.testCaseId) ||
      !requested.has(row.testCaseId) ||
      !status.success
    )
      throw refused();
    const value = { testCaseId: row.testCaseId, status: status.data };
    const rowBytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    bytes += rowBytes;
    if (rowBytes > Number(MAX_ROW_BYTES) || bytes > Number(MAX_NATIVE_BYTES))
      throw refused();
    results.push(value);
  }
  // A smaller *valid* cohort is returned literally for the caller's existing
  // missing/not-Pass BAD_REQUEST. Corruption is never presented as absence.
  return results;
}
