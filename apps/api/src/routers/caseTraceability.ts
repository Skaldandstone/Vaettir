import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma } from "@vaettir/db";
import { defectDocumentSchema, defectClusterId } from "@vaettir/core";
import {
  protectedProcedure,
  requireProjectAccess,
  router,
  type Context,
} from "../trpc.js";
import { liveEditor } from "./jiraConnections.js";

const bounded = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        Array.from(value).every(
          (character) =>
            character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
        ),
      "Use printable reference metadata",
    );
const provider = z.enum([
  "jira",
  "linear",
  "asana",
  "notion",
  "wiki",
  "requirement",
  "defect",
]);
const kind = z.enum(["feature", "task", "requirement", "document", "defect"]);
const nativeId = bounded(1000).refine(
  (value) => Buffer.byteLength(value) <= 1000,
  "Reference identity exceeds its metadata limit",
);
const projectInput = z.object({ projectId: bounded(120) }).strict();
const caseInput = projectInput.extend({ caseId: bounded(120) });
const mutationInput = caseInput.extend({
  version: z.number().int().min(0),
  requestId: z.string().uuid(),
});
const externalProviders = new Set([
  "jira",
  "linear",
  "asana",
  "notion",
  "wiki",
]);
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message:
      "Test links changed. Refresh and review your retained draft before saving.",
  });

// Reference navigation only: no network intake, query tokens, userinfo or executable scheme.
// Fragments identify exact documentation blocks and are intentionally preserved.
export function traceabilityHref(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Use the reference's HTTPS link.",
    });
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    !url.hostname.includes(".") ||
    /^(localhost|127\.|0\.|169\.254\.)/.test(url.hostname)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Use an HTTPS reference without credentials or query parameters.",
    });
  return url.href;
}
const targetInput = z
  .object({
    provider,
    nativeId,
    kind,
    title: bounded(200).optional(),
    url: bounded(1500).optional(),
  })
  .strict();

