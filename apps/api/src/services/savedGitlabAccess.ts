import { z } from "@vaettir/core/dist/validation.js";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import type { Context } from "../trpc.js";
import { lockCaseFieldProject } from "./caseFields.js";
import { lockCurrentCaseFieldActor } from "./caseFieldReadScope.js";
import { encryptToken, decryptToken } from "./tokenEncryption.js";
import { repositoryProviderOrigin, repositoryProviderJson } from "./repositoryProviderHttp.js";
import { refreshGitlabAuthorization, revokeGitlabAuthorization, GitlabOAuthRevocationPendingError, repositoryOAuthRedirect } from "./gitlabRepositoryOAuth.js";
import { assertGitlabProjectIdentity } from "./connectedRepositoryAccess.js";

const encrypted = z.object({ ciphertext:z.string(), iv:z.string(), authTag:z.string() });
const tokenMarker = z.object({ accessMethod:z.literal("gitlab-token/v1"), requestHash:z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const renewalSchema = z.object({ version:z.literal("gitlab-refresh/v1"), refreshToken:z.string().min(1).max(10000), accountId:z.string().regex(/^[1-9][0-9]*$/), redirectUri:z.string().url().max(1000) }).strict();
export const savedGitlabAccessInput = z.object({ projectId:z.string().min(1).max(200), repositoryId:z.string().min(1).max(200), originalOrganizationId:z.string().min(1).max(200), expectedNativeActorId:z.string().min(1).max(200), expectedClerkActorId:z.string().min(1).max(200), expectedConnectionId:z.string().min(1).max(200).optional() }).strict();
// Fresh server-owned reads discover their current connection under locks. An
// explicit captured client Check action must pin the connection it displayed.
export const savedGitlabAccessCheckInput = savedGitlabAccessInput.extend({expectedConnectionId:z.string().min(1).max(200)});
type Input = z.infer<typeof savedGitlabAccessInput>;
type ActorContext = Pick<Context,"prisma"|"authenticatedClerkSubject"> & { user:NonNullable<Context["user"]> };
const refuse = (message:string) => new TRPCError({ code:"PRECONDITION_FAILED", message });
function decrypt(value:unknown) {
  try { return decryptToken(encrypted.parse(value)); }
  catch { throw refuse("Saved GitLab credentials could not be read securely. No provider request was started."); }
}
function parseRenewal(value:unknown) {
  try { return renewalSchema.parse(JSON.parse(decrypt(value))); }
  catch { throw refuse("Saved GitLab renewal information is unavailable. Review the original grant before reconnecting."); }
}
const equal = (a:unknown,b:unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Call once OUTSIDE the read transaction, before admitConnectedGitlab, with
 * original current actor/project pins. Never call for a retained sourceBinding:
 * credential rotation requires a NEW explicit source/AI/cost review. This only
 * reuses originally approved metadata access; it neither reads source nor AI.
 * REFRESHING claims serialize all screens sharing this SAME saved connection.
 */
export async function ensureSavedGitlabAccess(ctx:ActorContext, raw:Input) {
  const input = savedGitlabAccessInput.parse(raw);
  if(ctx.user.id !== input.expectedNativeActorId || !ctx.authenticatedClerkSubject ||
    ctx.authenticatedClerkSubject !== input.expectedClerkActorId || ctx.user.clerkUserId !== input.expectedClerkActorId)
    throw new TRPCError({code:"FORBIDDEN",message:"Restore the original signed-in actor before using saved GitLab access."});
  const actor = ctx.user.id;
  const started = Date.now();
  const locked = async (tx:Prisma.TransactionClient) => {
    await lockCaseFieldProject(tx, actor, input.projectId);
    await lockCurrentCaseFieldActor(tx, actor, {clerkActorId:input.expectedClerkActorId});
    const project = await tx.project.findUniqueOrThrow({where:{id:input.projectId},select:{organizationId:true}});
    if(project.organizationId !== input.originalOrganizationId)throw new TRPCError({code:"FORBIDDEN"});
    const first = await tx.projectRepository.findFirst({where:{id:input.repositoryId,projectId:input.projectId}});
    if(!first?.connectionId)throw refuse("This repository has no saved GitLab grant. Connect it once in project Settings → Integrations.");
    if(input.expectedConnectionId && first.connectionId!==input.expectedConnectionId)throw new TRPCError({code:"CONFLICT",message:"The saved repository connection changed. Refresh the project integration before checking it."});
    await tx.$queryRaw`SELECT id FROM "RepositoryConnection" WHERE id=${first.connectionId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ProjectRepository" WHERE id=${first.id} FOR SHARE`;
    const repo = await tx.projectRepository.findFirst({where:{id:first.id,projectId:input.projectId},include:{connection:true}});
    const row = repo?.connection;
    if(!repo || !row || repo.connectionId!==first.connectionId || repo.provider!=="gitlab" || row.provider!=="gitlab" ||
      row.projectId!==input.projectId || row.organizationId!==input.originalOrganizationId || row.actorId!==actor)
      throw new TRPCError({code:"FORBIDDEN",message:"This saved connection belongs to another original project, workspace or actor."});
    const origin = repositoryProviderOrigin(row.origin), url = new URL(repo.url);
    if(url.origin!==origin || url.username || url.password || url.search || url.hash || url.port || url.pathname==="/" || !repo.externalId || !/^[1-9][0-9]*$/.test(repo.externalId))
      throw refuse("The saved GitLab repository identity must be reviewed in project Settings → Integrations.");
    encrypted.parse(row.encryptedToken);
    const pat = tokenMarker.safeParse(row.encryptedVerifier).success;
    if(pat ? row.configurationId!==null : !row.configurationId || Boolean(row.encryptedVerifier && typeof row.encryptedVerifier==="object" && Object.hasOwn(row.encryptedVerifier,"accessMethod")))
      throw refuse("The saved GitLab access method is unavailable. No credential was used.");
    return {repo,row,origin,pat};
  };
  const claim = await ctx.prisma.$transaction(async tx => {
    const value = await locked(tx), {row,pat} = value;
    if(row.status!=="VERIFIED" || !row.verifiedAt || !row.tokenExpiresAt)
      throw refuse(["REFRESHING","REFRESH_UNKNOWN"].includes(row.status)
        ? "Saved GitLab renewal is in progress or unconfirmed. No token exchange will be repeated."
        : "Saved GitLab access is unavailable. Review the original grant in project Settings → Integrations.");
    if(row.configurationId)await tx.$queryRaw`SELECT id FROM "RepositoryProviderConfiguration" WHERE id=${row.configurationId} FOR SHARE`;
    const config = pat ? null : await tx.repositoryProviderConfiguration.findFirst({where:{id:row.configurationId!,organizationId:input.originalOrganizationId,provider:"gitlab",origin:value.origin}});
    if(!pat && (!config || !encrypted.safeParse(config.encryptedSecret).success))throw refuse("The original GitLab application is unavailable. No token exchange was started.");
    if(row.tokenExpiresAt.getTime()>Date.now()+30000)return {...value,config,renewal:null,claimed:false as const};
    if(!pat && !encrypted.safeParse(row.encryptedVerifier).success)throw refuse("This older grant has no saved renewal token. Authorize once more; registered repositories stay saved.");
    const renewal = pat ? null : parseRenewal(row.encryptedVerifier);
    if(renewal && renewal.redirectUri!==repositoryOAuthRedirect())throw refuse("The original GitLab callback changed. Review this saved grant before reconnecting.");
    if(!pat && !renewal)throw refuse("This older grant has no saved renewal token. Authorize once more; registered repositories stay saved.");
    await tx.repositoryConnection.update({where:{id:row.id},data:{status:"REFRESHING",catalog:Prisma.DbNull,catalogAt:null}});
    return {...value,config,renewal,claimed:true as const};
  });
  const acknowledge = (renewed:boolean) => ({projectId:input.projectId,repositoryId:input.repositoryId,connectionId:claim.row.id,
    originalOrganizationId:input.originalOrganizationId,expectedNativeActorId:actor,expectedClerkActorId:input.expectedClerkActorId,
    status:"VERIFIED" as const,accessMethod:claim.pat?"token" as const:"oauth" as const,reused:true as const,renewed});
  if(!claim.claimed)return acknowledge(false);
  const original = claim.row;
  let issued:{token:string;clientId:string;clientSecret:string}|null = null;
  try {
    let nextToken:string, expiresAt:Date, accountLabel:string, nextVerifier:Prisma.InputJsonValue;
    if(claim.pat) {
      // Revalidate the SAME ciphertext, not a newly supplied/replacement token.
      // Eight hours is a local fresh-check window, NEVER a provider TTL claim.
      nextToken = decrypt(original.encryptedToken);
      const account = z.object({id:z.number().int().positive(),username:z.string().min(1).max(200)}).parse(await repositoryProviderJson(claim.origin,"/api/v4/user",{token:nextToken}));
      const metadata = await repositoryProviderJson(claim.origin,`/api/v4/projects/${claim.repo.externalId}`,{token:nextToken});
      assertGitlabProjectIdentity({version:"connected-gitlab/v1",repositoryId:claim.repo.id,connectionId:original.id,projectId:input.projectId,organizationId:input.originalOrganizationId,actorId:actor,
        clerkSubject:input.expectedClerkActorId,origin:claim.origin,repositoryUrl:claim.repo.url,externalId:claim.repo.externalId!,
        credentialHash:createHash("sha256").update(JSON.stringify([encrypted.parse(original.encryptedToken).ciphertext,encrypted.parse(original.encryptedToken).iv,encrypted.parse(original.encryptedToken).authTag,original.tokenExpiresAt!.toISOString()])).digest("hex")},metadata);
      accountLabel=account.username; expiresAt=new Date(Date.now()+28800000); nextVerifier=tokenMarker.parse(original.encryptedVerifier);
    } else {
      if(!claim.config || !claim.renewal)throw refuse("Saved GitLab renewal information is missing.");
      const credentials={clientId:claim.config.clientId,clientSecret:decrypt(claim.config.encryptedSecret)};
      const refreshed=await refreshGitlabAuthorization({origin:claim.origin,...credentials,...claim.renewal});
      issued={...credentials,token:refreshed.token};
      nextToken=refreshed.token; expiresAt=refreshed.expiresAt; accountLabel=refreshed.accountLabel;
      nextVerifier={...encryptToken(JSON.stringify(renewalSchema.parse({version:"gitlab-refresh/v1",...refreshed.renewal})))};
    }
    await ctx.prisma.$transaction(async tx => {
      const now=await locked(tx);
      if(Date.now()-started>60000 || now.row.status!=="REFRESHING" || now.row.id!==original.id || now.repo.url!==claim.repo.url || now.repo.externalId!==claim.repo.externalId ||
        now.row.configurationId!==original.configurationId || now.row.tokenExpiresAt?.getTime()!==original.tokenExpiresAt!.getTime() || !equal(now.row.encryptedToken,original.encryptedToken) || !equal(now.row.encryptedVerifier,original.encryptedVerifier))throw new TRPCError({code:"CONFLICT"});
      if(claim.config) {
        await tx.$queryRaw`SELECT id FROM "RepositoryProviderConfiguration" WHERE id=${claim.config.id} FOR SHARE`;
        const config=await tx.repositoryProviderConfiguration.findFirst({where:{id:claim.config.id,organizationId:input.originalOrganizationId,provider:"gitlab",origin:claim.origin}});
        if(!config || config.clientId!==claim.config.clientId || !equal(config.encryptedSecret,claim.config.encryptedSecret))throw new TRPCError({code:"CONFLICT"});
      }
      await tx.repositoryConnection.update({where:{id:original.id},data:{status:"VERIFIED",encryptedToken:claim.pat?original.encryptedToken as Prisma.InputJsonValue:{...encryptToken(nextToken)},encryptedVerifier:nextVerifier,
        tokenExpiresAt:expiresAt,accountLabel,verifiedAt:new Date()}});
    });
    return acknowledge(true);
  } catch(error) {
    let unrevoked = error instanceof GitlabOAuthRevocationPendingError ? error.token : null;
    if(issued)try{await revokeGitlabAuthorization({origin:claim.origin,...issued});}catch{unrevoked=issued.token;}
    // Quarantine only the original claimed row; never overwrite a replacement
    // credential/scope after concurrent loss. Never delete repo registrations.
    await ctx.prisma.repositoryConnection.updateMany({where:{id:original.id,status:"REFRESHING",projectId:input.projectId,organizationId:input.originalOrganizationId,actorId:actor,provider:"gitlab",origin:claim.origin,
      configurationId:original.configurationId,tokenExpiresAt:original.tokenExpiresAt,encryptedToken:{equals:original.encryptedToken as Prisma.InputJsonValue},encryptedVerifier:{equals:original.encryptedVerifier as Prisma.InputJsonValue}},
      data:unrevoked?{status:"REVOCATION_PENDING",encryptedToken:{...encryptToken(unrevoked)},encryptedVerifier:Prisma.DbNull,tokenExpiresAt:null,verifiedAt:null}
        :issued?{status:"FAILED",encryptedToken:Prisma.DbNull,encryptedVerifier:Prisma.DbNull,tokenExpiresAt:null,verifiedAt:null}
        :{status:"REFRESH_UNKNOWN"}});
    throw refuse("Saved GitLab access could not be confirmed. Its original outcome is retained; no automatic retry or reconnect was sent.");
  }
}
