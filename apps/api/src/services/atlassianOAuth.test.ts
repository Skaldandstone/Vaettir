import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("./repositoryProviderHttp.js",()=>({repositoryProviderJson:vi.fn(),atlassianProviderToken:vi.fn(),atlassianProviderPrivacy:vi.fn(),repositoryProviderOrigin:(raw:string)=>{const u=new URL(raw);if(u.protocol!=="https:"||u.username||u.password||u.pathname!=="/"||u.search||u.hash||u.port)throw Error("origin");return u.origin;}}));
import {atlassianProviderToken,atlassianProviderPrivacy,repositoryProviderJson} from "./repositoryProviderHttp.js";
import {ATLASSIAN_READ_SCOPES,atlassianApplication,createAtlassianAuthorization,exchangeAtlassianCode,listAtlassianResources,listAtlassianSites,refreshAtlassianToken,verifyAtlassianToken,reportAtlassianPrivacy} from "./atlassianOAuth.js";
const app={clientId:"synthetic-client",clientSecret:"synthetic-secret",redirectUri:"https://app.vaettir.example/connections/atlassian/callback"};
const site={id:"8594f221-9797-5f78-1fa4-485e198d7cd0",name:"Synthetic site",url:"https://synthetic.atlassian.net",products:["jira","confluence"] as ("jira"|"confluence")[]};
const issued={access_token:"synthetic-access",refresh_token:"synthetic-refresh",expires_in:3600,token_type:"Bearer"};
beforeEach(()=>vi.resetAllMocks());
describe("Atlassian OAuth protocol",()=>{
 it("accepts only privacy decisions for the exact reported account",async()=>{
  const at=new Date();vi.mocked(atlassianProviderPrivacy).mockResolvedValue({body:{accounts:[]},cycleDays:7});await expect(reportAtlassianPrivacy("synthetic-access","synthetic-account",at)).resolves.toEqual({decision:"clear",cycleDays:7});
  for(const status of ["closed","updated"] as const){vi.mocked(atlassianProviderPrivacy).mockResolvedValue({body:{accounts:[{accountId:"synthetic-account",status}]},cycleDays:7});await expect(reportAtlassianPrivacy("synthetic-access","synthetic-account",at)).resolves.toEqual({decision:status,cycleDays:7});}
  for(const accounts of [[{accountId:"foreign",status:"closed"}],[{accountId:"synthetic-account",status:"unknown"}],[{accountId:"synthetic-account",status:"closed"},{accountId:"synthetic-account",status:"updated"}]]){vi.mocked(atlassianProviderPrivacy).mockResolvedValue({body:{accounts},cycleDays:7});await expect(reportAtlassianPrivacy("synthetic-access","synthetic-account",at)).rejects.toThrow();}
 });
 it("requires dedicated configured callback and never reuses legacy domain configuration",()=>{
  expect(atlassianApplication({WEB_APP_URL:"https://legacy.example",ATLASSIAN_OAUTH_CLIENT_ID:app.clientId,ATLASSIAN_OAUTH_CLIENT_SECRET:app.clientSecret})).toBeNull();
  expect(atlassianApplication({ATLASSIAN_OAUTH_PUBLIC_URL:"https://app.vaettir.example",ATLASSIAN_OAUTH_CLIENT_ID:app.clientId,ATLASSIAN_OAUTH_CLIENT_SECRET:app.clientSecret})).toEqual(app);
 });
 it.each(["http://app.vaettir.example","https://user:secret@app.vaettir.example","https://app.vaettir.example/wrong","https://app.vaettir.example?redirect=evil"])("refuses unsafe callback origin %s",origin=>expect(atlassianApplication({ATLASSIAN_OAUTH_PUBLIC_URL:origin,ATLASSIAN_OAUTH_CLIENT_ID:app.clientId,ATLASSIAN_OAUTH_CLIENT_SECRET:app.clientSecret})).toBeNull());
 it("issues unpredictable state and fixed read-only scope union without secret leakage",()=>{
  const a=createAtlassianAuthorization(app),b=createAtlassianAuthorization(app),url=new URL(a.url);
  expect(a.state).not.toBe(b.state);expect(a.state).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(url.origin).toBe("https://auth.atlassian.com");expect(url.searchParams.get("scope")).toBe(ATLASSIAN_READ_SCOPES.join(" "));expect(url.searchParams.get("scope")?.split(" ")).toContain("report:personal-data");expect(a.url).not.toContain(app.clientSecret);expect(ATLASSIAN_READ_SCOPES.some(x=>/write|manage/.test(x))).toBe(false);
 });
 it("exchanges only the configured confidential client and callback",async()=>{
  vi.mocked(atlassianProviderToken).mockResolvedValue(issued);await exchangeAtlassianCode(app,"synthetic-code");expect(atlassianProviderToken).toHaveBeenCalledWith({grant_type:"authorization_code",client_id:app.clientId,client_secret:app.clientSecret,redirect_uri:app.redirectUri,code:"synthetic-code"});
 });
 it("retains only verified identity/name and ignores personal profile extras",async()=>{
  vi.mocked(repositoryProviderJson).mockResolvedValue({account_id:"synthetic-account",name:"Synthetic user",account_type:"atlassian",account_status:"active",email:"private@example.invalid",picture:"https://untrusted.invalid",extended_profile:{location:"private"}});
  const result=await verifyAtlassianToken(issued);expect(result).toMatchObject({accountId:"synthetic-account",accountName:"Synthetic user"});expect(JSON.stringify(result)).not.toMatch(/private|untrusted/);expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
  await expect(verifyAtlassianToken(issued,"different-account")).rejects.toThrow(/identity/);
 });
 it("rejects invalid issued expiry and inactive identity",async()=>{
  await expect(verifyAtlassianToken({...issued,expires_in:1})).rejects.toThrow();expect(repositoryProviderJson).not.toHaveBeenCalled();
  vi.mocked(repositoryProviderJson).mockResolvedValue({account_id:"synthetic-account",name:"Synthetic user",account_type:"atlassian",account_status:"inactive"});await expect(verifyAtlassianToken(issued)).rejects.toThrow();
 });
 it("refreshes through fixed endpoint with current rotating token only",async()=>{
  await refreshAtlassianToken(app,{accessToken:"synthetic-old",refreshToken:"synthetic-rotating",expiresAt:1,accountId:"synthetic-account",accountName:"Synthetic user"});expect(atlassianProviderToken).toHaveBeenCalledWith({grant_type:"refresh_token",client_id:app.clientId,client_secret:app.clientSecret,refresh_token:"synthetic-rotating"});
 });
 it("merges product-scoped entries only for an identical admitted site",async()=>{
  vi.mocked(repositoryProviderJson).mockResolvedValue([{...site,scopes:["read:jira-work","read:jira-user"]},{...site,scopes:["read:space:confluence"]}]);expect(await listAtlassianSites("synthetic-access")).toEqual([site]);
  vi.mocked(repositoryProviderJson).mockResolvedValue([{...site,scopes:["read:jira-work","read:jira-user"]},{...site,url:"https://foreign.atlassian.net",scopes:["read:space:confluence"]}]);await expect(listAtlassianSites("synthetic-access")).rejects.toThrow(/Conflicting/);
 });
 it("lists Jira metadata using fixed gateway and reconstructed offset",async()=>{
  vi.mocked(repositoryProviderJson).mockResolvedValue({startAt:0,maxResults:50,isLast:true,values:[{id:"12",key:"QA",name:"Synthetic QA",self:"https://untrusted.invalid"}]});const result=await listAtlassianResources("synthetic-access",site,"jira");expect(result).toEqual({resources:[{id:"12",key:"QA",name:"Synthetic QA",url:site.url+"/browse/QA"}],next:null});expect(repositoryProviderJson).toHaveBeenCalledWith("https://api.atlassian.com",`/ex/jira/${site.id}/rest/api/3/project/search?startAt=0&maxResults=50`,{token:"synthetic-access"});
 });
 it("reconstructs Confluence cursors and never follows arbitrary provider links",async()=>{
  vi.mocked(repositoryProviderJson).mockResolvedValue({results:[{id:"12",key:"QA",name:"Synthetic QA",description:{view:"private"}}],_links:{next:"/wiki/api/v2/spaces?cursor=synthetic-next&limit=50"}});const result=await listAtlassianResources("synthetic-access",site,"confluence");expect(result.next).toBe("synthetic-next");expect(JSON.stringify(result)).not.toContain("private");
  vi.mocked(repositoryProviderJson).mockResolvedValue({results:[{id:"12",key:"QA",name:"Synthetic QA"}],_links:{next:"https://untrusted.invalid/?cursor=secret"}});await expect(listAtlassianResources("synthetic-access",site,"confluence")).rejects.toThrow(/pagination/);
 });
 it("refuses unsupported product/site and stalled pagination",async()=>{
  await expect(listAtlassianResources("synthetic-access",{...site,products:["jira"]},"confluence")).rejects.toThrow();expect(repositoryProviderJson).not.toHaveBeenCalled();
  vi.mocked(repositoryProviderJson).mockResolvedValue({results:[],_links:{next:"/wiki/api/v2/spaces?cursor=repeat&limit=50"}});await expect(listAtlassianResources("synthetic-access",site,"confluence","repeat")).rejects.toThrow(/advance/);
 });
});
