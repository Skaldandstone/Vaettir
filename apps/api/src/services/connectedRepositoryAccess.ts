import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@vaettir/db";
import { repositoryProviderOrigin } from "./repositoryProviderHttp.js";
import { decryptToken } from "./tokenEncryption.js";

const encrypted = z.object({ciphertext:z.string(),iv:z.string(),authTag:z.string()});
export const connectedSourceBindingSchema = z.object({
  version:z.literal("connected-gitlab/v1"), repositoryId:z.string(), connectionId:z.string(),
  projectId:z.string(), organizationId:z.string(), actorId:z.string(), clerkSubject:z.string().min(1),
  origin:z.string(), repositoryUrl:z.string(), externalId:z.string().max(100).regex(/^[1-9][0-9]*$/), credentialHash:z.string().length(64),
}).strict();
export type ConnectedSourceBinding = z.infer<typeof connectedSourceBindingSchema>;

export function connectedSourceBinding(results:unknown):ConnectedSourceBinding|null {
  if (!results || typeof results!=="object" || !Object.hasOwn(results,"sourceBinding")) return null;
  return connectedSourceBindingSchema.parse((results as {sourceBinding:unknown}).sourceBinding);
}
export function sourceBindingReceipt(results:unknown) {
  const binding=connectedSourceBinding(results);
  return binding ? {sourceBinding:binding} : {};
}

/** Caller holds current organization/member/project admission locks. Take
 * connection before repository locks, matching connection writers. No token
 * is returned to the client, put in URLs, stored in receipts or logged. */
export async function admitConnectedGitlab(tx:Prisma.TransactionClient, input:{
  projectId:string;organizationId:string;actorId:string;clerkSubject:string;repositoryId:string;
}, expected?:ConnectedSourceBinding) {
  const first=await tx.projectRepository.findFirst({where:{id:input.repositoryId,projectId:input.projectId}});
  if(!first?.connectionId)throw new TRPCError({code:"PRECONDITION_FAILED",message:"This repository needs verified GitLab access."});
  await tx.$queryRaw`SELECT id FROM "RepositoryConnection" WHERE id=${first.connectionId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "ProjectRepository" WHERE id=${first.id} FOR SHARE`;
  const repo=await tx.projectRepository.findFirst({where:{id:first.id,projectId:input.projectId},include:{connection:true}});
  const connection=repo?.connection;
  const actor=await tx.user.findUnique({where:{id:input.actorId},select:{clerkUserId:true}});
  if(!repo || !connection || repo.connectionId!==first.connectionId || repo.provider!=="gitlab" || connection.provider!=="gitlab" ||
    connection.projectId!==input.projectId || connection.organizationId!==input.organizationId || connection.actorId!==input.actorId ||
    actor?.clerkUserId!==input.clerkSubject || connection.status!=="VERIFIED" || !connection.verifiedAt ||
    !connection.tokenExpiresAt || connection.tokenExpiresAt.getTime()<=Date.now()+30000 || !repo.externalId)
    throw new TRPCError({code:"FORBIDDEN",message:"Current access to this repository is unavailable. Restore the original account or renew its connection."});
  const url=new URL(repo.url);
  const origin=repositoryProviderOrigin(connection.origin);
  if(url.origin!==origin || url.username || url.password || url.search || url.hash || url.pathname==="/" || url.port)
    throw new TRPCError({code:"PRECONDITION_FAILED",message:"The registered repository does not match its GitLab instance."});
  const secret=encrypted.parse(connection.encryptedToken);
  const marker=z.object({accessMethod:z.literal("gitlab-token/v1"),requestHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(connection.encryptedVerifier);
  if(marker.success?connection.configurationId!==null:!connection.configurationId||Boolean(connection.encryptedVerifier&&typeof connection.encryptedVerifier==="object"&&Object.hasOwn(connection.encryptedVerifier,"accessMethod")))
    throw new TRPCError({code:"PRECONDITION_FAILED",message:"This GitLab access method could not be verified."});
  const binding=connectedSourceBindingSchema.parse({version:"connected-gitlab/v1",repositoryId:repo.id,connectionId:connection.id,
    projectId:input.projectId,organizationId:input.organizationId,actorId:input.actorId,clerkSubject:input.clerkSubject,
    origin,repositoryUrl:repo.url,externalId:repo.externalId,
    credentialHash:createHash("sha256").update(JSON.stringify([secret.ciphertext,secret.iv,secret.authTag,connection.tokenExpiresAt.toISOString()])).digest("hex")});
  if(expected && JSON.stringify(binding)!==JSON.stringify(connectedSourceBindingSchema.parse(expected)))
    throw new TRPCError({code:"CONFLICT",message:"The repository connection changed. Review and approve its current scope again."});
  return {binding, token:()=>decryptToken(secret)};
}

export function assertGitlabProjectIdentity(binding:ConnectedSourceBinding,value:unknown) {
  const project=z.object({id:z.number().int().positive(),web_url:z.string().url(),path_with_namespace:z.string().min(1).max(500)}).parse(value);
  const url=new URL(project.web_url);
  if(String(project.id)!==binding.externalId || url.href.replace(/\/$/,"")!==binding.repositoryUrl.replace(/\/$/,"") ||
    url.origin!==binding.origin || url.username || url.password || url.search || url.hash ||
    decodeURIComponent(url.pathname).replace(/^\/|\/$/g,"")!==project.path_with_namespace)
    throw new TRPCError({code:"CONFLICT",message:"GitLab repository identity or path changed. Review the project connection before reading."});
}