async function access<T>(
  ctx: Context & { user: NonNullable<Context["user"]> },
  projectId: string,
  write: boolean,
  action: (tx: Prisma.TransactionClient, organizationId: string) => Promise<T>,
) {
  const { project } = await requireProjectAccess(
    ctx,
    projectId,
    write ? "EDITOR" : "VIEWER",
  );
  return ctx.prisma.$transaction(
    async (tx) => {
      if (write)
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))::text`;
      if (write) await liveEditor(tx, project.organizationId, ctx.user.id);
      else {
        const member = await tx.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: project.organizationId,
              userId: ctx.user.id,
            },
          },
        });
        const org = await tx.organization.findUnique({
          where: { id: project.organizationId },
          select: { suspendedAt: true },
        });
        if (!member || !org || org.suspendedAt)
          throw new TRPCError({ code: "FORBIDDEN" });
      }
      const rows = await tx.$queryRaw<
        Array<{ organizationId: string }>
      >`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
      if (rows[0]?.organizationId !== project.organizationId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Project workspace changed. Refresh access.",
        });
      const state = await tx.caseTraceabilityState.findUnique({
        where: { projectId },
      });
      if (state && state.organizationId !== project.organizationId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "These retained links belong to the previous workspace; review migration before access.",
        });
      return action(tx, project.organizationId);
    },
    { maxWait: 5000, timeout: 10000 },
  );
}
async function ownCase(
  tx: Prisma.TransactionClient,
  projectId: string,
  caseId: string,
) {
  if (
    !(await tx.testCase.findFirst({
      where: { id: caseId, projectId },
      select: { id: true },
    }))
  )
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Choose a test case in this project.",
    });
}
async function target(
  tx: Prisma.TransactionClient,
  projectId: string,
  input: z.infer<typeof targetInput>,
) {
  if (input.provider === "requirement") {
    if (input.kind !== "requirement" || input.url)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Select a local requirement, not an external URL.",
      });
    const row = await tx.requirement.findFirst({
      where: { id: input.nativeId, projectId },
      select: { id: true, title: true },
    });
    if (!row)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "The requirement must belong to the same project.",
      });
    return {
      provider: input.provider,
      providerOrigin: "vaettir",
      nativeId: row.id,
      kind: input.kind,
      title: row.title.slice(0, 200),
      url: null,
      requirementId: row.id,
    };
  }
  if (input.provider === "defect") {
    if (input.kind !== "defect" || input.url)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Select a retained project defect, not an external URL.",
      });
    const row = await tx.defectMapState.findUnique({ where: { projectId } });
    const org = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { organizationId: true },
    });
    if (!row || row.organizationId !== org.organizationId)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Choose a defect in this project's retained map.",
      });
    const signal = defectDocumentSchema
      .parse(row.document)
      .signals.find((value) => defectClusterId(value) === input.nativeId);
    if (!signal)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Choose a defect in this project's retained map.",
      });
    return {
      provider: input.provider,
      providerOrigin: "vaettir",
      nativeId: input.nativeId,
      kind: input.kind,
      title: signal.title.slice(0, 200),
      url: null,
      requirementId: null,
    };
  }
  if (!externalProviders.has(input.provider) || !input.url || !input.title)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Add the selected reference's title, native ID and HTTPS link.",
    });
  const url = traceabilityHref(input.url);
  return {
    provider: input.provider,
    providerOrigin: new URL(url).origin,
    nativeId: input.nativeId,
    kind: input.kind,
    title: input.title,
    url,
    requirementId: null,
  };
}
async function write(
  ctx: Context & { user: NonNullable<Context["user"]> },
  input: z.infer<typeof mutationInput>,
  payload: unknown,
  apply: (tx: Prisma.TransactionClient) => Promise<boolean>,
) {
  return access(ctx, input.projectId, true, async (tx, organizationId) => {
    await ownCase(tx, input.projectId, input.caseId);
    const key = hash([input.projectId, ctx.user.id, input.requestId]);
    const requestHash = hash([input.caseId, input.version, payload]);
    const previous = await tx.caseTraceabilityWrite.findUnique({
      where: { key },
    });
    if (previous) {
      if (previous.requestHash !== requestHash) throw conflict();
      return { appliedVersion: previous.appliedVersion, retried: true };
    }
    const state = await tx.caseTraceabilityState.findUnique({
      where: { projectId: input.projectId },
    });
    if ((state?.version ?? 0) !== input.version) throw conflict();
    if (
      (await tx.caseTraceabilityWrite.count({
        where: { projectId: input.projectId },
      })) >= 10000
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This project reached its retained-link write limit. Existing evidence stays intact.",
      });
    await tx.caseTraceabilityState.upsert({
      where: { projectId: input.projectId },
      create: { projectId: input.projectId, organizationId },
      update: {},
    });
    const changed = await apply(tx);
    const appliedVersion = input.version + Number(changed);
    if (changed)
      await tx.caseTraceabilityState.update({
        where: { projectId: input.projectId },
        data: { version: appliedVersion },
      });
    await tx.caseTraceabilityWrite.create({
      data: {
        key,
        projectId: input.projectId,
        actorId: ctx.user.id,
        requestHash,
        appliedVersion,
      },
    });
    if (changed)
      await tx.auditLog.create({
        data: {
          organizationId,
          projectId: input.projectId,
          actorId: ctx.user.id,
          entityType: "TestCase",
          entityId: input.caseId,
          action: "UPDATE",
          summary: "Updated manually confirmed test coverage references",
          metadata: {
            traceability: { version: appliedVersion, manuallyConfirmed: true },
          },
        },
      });
    return { appliedVersion, retried: false };
  });
}

