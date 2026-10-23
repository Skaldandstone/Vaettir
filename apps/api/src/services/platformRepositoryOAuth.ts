import {z} from "zod";
import {githubRepositoryAppSecretSchema,githubRepositoryAppInstallationUrl} from "./githubAppRepositoryConnection.js";

const credentialCharacters=(value:string)=>!Array.from(value).some(character=>/\s/.test(character)||character.charCodeAt(0)<32||character.charCodeAt(0)===127);
const credentials=z.object({
  clientId:z.string().min(1).max(300).refine(credentialCharacters),
  clientSecret:z.string().min(1).max(2000).refine(credentialCharacters),
});
const hosted={
  gitlab:{id:"platform:gitlab",origin:"https://gitlab.com",clientId:"GITLAB_OAUTH_CLIENT_ID",clientSecret:"GITLAB_OAUTH_CLIENT_SECRET"},
  github:{id:"platform:github",origin:"https://github.com",clientId:"GITHUB_OAUTH_CLIENT_ID",clientSecret:"GITHUB_OAUTH_CLIENT_SECRET"},
} as const;
export type HostedOAuthProvider=keyof typeof hosted;

/** Server-only credentials. Never include this result in a public response. */
export function platformRepositoryApplication(provider:HostedOAuthProvider,env:NodeJS.ProcessEnv=process.env){
  const descriptor=hosted[provider];
  const parsed=credentials.safeParse({clientId:env[descriptor.clientId],clientSecret:env[descriptor.clientSecret]});
  return parsed.success?{provider,origin:descriptor.origin,...parsed.data}:null;
}
export function platformRepositoryProvider(id:string):HostedOAuthProvider|null{
  return id==="platform:gitlab"?"gitlab":id==="platform:github"?"github":null;
}
/** Separate from the broader PR-webhook App and legacy repo-scope OAuth App.
 * Explicit platform configuration only; never create credentials or apps here. */
export function platformGithubRepositoryApp(env:NodeJS.ProcessEnv=process.env){
  const pair=credentials.safeParse({clientId:env.GITHUB_REPOSITORY_APP_CLIENT_ID,clientSecret:env.GITHUB_REPOSITORY_APP_CLIENT_SECRET});
  if(!pair.success)return null;
  const secret=githubRepositoryAppSecretSchema.safeParse({kind:"github-app/v1",clientSecret:pair.data.clientSecret,appId:env.GITHUB_REPOSITORY_APP_ID,slug:env.GITHUB_REPOSITORY_APP_SLUG});
  return secret.success?{provider:"github-app" as const,origin:"https://github.com",clientId:pair.data.clientId,clientSecret:JSON.stringify(secret.data),installationUrl:githubRepositoryAppInstallationUrl(secret.data)}:null;
}
export function publicGithubAppConfiguration(configuration:{id:string;provider:string;origin:string},secret:unknown){
  const app=githubRepositoryAppSecretSchema.parse(secret);
  return{id:configuration.id,provider:"github",origin:configuration.origin,authorizationKind:"github-app" as const,installationUrl:githubRepositoryAppInstallationUrl(app)};
}
/** Read-only, credential-free availability. No snapshot or provider calls. */
export function availablePlatformRepositoryConfigurations(existing:readonly {provider:string;origin:string}[],ready:boolean,env:NodeJS.ProcessEnv=process.env){
  if(!ready)return[];
  const oauth=(Object.keys(hosted) as HostedOAuthProvider[]).flatMap(provider=>{
    const descriptor=hosted[provider];
    if(existing.some(row=>row.provider===provider&&row.origin===descriptor.origin)||!platformRepositoryApplication(provider,env))return[];
    return[{id:descriptor.id,provider,origin:descriptor.origin}];
  });
  const app=platformGithubRepositoryApp(env);
  return[...(app&&!existing.some(row=>row.provider==="github-app"&&row.origin===app.origin)?[{id:"platform:github-app",provider:"github",origin:app.origin,authorizationKind:"github-app" as const,installationUrl:app.installationUrl}]:[]),...oauth];
}
