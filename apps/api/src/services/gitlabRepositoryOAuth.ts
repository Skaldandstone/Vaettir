import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { repositoryProviderJson, repositoryProviderOrigin, repositoryProviderRevokeGitlabToken } from "./repositoryProviderHttp.js";

export const repositorySelectionSchema=z.object({id:z.string().max(100),name:z.string().max(500),url:z.string().max(1000),defaultBranch:z.string().max(200).nullable(),projectId:z.string().max(100).optional(),projectName:z.string().max(200).optional(),scopeKey:z.string().max(700).optional()});
export const gitlabRepositoryScopeSchema=z.object({groupPath:z.string().trim().min(1).max(400).regex(/^[A-Za-z0-9_][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/),includeSubgroups:z.boolean().default(true),includeShared:z.boolean().default(false)}).strict();
export type GitlabRepositoryScope=z.infer<typeof gitlabRepositoryScopeSchema>;
export type RepositorySelection=z.infer<typeof repositorySelectionSchema>;
export async function listGitlabGroups(origin:string,token:string,page:number,search:string){
  origin=repositoryProviderOrigin(origin);z.number().int().min(1).max(100).parse(page);z.string().max(100).parse(search);
  const params=new URLSearchParams({all_available:"false",per_page:"100",page:String(page),order_by:"path",sort:"asc",...(search?{search}:{})});
  const groups=z.array(z.object({id:z.number().int().positive(),full_path:gitlabRepositoryScopeSchema.shape.groupPath,name:z.string().min(1).max(200)})).max(100).parse(await repositoryProviderJson(origin,`/api/v4/groups?${params}`,{token}));
  if(new Set(groups.map(group=>group.id)).size!==groups.length)throw new Error("GitLab returned duplicate group identities.");
  return groups.map(group=>({id:String(group.id),path:group.full_path,name:group.name}));
}
export const hashOAuthState=(state:string)=>createHash("sha256").update(state).digest("hex");
/** The router must retain this issued token if upstream revocation cannot be confirmed. */
export class GitlabOAuthRevocationPendingError extends Error {
  declare readonly token: string;

  constructor(token: string) {
    super("GitLab issued a token that could not be verified or revoked.");
    this.name = "GitlabOAuthRevocationPendingError";
    Object.defineProperty(this, "token", { value: token, enumerable: false, writable: false });
  }
}

export async function revokeGitlabAuthorization(input:{origin:string;clientId:string;clientSecret:string;token:string}):Promise<void> {
  await repositoryProviderRevokeGitlabToken(input.origin,input.clientId,input.clientSecret,input.token);
}
export function repositoryOAuthRedirect(env:NodeJS.ProcessEnv=process.env, provider:"gitlab"|"github"="gitlab") {
  if (!env.WEB_APP_URL) throw new Error("Web application URL is not configured");
  return `${repositoryProviderOrigin(env.WEB_APP_URL)}/connections/${provider}/callback`;
}
export function createGitlabAuthorization(origin:string,clientId:string,redirectUri:string) {
  const state=randomBytes(32).toString("base64url");
  const verifier=randomBytes(48).toString("base64url");
  const url=new URL("/oauth/authorize",repositoryProviderOrigin(origin));
  url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:"code",scope:"read_api",state,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256"}).toString();
  return {state,verifier,url:url.href};
}
/** PATs use the same Bearer transport; this verifies metadata access, not token scope. */
export async function verifyGitlabAccessToken(input:{origin:string;token:string}) {
  const origin=repositoryProviderOrigin(input.origin);
  if(!input.token || input.token.length>10000 || /[^\x21-\x7e]/.test(input.token))
    throw new Error("Enter a valid GitLab access token for the selected instance.");
  try {
    const account=z.object({id:z.number().int().positive(),username:z.string().min(1).max(200)}).parse(await repositoryProviderJson(origin,"/api/v4/user",{token:input.token}));
    return {accountLabel:account.username};
  } catch {
    throw new Error("GitLab account access could not be verified for this instance.");
  }
}
export async function verifyGitlabAuthorization(input:{origin:string;clientId:string;clientSecret:string;redirectUri:string;code:string;verifier:string}) {
  const response=await repositoryProviderJson(input.origin,"/oauth/token",{form:new URLSearchParams({client_id:input.clientId,client_secret:input.clientSecret,redirect_uri:input.redirectUri,code:input.code,code_verifier:input.verifier,grant_type:"authorization_code"})});
  const issued=z.object({access_token:z.string().min(1).max(10000)}).parse(response);
  try {
    const result=z.object({access_token:z.string().min(1).max(10000),token_type:z.string().refine(value=>value.toLowerCase()==="bearer"),expires_in:z.number().positive().max(86400),scope:z.string()}).parse(response);
    if(!result.scope.split(/\s+/).includes("read_api")) throw new Error("Read API permission was not granted");
    const account=z.object({id:z.number().int().positive(),username:z.string().min(1).max(200)}).parse(await repositoryProviderJson(input.origin,"/api/v4/user",{token:result.access_token}));
    return {token:result.access_token,expiresAt:new Date(Date.now()+result.expires_in*1000),accountLabel:account.username};
  } catch(error) {
    try { await revokeGitlabAuthorization({origin:input.origin,clientId:input.clientId,clientSecret:input.clientSecret,token:issued.access_token}); }
    catch { throw new GitlabOAuthRevocationPendingError(issued.access_token); }
    throw error;
  }
}
export async function listGitlabRepositories(origin:string,token:string,page:number,search:string,scope?:GitlabRepositoryScope,onVerifiedGroup?:(id:number)=>void):Promise<RepositorySelection[]> {
  origin=repositoryProviderOrigin(origin);
  z.number().int().min(1).max(100).parse(page);z.string().max(100).parse(search);
  const scoped=scope?gitlabRepositoryScopeSchema.parse(scope):null;
  let endpoint="/api/v4/projects";
  if(scoped){
    const group=z.object({id:z.number().int().positive(),full_path:z.string().min(1).max(400)}).parse(await repositoryProviderJson(origin,`/api/v4/groups/${encodeURIComponent(scoped.groupPath)}`,{token}));
    if(group.full_path!==scoped.groupPath)throw new Error("The selected GitLab group changed identity. Review its current path.");
    onVerifiedGroup?.(group.id);
    endpoint=`/api/v4/groups/${group.id}/projects`;
  }
  const params=new URLSearchParams({...(scoped?{include_subgroups:String(scoped.includeSubgroups),with_shared:String(scoped.includeShared)}:{membership:"true"}),simple:"true",per_page:"100",page:String(page),order_by:"path",sort:"asc",...(search?{search}:{})});
  const rows=z.array(z.object({id:z.number().int().positive(),path_with_namespace:z.string().min(1).max(500),web_url:z.string().url().max(1000),default_branch:z.string().max(200).nullable().optional()})).max(100).parse(await repositoryProviderJson(origin,`${endpoint}?${params}`,{token}));
  if(new Set(rows.map(row=>row.id)).size!==rows.length)throw new Error("GitLab returned duplicate repository identities.");
  return rows.map(row=>{
    const url=new URL(row.web_url);
    if(url.origin!==origin || url.username || url.password || url.hash || url.search) throw new Error("Provider returned a repository outside this instance");
    const namespace=row.path_with_namespace.slice(0,row.path_with_namespace.lastIndexOf("/"));
    if(scoped&&!scoped.includeShared&&!(namespace===scoped.groupPath||scoped.includeSubgroups&&namespace.startsWith(scoped.groupPath+"/")))throw new Error("GitLab returned a repository outside the selected group.");
    return{id:String(row.id),name:row.path_with_namespace,url:url.href,defaultBranch:row.default_branch??null};
  });
}