export const caseTraceabilityRouter = router({
  forCase: protectedProcedure.input(caseInput).query(({ ctx, input }) =>
    access(ctx, input.projectId, false, async (tx) => {
      await ownCase(tx, input.projectId, input.caseId);
      const state = await tx.caseTraceabilityState.findUnique({
        where: { projectId: input.projectId },
      });
      const links = await tx.caseTraceabilityLink.findMany({
        where: { projectId: input.projectId, caseId: input.caseId },
        orderBy: [{ removedAt: "asc" }, { createdAt: "asc" }],
        take: 100,
      });
      return {
        version: state?.version ?? 0,
        links,
        meaning: "manually_confirmed_coverage_reference" as const,
        sourceFetched: false,
        credits: 0,
      };
    }),
  ),
  localRequirements: protectedProcedure
    .input(projectInput.extend({ search: z.string().max(100).default("") }))
    .query(({ ctx, input }) =>
      access(ctx, input.projectId, false, (tx) =>
        tx.requirement.findMany({
          where: {
            projectId: input.projectId,
            title: { contains: input.search, mode: "insensitive" },
          },
          select: { id: true, title: true },
          orderBy: [{ title: "asc" }, { id: "asc" }],
          take: 50,
        }),
      ),
    ),
  localDefects: protectedProcedure.input(projectInput).query(({ ctx, input }) =>
    access(ctx, input.projectId, false, async (tx, organizationId) => {
      const state = await tx.defectMapState.findUnique({
        where: { projectId: input.projectId },
      });
      if (!state || state.organizationId !== organizationId) return [];
      return Array.from(
        new Map(
          defectDocumentSchema
            .parse(state.document)
            .signals.map((signal) => [
              defectClusterId(signal),
              { id: defectClusterId(signal), title: signal.title },
            ]),
        ).values(),
      ).slice(0, 50);
    }),
  ),
  availableCases: protectedProcedure
    .input(projectInput.extend({ search: z.string().max(100).default("") }))
    .query(({ ctx, input }) =>
      access(ctx, input.projectId, false, (tx) =>
        tx.testCase.findMany({
          where: {
            projectId: input.projectId,
            archived: false,
            title: { contains: input.search, mode: "insensitive" },
          },
          select: { id: true, title: true },
          orderBy: [{ title: "asc" }, { id: "asc" }],
          take: 50,
        }),
      ),
    ),
  forTarget: protectedProcedure
    .input(
      projectInput.extend({
        provider,
        providerOrigin: bounded(500),
        nativeId,
        afterId: bounded(100).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      access(ctx, input.projectId, false, async (tx) => {
        if (externalProviders.has(input.provider)) {
          const url = new URL(traceabilityHref(input.providerOrigin));
          if (url.origin !== input.providerOrigin)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Use the exact provider origin, not a page URL.",
            });
        } else if (input.providerOrigin !== "vaettir")
          throw new TRPCError({ code: "BAD_REQUEST" });
        const where = {
          projectId: input.projectId,
          provider: input.provider,
          providerOrigin: input.providerOrigin,
          nativeId: input.nativeId,
          removedAt: null,
        };
        const links = await tx.caseTraceabilityLink.findMany({
          where: {
            ...where,
            ...(input.afterId ? { id: { gt: input.afterId } } : {}),
          },
          orderBy: { id: "asc" },
          take: 51,
          select: {
            id: true,
            caseId: true,
            testCase: {
              select: {
                title: true,
                archived: true,
                testType: true,
                priority: true,
              },
            },
          },
        });
        const state = await tx.caseTraceabilityState.findUnique({
          where: { projectId: input.projectId },
        });
        return {
          version: state?.version ?? 0,
          cases: links.slice(0, 50),
          nextId: links.length > 50 ? links[49]!.id : null,
          total: await tx.caseTraceabilityLink.count({ where }),
          indicatesExecutionPassed: false,
        };
      }),
    ),
  save: protectedProcedure
    .input(
      mutationInput.extend({
        target: targetInput,
        approveLink: z.literal(true),
      }),
    )
    .mutation(({ ctx, input }) =>
      write(ctx, input, ["save", input.target], async (tx) => {
        const selected = await target(tx, input.projectId, input.target);
        const id = hash([
          input.projectId,
          input.caseId,
          selected.provider,
          selected.providerOrigin,
          selected.nativeId,
        ]);
        const previous = await tx.caseTraceabilityLink.findUnique({
          where: { id },
        });
        if (
          !previous &&
          (await tx.caseTraceabilityLink.count({
            where: { projectId: input.projectId, caseId: input.caseId },
          })) >= 100
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Maximum 100 retained references per test case, including removed links.",
          });
        const changed =
          !previous ||
          previous.removedAt !== null ||
          Object.entries(selected).some(
            ([key, value]) => previous[key as keyof typeof previous] !== value,
          );
        if (changed)
          await tx.caseTraceabilityLink.upsert({
            where: { id },
            create: {
              id,
              projectId: input.projectId,
              caseId: input.caseId,
              ...selected,
              createdById: ctx.user.id,
              updatedById: ctx.user.id,
            },
            update: { ...selected, updatedById: ctx.user.id, removedAt: null },
          });
        return changed;
      }),
    ),
  remove: protectedProcedure
    .input(
      mutationInput.extend({
        linkId: bounded(100),
        approveRemove: z.literal(true),
      }),
    )
    .mutation(({ ctx, input }) =>
      write(ctx, input, ["remove", input.linkId], async (tx) => {
        const link = await tx.caseTraceabilityLink.findFirst({
          where: {
            id: input.linkId,
            projectId: input.projectId,
            caseId: input.caseId,
          },
        });
        if (!link) throw new TRPCError({ code: "NOT_FOUND" });
        if (link.removedAt) return false;
        await tx.caseTraceabilityLink.update({
          where: { id: link.id },
          data: { removedAt: new Date(), updatedById: ctx.user.id },
        });
        return true;
      }),
    ),
});
