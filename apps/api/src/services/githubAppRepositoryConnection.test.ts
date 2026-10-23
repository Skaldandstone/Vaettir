import {beforeEach,describe,expect,it,vi} from "vitest";
import {repositoryProviderJson,repositoryProviderRevokeGithubToken} from "./repositoryProviderHttp.js";
import {createGithubAppRepositoryAuthorization,verifyGithubAppRepositoryAuthorization,listGithubAppInstallations,listGithubAppInstallationRepositories,githubRepositoryAppInstallationUrl} from "./githubAppRepositoryConnection.js";
import {GithubOAuthRevocationPendingError} from "./githubRepositoryOAuth.js";
import {availablePlatformRepositoryConfigurations,platformGithubRepositoryApp} from "./platformRepositoryOAuth.js";
vi.mock("./repositoryProviderHttp.js",async original=>({...await original<typeof import("./repositoryProviderHttp.js")>(),repositoryProviderJson:vi.fn(),repositoryProviderRevokeGithubToken:vi.fn()}));
const app={kind:"github-app/v1" as const,appId:"71",slug:"synthetic-vaettir",clientSecret:"synthetic-secret"};
const installation={id:41,app_id:71,app_slug:app.slug,account:{login:"synthetic-team"},repository_selection:"selected",permissions:{metadata:"read",contents:"read"},suspended_at:null};
const installations={total_count:1,installations:[installation]};
const repo={id:91,full_name:"synthetic-team/service",html_url:"https://github.com/synthetic-team/service",default_branch:"main"};
const verification={clientId:"synthetic-client",clientSecret:app.clientSecret,redirectUri:"https://app.synthetic.example/connections/github/callback",code:"synthetic-code",verifier:"synthetic-verifier"};
beforeEach(()=>vi.resetAllMocks());
describe("GitHub App-backed installed repository metadata",()=>{
  it("uses App user authorization with PKCE and random state, never broad repo OAuth scope",()=>{
    const first=createGithubAppRepositoryAuthorization(verification.clientId,verification.redirectUri),second=createGithubAppRepositoryAuthorization(verification.clientId,verification.redirectUri);
    const url=new URL(first.url);expect(url.origin).toBe("https://github.com");expect(url.searchParams.has("scope")).toBe(false);expect(url.searchParams.get("code_challenge_method")).toBe("S256");expect(first.state).not.toBe(second.state);
  });
  it("accepts App user tokens with empty scope and bounds retention without refresh issuance",async()=>{
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({access_token:"ghu_synthetic",token_type:"bearer",scope:"",expires_in:28800,refresh_token:"synthetic-not-retained"}).mockResolvedValueOnce({id:5,login:"synthetic-user"});
    const verified=await verifyGithubAppRepositoryAuthorization(verification);expect(verified.token).toBe("ghu_synthetic");expect(verified.expiresAt.getTime()).toBeLessThanOrEqual(Date.now()+28800000);expect(JSON.stringify(verified)).not.toContain("refresh");expect(repositoryProviderJson).toHaveBeenCalledTimes(2);
  });
  it.each([{access_token:"gho_legacy",scope:""},{access_token:"ghu_synthetic",scope:"repo"}])("refuses broad/legacy token responses and confirms revocation",async bad=>{
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({...bad,token_type:"bearer"});await expect(verifyGithubAppRepositoryAuthorization(verification)).rejects.toThrow();expect(repositoryProviderRevokeGithubToken).toHaveBeenCalledWith(verification.clientId,app.clientSecret,bad.access_token);
  });
  it("retains hidden token recovery evidence if revocation of a failed App grant is uncertain",async()=>{
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({access_token:"ghu_synthetic",token_type:"bearer",scope:"repo"});vi.mocked(repositoryProviderRevokeGithubToken).mockRejectedValueOnce(Error("synthetic"));
    const error=await verifyGithubAppRepositoryAuthorization(verification).catch(error=>error);expect(error).toBeInstanceOf(GithubOAuthRevocationPendingError);expect(error.token).toBe("ghu_synthetic");expect(JSON.stringify(error)).not.toContain("ghu_synthetic");
  });
  it("lists only this App's read-only active installations and reports exact page hints",async()=>{
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce(installations);await expect(listGithubAppInstallations("ghu_synthetic",app,2)).resolves.toEqual({installations:[{id:"41",accountLabel:"synthetic-team",repositorySelection:"selected",page:2}],hasMore:false,limitReached:false});expect(repositoryProviderJson).toHaveBeenCalledWith("https://api.github.com","/user/installations?per_page=100&page=2",{token:"ghu_synthetic"});
  });
  it.each([{app_id:72},{app_slug:"other-app"},{suspended_at:"2026-01-01"},{permissions:{metadata:"read",contents:"write"}},{permissions:{contents:"read"}}])("rejects foreign, suspended or write-enabled installations",async bad=>{
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({total_count:1,installations:[{...installation,...bad}]});await expect(listGithubAppInstallations("ghu_synthetic",app,1)).rejects.toThrow();
  });
  it("rechecks the selected installation page, then reads only its installed repository metadata",async()=>{
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce(installations).mockResolvedValueOnce({total_count:1,repositories:[repo]});
    await expect(listGithubAppInstallationRepositories("ghu_synthetic",app,"41",3,2)).resolves.toEqual({repositories:[{id:"91",name:repo.full_name,url:repo.html_url,defaultBranch:"main",scopeKey:'["github-installation/v1","41"]'}],hasMore:false,limitReached:false,scopeKey:'["github-installation/v1","41"]'});
    expect(repositoryProviderJson).toHaveBeenNthCalledWith(1,"https://api.github.com","/user/installations?per_page=100&page=2",{token:"ghu_synthetic"});expect(repositoryProviderJson).toHaveBeenNthCalledWith(2,"https://api.github.com","/user/installations/41/repositories?per_page=100&page=3",{token:"ghu_synthetic"});
  });
  it("does not read repositories for an unverified or reordered installation",async()=>{
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({total_count:0,installations:[]});await expect(listGithubAppInstallationRepositories("ghu_synthetic",app,"41",1)).rejects.toThrow("Refresh");expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
  });
  it.each(["https://other.example/service","https://secret@github.com/synthetic-team/service","https://github.com/synthetic-team/service?token=bad"]) ("refuses cross-origin or credential-bearing repo URLs",async html_url=>{
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce(installations).mockResolvedValueOnce({total_count:1,repositories:[{...repo,html_url}]});await expect(listGithubAppInstallationRepositories("ghu_synthetic",app,"41",1)).rejects.toThrow("identity");
  });
  it("refuses repositories outside the verified installed account and duplicate native IDs",async()=>{
    for(const repositories of [[{...repo,full_name:"other/service",html_url:"https://github.com/other/service"}],[repo,repo]]){
      vi.mocked(repositoryProviderJson).mockResolvedValueOnce(installations).mockResolvedValueOnce({total_count:repositories.length,repositories});await expect(listGithubAppInstallationRepositories("ghu_synthetic",app,"41",1)).rejects.toThrow("identity");
    }
  });
  it("reports bounded truncation instead of falsely complete listings",async()=>{
    const hundred=Array.from({length:100},(_,n)=>({...installation,id:n+1}));vi.mocked(repositoryProviderJson).mockResolvedValueOnce({total_count:20000,installations:hundred});const result=await listGithubAppInstallations("ghu_synthetic",app,100);expect(result).toMatchObject({hasMore:false,limitReached:true});
  });
  it.each(["0","-1","41/path","9007199254740992"])("refuses unsafe installation ID %s before any provider request",async id=>{
    await expect(listGithubAppInstallationRepositories("ghu_synthetic",app,id,1)).rejects.toThrow();expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("requires complete, distinct App configuration and exposes no keys or secrets",()=>{
    const env={GITHUB_REPOSITORY_APP_CLIENT_ID:verification.clientId,GITHUB_REPOSITORY_APP_CLIENT_SECRET:app.clientSecret,GITHUB_REPOSITORY_APP_ID:app.appId,GITHUB_REPOSITORY_APP_SLUG:app.slug};
    expect(platformGithubRepositoryApp({...env,GITHUB_REPOSITORY_APP_CLIENT_SECRET:undefined})).toBeNull();expect(platformGithubRepositoryApp({...env,GITHUB_REPOSITORY_APP_SLUG:"bad/path"})).toBeNull();
    const publicRows=availablePlatformRepositoryConfigurations([],true,env);expect(publicRows).toEqual([{id:"platform:github-app",provider:"github",origin:"https://github.com",authorizationKind:"github-app",installationUrl:githubRepositoryAppInstallationUrl(app)}]);expect(JSON.stringify(publicRows)).not.toContain(app.clientSecret);expect(JSON.stringify(publicRows)).not.toContain(verification.clientId);
    expect(availablePlatformRepositoryConfigurations([{provider:"github-app",origin:"https://github.com"}],true,env)).toEqual([]);
  });
});
