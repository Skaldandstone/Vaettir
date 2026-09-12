import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { generateTestCasesFromRequirement, extractRequirementsFromMarkdown } from "@vaettir/ai-agent";
import { randomBytes } from "node:crypto";
import { router, protectedProcedure, publicProcedure, requireProjectAccess } from "../trpc.js";
import { chargeAiCredits, InsufficientAiCreditsError, meterAiCall, type AiCharge } from "../services/aiCredits.js";
import { scanRepoForRequirementDocs } from "../services/repoDocScan.js";
import { fetchLinearIssue, getOrgLinearApiKey, LinearApiError, LinearNotConfiguredError } from "../services/linearApi.js";
import { fetchJiraIssue, getOrgJiraConnection, JiraApiError, JiraNotConfiguredError } from "../services/jiraApi.js";
import { computeRequirementTestSummary } from "../services/requirementTestSummary.js";

const testSummaryOutput = z.object({
  requirementId: z.string(),
  requirementTitle: z.string(),
  requirementDescription: z.string().nullable(),
  acceptanceCriteria: z.object({ total: z.number(), met: z.number(), pending: z.number(), notMet: z.number(), atRisk: z.number() }),
  testCases: z.object({
    total: z.number(),
    passing: z.number(),
    failing: z.number(),
    neverRun: z.number(),
    other: z.number(),
    pendingReview: z.number(),
  }),
  failingTestCases: z.array(z.object({ id: z.string(), title: z.string(), lastRunAt: z.string().nullable() })),
  openRiskFlags: z.array(z.object({ id: z.string(), severity: z.string(), description: z.string() })),
});

const draftRequirementOutput = z.object({
  title: z.string(),
  description: z.string(),
  sourceFile: z.string().nullable(),
});

