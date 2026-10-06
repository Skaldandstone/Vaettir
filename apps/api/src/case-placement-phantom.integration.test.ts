// AUTHORED, NOT RUN. Deliberate native concurrency regressions, not an acceptance
// claim. Current RR/row-lock source may fail entrant/unarchive expectations.
// Exact owned disposable DB + separate named opt-in required. Retain all rows.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, PrismaClient } from "@vaettir/db";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import type {
  previewReviewedCasePlacement,
  moveReviewedCasePlacement,
} from "./services/casePlacementReviewed.js";
export const PLACEMENT_PHANTOM_OPT_IN =
  "VAETTIR_CASE_PLACEMENT_PHANTOM_NATIVE_FIXTURE";
export function admitCasePlacementFixture(
  env: Record<string, string | undefined>,
) {
  const route = assertOwnedTestDatabase(env.DATABASE_URL, env);
  if (
    route.route !== "LOCAL_DISPOSABLE" ||
    env[PLACEMENT_PHANTOM_OPT_IN] !== "1"
  )
    throw Error(
      "Exact owned local placement phantom fixture opt-in required; no native work started",
    );
  return route;
}
export function placementFixtureEnabled(
  env: Record<string, string | undefined>,
) {
  try {
    admitCasePlacementFixture(env);
    return true;
  } catch {
    return false;
  }
}
export type PlacementFixtureOwner = {
  prefix: string;
  organizationId: string;
  organizationSlug: string;
  projectId: string;
  actorId: string;
  clerkActorId: string;
};
export function assertPlacementFixtureOwner(owner: PlacementFixtureOwner) {
  if (
    !/^case-placement-phantom-[0-9]{13}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      owner.prefix,
    ) ||
    owner.organizationSlug !== owner.prefix + "-org" ||
    owner.clerkActorId !== owner.prefix + "-owner" ||
    [owner.organizationId, owner.projectId, owner.actorId].some(
      (id) => !id || id.length > 200 || id.includes("\0"),
    )
  )
    throw Error("Exact minted synthetic placement owner required");
}
type TxOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};
type Scenario = {
  movingId: string;
  targetId: string;
  sourceSiblingId: string;
  outsiderId: string;
  ownedIds: string[];
};
type Phase = "AFTER_PROJECT_SNAPSHOT" | "AFTER_SECOND_COHORT";
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function withinBarrier<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Error(
                "Synthetic native interleaving barrier did not arrive within its own 1500ms bound",
              ),
            ),
          1500,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
/** Only pause AFTER genuine native calls. Never fabricate native row/results.
 * A and B remain distinct ConstraintCheckedPrismaClient instances/connections. */
