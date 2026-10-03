import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";

const suitePathSchema = z.string().trim().min(1).max(240).nullable();
const placementInput = z.object({ projectId: z.string().min(1) });
const MAX_SUITE_CASES = 2000;
const MAX_PROJECT_DEPENDENCIES = 10000;

function sameIds(a: string[], b: string[]) {
  const sortedB = [...b].sort();
  return a.length === b.length && [...a].sort().every((id, i) => id === sortedB[i]);
}

export const testCaseStructureRouter = router({
  list: protectedProcedure.input(placementInput).query(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId);
    const [cases, links] = await Promise.all([
      ctx.prisma.testCase.findMany({
        where: { projectId: input.projectId, archived: false },
        select: { id: true, displayId: true, caseNumber: true, suitePath: true, sortPosition: true },
        orderBy: [{ suitePath: "asc" }, { sortPosition: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
      ctx.prisma.testCasePrerequisite.findMany({
        where: { projectId: input.projectId },
        select: { dependentId: true, prerequisiteId: true },
      }),
    ]);
    return { cases, prerequisites: links };
  }),

  // The caller supplies the source placement it rendered. A second drag in
  // another tab is serialized and rejected as stale instead of silently
  // overriding that person's newer move.
  move: protectedProcedure.input(placementInput.extend({
    caseId: z.string().min(1),
    expectedSuitePath: suitePathSchema,
    expectedSortPosition: z.number().int(),
    targetSuitePath: suitePathSchema,
    beforeCaseId: z.string().min(1).nullable(),
  })).mutation(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
    return ctx.prisma.$transaction(async (tx) => {
      // One project-scoped lock covers suite order and graph edits without
      // locking unrelated tenants. hashtext collisions only over-serialize.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.projectId}))::text`;
      // Existing case-content editors use row-level updates. Lock the case
      // itself too, so a concurrent content/suite edit that began first is
      // observed by the baseline check below.
      await tx.$queryRaw`SELECT id FROM "TestCase" WHERE id = ${input.caseId} AND "projectId" = ${input.projectId} FOR UPDATE`;
      const moving = await tx.testCase.findFirst({
        where: { id: input.caseId, projectId: input.projectId, archived: false },
        select: { id: true, title: true, suitePath: true, sortPosition: true },
      });
      if (!moving) throw new TRPCError({ code: "NOT_FOUND", message: "Test case not found in this project." });
      if (moving.suitePath !== input.expectedSuitePath || moving.sortPosition !== input.expectedSortPosition) {
        throw new TRPCError({ code: "CONFLICT", message: "This case moved since it was loaded. Refresh before moving it." });
      }
      const paths = moving.suitePath === input.targetSuitePath
        ? [moving.suitePath]
        : [moving.suitePath, input.targetSuitePath];
      const rows = await tx.testCase.findMany({
        where: { projectId: input.projectId, archived: false, OR: paths.map(suitePath => ({ suitePath })) },
        select: { id: true, suitePath: true, sortPosition: true },
        orderBy: [{ sortPosition: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: MAX_SUITE_CASES * 2 + 1,
      });
      if (rows.length > MAX_SUITE_CASES * 2) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Suite is too large to reorder in one operation." });
      }
      const sourceIds = rows.filter(row => row.suitePath === moving.suitePath && row.id !== input.caseId).map(row => row.id);
      const targetIds = moving.suitePath === input.targetSuitePath
        ? sourceIds
        : rows.filter(row => row.suitePath === input.targetSuitePath).map(row => row.id);
      if (targetIds.length >= MAX_SUITE_CASES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Target suite is too large to reorder in one operation." });
      }
      const beforeIndex = input.beforeCaseId === null ? targetIds.length : targetIds.indexOf(input.beforeCaseId);
      if (beforeIndex < 0) throw new TRPCError({ code: "CONFLICT", message: "The target position changed. Refresh before moving." });
      targetIds.splice(beforeIndex, 0, input.caseId);
      const orders = moving.suitePath === input.targetSuitePath
        ? [{ path: input.targetSuitePath, ids: targetIds }]
        : [{ path: moving.suitePath, ids: sourceIds }, { path: input.targetSuitePath, ids: targetIds }];
      const rowById = new Map(rows.map(row => [row.id, row]));
      for (const order of orders) {
        for (let position = 0; position < order.ids.length; position++) {
          const id = order.ids[position]!;
          const current = rowById.get(id);
          if (current?.suitePath === order.path && current.sortPosition === position) continue;
          await tx.testCase.update({
            where: { id },
            data: {
              suitePath: order.path,
              sortPosition: position,
              ...(id === input.caseId ? { updatedById: ctx.user.id } : {}),
            },
          });
        }
      }
      await tx.auditLog.create({ data: {
        organizationId: project.organizationId,
        projectId: input.projectId,
        actorId: ctx.user.id,
        entityType: "TestCase",
        entityId: input.caseId,
        action: "UPDATE",
        summary: `Moved test case “${moving.title}” in suite order`,
        metadata: { fromSuite: moving.suitePath, toSuite: input.targetSuitePath, beforeCaseId: input.beforeCaseId },
      } });
      return { suitePath: input.targetSuitePath, sortPosition: beforeIndex };
    }, { timeout: 20000 });
  }),

  // Full-set replacement with an expected baseline is safer than individual
  // add/remove toggles under concurrent editors. Cycles are forbidden.
  setPrerequisites: protectedProcedure.input(placementInput.extend({
    dependentId: z.string().min(1),
    prerequisiteIds: z.array(z.string().min(1)).max(50),
    expectedPrerequisiteIds: z.array(z.string().min(1)).max(50),
  })).mutation(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
    if (new Set(input.prerequisiteIds).size !== input.prerequisiteIds.length || input.prerequisiteIds.includes(input.dependentId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Choose unique prerequisite cases other than this case." });
    }
    return ctx.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.projectId}))::text`;
      const ids = [input.dependentId, ...input.prerequisiteIds];
      const cases = await tx.testCase.findMany({
        where: { id: { in: ids }, projectId: input.projectId, archived: false },
        select: { id: true, title: true },
      });
      if (cases.length !== ids.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Prerequisites must be active cases in the same project." });
      }
      const links = await tx.testCasePrerequisite.findMany({
        where: { projectId: input.projectId },
        select: { dependentId: true, prerequisiteId: true },
        take: MAX_PROJECT_DEPENDENCIES + 1,
      });
      if (links.length > MAX_PROJECT_DEPENDENCIES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Project has too many prerequisite links to edit safely." });
      }
      const existing = links.filter(link => link.dependentId === input.dependentId).map(link => link.prerequisiteId);
      if (!sameIds(existing, input.expectedPrerequisiteIds)) {
        throw new TRPCError({ code: "CONFLICT", message: "Prerequisites changed since you opened this case. Refresh before saving." });
      }
      const graph = new Map<string, string[]>();
      for (const link of links) {
        if (link.dependentId === input.dependentId) continue;
        graph.set(link.dependentId, [...(graph.get(link.dependentId) ?? []), link.prerequisiteId]);
      }
      graph.set(input.dependentId, input.prerequisiteIds);
      // Iterative topological check avoids unbounded JS recursion on a long
      // but otherwise valid chain in a larger customer's project.
      const indegree = new Map<string, number>();
      for (const [dependentId, prerequisiteIds] of graph) {
        indegree.set(dependentId, indegree.get(dependentId) ?? 0);
        for (const prerequisiteId of prerequisiteIds) indegree.set(prerequisiteId, (indegree.get(prerequisiteId) ?? 0) + 1);
      }
      const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
      let processed = 0;
      while (queue.length) {
        const id = queue.pop()!;
        processed++;
        for (const next of graph.get(id) ?? []) {
          const degree = indegree.get(next)! - 1;
          indegree.set(next, degree);
          if (degree === 0) queue.push(next);
        }
      }
      if (processed !== indegree.size) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Prerequisites cannot form a cycle." });
      }
      if (sameIds(existing, input.prerequisiteIds)) return { prerequisiteIds: existing };
      await tx.testCasePrerequisite.deleteMany({ where: { projectId: input.projectId, dependentId: input.dependentId } });
      if (input.prerequisiteIds.length) await tx.testCasePrerequisite.createMany({
        data: input.prerequisiteIds.map(prerequisiteId => ({
          projectId: input.projectId,
          dependentId: input.dependentId,
          prerequisiteId,
          createdById: ctx.user.id,
        })),
      });
      await tx.auditLog.create({ data: {
        organizationId: project.organizationId,
        projectId: input.projectId,
        actorId: ctx.user.id,
        entityType: "TestCase",
        entityId: input.dependentId,
        action: "UPDATE",
        summary: `Updated prerequisites for “${cases.find(c => c.id === input.dependentId)?.title ?? "test case"}”`,
        metadata: { from: existing, to: input.prerequisiteIds },
      } });
      return { prerequisiteIds: input.prerequisiteIds };
    }, { timeout: 20000 });
  }),
});