export const requirementsRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          externalRef: z.string().nullable(),
          acceptanceCriteriaCount: z.number(),
          linearIssueId: z.string().nullable(),
          linearStatusName: z.string().nullable(),
          linearSyncedAt: z.date().nullable(),
          jiraIssueKey: z.string().nullable(),
          jiraStatusName: z.string().nullable(),
          jiraSyncedAt: z.date().nullable(),
          shareToken: z.string().nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const requirements = await ctx.prisma.requirement.findMany({
        where: { projectId: input.projectId },
        include: { _count: { select: { acceptanceCriteria: true } } },
        orderBy: { createdAt: "desc" },
      });
      return requirements.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        externalRef: r.externalRef,
        acceptanceCriteriaCount: r._count.acceptanceCriteria,
        linearIssueId: r.linearIssueId,
        linearStatusName: r.linearStatusName,
        linearSyncedAt: r.linearSyncedAt,
        jiraIssueKey: r.jiraIssueKey,
        jiraStatusName: r.jiraStatusName,
        jiraSyncedAt: r.jiraSyncedAt,
        shareToken: r.shareToken,
      }));
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        title: z.string().min(1),
        description: z.string().optional(),
        externalRef: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return ctx.prisma.requirement.create({
        data: {
          projectId: input.projectId,
          title: input.title,
          description: input.description,
          externalRef: input.externalRef,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1),
        description: z.string().optional(),
        externalRef: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.requirement.findUniqueOrThrow({
        where: { id: input.id },
        select: { projectId: true },
      });
      await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      return ctx.prisma.requirement.update({
        where: { id: input.id },
        data: { title: input.title, description: input.description, externalRef: input.externalRef },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.requirement.findUniqueOrThrow({
        where: { id: input.id },
        select: { projectId: true },
      });
      await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      await ctx.prisma.requirement.delete({ where: { id: input.id } });
    }),

  // P9-02: validates the Linear issue actually exists (and this org's API
  // key can see it) before storing the link - a typo'd identifier fails
  // loudly here rather than silently never syncing. Pulls the issue's
  // current status immediately so a newly-linked requirement doesn't sit
  // with a blank status until the next webhook/manual sync.
  linkLinearIssue: protectedProcedure
    .input(z.object({ requirementId: z.string(), linearIssueId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.requirement.findUniqueOrThrow({
        where: { id: input.requirementId },
        include: { project: { select: { id: true, organizationId: true } } },
      });
      await requireProjectAccess(ctx, existing.project.id, "EDITOR");

      let apiKey: string;
      try {
        apiKey = await getOrgLinearApiKey(ctx.prisma, existing.project.organizationId);
      } catch (e) {
        if (e instanceof LinearNotConfiguredError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
        throw e;
      }

      let issue;
      try {
        issue = await fetchLinearIssue(apiKey, input.linearIssueId.trim());
      } catch (e) {
        if (e instanceof LinearApiError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        throw e;
      }

      return ctx.prisma.requirement.update({
        where: { id: input.requirementId },
        data: { linearIssueId: issue.identifier, linearStatusName: issue.stateName, linearSyncedAt: new Date() },
      });
    }),

  unlinkLinearIssue: protectedProcedure.input(z.object({ requirementId: z.string() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.requirement.findUniqueOrThrow({ where: { id: input.requirementId }, select: { projectId: true } });
    await requireProjectAccess(ctx, existing.projectId, "EDITOR");
    return ctx.prisma.requirement.update({
      where: { id: input.requirementId },
      data: { linearIssueId: null, linearStatusName: null, linearSyncedAt: null },
    });
  }),

  // Manual re-pull, for "I don't want to wait for the webhook" or for an
  // org that hasn't configured one yet - the same underlying fetch the
  // inbound webhook path effectively short-circuits when it's live.
  syncLinearStatus: protectedProcedure.input(z.object({ requirementId: z.string() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.requirement.findUniqueOrThrow({
      where: { id: input.requirementId },
      include: { project: { select: { id: true, organizationId: true } } },
    });
    await requireProjectAccess(ctx, existing.project.id, "EDITOR");
    if (!existing.linearIssueId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This requirement isn't linked to a Linear issue yet." });
    }

    let apiKey: string;
    try {
      apiKey = await getOrgLinearApiKey(ctx.prisma, existing.project.organizationId);
    } catch (e) {
      if (e instanceof LinearNotConfiguredError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
      throw e;
    }

    let issue;
    try {
      issue = await fetchLinearIssue(apiKey, existing.linearIssueId);
    } catch (e) {
      if (e instanceof LinearApiError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
      throw e;
    }

    return ctx.prisma.requirement.update({
      where: { id: input.requirementId },
      data: { linearStatusName: issue.stateName, linearSyncedAt: new Date() },
    });
  }),

  // P9-01: same three-mutation shape as Linear's above, against Jira's
  // Basic-auth REST API instead.
  linkJiraIssue: protectedProcedure
    .input(z.object({ requirementId: z.string(), jiraIssueKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.requirement.findUniqueOrThrow({
        where: { id: input.requirementId },
        include: { project: { select: { id: true, organizationId: true } } },
      });
      await requireProjectAccess(ctx, existing.project.id, "EDITOR");

      let conn;
      try {
        conn = await getOrgJiraConnection(ctx.prisma, existing.project.organizationId);
      } catch (e) {
        if (e instanceof JiraNotConfiguredError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
        throw e;
      }

      let issue;
      try {
        issue = await fetchJiraIssue(conn, input.jiraIssueKey.trim());
      } catch (e) {
        if (e instanceof JiraApiError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        throw e;
      }

      return ctx.prisma.requirement.update({
        where: { id: input.requirementId },
        data: { jiraIssueKey: issue.key, jiraStatusName: issue.statusName, jiraSyncedAt: new Date() },
      });
    }),

  unlinkJiraIssue: protectedProcedure.input(z.object({ requirementId: z.string() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.requirement.findUniqueOrThrow({ where: { id: input.requirementId }, select: { projectId: true } });
    await requireProjectAccess(ctx, existing.projectId, "EDITOR");
    return ctx.prisma.requirement.update({
      where: { id: input.requirementId },
      data: { jiraIssueKey: null, jiraStatusName: null, jiraSyncedAt: null },
    });
  }),

  syncJiraStatus: protectedProcedure.input(z.object({ requirementId: z.string() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.requirement.findUniqueOrThrow({
      where: { id: input.requirementId },
      include: { project: { select: { id: true, organizationId: true } } },
    });
    await requireProjectAccess(ctx, existing.project.id, "EDITOR");
    if (!existing.jiraIssueKey) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This requirement isn't linked to a Jira issue yet." });
    }

    let conn;
    try {
      conn = await getOrgJiraConnection(ctx.prisma, existing.project.organizationId);
    } catch (e) {
      if (e instanceof JiraNotConfiguredError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
      throw e;
    }

    let issue;
    try {
      issue = await fetchJiraIssue(conn, existing.jiraIssueKey);
    } catch (e) {
      if (e instanceof JiraApiError) throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
      throw e;
    }

    return ctx.prisma.requirement.update({
      where: { id: input.requirementId },
      data: { jiraStatusName: issue.statusName, jiraSyncedAt: new Date() },
    });
  }),

  // The in-app view of the same summary the public share link renders -
  // acceptance criteria rollup, pass/fail/never-run counts, the actual
  // failing test titles, and open risk flags for the project. Requires a
  // real session (unlike getSharedSummary below), so this is what backs
  // the requirements page's own "Test status" panel.
  getTestSummary: protectedProcedure
    .input(z.object({ requirementId: z.string() }))
    .output(testSummaryOutput)
    .query(async ({ ctx, input }) => {
      const requirement = await ctx.prisma.requirement.findUniqueOrThrow({ where: { id: input.requirementId }, select: { projectId: true } });
      await requireProjectAccess(ctx, requirement.projectId);
      return computeRequirementTestSummary(ctx.prisma, input.requirementId);
    }),

  // Opt-in only - nothing is exposed publicly until a human explicitly
  // generates a link. The token is the entire access control for
  // getSharedSummary below (there's no way to authenticate a Jira/Linear
  // unfurl bot as a real Vaettir session), so it's a fresh random 32-byte
  // value every time - regenerating invalidates whatever was pasted
  // anywhere before.
  createShareLink: protectedProcedure.input(z.object({ requirementId: z.string() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.requirement.findUniqueOrThrow({ where: { id: input.requirementId }, select: { projectId: true } });
    await requireProjectAccess(ctx, existing.projectId, "EDITOR");
    const shareToken = randomBytes(24).toString("base64url");
    await ctx.prisma.requirement.update({ where: { id: input.requirementId }, data: { shareToken } });
    return { shareToken };
  }),

  revokeShareLink: protectedProcedure.input(z.object({ requirementId: z.string() })).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.requirement.findUniqueOrThrow({ where: { id: input.requirementId }, select: { projectId: true } });
    await requireProjectAccess(ctx, existing.projectId, "EDITOR");
    await ctx.prisma.requirement.update({ where: { id: input.requirementId }, data: { shareToken: null } });
  }),

  // Public by design (see the schema comment on Requirement.shareToken) -
  // the unguessable token itself is the access control, not a session.
  // Deliberately returns only aggregate counts and test/risk-flag titles,
  // never given/when/then step content or acceptance-criterion text - a
  // link preview is meant for status at a glance, not to leak a project's
  // full test detail to whoever else can see the ticket it's pasted into.
  getSharedSummary: publicProcedure
    .input(z.object({ shareToken: z.string().min(1) }))
    .output(testSummaryOutput.nullable())
    .query(async ({ ctx, input }) => {
      const requirement = await ctx.prisma.requirement.findUnique({ where: { shareToken: input.shareToken }, select: { id: true } });
      if (!requirement) return null;
      return computeRequirementTestSummary(ctx.prisma, requirement.id);
    }),

  // 2026-08-27 competitor parity audit: draft-only, same review-before-save
  // shape as every other AI feature (P2-06, P4-02, P5-12) - nothing here
  // creates a real TestCase; the caller reviews/edits the draft, then a
  // separate testCases.create call (already built) commits whichever ones
  // survive review.
  generateTestCases: protectedProcedure
    .input(z.object({ requirementId: z.string() }))
    .output(
      z.array(
        z.object({
          title: z.string(),
          given: z.array(z.string()),
          when: z.array(z.string()),
          then: z.array(z.string()),
          priority: z.string(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const requirement = await ctx.prisma.requirement.findUniqueOrThrow({
        where: { id: input.requirementId },
        include: { project: { select: { id: true, name: true, organizationId: true } } },
      });
      await requireProjectAccess(ctx, requirement.projectId, "EDITOR");

      const charge = await chargeAiCredits(ctx.prisma, requirement.project.organizationId, "generateTestCasesFromRequirement").catch((e: unknown) => {
        if (e instanceof InsufficientAiCreditsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        throw e;
      });

      return meterAiCall(ctx.prisma, charge, () =>
        generateTestCasesFromRequirement({
          requirementTitle: requirement.title,
          requirementDescription: requirement.description,
          projectName: requirement.project.name,
        }),
      );
    }),

  // Draft-only, same review-before-save shape - nothing here creates a
  // real Requirement until the caller reviews the drafts and explicitly
  // picks which to keep via the normal `create` mutation above.
  extractFromMarkdown: protectedProcedure
    .input(z.object({ projectId: z.string(), fileName: z.string().min(1), markdownContent: z.string().min(1) }))
    .output(z.array(draftRequirementOutput))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const charge = await chargeAiCredits(ctx.prisma, project.organizationId, "extractRequirementsFromMarkdown").catch((e: unknown) => {
        if (e instanceof InsufficientAiCreditsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        throw e;
      });
      const drafts = await meterAiCall(ctx.prisma, charge, () => extractRequirementsFromMarkdown(input.markdownContent, input.fileName));
      return drafts.map((d) => ({ ...d, sourceFile: input.fileName }));
    }),

  // Scans the project's (or a caller-supplied) repo for likely
  // requirements/spec docs (README + docs//spec//requirements-hinted
  // paths, see repoDocScan.ts) and extracts drafts from each - one AI
  // credit charge per document actually scanned, so a doc-light repo
  // costs less than a doc-heavy one rather than a flat fee either way.
  extractFromRepo: protectedProcedure
    .input(z.object({ projectId: z.string(), repoUrl: z.string().optional(), ref: z.string().default("main") }))
    .output(z.array(draftRequirementOutput))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const projectRow = await ctx.prisma.project.findUniqueOrThrow({ where: { id: input.projectId } });
      const repoUrl = input.repoUrl ?? projectRow.repoUrl;
      if (!repoUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No repo URL provided and the project has none configured" });
      }

      const docs = await scanRepoForRequirementDocs(repoUrl, input.ref);
      if (docs.length === 0) {
        return [];
      }

      const results: Array<{ title: string; description: string; sourceFile: string | null }> = [];
      for (const doc of docs) {
        let charge: AiCharge;
        try {
          charge = await chargeAiCredits(ctx.prisma, project.organizationId, "extractRequirementsFromMarkdown");
        } catch (e) {
          if (e instanceof InsufficientAiCreditsError) {
            // Stop here, keep whatever was already extracted - a partial
            // result is still useful, unlike failing the whole scan.
            break;
          }
          throw e;
        }
        const drafts = await meterAiCall(ctx.prisma, charge, () => extractRequirementsFromMarkdown(doc.content, doc.relativePath));
        results.push(...drafts.map((d) => ({ ...d, sourceFile: doc.relativePath })));
      }
      return results;
    }),
});
