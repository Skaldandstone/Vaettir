import {z} from "zod";

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
/** Read-only, credential-free availability. No snapshot or provider calls. */
export function availablePlatformRepositoryConfigurations(existing:readonly {provider:string;origin:string}[],ready:boolean,env:NodeJS.ProcessEnv=process.env){
  if(!ready)return[];
  return(Object.keys(hosted) as HostedOAuthProvider[]).flatMap(provider=>{
    const descriptor=hosted[provider];
    if(existing.some(row=>row.provider===provider&&row.origin===descriptor.origin)||!platformRepositoryApplication(provider,env))return[];
    return[{id:descriptor.id,provider,origin:descriptor.origin}];
  });
}
