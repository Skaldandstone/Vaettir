import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {type Prisma} from "@vaettir/db";
import { generateTestCasesFromRequirement, extractRequirementsFromMarkdown } from "@vaettir/ai-agent";
import { randomBytes,createHash } from "node:crypto";
import { router, protectedProcedure, publicProcedure, requireProjectAccess } from "../trpc.js";
import { chargeAiCredits, InsufficientAiCreditsError, meterAiCall } from "../services/aiCredits.js";
import { scanRepoForRequirementDocs } from "../services/repoDocScan.js";
import { fetchLinearIssue, getOrgLinearApiKey, LinearApiError, LinearNotConfiguredError } from "../services/linearApi.js";
import { fetchJiraIssue, getOrgJiraConnection, JiraApiError, JiraNotConfiguredError } from "../services/jiraApi.js";
import { computeRequirementTestSummary } from "../services/requirementTestSummary.js";
import { repositoryProcessingScope, repositoryProcessingConsent, beginRepositoryProcessing, assertRepositoryProcessingApproval } from "../services/repositoryProcessingApproval.js";
import {publicRepositoryProcessingError} from "../services/repositoryProcessingErrors.js";

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

// Same organization/member/project lock order as reviewed source imports.
// Preserve the normal CRUD seat policy, but do not trust a cached membership
// after waiting on another writer.
async function lockedRequirementEditor(tx:Prisma.TransactionClient,organizationId:string,actorId:string,projectId:string){
  const orgs=await tx.$queryRaw<Array<{suspendedAt:Date|null}>>`SELECT "suspendedAt" FROM "Organization" WHERE id=${organizationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${organizationId} AND "userId"=${actorId} FOR UPDATE`;
  const member=await tx.membership.findUnique({where:{organizationId_userId:{organizationId,userId:actorId}}});
  if(!orgs[0]||orgs[0].suspendedAt||!member||!["OWNER","ADMIN","EDITOR"].includes(member.role))throw new TRPCError({code:"FORBIDDEN"});
  const projects=await tx.$queryRaw<Array<{organizationId:string}>>`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
  if(projects[0]?.organizationId!==organizationId)throw new TRPCError({code:"FORBIDDEN"});
}

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
      const access = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      // Serialize manual additions with reviewed Jira imports, so an import
      // sees a preceding human link rather than racing its duplicate check.
      return ctx.prisma.$transaction(async tx => {
        await lockedRequirementEditor(tx,access.project.organizationId,ctx.user.id,input.projectId);
        return tx.requirement.create({
          data: {
            projectId: input.projectId,
            title: input.title,
            description: input.description,
            externalRef: input.externalRef,
          },
        });
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
      const access = await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      return ctx.prisma.$transaction(async tx => {
        await lockedRequirementEditor(tx,access.project.organizationId,ctx.user.id,existing.projectId);
        return tx.requirement.update({
          where: { id: input.id, projectId: existing.projectId },
          data: { title: input.title, description: input.description, externalRef: input.externalRef },
        });
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.requirement.findUniqueOrThrow({
        where: { id: input.id },
        select: { projectId: true },
      });
      const access = await requireProjectAccess(ctx, existing.projectId, "EDITOR");
      await ctx.prisma.$transaction(async tx => {
        await lockedRequirementEditor(tx,access.project.organizationId,ctx.user.id,existing.projectId);
        await tx.requirement.delete({ where: { id: input.id, projectId: existing.projectId } });
      });
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
    .input(z.object({ projectId: z.string(), scope:repositoryProcessingScope, consent:repositoryProcessingConsent }))
    .output(z.array(draftRequirementOutput))
    .mutation(async ({ ctx, input }) => {
      const {approval,replayed}=await beginRepositoryProcessing(ctx,input.projectId,"REQUIREMENTS",input.scope,input.consent);
      const processedFileSchema=z.object({path:z.string(),hash:z.string(),drafts:z.array(draftRequirementOutput)});
      const receiptSchema=z.object({drafts:z.array(draftRequirementOutput),inFlightPath:z.string().nullable(),inFlightHash:z.string().nullable(),processedPaths:z.array(z.string()),processedFiles:z.array(processedFileSchema)});
      if(replayed){
        if(approval.results)return receiptSchema.parse(approval.results).drafts;
        throw new TRPCError({code:"PRECONDITION_FAILED",message:"This approved run is in progress or needs recovery. Review its saved status; retrying cannot reread or recharge it."});
      }
      const results: Array<{ title: string; description: string; sourceFile: string | null }> = [];
      const processedPaths:string[]=[];
      const processedFiles:Array<z.infer<typeof processedFileSchema>>=[];
      try{
        await ctx.prisma.$transaction(tx=>assertRepositoryProcessingApproval(tx,approval.id,input.projectId,"REQUIREMENTS"));
        const {files:docs,headSha}=await scanRepoForRequirementDocs(input.scope.repoUrl,input.scope.ref,input.scope.pathPrefixes,input.scope.maxItems);
        if(!/^[a-f0-9]{40}$/i.test(headSha))throw new TRPCError({code:"PRECONDITION_FAILED",message:"The repository revision could not be pinned."});
        await ctx.prisma.$transaction(async tx=>{
          await assertRepositoryProcessingApproval(tx,approval.id,input.projectId,"REQUIREMENTS");
          await tx.repositoryProcessingApproval.update({where:{id:approval.id},data:{resolvedCommitSha:headSha,results:{drafts:results,processedPaths,processedFiles,inFlightPath:null,inFlightHash:null}}});
        });
        for(const doc of docs){
          const hash=createHash("sha256").update(doc.content).digest("hex");
          const retained=await ctx.prisma.$transaction(async tx=>{
            await assertRepositoryProcessingApproval(tx,approval.id,input.projectId,"REQUIREMENTS");
            const prior=await tx.repositoryProcessingApproval.findFirst({where:{id:{not:approval.id},projectId:input.projectId,organizationId:approval.organizationId,purpose:"REQUIREMENTS",repositoryUrl:input.scope.repoUrl,results:{path:["processedFiles"],array_contains:[{path:doc.relativePath,hash}]}},orderBy:{createdAt:"desc"}});
            if(prior){const receipt=receiptSchema.parse(prior.results);const file=receipt.processedFiles.find(item=>item.path===doc.relativePath&&item.hash===hash);if(file)return {retained:file.drafts};}
            const pending=await tx.repositoryProcessingApproval.findFirst({where:{id:{not:approval.id},projectId:input.projectId,organizationId:approval.organizationId,purpose:"REQUIREMENTS",repositoryUrl:input.scope.repoUrl,AND:[{results:{path:["inFlightPath"],equals:doc.relativePath}},{results:{path:["inFlightHash"],equals:hash}}]}});
            if(pending)throw new TRPCError({code:"PRECONDITION_FAILED",message:"This document already has an approved paid attempt in progress or requiring recovery. Review the saved run; automatic repeated charges are blocked."});
            await tx.repositoryProcessingApproval.update({where:{id:approval.id},data:{results:{drafts:results,processedPaths,processedFiles,inFlightPath:doc.relativePath,inFlightHash:hash}}});
            const charge=await chargeAiCredits(tx as unknown as typeof ctx.prisma,approval.organizationId,"extractRequirementsFromMarkdown");
            return {charge};
          });
          if("retained" in retained&&retained.retained){results.push(...retained.retained);processedPaths.push(doc.relativePath);processedFiles.push({path:doc.relativePath,hash,drafts:retained.retained});await ctx.prisma.repositoryProcessingApproval.update({where:{id:approval.id},data:{results:{drafts:results,processedPaths,processedFiles,inFlightPath:null,inFlightHash:null}}});continue;}
          if(!("charge" in retained)||!retained.charge)throw new Error("Processing charge could not be reserved");
          const drafts=await meterAiCall(ctx.prisma,retained.charge,()=>extractRequirementsFromMarkdown(doc.content,doc.relativePath));
          const fileDrafts=drafts.map(draft=>({...draft,sourceFile:doc.relativePath}));
          results.push(...fileDrafts);processedPaths.push(doc.relativePath);processedFiles.push({path:doc.relativePath,hash,drafts:fileDrafts});
          // Retain paid outputs even if the actor loses access while AI is in
          // flight. Access is checked again before returning or continuing.
          await ctx.prisma.repositoryProcessingApproval.update({where:{id:approval.id},data:{results:{drafts:results,processedPaths,processedFiles,inFlightPath:null,inFlightHash:null}}});
          await ctx.prisma.$transaction(tx=>assertRepositoryProcessingApproval(tx,approval.id,input.projectId,"REQUIREMENTS"));
        }
        await ctx.prisma.$transaction(async tx=>{
          await assertRepositoryProcessingApproval(tx,approval.id,input.projectId,"REQUIREMENTS");
          await tx.repositoryProcessingApproval.update({where:{id:approval.id},data:{status:"COMPLETED"}});
        });
        return results;
      }catch(error){
        await ctx.prisma.repositoryProcessingApproval.updateMany({where:{id:approval.id,status:"READING"},data:{status:"FAILED"}});
        if(error instanceof InsufficientAiCreditsError){
          // Retain previous paid drafts; the stored status exposes partial
          // failure without automatically repeating any provider operation.
          await requireProjectAccess(ctx,input.projectId,"EDITOR");return results;
          }
        throw publicRepositoryProcessingError(error);
      }
    }),
});