function withNativeBarrier(
  db: PrismaClient,
  phase: Phase,
  arrived: ReturnType<typeof gate>,
  resume: ReturnType<typeof gate>,
) {
  return new Proxy(db, {
    get(client, key) {
      if (key !== "$transaction") {
        const value = Reflect.get(client, key);
        return typeof value === "function" ? value.bind(client) : value;
      }
      return <T>(
        work: (tx: Prisma.TransactionClient) => Promise<T>,
        options?: TxOptions,
      ) =>
        client.$transaction(async (tx) => {
          let projectReads = 0,
            cohortReads = 0;
          const wrapped = new Proxy(tx, {
            get(transaction, property) {
              if (property === "project")
                return new Proxy(transaction.project, {
                  get(model, method) {
                    const value = Reflect.get(model, method);
                    if (method !== "findUnique")
                      return typeof value === "function"
                        ? value.bind(model)
                        : value;
                    return async (...args: unknown[]) => {
                      const result = await Reflect.apply(value, model, args);
                      projectReads++;
                      if (
                        phase === "AFTER_PROJECT_SNAPSHOT" &&
                        projectReads === 1
                      ) {
                        arrived.release();
                        await resume.promise;
                      }
                      return result;
                    };
                  },
                });
              if (property === "$queryRaw")
                return async (...args: unknown[]) => {
                  const result = await Reflect.apply(
                    transaction.$queryRaw,
                    transaction,
                    args,
                  );
                  const text = Array.isArray(args[0])
                    ? args[0].join("")
                    : String((args[0] as { sql?: string })?.sql ?? "");
                  if (text.includes('AS "createdAtText"')) cohortReads++;
                  if (
                    phase === "AFTER_SECOND_COHORT" &&
                    text.includes('AS "createdAtText"') &&
                    cohortReads === 2
                  ) {
                    arrived.release();
                    await resume.promise;
                  }
                  return result;
                };
              const value = Reflect.get(transaction, property);
              return typeof value === "function"
                ? value.bind(transaction)
                : value;
            },
          });
          return work(wrapped);
        }, options);
    },
  }) as PrismaClient;
}
describe.skipIf(!placementFixtureEnabled(process.env))(
  "owned placement phantom interleavings (AUTHORED NOT RUN)",
  { concurrent: false },
  () => {
    const prefix = `case-placement-phantom-${Date.now()}-${randomUUID()}`;
    let first: PrismaClient | undefined,
      second: PrismaClient | undefined,
      owner: PlacementFixtureOwner,
      preview: typeof previewReviewedCasePlacement,
      move: typeof moveReviewedCasePlacement;
    const running: Promise<unknown>[] = [];
    const dbA = () => {
      if (!first) throw Error("Owned placement fixture admission required");
      return first;
    };
    const dbB = () => {
      if (!second) throw Error("Owned placement fixture admission required");
      return second;
    };
    beforeAll(async () => {
      const captured = { ...process.env },
        admission = admitCasePlacementFixture(captured);
      // No native client/runtime/service imports before the exact route+opt-in.
      const { ConstraintCheckedPrismaClient } =
        await import("../../../packages/db/src/constraintCheckedClient.js");
      const service = await import("./services/casePlacementReviewed.js");
      preview = service.previewReviewedCasePlacement;
      move = service.moveReviewedCasePlacement;
      first = new ConstraintCheckedPrismaClient({
        datasources: { db: { url: captured.DATABASE_URL } },
      });
      second = new ConstraintCheckedPrismaClient({
        datasources: { db: { url: captured.DATABASE_URL } },
      });
      // First DB calls only verify the actual route. No credentials are logged.
      const routes = await Promise.all(
        [dbA(), dbB()].map(
          (db) =>
            db.$queryRaw<
              Array<{
                database: string;
                address: string | null;
                port: number | null;
                schema: string | null;
                pid: number;
              }>
            >`SELECT current_database() AS database,inet_server_addr()::text AS address,inet_server_port() AS port,current_schema() AS schema,pg_backend_pid() AS pid`,
        ),
      );
      for (const [route] of routes)
        if (
          !route ||
          route.database !== admission.database ||
          !["127.0.0.1", "::1"].includes(route.address ?? "") ||
          route.port !== 5432 ||
          route.schema !== "public"
        )
          throw Error("Exact actual owned native placement route required");
      if (routes[0]?.[0]?.pid === routes[1]?.[0]?.pid)
        throw Error("Independent native placement connections required");
      const tier = await dbA().planTier.findUniqueOrThrow({
        where: { key: "free" },
      });
      const org = await dbA().organization.create({
        data: { slug: `${prefix}-org`, name: prefix, planTierId: tier.id },
      });
      const actor = await dbA().user.create({
        data: {
          clerkUserId: `${prefix}-owner`,
          name: "Synthetic placement phantom owner",
          email: `${prefix}@example.com`,
          memberships: {
            create: { organizationId: org.id, role: "OWNER", seatType: "FULL" },
          },
        },
      });
      const project = await dbA().project.create({
        data: {
          organizationId: org.id,
          name: prefix,
          slug: `${prefix}-project`,
        },
      });
      owner = {
        prefix,
        organizationId: org.id,
        organizationSlug: org.slug,
        projectId: project.id,
        actorId: actor.id,
        clerkActorId: actor.clerkUserId,
      };
      assertPlacementFixtureOwner(owner);
    });
    afterAll(async () => {
      // Failed native evidence and any unexpectedly accepted receipts remain.
      await Promise.allSettled(running);
      await Promise.all([first?.$disconnect(), second?.$disconnect()]);
    });
    async function ownedNative(db: PrismaClient, ids: readonly string[] = []) {
      assertPlacementFixtureOwner(owner);
      const [org, project, actor, member] = await Promise.all([
        db.organization.findUniqueOrThrow({
          where: { id: owner.organizationId },
          select: { slug: true, suspendedAt: true },
        }),
        db.project.findUniqueOrThrow({
          where: { id: owner.projectId },
          select: { organizationId: true, name: true, slug: true },
        }),
        db.user.findUniqueOrThrow({
          where: { id: owner.actorId },
          select: { clerkUserId: true },
        }),
        db.membership.findUniqueOrThrow({
          where: {
            organizationId_userId: {
              organizationId: owner.organizationId,
              userId: owner.actorId,
            },
          },
          select: { role: true, seatType: true },
        }),
      ]);
      if (
        org.slug !== owner.organizationSlug ||
        org.suspendedAt !== null ||
        project.organizationId !== owner.organizationId ||
        project.name !== prefix ||
        project.slug !== `${prefix}-project` ||
        actor.clerkUserId !== owner.clerkActorId ||
        member.role !== "OWNER" ||
        member.seatType !== "FULL"
      )
        throw Error(
          "Native synthetic placement owner changed; refusing scenario mutation",
        );
      if (ids.length) {
        if (new Set(ids).size !== ids.length)
          throw Error("Duplicate owned scenario identity");
        const rows = await db.testCase.findMany({
          where: { id: { in: [...ids] }, projectId: owner.projectId },
          select: { id: true, title: true, createdById: true },
        });
        if (
          rows.length !== ids.length ||
          rows.some(
            (row) =>
              !row.title.startsWith(`${prefix}:`) ||
              row.createdById !== owner.actorId,
          )
        )
          throw Error(
            "Exact minted scenario cases required; no foreign native rows may be touched",
          );
      }
    }
    const createCase = (
      db: PrismaClient,
      label: string,
      suitePath: string | null,
      sortPosition: number,
      archived = false,
    ) =>
      db.$transaction((tx) =>
        tx.testCase.create({
          data: {
            projectId: owner.projectId,
            title: `${prefix}:${label}:${randomUUID()}`,
            suitePath,
            sortPosition,
            archived,
            createdById: owner.actorId,
            updatedById: owner.actorId,
            testType: "FUNCTIONAL",
            given: ["Synthetic precondition"],
            when: ["Synthetic action"],
            then: ["Synthetic expected outcome"],
          },
        }),
      );
    async function scenario(
      kind: "insert" | "entry" | "unarchive",
    ): Promise<Scenario> {
      await ownedNative(dbA());
      // Different raw suite paths for each scenario isolate retained earlier rows.
      const stamp = randomUUID(),
        source = `source/${stamp}`,
        target = `target/${stamp}`,
        elsewhere = `elsewhere/${stamp}`;
      const main = await createCase(dbA(), `${kind}-main`, source, 0),
        sibling = await createCase(dbA(), `${kind}-source-sibling`, source, 1),
        destination = await createCase(dbA(), `${kind}-target`, target, 0),
        outsider = await createCase(
          dbA(),
          `${kind}-outsider`,
          kind === "unarchive" ? target : elsewhere,
          0,
          kind === "unarchive",
        );
      const value = {
        movingId: main.id,
        targetId: destination.id,
        sourceSiblingId: sibling.id,
        outsiderId: outsider.id,
        ownedIds: [main.id, sibling.id, destination.id, outsider.id],
      };
      await ownedNative(dbA(), value.ownedIds);
      return value;
    }
    async function intentFor(value: Scenario) {
      await ownedNative(dbA(), value.ownedIds);
      const source = await dbA().testCase.findUniqueOrThrow({
          where: { id: value.movingId },
          select: { suitePath: true, sortPosition: true },
        }),
        target = await dbA().testCase.findUniqueOrThrow({
          where: { id: value.targetId },
          select: { suitePath: true },
        });
      const intent = {
        projectId: owner.projectId,
        caseId: value.movingId,
        originalOrganizationId: owner.organizationId,
        expectedClerkActorId: owner.clerkActorId,
        expectedNativeActorId: owner.actorId,
        expectedSuitePath: source.suitePath,
        expectedSortPosition: source.sortPosition,
        targetSuitePath: target.suitePath,
        beforeCaseId: null,
      };
      const read = await preview(
        dbA(),
        owner.actorId,
        { ...intent, readRequestId: randomUUID() },
        { clerkActorId: owner.clerkActorId },
      );
      expect(read.rows.some((row) => row.id === value.outsiderId)).toBe(false);
      return {
        ...intent,
        requestId: randomUUID(),
        expectedCohortHash: read.expectedCohortHash,
        confirmed: true as const,
      };
    }
    async function race(kind: "insert" | "entry" | "unarchive", phase: Phase) {
      const value = await scenario(kind),
        input = await intentFor(value),
        before = await dbA().testCase.findMany({
          where: {
            id: { in: [value.movingId, value.sourceSiblingId, value.targetId] },
          },
          select: { id: true, suitePath: true, sortPosition: true },
          orderBy: { id: "asc" },
        });
      const arrived = gate(),
        resume = gate(),
        client = withNativeBarrier(dbA(), phase, arrived, resume);
      const result = move(client, owner.actorId, input, {
        clerkActorId: owner.clerkActorId,
      }).then(
        (ack) => ({ accepted: true as const, ack }),
        (error) => ({
          accepted: false as const,
          error: error as { code?: string },
        }),
      );
      running.push(result);
      try {
        await withinBarrier(arrived.promise);
        await ownedNative(dbB(), value.ownedIds);
        if (kind === "insert") {
          // Existing native identity trigger increments Project.nextCaseNumber. This
          // may already force A's RR Project FOR UPDATE to serialize-refuse. Source
          // inspection is NOT an observed native result; preserve strict expectation.
          const inserted = await createCase(
            dbB(),
            "committed-insert-phantom",
            input.targetSuitePath,
            0,
          );
          value.ownedIds.push(inserted.id);
          await ownedNative(dbB(), value.ownedIds);
        } else {
          // Actual non-advisory native row-only UPDATE. No fabricated SQL result,
          // disabled trigger, relation reassignment or altered customer row. Current
          // typed-fields UPDATE trigger excludes suitePath/archived; identity UPDATE
          // guard returns when native display/project identity is unchanged.
          const changed = await dbB().$transaction((tx) =>
            tx.testCase.updateMany({
              where: {
                id: value.outsiderId,
                projectId: owner.projectId,
                createdById: owner.actorId,
              },
              data:
                kind === "entry"
                  ? { suitePath: input.targetSuitePath }
                  : { archived: false },
            }),
          );
          expect(changed.count).toBe(1);
          const committed = await dbB().testCase.findUniqueOrThrow({
            where: { id: value.outsiderId },
            select: { suitePath: true, archived: true },
          });
          expect(committed).toEqual({
            suitePath: input.targetSuitePath,
            archived: false,
          });
        }
      } finally {
        resume.release();
      }
      const settled = await result;
      // Strict regression expectation: current known source hole must FAIL this
      // native test, never pass by accepting a snapshot-only success or arbitrary
      // auth/timeout errors. No xfail, inner skip, automatic retry or time waiver.
      expect(settled.accepted).toBe(false);
      if (settled.accepted)
        throw Error(
          "Native stale complete-cohort move was acknowledged; retain its failed receipt evidence",
        );
      expect(settled.error).toMatchObject({ code: "CONFLICT" });
      expect(
        await dbA().caseFolderWrite.count({
          where: {
            projectId: owner.projectId,
            actorId: owner.actorId,
            requestId: input.requestId,
          },
        }),
      ).toBe(0);
      expect(
        await dbA().auditLog.count({
          where: {
            projectId: owner.projectId,
            actorId: owner.actorId,
            entityType: "CasePlacementReviewedMove",
            metadata: { path: ["requestId"], equals: input.requestId },
          },
        }),
      ).toBe(0);
      expect(
        await dbA().testCase.findMany({
          where: {
            id: { in: [value.movingId, value.sourceSiblingId, value.targetId] },
          },
          select: { id: true, suitePath: true, sortPosition: true },
          orderBy: { id: "asc" },
        }),
      ).toEqual(before);
    }
    it("committed native insert after Project snapshot must refuse stale complete cohort", async () => {
      await race("insert", "AFTER_PROJECT_SNAPSHOT");
    });
    it("native outsider suite entry after second cohort read must refuse stale complete cohort", async () => {
      await race("entry", "AFTER_SECOND_COHORT");
    });
    it("native archived outsider unarchive after second cohort read must refuse stale complete cohort", async () => {
      await race("unarchive", "AFTER_SECOND_COHORT");
    });
  },
);
