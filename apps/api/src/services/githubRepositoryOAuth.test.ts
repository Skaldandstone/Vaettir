import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { repositoryProviderJson, repositoryProviderRevokeGithubToken } from "./repositoryProviderHttp.js";
import { createGithubAuthorization, listGithubRepositories, revokeGithubAuthorization, verifyGithubAuthorization } from "./githubRepositoryOAuth.js";

vi.mock("./repositoryProviderHttp.js", async importOriginal => ({
  ...await importOriginal<typeof import("./repositoryProviderHttp.js")>(), repositoryProviderJson: vi.fn(), repositoryProviderRevokeGithubToken: vi.fn(),
}));
const input = { clientId: "synthetic-client", clientSecret: "synthetic-secret", redirectUri: "https://app.example.com/connections/github/callback", code: "synthetic-code", verifier: "synthetic-verifier" };
const token = { access_token: "synthetic-token", token_type: "bearer", scope: "repo", expires_in: 7200 };
beforeEach(() => vi.resetAllMocks());

describe("GitHub OAuth repository metadata contract", () => {
  it("uses the hosted authorization endpoint, random state and S256 PKCE", () => {
    const first = createGithubAuthorization(input.clientId, input.redirectUri);
    const second = createGithubAuthorization(input.clientId, input.redirectUri);
    const url = new URL(first.url);
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/login/oauth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe(input.redirectUri);
    expect(url.searchParams.get("scope")).toBe("repo");
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(first.verifier).digest("base64url"));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(first.state).not.toBe(second.state);
  });
  it("exchanges code with original verifier and verifies the account before saving a token", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce(token).mockResolvedValueOnce({ id: 17, login: "fixture-user" });
    const result = await verifyGithubAuthorization(input);
    expect(repositoryProviderJson).toHaveBeenNthCalledWith(1, "https://github.com", "/login/oauth/access_token", { form: new URLSearchParams({ client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri, code: input.code, code_verifier: input.verifier }) });
    expect(repositoryProviderJson).toHaveBeenNthCalledWith(2, "https://api.github.com", "/user", { token: token.access_token });
    expect(result).toMatchObject({ token: token.access_token, accountLabel: "fixture-user" });
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 7100000);
  });
  it("bounds retention of non-expiring upstream OAuth tokens", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({ ...token, expires_in: undefined }).mockResolvedValueOnce({ id: 17, login: "fixture-user" });
    const result = await verifyGithubAuthorization(input);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 28800000);
  });
  it.each([undefined, "", "public_repo", "repo_extra"]) ("rejects absent or insufficient granted scope %s", async scope => {
    vi.mocked(repositoryProviderJson).mockResolvedValue({ ...token, scope });
    await expect(verifyGithubAuthorization(input)).rejects.toThrow();
    expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
  });
  it("requires a Bearer token and a real account", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({ ...token, token_type: "MAC" });
    await expect(verifyGithubAuthorization(input)).rejects.toThrow();
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce(token).mockResolvedValueOnce({ id: 0, login: "fixture-user" });
    await expect(verifyGithubAuthorization(input)).rejects.toThrow();
  });
  it("lists bounded pages of accessible repository metadata without reading source", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValue([{ id: 19, full_name: "team/repo", html_url: "https://github.com/team/repo", default_branch: "main" }]);
    await expect(listGithubRepositories(token.access_token, 2)).resolves.toEqual([{ id: "19", name: "team/repo", url: "https://github.com/team/repo", defaultBranch: "main" }]);
    const [origin, path, options] = vi.mocked(repositoryProviderJson).mock.calls[0]!;
    expect(origin).toBe("https://api.github.com"); expect(options).toEqual({ token: token.access_token });
    const url = new URL(path, origin);
    expect(url.pathname).toBe("/user/repos");
    expect(Object.fromEntries(url.searchParams)).toEqual({ affiliation: "owner,collaborator,organization_member", visibility: "all", sort: "full_name", direction: "asc", per_page: "100", page: "2" });
  });
  it.each(["https://other.example.com/team/repo", "https://token@github.com/team/repo", "https://github.com/team/repo?bad=1", "https://github.com/team/not-repo"]) ("rejects unexpected repository URL %s", async html_url => {
    vi.mocked(repositoryProviderJson).mockResolvedValue([{ id: 19, full_name: "team/repo", html_url }]);
    await expect(listGithubRepositories(token.access_token, 1)).rejects.toThrow("outside GitHub");
  });
  it("passes the exact app credentials and token to confirmed upstream revocation", async () => {
    await revokeGithubAuthorization({ clientId: input.clientId, clientSecret: input.clientSecret, token: token.access_token });
    expect(repositoryProviderRevokeGithubToken).toHaveBeenCalledOnce();
    expect(repositoryProviderRevokeGithubToken).toHaveBeenCalledWith(input.clientId, input.clientSecret, token.access_token);
  });
});
