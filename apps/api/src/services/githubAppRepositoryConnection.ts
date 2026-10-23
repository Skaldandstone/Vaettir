import {z} from "zod";
import {repositoryProviderJson} from "./repositoryProviderHttp.js";
import {createGithubAuthorization, verifyGithubAuthorization} from "./githubRepositoryOAuth.js";
import {repositorySelectionSchema} from "./gitlabRepositoryOAuth.js";

const nativeId=z.string().regex(/^[1-9][0-9]{0,15}$/).refine(value=>Number.isSafeInteger(Number(value)));
export const githubRepositoryAppSecretSchema=z.object({
  kind:z.literal("github-app/v1"),clientSecret:z.string().min(1).max(2000),
  appId:nativeId,slug:z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
}).strict();
export type GithubRepositoryAppSecret=z.infer<typeof githubRepositoryAppSecretSchema>;
export const githubInstallationIdSchema=nativeId;
const api="https://api.github.com";
const installationSchema=z.object({
  id:z.number().int().positive().safe(),app_id:z.number().int().positive().safe(),
  app_slug:z.string(),account:z.object({login:z.string().min(1).max(200)}),
  repository_selection:z.enum(["all","selected"]),
  permissions:z.record(z.string()),suspended_at:z.string().nullable(),
});
function requireReadOnlyInstallation(row:z.infer<typeof installationSchema>,app:GithubRepositoryAppSecret){
  if(String(row.app_id)!==app.appId||row.app_slug!==app.slug||row.suspended_at!==null||
    row.permissions.metadata!=="read"||Object.values(row.permissions).some(permission=>permission!=="read"))
    throw Error("The selected GitHub App installation is not an active read-only installation of this application.");
}
export function githubRepositoryAppInstallationUrl(app:GithubRepositoryAppSecret){
  const checked=githubRepositoryAppSecretSchema.parse(app);
  return `https://github.com/apps/${checked.slug}/installations/new`;
}
export function createGithubAppRepositoryAuthorization(clientId:string,redirectUri:string){
  return createGithubAuthorization(clientId,redirectUri,"github-app");
}
export async function verifyGithubAppRepositoryAuthorization(input:Parameters<typeof verifyGithubAuthorization>[0]){
  return verifyGithubAuthorization({...input,authorizationKind:"github-app"});
}
/** Metadata intersection of the authorized user and this exact installed App.
 * No App JWT, installation-token issuance, source contents or writes occur. */
export async function listGithubAppInstallations(token:string,app:GithubRepositoryAppSecret,page:number,search=""){
  githubRepositoryAppSecretSchema.parse(app);z.number().int().min(1).max(100).parse(page);
  const result=z.object({total_count:z.number().int().nonnegative().safe(),installations:z.array(installationSchema).max(100)})
    .parse(await repositoryProviderJson(api,`/user/installations?per_page=100&page=${page}`,{token}));
  const seen=new Set<number>();
  const installations=result.installations.flatMap(row=>{
    if(seen.has(row.id))throw Error("Duplicate GitHub installation identity");seen.add(row.id);
    requireReadOnlyInstallation(row,app);
    return row.account.login.toLowerCase().includes(search.toLowerCase())?
      [{id:String(row.id),accountLabel:row.account.login,repositorySelection:row.repository_selection,page}]:[];
  });
  const more=result.installations.length===100;
  return{installations,hasMore:more&&page<100,limitReached:more&&page===100};
}
export async function listGithubAppInstallationRepositories(token:string,app:GithubRepositoryAppSecret,installationId:string,page:number,installationPage=1){
  const id=githubInstallationIdSchema.parse(installationId);z.number().int().min(1).max(100).parse(page);
  // A manually submitted id is never treated as an authorized installation.
  // Re-read the page of installation metadata the user explicitly chose. There
  // is no GET /user/installations/:id endpoint and no unbounded page traversal.
  const installations=await listGithubAppInstallations(token,app,installationPage);
  const installed=installations.installations.find(installation=>installation.id===id);
  if(!installed)throw Error("Refresh GitHub installation access before browsing this account");
  const result=z.object({total_count:z.number().int().nonnegative().safe(),repositories:z.array(z.object({
    id:z.number().int().positive().safe(),full_name:z.string().min(1).max(500),html_url:z.string().url().max(1000),default_branch:z.string().max(200).nullable().optional(),
  })).max(100)}).parse(await repositoryProviderJson(api,`/user/installations/${id}/repositories?per_page=100&page=${page}`,{token}));
  const scopeKey=JSON.stringify(["github-installation/v1",id]);const seen=new Set<number>();
  const repositories=result.repositories.map(row=>{
    const url=new URL(row.html_url);
    if(seen.has(row.id)||row.full_name.split("/").length!==2||row.full_name.split("/")[0]!.toLowerCase()!==installed.accountLabel.toLowerCase()||url.origin!=="https://github.com"||url.username||url.password||url.search||url.hash||url.pathname.toLowerCase()!==`/${row.full_name}`.toLowerCase())throw Error("Invalid installed repository identity");
    seen.add(row.id);
    return repositorySelectionSchema.parse({id:String(row.id),name:row.full_name,url:url.href,defaultBranch:row.default_branch??null,scopeKey});
  });
  const more=result.repositories.length===100;
  return{repositories,hasMore:more&&page<100,limitReached:more&&page===100,scopeKey};
}
