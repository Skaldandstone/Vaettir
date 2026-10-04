import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { reportRunWhere } from "../routers/reportSnapshotScope.js";
import {
  recordedExecutionTrendKey,
  recordedExecutionTrendOutput,
  recordedExecutionTrendRunsOutput,
  type RecordedExecutionTrendInput,
  type RecordedExecutionTrend,
} from "./recordedExecutionTrendSchema.js";

const limitations = [
  "Recorded result-row observations, not unique cases or attempts. Repeated/imported observations remain separate; retry grouping and original per-result timestamps are unavailable.",
  "Days use each selected run's stored startedAt in UTC, not the result-recorded time. Imports may not preserve original chronology. Empty days are zero selected observations only after the entire bounded aggregate succeeds.",
  "Current read-time evidence includes in-progress runs/results and may change. RUNNING is explicit; non-running runs without a valid finishedAt have unavailable completion evidence. No immutable dashboard snapshot is created.",
  "Mapping uses the current same-project native case identity. Null case references are unmatched; missing or foreign references are unavailable mapping, not an inferred pass or foreign case disclosure.",
  "Optional exact platform/environment filters use recorded version-one configuration fields only. Build uses version-one manual configuration or exact non-manual recorded commit as maintained report scope does. Provider and branch labels do not infer platforms, environments or release membership.",
  "PASS/FAIL/FLAKY/SKIP/BLOCKED are stored statuses, not a new regression classifier, flakiness rate, release verdict, coverage measure or verified repair. Durations sum only non-negative recorded values, not comparable performance.",
  "At most 20,000 selected runs and 100,000 result rows; larger populations refuse before aggregation. No raw notes, errors, source, private configuration body or artifacts are loaded. Access is current and bound to the original organization.",
  "Drilldown is current deterministic run metadata, not immutable pagination. Changes between day pages can shift membership; rerun the applied scope. Supported configuration labels may be excerpts; unavailable recorded values are not inferred from project defaults.",
  "A conservative prefilter safety gate bounds all same-project run identity bytes in the selected UTC date window to 4 MiB with native IDs of at most 200 units, before optional configuration filters. Many out-of-filter runs may therefore require a narrower date window; failures are not empty evidence.",
];
type Day = RecordedExecutionTrend["days"][number];
function emptyCounts() {
  return {
    runs: 0,
    results: 0,
    mapped: 0,
    unmatched: 0,
    unavailableMapping: 0,
    inProgressRuns: 0,
    finishedRecordedRuns: 0,
    completionUnavailableRuns: 0,
    inProgressResults: 0,
    timedResults: 0,
    missingDurations: 0,
    invalidDurations: 0,
    sumDurationMs: 0,
    outcomes: { PASS: 0, FAIL: 0, FLAKY: 0, SKIP: 0, BLOCKED: 0 },
  };
}
export async function withRecordedExecutionTrendAccess<T>(
  db: PrismaClient,
  actorId: string,
  clerkActorId: string,
  input: RecordedExecutionTrendInput,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
      const org = await tx.$queryRaw<
        Array<{ suspendedAt: Date | null }>
      >`SELECT "suspendedAt" FROM "Organization" WHERE id=${input.originalOrganizationId} FOR SHARE`;
      const member = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "Membership" WHERE "organizationId"=${input.originalOrganizationId} AND "userId"=${actorId} FOR SHARE`;
      const project = await tx.$queryRaw<
        Array<{ organizationId: string }>
      >`SELECT "organizationId" FROM "Project" WHERE id=${input.projectId} FOR SHARE`;
      const user = await tx.user.findUnique({
        where: { id: actorId },
        select: { clerkUserId: true },
      });
      if (
        !org[0] ||
        org[0].suspendedAt ||
        !member[0] ||
        project[0]?.organizationId !== input.originalOrganizationId ||
        user?.clerkUserId !== clerkActorId
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Current original-organization membership and project access are required.",
        });
      return work(tx);
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
function window(input: RecordedExecutionTrendInput, asOf: Date) {
  return {
    start: new Date(`${input.start}T00:00:00.000Z`),
    end: new Date(
      Math.min(
        Date.parse(`${input.end}T00:00:00.000Z`) + 86400000 - 1,
        asOf.getTime(),
      ),
    ),
  };
}
async function population(
  tx: Prisma.TransactionClient,
  input: RecordedExecutionTrendInput,
  asOf: Date,
) {
  const range = window(input, asOf),
    scope = {
      ...(input.platform === undefined ? {} : { platform: input.platform }),
      ...(input.environment === undefined
        ? {}
        : { environment: input.environment }),
      ...(input.build === undefined ? {} : { build: input.build }),
    };
  // One maintained compiler, no alternative SQL configuration/filter semantics.
  const where = reportRunWhere(input.projectId, range.start, range.end, scope);
  const runs = await tx.testRun.count({ where });
  if (runs > 20000)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "More than 20,000 recorded runs match. Narrow the UTC interval or exact configuration; no partial trend was produced.",
    });
  const results = await tx.testResult.count({
    where: { testRun: { is: where } },
  });
  if (results > 100000)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "More than 100,000 result observations match. Narrow the scope; no partial trend was produced.",
    });
  const ids = await tx.$queryRaw<
    Array<{ bytes: string; supported: boolean }>
  >(Prisma.sql`
    SELECT COALESCE(sum(octet_length(id)),0)::text AS bytes,
      COALESCE(bool_and(length(id) BETWEEN 1 AND 200 AND id ~ '^[a-zA-Z0-9_-]+$'),true) AS supported
    FROM "TestRun" WHERE "projectId"=${input.projectId} AND "startedAt">=${range.start} AND "startedAt"<=${range.end}`);
  const bytes = Number(ids[0]?.bytes);
  if (
    !ids[0]?.supported ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > 4 * 1024 * 1024
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Run identity metadata in this project's UTC date window exceeds supported 4 MiB/native-ID bounds before configuration filters. Narrow dates or repair native identities; no empty or partial trend was returned.",
    });
  return { where, runs, results, range };
}
function echo(
  input: RecordedExecutionTrendInput,
  clerkActorId: string,
  asOf: Date,
  range: { start: Date; end: Date },
) {
  return {
    projectId: input.projectId,
    organizationId: input.originalOrganizationId,
    clerkActorId,
    requestKey: recordedExecutionTrendKey(input),
    asOf: asOf.toISOString(),
    windowStart: range.start.toISOString(),
    windowEnd: range.end.toISOString(),
    scope: {
      start: input.start,
      end: input.end,
      ...(input.platform === undefined ? {} : { platform: input.platform }),
      ...(input.environment === undefined
        ? {}
        : { environment: input.environment }),
      ...(input.build === undefined ? {} : { build: input.build }),
    },
    limitations,
  };
}
export async function readRecordedExecutionTrend(
  tx: Prisma.TransactionClient,
  input: RecordedExecutionTrendInput,
  clerkActorId: string,
) {
  const asOf = new Date(),
    selected = await population(tx, input, asOf);
  const runs = await tx.testRun.findMany({
    where: selected.where,
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    take: 20001,
    select: { id: true, startedAt: true, finishedAt: true, status: true },
  });
  if (runs.length !== selected.runs || runs.length > 20000)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The complete selected run population is unavailable; no smaller trend was substituted.",
    });
  if (
    runs.some((run) => !/^[a-zA-Z0-9_-]{1,200}$/.test(run.id)) ||
    new Set(runs.map((run) => run.id)).size !== runs.length
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Selected native run identities are unsupported or incomplete.",
    });
  const days = new Map<string, Day>();
  for (
    let date = Date.parse(input.start);
    date <= Date.parse(input.end);
    date += 86400000
  ) {
    const day = new Date(date).toISOString().slice(0, 10);
    days.set(day, { day, ...emptyCounts() });
  }
  for (const run of runs) {
    const day = days.get(run.startedAt.toISOString().slice(0, 10));
    if (!day)
      throw new TRPCError({
        code: "CONFLICT",
        message: "A run lies outside the selected UTC day scope.",
      });
    day.runs++;
    if (run.status === "RUNNING") day.inProgressRuns++;
    else if (
      run.finishedAt &&
      run.finishedAt >= run.startedAt &&
      run.finishedAt <= asOf
    )
      day.finishedRecordedRuns++;
    else day.completionUnavailableRuns++;
  }
  type Group = {
    day: string;
    status: keyof Day["outcomes"];
    mapping: "MAPPED" | "UNMATCHED" | "UNAVAILABLE";
    inProgress: boolean;
    observations: number;
    timed: number;
    missing: number;
    invalid: number;
    duration: string;
  };
  // Prisma DateTime uses UTC-valued TIMESTAMP(3) without timezone. Direct
  // calendar formatting avoids session-timezone shifts from a timestamptz cast.
  const groups = runs.length
    ? await tx.$queryRaw<Group[]>(Prisma.sql`
    SELECT to_char(run."startedAt",'YYYY-MM-DD') AS day,result.status::text AS status,
      CASE WHEN result."testCaseId" IS NULL THEN 'UNMATCHED' WHEN currentcase.id IS NULL THEN 'UNAVAILABLE' ELSE 'MAPPED' END AS mapping,
      run.status='RUNNING' AS "inProgress",count(*)::int AS observations,
      count(*) FILTER(WHERE result."durationMs">=0)::int AS timed,
      count(*) FILTER(WHERE result."durationMs" IS NULL)::int AS missing,
      count(*) FILTER(WHERE result."durationMs"<0)::int AS invalid,
      COALESCE(sum(CASE WHEN result."durationMs">=0 THEN result."durationMs"::bigint ELSE 0 END),0)::text AS duration
    FROM "TestResult" result JOIN "TestRun" run ON run.id=result."testRunId" AND run."projectId"=${input.projectId}
      LEFT JOIN "TestCase" currentcase ON currentcase.id=result."testCaseId" AND currentcase."projectId"=${input.projectId}
    WHERE run.id IN (${Prisma.join(runs.map((run) => run.id))}) GROUP BY day,result.status,mapping,(run.status='RUNNING')
    ORDER BY day,result.status,mapping,"inProgress"`)
    : [];
  let observed = 0;
  for (const group of groups) {
    const day = days.get(group.day),
      duration = Number(group.duration);
    if (
      !day ||
      !Object.hasOwn(day.outcomes, group.status) ||
      !["MAPPED", "UNMATCHED", "UNAVAILABLE"].includes(group.mapping) ||
      !Number.isSafeInteger(duration) ||
      duration < 0 ||
      group.observations !== group.timed + group.missing + group.invalid
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "A recorded aggregate has unsupported evidence; no partial trend was returned.",
      });
    observed += group.observations;
    day.results += group.observations;
    day.outcomes[group.status] += group.observations;
    day[
      group.mapping === "MAPPED"
        ? "mapped"
        : group.mapping === "UNMATCHED"
          ? "unmatched"
          : "unavailableMapping"
    ] += group.observations;
    if (group.inProgress) day.inProgressResults += group.observations;
    day.timedResults += group.timed;
    day.missingDurations += group.missing;
    day.invalidDurations += group.invalid;
    day.sumDurationMs += duration;
  }
  if (observed !== selected.results)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The full recorded result population is unavailable; missing days were not substituted with zero.",
    });
  const totals = emptyCounts();
  for (const day of days.values()) {
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      if (key === "outcomes")
        for (const status of Object.keys(totals.outcomes) as Array<
          keyof typeof totals.outcomes
        >)
          totals.outcomes[status] += day.outcomes[status];
      else totals[key] += day[key];
    }
  }
  return recordedExecutionTrendOutput.parse({
    ...echo(input, clerkActorId, asOf, selected.range),
    totals,
    days: [...days.values()],
  });
}
function excerpt(
  value: string | null,
  databaseExcerpt: boolean,
  limit: number,
) {
  if (value === null) return { value: null, excerpt: false };
  let bounded = value.slice(0, limit);
  if (/[\ud800-\udbff]$/u.test(bounded)) bounded = bounded.slice(0, -1);
  return {
    value: bounded,
    excerpt: databaseExcerpt || bounded.length < value.length,
  };
}
export async function readRecordedExecutionTrendRuns(
  tx: Prisma.TransactionClient,
  input: RecordedExecutionTrendInput & { day: string; page: number },
  clerkActorId: string,
) {
  const asOf = new Date(),
    selected = await population(tx, input, asOf);
  const dayStart = new Date(`${input.day}T00:00:00.000Z`),
    dayEnd = new Date(
      Math.min(dayStart.getTime() + 86400000 - 1, selected.range.end.getTime()),
    );
  const where = {
    AND: [selected.where, { startedAt: { gte: dayStart, lte: dayEnd } }],
  };
  const total = await tx.testRun.count({ where });
  if (input.page > 0 && input.page * 20 >= total)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This day page is unavailable. Refresh the current recorded day scope.",
    });
  const identities = await tx.testRun.findMany({
    where,
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    skip: input.page * 20,
    take: 21,
    select: { id: true },
  });
  const ids = identities.slice(0, 20).map((row) => row.id);
  if (
    identities.some((row) => !/^[a-zA-Z0-9_-]{1,200}$/.test(row.id)) ||
    new Set(identities.map((row) => row.id)).size !== identities.length
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The current day contains unsupported native run identities.",
    });
  type LabelRun = {
    id: string;
    startedAt: Date;
    finishedAt: Date | null;
    status: "RUNNING" | "PASSED" | "FAILED" | "PARTIAL";
    provider: string;
    providerExcerpt: boolean;
    build: string | null;
    buildExcerpt: boolean;
    platform: string | null;
    platformExcerpt: boolean;
    environment: string | null;
    environmentExcerpt: boolean;
  };
  const labels = ids.length
    ? await tx.$queryRaw<LabelRun[]>(Prisma.sql`
    SELECT id,"startedAt","finishedAt",status::text AS status,left("ciProvider",80) AS provider,length("ciProvider")>80 AS "providerExcerpt",
      CASE WHEN "ciProvider"='manual' THEN CASE WHEN "executionContext"->'version'='1'::jsonb AND jsonb_typeof("executionContext"->'configuration'->'build')='string' THEN left("executionContext"->'configuration'->>'build',160) ELSE NULL END ELSE left("commitSha",160) END AS build,
      CASE WHEN "ciProvider"='manual' THEN COALESCE(length("executionContext"->'configuration'->>'build')>160,false) ELSE length("commitSha")>160 END AS "buildExcerpt",
      CASE WHEN "executionContext"->'version'='1'::jsonb AND jsonb_typeof("executionContext"->'configuration'->'platform')='string' THEN left("executionContext"->'configuration'->>'platform',160) ELSE NULL END AS platform,
      COALESCE(length("executionContext"->'configuration'->>'platform')>160,false) AS "platformExcerpt",
      CASE WHEN "executionContext"->'version'='1'::jsonb AND jsonb_typeof("executionContext"->'configuration'->'environment')='string' THEN left("executionContext"->'configuration'->>'environment',160) ELSE NULL END AS environment,
      COALESCE(length("executionContext"->'configuration'->>'environment')>160,false) AS "environmentExcerpt"
    FROM "TestRun" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(ids)})`)
    : [];
  const byId = new Map(labels.map((row) => [row.id, row]));
  if (
    byId.size !== ids.length ||
    identities.length !== Math.min(21, Math.max(0, total - input.page * 20))
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The complete current day page is unavailable; no smaller page was substituted.",
    });
  const runs = ids.map((id) => {
    const row = byId.get(id)!,
      provider = excerpt(row.provider, row.providerExcerpt, 80),
      build = excerpt(row.build, row.buildExcerpt, 160),
      platform = excerpt(row.platform, row.platformExcerpt, 160),
      environment = excerpt(row.environment, row.environmentExcerpt, 160);
    return {
      id,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      status: row.status,
      provider: provider.value!,
      providerExcerpt: provider.excerpt,
      build: build.value,
      buildExcerpt: build.excerpt,
      platform: platform.value,
      platformExcerpt: platform.excerpt,
      environment: environment.value,
      environmentExcerpt: environment.excerpt,
    };
  });
  return recordedExecutionTrendRunsOutput.parse({
    ...echo(input, clerkActorId, asOf, selected.range),
    day: input.day,
    page: input.page,
    total,
    runs,
    hasMore: identities.length > 20,
  });
}
