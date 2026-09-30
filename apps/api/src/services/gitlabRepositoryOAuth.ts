import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { repositoryProviderJson, repositoryProviderOrigin, repositoryProviderRevokeGitlabToken } from "./repositoryProviderHttp.js";

export const repositorySelectionSchema=z.object({id:z.string().max(100),name:z.string().max(500),url:z.string().max(1000),defaultBranch:z.string().max(200).nullable()});
export type RepositorySelection=z.infer<typeof repositorySelectionSchema>;
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
export async function listGitlabRepositories(origin:string,token:string,page:number,search:string):Promise<RepositorySelection[]> {
  const params=new URLSearchParams({membership:"true",simple:"true",per_page:"100",page:String(page),order_by:"path",sort:"asc",...(search?{search}:{})});
  const rows=z.array(z.object({id:z.number().int().positive(),path_with_namespace:z.string().max(500),web_url:z.string().url().max(1000),default_branch:z.string().max(200).nullable().optional()})).max(100).parse(await repositoryProviderJson(origin,`/api/v4/projects?${params}`,{token}));
  return rows.map(row=>{
    const url=new URL(row.web_url);
    if(url.origin!==origin || url.username || url.password || url.hash || url.search) throw new Error("Provider returned a repository outside this instance");
    return{id:String(row.id),name:row.path_with_namespace,url:url.href,defaultBranch:row.default_branch??null};
  });
}
