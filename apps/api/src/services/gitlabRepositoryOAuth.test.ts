import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { repositoryProviderJson, repositoryProviderRevokeGitlabToken } from "./repositoryProviderHttp.js";
import { createGitlabAuthorization, GitlabOAuthRevocationPendingError, listGitlabGroups, listGitlabRepositories, repositorySelectionSchema, revokeGitlabAuthorization, verifyGitlabAuthorization, verifyGitlabAccessToken, refreshGitlabAuthorization } from "./gitlabRepositoryOAuth.js";

vi.mock("./repositoryProviderHttp.js", async importOriginal => ({
  ...await importOriginal<typeof import("./repositoryProviderHttp.js")>(), repositoryProviderJson: vi.fn(), repositoryProviderRevokeGitlabToken: vi.fn(),
}));
const input = { origin: "https://gitlab.example.com", clientId: "synthetic-client", clientSecret: "synthetic-secret", redirectUri: "https://app.example.com/connections/gitlab/callback", code: "synthetic-code", verifier: "synthetic-verifier" };
const token = { access_token: "synthetic-token", token_type: "Bearer", expires_in: 7200, scope: "read_api" };
beforeEach(() => { vi.resetAllMocks(); });

describe("GitLab repository OAuth contract", () => {
  it("retains refresh credentials and immutable account/callback identity after account verification",async()=>{
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({...token,refresh_token:"synthetic-refresh"}).mockResolvedValueOnce({id:17,username:"fixture-user"});
    expect((await verifyGitlabAuthorization(input)).renewal).toEqual({refreshToken:"synthetic-refresh",accountId:"17",redirectUri:input.redirectUri});
  });
  it("renews with the pinned app and callback, and retains the rotated token",async()=>{
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({...token,access_token:"next-access",refresh_token:"next-refresh"}).mockResolvedValueOnce({id:17,username:"renamed-user"});
    const result=await refreshGitlabAuthorization({...input,refreshToken:"old-refresh",accountId:"17"});
    expect(Object.fromEntries(vi.mocked(repositoryProviderJson).mock.calls[0]![2]!.form!)).toEqual({client_id:input.clientId,client_secret:input.clientSecret,redirect_uri:input.redirectUri,refresh_token:"old-refresh",grant_type:"refresh_token"});
    expect(result).toMatchObject({token:"next-access",accountLabel:"renamed-user",renewal:{refreshToken:"next-refresh",accountId:"17"}});
  });
  it.each([{accountId:18,refresh_token:"next-refresh"},{accountId:17,refresh_token:undefined}])("revokes an inadmissible renewal without adopting its identity: %o",async value=>{
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({...token,refresh_token:value.refresh_token}).mockResolvedValueOnce({id:value.accountId,username:"fixture-user"});
    await expect(refreshGitlabAuthorization({...input,refreshToken:"old-refresh",accountId:"17"})).rejects.toThrow();
    expect(repositoryProviderRevokeGitlabToken).toHaveBeenCalledExactlyOnceWith(input.origin,input.clientId,input.clientSecret,token.access_token);
  });
  it("does not automatically repeat a renewal after an ambiguous exchange",async()=>{
    vi.mocked(repositoryProviderJson).mockRejectedValue(new Error("synthetic transport timeout"));
    await expect(refreshGitlabAuthorization({...input,refreshToken:"old-refresh",accountId:"17"})).rejects.toThrow();
    expect(repositoryProviderJson).toHaveBeenCalledTimes(1);expect(repositoryProviderRevokeGitlabToken).not.toHaveBeenCalled();
  });
  it("discovers bounded authorized group paths without source bodies or redirects",async()=>{
    vi.mocked(repositoryProviderJson).mockResolvedValue([{id:44,full_path:"team/product",name:"Product"}]);
    await expect(listGitlabGroups(input.origin,token.access_token,2,"product & all_available=true")).resolves.toEqual([{id:"44",path:"team/product",name:"Product"}]);
    const path=vi.mocked(repositoryProviderJson).mock.calls[0]![1];const url=new URL(path,input.origin);
    expect(url.pathname).toBe("/api/v4/groups");expect(url.searchParams.get("page")).toBe("2");expect(url.searchParams.get("search")).toBe("product & all_available=true");
  });
  it("binds exact group identity, explicit subgroups and shared false by default",async()=>{
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({id:44,full_path:"team/product"}).mockResolvedValueOnce([{id:19,path_with_namespace:"team/product/sub/repo",web_url:`${input.origin}/team/product/sub/repo`,default_branch:"main"}]);
    await expect(listGitlabRepositories(input.origin,token.access_token,2,"repo",{groupPath:"team/product",includeSubgroups:true,includeShared:false})).resolves.toHaveLength(1);
    expect(repositoryProviderJson).toHaveBeenNthCalledWith(1,input.origin,"/api/v4/groups/team%2Fproduct",{token:token.access_token});
    const url=new URL(vi.mocked(repositoryProviderJson).mock.calls[1]![1],input.origin);expect(url.pathname).toBe("/api/v4/groups/44/projects");expect(url.searchParams.get("include_subgroups")).toBe("true");expect(url.searchParams.get("with_shared")).toBe("false");
  });
  it.each(["../team","team?x=1","https://other.example/team","team//sub"])("rejects unbound group path %s before transport",async groupPath=>{
    await expect(listGitlabRepositories(input.origin,token.access_token,1,"",{groupPath,includeSubgroups:true,includeShared:false})).rejects.toThrow();expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("rejects group redirects and non-selected subgroup metadata, permitting shared projects only when explicit",async()=>{
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({id:44,full_path:"renamed"});
    await expect(listGitlabRepositories(input.origin,token.access_token,1,"",{groupPath:"team",includeSubgroups:true,includeShared:false})).rejects.toThrow("changed identity");expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
    vi.mocked(repositoryProviderJson).mockReset().mockResolvedValueOnce({id:44,full_path:"team"}).mockResolvedValueOnce([{id:19,path_with_namespace:"team/sub/repo",web_url:`${input.origin}/team/sub/repo`}]);
    await expect(listGitlabRepositories(input.origin,token.access_token,1,"",{groupPath:"team",includeSubgroups:false,includeShared:false})).rejects.toThrow("outside the selected group");
    vi.mocked(repositoryProviderJson).mockReset().mockResolvedValueOnce({id:44,full_path:"team"}).mockResolvedValueOnce([{id:19,path_with_namespace:"shared/repo",web_url:`${input.origin}/shared/repo`}]);
    await expect(listGitlabRepositories(input.origin,token.access_token,1,"",{groupPath:"team",includeSubgroups:false,includeShared:true})).resolves.toHaveLength(1);
  });
  it("preserves native Azure grouping metadata in shared catalogue shape",()=>{
    expect(repositorySelectionSchema.parse({id:"native",name:"Project/repo",url:"https://dev.azure.com/org/Project/_git/repo",defaultBranch:"main",projectId:"project-native",projectName:"Project"})).toMatchObject({projectId:"project-native",projectName:"Project"});
  });
  it("verifies an access token using existing bounded Bearer user metadata without OAuth app credentials", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValue({id:17,username:"fixture-user"});
    await expect(verifyGitlabAccessToken({origin:input.origin,token:token.access_token})).resolves.toEqual({accountLabel:"fixture-user"});
    expect(repositoryProviderJson).toHaveBeenCalledExactlyOnceWith(input.origin,"/api/v4/user",{token:token.access_token});
    expect(repositoryProviderRevokeGitlabToken).not.toHaveBeenCalled();
  });
  it.each(["", "sensitive\nvalue", " token", "bad\u0000token"])("invalid access token %j refuses before transport without reflecting it", async candidate => {
    await expect(verifyGitlabAccessToken({origin:input.origin,token:candidate})).rejects.toThrow("valid GitLab access token");
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it.each([{}, {id:0,username:"user"}, {id:1,username:""}])("unsupported access-token account %j never declares verification or attempts OAuth revocation", async account => {
    vi.mocked(repositoryProviderJson).mockResolvedValue(account);
    await expect(verifyGitlabAccessToken({origin:input.origin,token:token.access_token})).rejects.toThrow("account access could not be verified");
    expect(repositoryProviderRevokeGitlabToken).not.toHaveBeenCalled();
  });
  it("access-token transport errors are generic and cannot reflect provider diagnostics or token text", async () => {
    vi.mocked(repositoryProviderJson).mockRejectedValue(Error(token.access_token));
    const failure=verifyGitlabAccessToken({origin:input.origin,token:token.access_token});
    await expect(failure).rejects.toThrow("account access could not be verified");
    await expect(failure).rejects.not.toThrow(token.access_token);
    expect(repositoryProviderRevokeGitlabToken).not.toHaveBeenCalled();
  });
  it("uses random actor state and S256 PKCE with the configured callback", () => {
    const authorization = createGitlabAuthorization(input.origin, input.clientId, input.redirectUri);
    const url = new URL(authorization.url);
    expect(url.origin).toBe(input.origin);
    expect(url.pathname).toBe("/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: input.clientId, redirect_uri: input.redirectUri, response_type: "code", scope: "read_api", state: authorization.state, code_challenge: createHash("sha256").update(authorization.verifier).digest("base64url"), code_challenge_method: "S256" });
    expect(authorization.state.length).toBeGreaterThanOrEqual(32);
    expect(authorization.verifier.length).toBeGreaterThanOrEqual(43);
    expect(createGitlabAuthorization(input.origin, input.clientId, input.redirectUri).state).not.toBe(authorization.state);
  });
  it("exchanges the code with PKCE, matching redirect and client, then verifies the account", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce(token).mockResolvedValueOnce({ id: 17, username: "fixture-user" });
    const before = Date.now();
    const result = await verifyGitlabAuthorization(input);
    const [origin, path, options] = vi.mocked(repositoryProviderJson).mock.calls[0]!;
    expect(origin).toBe(input.origin); expect(path).toBe("/oauth/token");
    expect(Object.fromEntries(options!.form!)).toEqual({ client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri, code: input.code, code_verifier: input.verifier, grant_type: "authorization_code" });
    expect(repositoryProviderJson).toHaveBeenNthCalledWith(2, input.origin, "/api/v4/user", { token: token.access_token });
    expect(result.accountLabel).toBe("fixture-user");
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 7200000);
  });
  it.each([undefined, "", "read_user", "read_api_extra"])("denies missing or inadequate granted scope %s before account access", async scope => {
    vi.mocked(repositoryProviderJson).mockResolvedValue({ ...token, scope });
    await expect(verifyGitlabAuthorization(input)).rejects.toThrow();
    expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
    expect(repositoryProviderRevokeGitlabToken).toHaveBeenCalledWith(input.origin,input.clientId,input.clientSecret,token.access_token);
  });
  it.each([undefined, "Basic", "MAC"])("rejects non-Bearer token type %s", async token_type => {
    vi.mocked(repositoryProviderJson).mockResolvedValue({ ...token, token_type });
    await expect(verifyGitlabAuthorization(input)).rejects.toThrow();
    expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
    expect(repositoryProviderRevokeGitlabToken).toHaveBeenCalledWith(input.origin,input.clientId,input.clientSecret,token.access_token);
  });
  it.each([0, -1, 1.5])("rejects invalid provider account ID %s", async id => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce(token).mockResolvedValueOnce({ id, username: "fixture-user" });
    await expect(verifyGitlabAuthorization(input)).rejects.toThrow();
    expect(repositoryProviderRevokeGitlabToken).toHaveBeenCalledWith(input.origin,input.clientId,input.clientSecret,token.access_token);
  });
  it("revokes an issued token when account lookup fails", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce(token).mockRejectedValueOnce(new Error("account unavailable"));
    await expect(verifyGitlabAuthorization(input)).rejects.toThrow("account unavailable");
    expect(repositoryProviderRevokeGitlabToken).toHaveBeenCalledWith(input.origin,input.clientId,input.clientSecret,token.access_token);
  });
  it("surfaces a non-enumerable issued token for quarantine when revocation fails", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce(token).mockRejectedValueOnce(new Error("account unavailable"));
    vi.mocked(repositoryProviderRevokeGitlabToken).mockRejectedValueOnce(new Error("provider unavailable"));
    const failure=await verifyGitlabAuthorization(input).catch(error=>error);
    expect(failure).toBeInstanceOf(GitlabOAuthRevocationPendingError);
    expect(failure.token).toBe(token.access_token);
    expect(JSON.stringify(failure)).not.toContain(token.access_token);
  });
  it("does not attempt revocation when the token exchange did not issue a usable token", async () => {
    vi.mocked(repositoryProviderJson).mockRejectedValueOnce(new Error("exchange rejected"));
    await expect(verifyGitlabAuthorization(input)).rejects.toThrow("exchange rejected");
    expect(repositoryProviderRevokeGitlabToken).not.toHaveBeenCalled();
  });
  it("passes the exact instance and app credentials to GitLab revocation", async () => {
    await revokeGitlabAuthorization({origin:input.origin,clientId:input.clientId,clientSecret:input.clientSecret,token:token.access_token});
    expect(repositoryProviderRevokeGitlabToken).toHaveBeenCalledWith(input.origin,input.clientId,input.clientSecret,token.access_token);
  });
  it("requests bounded member metadata with encoded pagination and search", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValue([{ id: 19, path_with_namespace: "team/repo", web_url: `${input.origin}/team/repo`, default_branch: "main" }]);
    await expect(listGitlabRepositories(input.origin, token.access_token, 2, "repo & membership=false")).resolves.toEqual([{ id: "19", name: "team/repo", url: `${input.origin}/team/repo`, defaultBranch: "main" }]);
    const [origin, path, options] = vi.mocked(repositoryProviderJson).mock.calls[0]!;
    expect(origin).toBe(input.origin); expect(options).toEqual({ token: token.access_token });
    const url = new URL(path, origin);
    expect(url.pathname).toBe("/api/v4/projects");
    expect(Object.fromEntries(url.searchParams)).toEqual({ membership: "true", simple: "true", per_page: "100", page: "2", order_by: "path", sort: "asc", search: "repo & membership=false" });
  });
  it.each(["https://other.example.com/team/repo", "https://token@gitlab.example.com/team/repo", "https://gitlab.example.com/team/repo#bad", "https://gitlab.example.com/team/repo?bad=1"])("rejects unexpected repository URL %s", async web_url => {
    vi.mocked(repositoryProviderJson).mockResolvedValue([{ id: 19, path_with_namespace: "team/repo", web_url }]);
    await expect(listGitlabRepositories(input.origin, token.access_token, 1, "")).rejects.toThrow("outside this instance");
  });
});
