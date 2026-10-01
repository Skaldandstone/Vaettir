import { beforeEach, describe, expect, it, vi } from "vitest";
import { repositoryProviderJson } from "./repositoryProviderHttp.js";
import { azureOrganizationUrl, getAzureRepository, listAzureRepositories, verifyAzureRepositoryConnection } from "./azureRepositoryConnection.js";

vi.mock("./repositoryProviderHttp.js", () => ({ repositoryProviderJson: vi.fn() }));
const organizationUrl = "https://dev.azure.com/fixture-org";
const pat = "synthetic-pat";
const repository = {
  id: "11111111-1111-4111-8111-111111111111", name: "Mobile app",
  project: { id: "22222222-2222-4222-8222-222222222222", name: "Platform" },
  defaultBranch: "refs/heads/main", remoteUrl: "https://malicious.invalid/ignored",
};
const response = (value: unknown[]) => ({ count: value.length, value });
const identity = { authenticatedUser: { id: "44444444-4444-4444-8444-444444444444", isActive: true, isContainer: false } };
function providerResult(value: unknown) {
  vi.mocked(repositoryProviderJson).mockImplementation(async (_origin, path) => path.includes("/ConnectionData?") ? identity : value);
}
beforeEach(() => vi.resetAllMocks());

describe("Azure DevOps Services read-only repository metadata", () => {
  it("normalizes only a Services organization URL", () => {
    expect(azureOrganizationUrl(`${organizationUrl}/`)).toEqual({ origin: "https://dev.azure.com", organization: "fixture-org", url: organizationUrl });
  });
  it.each(["http://dev.azure.com/org", "https://token@dev.azure.com/org", "https://dev.azure.com/org/project", "https://dev.azure.com/org?token=secret", "https://dev.azure.com/org#fragment", "https://dev.azure.com/org%2Fother", "https://example.visualstudio.com/org", "https://127.0.0.1/org", "https://dev.azure.com:8443/org"])("rejects unsupported organization input %s", async url => {
    await expect(verifyAzureRepositoryConnection(url, pat)).rejects.toThrow();
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("verifies read-only repository access without inventing a provider identity", async () => {
    providerResult(response([repository]));
    const verification = await verifyAzureRepositoryConnection(organizationUrl, pat);
    expect(verification).toMatchObject({ organization: "fixture-org", organizationUrl, evidence: "authenticated-repository-metadata-access", accountId: identity.authenticatedUser.id, repositoryCount: 1, hasMore: false });
    expect(verification.repositories[0]?.id).toBe(repository.id);
    expect(verification.accountLabel).toBe(identity.authenticatedUser.id);
    expect(repositoryProviderJson).toHaveBeenCalledWith("https://dev.azure.com", "/fixture-org/_apis/git/repositories?api-version=7.1&includeHidden=false", { basic: { username: "", password: pat } });
    expect(repositoryProviderJson).toHaveBeenCalledWith("https://dev.azure.com", "/fixture-org/_apis/ConnectionData?api-version=7.2-preview.1", { basic: { username: "", password: pat } });
    expect(repositoryProviderJson).toHaveBeenCalledTimes(2);
  });
  it("keeps native repository/project identity and branch refs, ignores remote URLs", async () => {
    providerResult(response([repository]));
    expect(await listAzureRepositories(organizationUrl, pat)).toEqual({ repositories: [{
      id: repository.id, name: "Platform/Mobile app", url: `${organizationUrl}/Platform/_git/Mobile%20app`,
      defaultBranch: "refs/heads/main", projectId: repository.project.id, projectName: "Platform",
    }], hasMore: false });
  });
  it("searches project/repository names and pages a complete bounded catalog", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({ ...repository, id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`, name: `repo-${String(index).padStart(3, "0")}` }));
    providerResult(response(rows));
    expect((await listAzureRepositories(organizationUrl, pat, 1, "platform")).hasMore).toBe(true);
    expect((await listAzureRepositories(organizationUrl, pat, 2, "platform")).repositories).toHaveLength(1);
    expect((await listAzureRepositories(organizationUrl, pat, 1, "REPO-100")).repositories[0]?.id).toBe(rows[100]?.id);
  });
  it("represents empty/new repositories honestly and excludes disabled repositories", async () => {
    providerResult(response([{ ...repository, defaultBranch: undefined }, { ...repository, id: "33333333-3333-4333-8333-333333333333", isDisabled: true }]));
    const result = await listAzureRepositories(organizationUrl, pat);
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]?.defaultBranch).toBeNull();
  });
  it.each(["", "contains space", "token\r\nHeader:bad", "x".repeat(10001)])("rejects unsafe token before any request", async token => {
    await expect(verifyAzureRepositoryConnection(organizationUrl, token)).rejects.toThrow("valid organization-scoped");
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("bounds pages/search and refuses inconsistent or duplicate catalog results", async () => {
    await expect(listAzureRepositories(organizationUrl, pat, 0)).rejects.toThrow();
    await expect(listAzureRepositories(organizationUrl, pat, 11)).rejects.toThrow();
    await expect(listAzureRepositories(organizationUrl, pat, 1, "x".repeat(201))).rejects.toThrow();
    expect(repositoryProviderJson).not.toHaveBeenCalled();
    providerResult({ count: 2, value: [repository] });
    await expect(listAzureRepositories(organizationUrl, pat)).rejects.toThrow("incomplete");
    providerResult(response([repository, repository]));
    await expect(listAzureRepositories(organizationUrl, pat)).rejects.toThrow("duplicate");
    providerResult({ count: 1001, value: [] });
    await expect(listAzureRepositories(organizationUrl, pat)).rejects.toThrow();
  });
  it("propagates denied/provider failures and refuses malformed metadata", async () => {
    vi.mocked(repositoryProviderJson).mockRejectedValue(new Error("Provider request failed (401). Reconnect or check access."));
    await expect(verifyAzureRepositoryConnection(organizationUrl, pat)).rejects.toThrow("401");
    providerResult(response([{ ...repository, id: "not-native-id" }]));
    await expect(verifyAzureRepositoryConnection(organizationUrl, pat)).rejects.toThrow();
  });
  it.each(["..", ".", "nested/repo", "nested\\repo", "name\nheader"])("refuses unsafe repository/project link segments", async name => {
    providerResult(response([{ ...repository, name }]));
    await expect(listAzureRepositories(organizationUrl, pat)).rejects.toThrow();
    providerResult(response([{ ...repository, project: { ...repository.project, name } }]));
    await expect(listAzureRepositories(organizationUrl, pat)).rejects.toThrow();
  });
  it("revalidates selected IDs with the provider before writes", async () => {
    providerResult(repository);
    expect((await getAzureRepository(organizationUrl, pat, repository.id)).id).toBe(repository.id);
    expect(repositoryProviderJson).toHaveBeenCalledWith("https://dev.azure.com", `/fixture-org/_apis/git/repositories/${repository.id}?api-version=7.1`, { basic: { username: "", password: pat } });
    await expect(getAzureRepository(organizationUrl, pat, "../items")).rejects.toThrow("identifier");
    providerResult({ ...repository, isDisabled: true });
    await expect(getAzureRepository(organizationUrl, pat, repository.id)).rejects.toThrow("unavailable");
    providerResult({ ...repository, id: "33333333-3333-4333-8333-333333333333" });
    await expect(getAzureRepository(organizationUrl, pat, repository.id)).rejects.toThrow("unavailable");
  });
  it.each([
    {}, { authenticatedUser: null },
    { authenticatedUser: { ...identity.authenticatedUser, id: "00000000-0000-0000-0000-000000000000" } },
    { authenticatedUser: { ...identity.authenticatedUser, isActive: false } },
    { authenticatedUser: { ...identity.authenticatedUser, isContainer: true } },
  ])("rejects anonymous, inactive or absent identity before trusting a public catalog", async connectionData => {
    vi.mocked(repositoryProviderJson).mockImplementation(async (_origin, path) => path.includes("/ConnectionData?") ? connectionData : response([repository]));
    await expect(verifyAzureRepositoryConnection(organizationUrl, pat)).rejects.toThrow("authenticated organization member");
    expect(repositoryProviderJson).toHaveBeenCalledOnce();
    await expect(listAzureRepositories(organizationUrl, pat)).rejects.toThrow("authenticated organization member");
    await expect(getAzureRepository(organizationUrl, pat, repository.id)).rejects.toThrow("authenticated organization member");
    expect(vi.mocked(repositoryProviderJson).mock.calls.every(([, path]) => path.includes("/ConnectionData?"))).toBe(true);
  });
});
