import { beforeEach, describe, expect, it, vi } from "vitest";
import { repositoryProviderJson } from "./repositoryProviderHttp.js";
import { listBitbucketRepositories, verifyBitbucketAuthorization } from "./bitbucketRepositoryConnection.js";

vi.mock("./repositoryProviderHttp.js", () => ({ repositoryProviderJson: vi.fn() }));
const credentials = { email: "fixture@example.com", token: "synthetic-api-token" };
const uuid = "{10000000-0000-0000-0000-000000000001}";
const repository = { type: "repository", scm: "git", uuid, full_name: "fixture-workspace/example", links: { html: { href: "https://bitbucket.org/fixture-workspace/example" } }, mainbranch: { name: "main" } };
const input = { ...credentials, workspace: "fixture-workspace", page: 1, search: "" };
beforeEach(() => vi.resetAllMocks());

describe("Bitbucket Cloud account-bound metadata adapter", () => {
  it("verifies the token's account identity using the fixed API host and Basic credentials", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValue({ type: "user", uuid, display_name: "Fixture Person", account_id: "ignored-provider-extra" });
    await expect(verifyBitbucketAuthorization(credentials)).resolves.toEqual({ accountId: uuid, accountLabel: "Fixture Person" });
    expect(repositoryProviderJson).toHaveBeenCalledExactlyOnceWith("https://api.bitbucket.org", "/2.0/user", { basic: { username: credentials.email, password: credentials.token } });
  });
  it("refuses malformed credentials without making any request or reflecting their value", async () => {
    for (const candidate of [{ ...credentials, email: "name:password@example.com" }, { ...credentials, token: "sensitive\nvalue" }, { ...credentials, token: "" }]) {
      const failure = verifyBitbucketAuthorization(candidate);
      await expect(failure).rejects.toThrow("valid API token");
      await expect(failure).rejects.not.toThrow("sensitive");
    }
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("rejects a missing or non-user identity instead of declaring it verified", async () => {
    for (const response of [{}, { type: "team", uuid, display_name: "Workspace token" }, { type: "user", uuid: "not-a-native-id", display_name: "Person" }]) {
      vi.mocked(repositoryProviderJson).mockResolvedValueOnce(response);
      await expect(verifyBitbucketAuthorization(credentials)).rejects.toThrow("invalid account identity");
    }
  });
  it("normalizes native repository UUIDs and default branch metadata without source calls", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValue({ values: [repository] });
    await expect(listBitbucketRepositories(input)).resolves.toEqual({ repositories: [{ id: uuid, name: repository.full_name, url: repository.links.html.href, defaultBranch: "main" }], hasMore: false, limitReached: false });
    const [origin, path, options] = vi.mocked(repositoryProviderJson).mock.calls[0]!;
    expect(origin).toBe("https://api.bitbucket.org");
    const url = new URL(path, origin);
    expect(url.pathname).toBe("/2.0/repositories/fixture-workspace");
    expect(url.searchParams.get("pagelen")).toBe("100");
    expect(options).toEqual({ basic: { username: credentials.email, password: credentials.token } });
    expect(url.href).not.toContain(credentials.token);
    expect(repositoryProviderJson).toHaveBeenCalledOnce();
  });
  it("supports empty repositories with no main branch and a successful empty workspace", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({ values: [{ ...repository, mainbranch: null }] }).mockResolvedValueOnce({ values: [] });
    expect((await listBitbucketRepositories(input)).repositories[0]?.defaultBranch).toBeNull();
    await expect(listBitbucketRepositories(input)).resolves.toEqual({ repositories: [], hasMore: false, limitReached: false });
  });
  it("quotes the search as one BBQL literal rather than allowing expression injection", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValue({ values: [] });
    const search = 'foo" OR is_private=false OR name ~ "bar\\';
    await listBitbucketRepositories({ ...input, search });
    const [origin, path] = vi.mocked(repositoryProviderJson).mock.calls[0]!;
    expect(new URL(path, origin).searchParams.get("q")).toBe(`name ~ ${JSON.stringify(search)}`);
  });
  it("rejects unsafe workspace paths and bounds search and page inputs before credentials leave", async () => {
    for (const bad of [{ workspace: "../other" }, { workspace: "fixture%2fother" }, { workspace: "https://internal" }, { page: 0 }, { page: 11 }, { page: 1.5 }, { search: "x".repeat(101) }, { search: "foo\nbar" }])
      await expect(listBitbucketRepositories({ ...input, ...bad })).rejects.toThrow("valid Bitbucket workspace");
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("offers the next page but never follows the provider's next link", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValue({ values: [repository], next: "https://api.bitbucket.org/2.0/repositories/fixture-workspace?page=2&pagelen=100" });
    expect((await listBitbucketRepositories(input)).hasMore).toBe(true);
    expect(repositoryProviderJson).toHaveBeenCalledOnce();
  });
  it("reports catalog truncation at the tenth page so users can narrow the search", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValue({ values: [], next: "https://api.bitbucket.org/2.0/repositories/fixture-workspace?page=11&pagelen=100" });
    await expect(listBitbucketRepositories({ ...input, page: 10 })).resolves.toEqual({ repositories: [], hasMore: false, limitReached: true });
  });
  it("rejects credential-leaking, cross-workspace and source-reading continuation endpoints", async () => {
    for (const next of ["https://attacker.example/2.0/repositories/fixture-workspace?page=2", "https://token@api.bitbucket.org/2.0/repositories/fixture-workspace?page=2", "https://api.bitbucket.org/2.0/repositories/other?page=2", "https://api.bitbucket.org/2.0/repositories/fixture-workspace/src/main?page=2", "https://api.bitbucket.org/2.0/repositories/fixture-workspace?page=1"] ) {
      vi.mocked(repositoryProviderJson).mockResolvedValueOnce({ values: [], next });
      await expect(listBitbucketRepositories(input)).rejects.toThrow("invalid repository continuation");
    }
    expect(repositoryProviderJson).toHaveBeenCalledTimes(5);
  });
  it("rejects injected web URLs, wrong workspaces and duplicate stable identities", async () => {
    for (const rows of [[{ ...repository, links: { html: { href: "https://attacker.example/fixture-workspace/example" } } }], [{ ...repository, full_name: "another-workspace/example" }], [{ ...repository, links: { html: { href: `${repository.links.html.href}?token=secret` } } }], [repository, repository]]) {
      vi.mocked(repositoryProviderJson).mockResolvedValueOnce({ values: rows });
      await expect(listBitbucketRepositories(input)).rejects.toThrow("outside the selected workspace");
    }
  });
  it("fails closed for malformed or oversized pages and unsupported repository types", async () => {
    for (const payload of [{}, { values: Array.from({ length: 101 }, () => repository) }, { values: [{ ...repository, scm: "hg" }] }, { values: [{ ...repository, mainbranch: { name: "x".repeat(201) } }] }]) {
      vi.mocked(repositoryProviderJson).mockResolvedValueOnce(payload);
      await expect(listBitbucketRepositories(input)).rejects.toThrow("invalid repository page");
    }
  });
  it("propagates provider denial rather than returning an empty successful catalog", async () => {
    vi.mocked(repositoryProviderJson).mockRejectedValue(new Error("Provider request failed (403). Reconnect or check access."));
    await expect(listBitbucketRepositories(input)).rejects.toThrow("403");
    await expect(verifyBitbucketAuthorization(credentials)).rejects.toThrow("403");
  });
});
