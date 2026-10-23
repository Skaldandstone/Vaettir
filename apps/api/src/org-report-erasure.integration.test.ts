// Authored source only; morning requires an owned migrated loopback database.
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, afterEach, describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@vaettir/db";
import {
  hardDeleteOrganization,
  previewOrgHardDelete,
} from "./services/orgHardDelete.js";
describe("original-organization report erasure scope", () => {
  const tag = `report-erasure-${randomUUID()}`,
    orgs: string[] = [],
    projectIds: string[] = [],
    users: string[] = [];
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/test/i.test(url.pathname) ||
      url.searchParams.has("host")
    )
      throw Error("Owned disposable loopback DB required");
  });
  afterEach(async () => {
    for (const id of projectIds) {
      const project = await prisma.project.findUnique({
        where: { id },
        select: { slug: true },
      });
      if (project && !project.slug.startsWith(tag))
        throw Error("Project fixture ownership mismatch");
    }
    // Deliberate unsupported cross-scope fixture references are removed only
    // during this uniquely owned cleanup, never by weakening production guards.
    await prisma.projectReportDefinitionWrite.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.projectReportSnapshot.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.projectReportDefinition.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    for (const id of orgs) {
      const org = await prisma.organization.findUnique({
        where: { id },
        select: { slug: true },
      });
      if (!org) continue;
      if (!org.slug.startsWith(tag))
        throw Error("Organization fixture ownership mismatch");
      await hardDeleteOrganization(
        prisma,
        id,
        users[0]!,
        "Owned report erasure fixture cleanup",
      );
    }
    await prisma.organizationDeletionLog.deleteMany({
      where: { organizationId: { in: orgs } },
    });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    orgs.length = projectIds.length = users.length = 0;
  });
  const digest = (suffix: string) =>
    createHash("sha256").update(`${tag}-${suffix}`).digest("hex");
  async function fixture() {
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    for (let i = 0; i < 2; i++)
      orgs.push(
        (
          await prisma.organization.create({
            data: {
              name: `${tag}-${i}`,
              slug: `${tag}-${i}`,
              planTierId: tier.id,
            },
          })
        ).id,
      );
    const actor = await prisma.user.create({
      data: {
        clerkUserId: `${tag}-${randomUUID()}`,
        email: `${tag}-${randomUUID()}@example.com`,
      },
    });
    users.push(actor.id);
    async function project(organizationId: string) {
      const slug = `${tag}-${randomUUID()}`;
      const p = await prisma.project.create({
        data: {
          organizationId,
          name: slug,
          slug,
          caseKey: `e${randomUUID().replaceAll("-", "").slice(0, 15)}`,
        },
      });
      projectIds.push(p.id);
      return p;
    }
    const current = await project(orgs[0]!),
      moved = await project(orgs[0]!),
      foreign = await project(orgs[1]!);
    await prisma.project.update({
      where: { id: moved.id },
      data: { organizationId: orgs[1]! },
    });
    return { current, moved, foreign, actor };
  }
  async function reports(
    projectId: string,
    organizationId: string,
    actorId: string,
    label: string,
  ) {
    const definition = await prisma.projectReportDefinition.create({
      data: {
        projectId,
        organizationId,
        userId: actorId,
        name: label,
        definition: { fixture: label },
        archivedAt: new Date("2026-10-01T12:00:00Z"),
      },
    });
    const snapshot = await prisma.projectReportSnapshot.create({
      data: {
        id: digest(`${label}-${randomUUID()}`),
        projectId,
        organizationId,
        definitionId: definition.id,
        createdById: actorId,
        inputHash: digest(label),
        title: label,
        payload: { fixture: label, state: "approved" },
        asOf: new Date("2026-10-02T12:00:00Z"),
      },
    });
    const write = await prisma.projectReportDefinitionWrite.create({
      data: {
        key: digest(`${label}-write-${randomUUID()}`),
        projectId,
        organizationId,
        actorId,
        requestHash: digest(label),
        definitionId: definition.id,
        appliedVersion: 1,
        beforeState: { fixture: "before" },
        afterState: { fixture: label },
      },
    });
    return { definition, snapshot, write };
  }
  it("counts and erases all original-org records on current and reparented projects, retaining the foreign project and its reports", async () => {
    const f = await fixture();
    await reports(f.current.id, orgs[0]!, f.actor.id, "current-original");
    const moved = await reports(
        f.moved.id,
        orgs[0]!,
        f.actor.id,
        "reparented-original",
      ),
      kept = await reports(f.moved.id, orgs[1]!, f.actor.id, "current-foreign");
    const preview = await previewOrgHardDelete(prisma, orgs[0]!);
    for (const key of [
      "ProjectReportSnapshot",
      "ProjectReportDefinition",
      "ProjectReportDefinitionWrite",
    ]) {
      expect(preview.rowCounts[key]).toBe(2);
      expect(preview.reportScope.originalRecordsOnReparentedProjects[key]).toBe(
        1,
      );
    }
    expect(preview.reportScope.basis).toBe("ORIGINAL_ORGANIZATION");
    expect(preview.reportScope.blocked).toBe(false);
    const result = await hardDeleteOrganization(
      prisma,
      orgs[0]!,
      f.actor.id,
      "Synthetic explicit original-org erasure",
    );
    for (const key of [
      "ProjectReportSnapshot",
      "ProjectReportDefinition",
      "ProjectReportDefinitionWrite",
    ])
      expect(result.rowCounts[key]).toBe(2);
    expect(
      await prisma.project.findUnique({ where: { id: f.current.id } }),
    ).toBeNull();
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: f.moved.id } }))
        .organizationId,
    ).toBe(orgs[1]);
    expect(
      await prisma.projectReportSnapshot.findUnique({
        where: { id: moved.snapshot.id },
      }),
    ).toBeNull();
    expect(
      await prisma.projectReportSnapshot.findUniqueOrThrow({
        where: { id: kept.snapshot.id },
      }),
    ).toEqual(kept.snapshot);
    expect(
      await prisma.projectReportDefinition.findUniqueOrThrow({
        where: { id: kept.definition.id },
      }),
    ).toEqual(kept.definition);
    expect(
      await prisma.projectReportDefinitionWrite.findUniqueOrThrow({
        where: { key: kept.write.key },
      }),
    ).toEqual(kept.write);
    expect(
      (
        await prisma.organizationDeletionLog.findUniqueOrThrow({
          where: { id: result.deletionLogId },
        })
      ).rowCounts,
    ).toEqual(result.rowCounts);
  });
  it("refuses foreign-original captures under current projects before any deletion or cascade", async () => {
    const f = await fixture(),
      own = await reports(f.current.id, orgs[0]!, f.actor.id, "own"),
      foreign = await reports(
        f.current.id,
        orgs[1]!,
        f.actor.id,
        "foreign-current-project",
      );
    const preview = await previewOrgHardDelete(prisma, orgs[0]!);
    expect(preview.reportScope.blocked).toBe(true);
    expect(
      preview.reportScope.unsupportedForeignOriginalRecordsOnCurrentProjects
        .ProjectReportSnapshot,
    ).toBe(1);
    expect(
      preview.reportScope.unsupportedForeignOriginalRecordsOnCurrentProjects
        .ProjectReportDefinition,
    ).toBe(1);
    expect(
      preview.reportScope.unsupportedForeignOriginalRecordsOnCurrentProjects
        .ProjectReportDefinitionWrite,
    ).toBe(1);
    await expect(
      hardDeleteOrganization(
        prisma,
        orgs[0]!,
        f.actor.id,
        "Unsupported scope must refuse",
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      await prisma.projectReportSnapshot.findUniqueOrThrow({
        where: { id: own.snapshot.id },
      }),
    ).toEqual(own.snapshot);
    expect(
      await prisma.projectReportSnapshot.findUniqueOrThrow({
        where: { id: foreign.snapshot.id },
      }),
    ).toEqual(foreign.snapshot);
    expect(await prisma.organization.count({ where: { id: orgs[0] } })).toBe(1);
    expect(
      await prisma.organizationDeletionLog.count({
        where: { organizationId: orgs[0] },
      }),
    ).toBe(0);
  });
  it("refuses a foreign snapshot definition reference rather than applying SET NULL to another tenant", async () => {
    const f = await fixture(),
      own = await reports(f.current.id, orgs[0]!, f.actor.id, "own-definition"),
      foreign = await reports(
        f.foreign.id,
        orgs[1]!,
        f.actor.id,
        "foreign-reference",
      );
    const linked = await prisma.projectReportSnapshot.update({
      where: { id: foreign.snapshot.id },
      data: { definitionId: own.definition.id },
    });
    const preview = await previewOrgHardDelete(prisma, orgs[0]!);
    expect(
      preview.reportScope
        .unsupportedForeignSnapshotsReferencingOriginalDefinitions,
    ).toBe(1);
    expect(preview.reportScope.blocked).toBe(true);
    await expect(
      hardDeleteOrganization(
        prisma,
        orgs[0]!,
        f.actor.id,
        "Unsupported reference must refuse",
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(
      await prisma.projectReportSnapshot.findUniqueOrThrow({
        where: { id: linked.id },
      }),
    ).toEqual(linked);
    expect(
      await prisma.projectReportDefinition.findUniqueOrThrow({
        where: { id: own.definition.id },
      }),
    ).toEqual(own.definition);
  });
  it("deletes an original snapshot referencing a foreign definition without changing that retained definition", async () => {
    const f = await fixture(),
      own = await reports(f.current.id, orgs[0]!, f.actor.id, "own-snapshot"),
      foreign = await reports(
        f.foreign.id,
        orgs[1]!,
        f.actor.id,
        "foreign-definition",
      );
    await prisma.projectReportSnapshot.update({
      where: { id: own.snapshot.id },
      data: { definitionId: foreign.definition.id },
    });
    const preview = await previewOrgHardDelete(prisma, orgs[0]!);
    expect(preview.reportScope.blocked).toBe(false);
    await hardDeleteOrganization(
      prisma,
      orgs[0]!,
      f.actor.id,
      "Synthetic reviewed own snapshot erasure",
    );
    expect(
      await prisma.projectReportDefinition.findUniqueOrThrow({
        where: { id: foreign.definition.id },
      }),
    ).toEqual(foreign.definition);
    expect(
      await prisma.projectReportSnapshot.findUniqueOrThrow({
        where: { id: foreign.snapshot.id },
      }),
    ).toEqual(foreign.snapshot);
  });
  it("refuses ownership drift between pretransaction project enumeration and erasure before touching child rows", async () => {
    const f = await fixture(),
      own = await reports(
        f.current.id,
        orgs[0]!,
        f.actor.id,
        "drift-protected",
      ),
      c = await prisma.testCase.create({
        data: {
          projectId: f.current.id,
          title: "Synthetic child must survive",
          testType: "FUNCTIONAL",
        },
      });
    let drifted = false;
    // Boundary hook delegates every operation to the real disposable DB; no
    // mocked authorization or fake transaction. Reparent after scope enumeration.
    let scopedProjectReads = 0;
    const db = new Proxy(prisma, {
      get(target, key) {
        if (key === "$queryRaw")
          return async (...args: unknown[]) => {
            const rows: unknown = await Reflect.apply(
              target.$queryRaw,
              target,
              args,
            );
            const statement = args[0];
            const parts =
              statement !== null &&
              typeof statement === "object" &&
              "strings" in statement &&
              Array.isArray(statement.strings)
                ? statement.strings
                : [];
            const sql = parts.join("").trim();
            if (
              sql === 'SELECT id FROM "Project" WHERE "organizationId"=' &&
              !drifted
            ) {
              expect(
                statement !== null &&
                  typeof statement === "object" &&
                  "values" in statement
                  ? statement.values
                  : null,
              ).toEqual([orgs[0]]);
              expect(Array.isArray(rows)).toBe(true);
              if (!Array.isArray(rows))
                throw Error("Expected real native project identity rows");
              expect(rows.some((row) => row?.id === f.current.id)).toBe(true);
              scopedProjectReads++;
              drifted = true;
              await prisma.project.update({
                where: { id: f.current.id },
                data: { organizationId: orgs[1]! },
              });
            }
            return rows;
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      hardDeleteOrganization(
        db,
        orgs[0]!,
        f.actor.id,
        "Scope drift must refuse",
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(drifted).toBe(true);
    expect(scopedProjectReads).toBe(1);
    expect(
      (
        await prisma.project.findUniqueOrThrow({
          where: { id: f.current.id },
        })
      ).organizationId,
    ).toBe(orgs[1]);
    expect(
      await prisma.testCase.findUniqueOrThrow({ where: { id: c.id } }),
    ).toEqual(c);
    expect(
      await prisma.projectReportSnapshot.findUniqueOrThrow({
        where: { id: own.snapshot.id },
      }),
    ).toEqual(own.snapshot);
    expect(await prisma.organization.count({ where: { id: orgs[0] } })).toBe(1);
    expect(
      await prisma.organizationDeletionLog.count({
        where: { organizationId: orgs[0] },
      }),
    ).toBe(0);
  });
  it("rolls all report deletions back if a later existing erasure step fails", async () => {
    const f = await fixture(),
      own = await reports(
        f.current.id,
        orgs[0]!,
        f.actor.id,
        "rollback-protected",
      );
    // Actual PostgreSQL transaction and all actual early erasure steps. Inject
    // only a later failure to prove atomic rollback, not pretend DB acceptance.
    const db = new Proxy(prisma, {
      get(target, key) {
        if (key === "$transaction")
          return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            prisma.$transaction(async (tx) => {
              const projects = new Proxy(tx.project, {
                get(delegate, member) {
                  if (member === "deleteMany")
                    return async () => {
                      throw Error("Synthetic later erasure failure");
                    };
                  const value = Reflect.get(delegate, member);
                  return typeof value === "function"
                    ? value.bind(delegate)
                    : value;
                },
              });
              return work(
                new Proxy(tx, {
                  get(transaction, member) {
                    if (member === "project") return projects;
                    const value = Reflect.get(transaction, member);
                    return typeof value === "function"
                      ? value.bind(transaction)
                      : value;
                  },
                }),
              );
            });
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      hardDeleteOrganization(
        db,
        orgs[0]!,
        f.actor.id,
        "Synthetic rollback proof",
      ),
    ).rejects.toThrow("Synthetic later erasure failure");
    expect(
      await prisma.projectReportSnapshot.findUniqueOrThrow({
        where: { id: own.snapshot.id },
      }),
    ).toEqual(own.snapshot);
    expect(
      await prisma.projectReportDefinition.findUniqueOrThrow({
        where: { id: own.definition.id },
      }),
    ).toEqual(own.definition);
    expect(
      await prisma.projectReportDefinitionWrite.findUniqueOrThrow({
        where: { key: own.write.key },
      }),
    ).toEqual(own.write);
    expect(await prisma.organization.count({ where: { id: orgs[0] } })).toBe(1);
    expect(
      await prisma.organizationDeletionLog.count({
        where: { organizationId: orgs[0] },
      }),
    ).toBe(0);
  });
});
