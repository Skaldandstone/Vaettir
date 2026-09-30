import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { repositoryProviderJson } from "./repositoryProviderHttp.js";
import { createGitlabAuthorization, listGitlabRepositories, verifyGitlabAuthorization } from "./gitlabRepositoryOAuth.js";

vi.mock("./repositoryProviderHttp.js", async importOriginal => ({
  ...await importOriginal<typeof import("./repositoryProviderHttp.js")>(), repositoryProviderJson: vi.fn(),
}));
const input = { origin: "https://gitlab.example.com", clientId: "synthetic-client", clientSecret: "synthetic-secret", redirectUri: "https://app.example.com/connections/gitlab/callback", code: "synthetic-code", verifier: "synthetic-verifier" };
const token = { access_token: "synthetic-token", token_type: "Bearer", expires_in: 7200, scope: "read_api" };
beforeEach(() => { vi.resetAllMocks(); });

describe("GitLab repository OAuth contract", () => {
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
  });
  it.each([undefined, "Basic", "MAC"])("rejects non-Bearer token type %s", async token_type => {
    vi.mocked(repositoryProviderJson).mockResolvedValue({ ...token, token_type });
    await expect(verifyGitlabAuthorization(input)).rejects.toThrow();
    expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
  });
  it.each([0, -1, 1.5])("rejects invalid provider account ID %s", async id => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce(token).mockResolvedValueOnce({ id, username: "fixture-user" });
    await expect(verifyGitlabAuthorization(input)).rejects.toThrow();
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
