import { beforeEach, describe, expect, it, vi } from "vitest";
import { repositoryProviderJson } from "./repositoryProviderHttp.js";
import { jiraCatalogSchema, jiraProjectSchema, jiraSiteOrigin, listJiraProjects } from "./jiraSourceConnection.js";

vi.mock("./repositoryProviderHttp.js", () => ({ repositoryProviderJson: vi.fn() }));
const credentials = { siteUrl: "https://synthetic.atlassian.net", email: "fixture@example.test", apiToken: "synthetic-only-key" };
const identity = { accountId: "557058:83ebdf55-ae1d-4db2-abbb-9c197933c5e5", displayName: "Synthetic account", active: true, accountType: "atlassian" };
const project = { id: "10001", key: "SYN", name: "Synthetic project" };
const page = () => ({ startAt: 0, maxResults: 50, isLast: true, total: 1, values: [project] });
function response(body: unknown = page(), account: unknown = identity) {
  vi.mocked(repositoryProviderJson).mockResolvedValueOnce(account).mockResolvedValueOnce(body);
}
beforeEach(() => vi.resetAllMocks());

describe("Jira Cloud metadata-only adapter", () => {
  it("verifies the active account before listing 50 projects and derives site-bound links", async () => {
    response();
    await expect(listJiraProjects(credentials)).resolves.toEqual({
      workspace: { id: credentials.siteUrl, name: credentials.siteUrl },
      account: { id: identity.accountId, name: identity.displayName },
      projects: [{ ...project, url: `${credentials.siteUrl}/browse/SYN` }], hasMore: false, nextCursor: null,
    });
    const options = { basic: { username: credentials.email, password: credentials.apiToken } };
    expect(vi.mocked(repositoryProviderJson).mock.calls).toEqual([
      [credentials.siteUrl, "/rest/api/3/myself", options],
      [credentials.siteUrl, "/rest/api/3/project/search?startAt=0&maxResults=50", options],
    ]);
    expect(JSON.stringify(vi.mocked(repositoryProviderJson).mock.calls)).not.toMatch(/issues|expand|description|graphql/);
  });

  it("ignores misleading provider URLs and reconstructs bounded pagination", async () => {
    response({ startAt: 50, maxResults: 20, isLast: false, total: 100,
      nextPage: "https://127.0.0.1/private?token=secret", self: "https://evil.example",
      values: [{ ...project, self: "https://evil.example", url: "javascript:alert(1)", avatarUrls: { "48x48": "https://10.0.0.1" } }],
    });
    const result = await listJiraProjects(credentials, 50);
    expect(result.hasMore).toBe(true); expect(result.nextCursor).toBe(70);
    expect(result.projects).toEqual([{ ...project, url: `${credentials.siteUrl}/browse/SYN` }]);
    expect(repositoryProviderJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(repositoryProviderJson).mock.calls[1]![1]).toBe("/rest/api/3/project/search?startAt=50&maxResults=50");
  });

  it("permits an authenticated empty final page without pretending projects are selected", async () => {
    response({ startAt: 0, maxResults: 50, isLast: true, total: 0, values: [] });
    await expect(listJiraProjects(credentials)).resolves.toMatchObject({ projects: [], hasMore: false, nextCursor: null });
  });

  it("normalizes only Cloud casing, default port and surrounding whitespace", () => {
    expect(jiraSiteOrigin("  https://SYNTHETIC.atlassian.net:443/  ")).toBe(credentials.siteUrl);
  });

  it.each([
    "http://synthetic.atlassian.net", "https://synthetic.atlassian.net:444", "https://synthetic.atlassian.net/path",
    "https://synthetic.atlassian.net/../", "https://synthetic.atlassian.net?query=x", "https://synthetic.atlassian.net#hash",
    "https://user:pass@synthetic.atlassian.net", "https://synthetic.atlassian.net.evil.example", "https://evil.atlassian.net@127.0.0.1",
    "https://127.0.0.1", "https://[::1]", "https://jira.example.test", "https://sub.synthetic.atlassian.net",
    "https://synthetic.atlassian.net\\@evil.example", "https://%73ynthetic.atlassian.net", "https://synthétic.atlassian.net",
    "https://synthetic.atlassian.net./", "https://-bad.atlassian.net", "https://bad-.atlassian.net",
  ])("rejects unsafe or unsupported site input before I/O: %s", async siteUrl => {
    await expect(listJiraProjects({ ...credentials, siteUrl })).rejects.toThrow();
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });

  it.each([
    { email: "bad:user@example.test" }, { email: "fixture@example.test\r\nInjected:yes" }, { email: "invalid" },
    { apiToken: "" }, { apiToken: "secret\nInjected:yes" }, { apiToken: "contains space" }, { apiToken: "token:password" },
    { apiToken: "x".repeat(10001) },
  ])("rejects invalid credentials before I/O %#", async invalid => {
    await expect(listJiraProjects({ ...credentials, ...invalid })).rejects.toThrow();
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });

  it.each([-1, 0.5, NaN, Infinity, 1000001])("rejects invalid numeric cursor %s before I/O", async after => {
    await expect(listJiraProjects(credentials, after)).rejects.toThrow();
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, { ...identity, active: false }, { ...identity, accountId: "" }, { ...identity, accountId: "unknown" },
    { ...identity, accountId: "anonymous" }, { ...identity, accountId: "Unknown" }, { ...identity, accountId: "null" },
    { ...identity, accountType: "app" }, { ...identity, displayName: "" }, { ...identity, displayName: "   " },
  ])("rejects missing, inactive or unknown identity without querying projects %#", async account => {
    response(page(), account);
    await expect(listJiraProjects(credentials)).rejects.toThrow();
    expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    { startAt: 1 }, { startAt: -1 }, { maxResults: 0 }, { maxResults: 51 }, { maxResults: 0.5 }, { isLast: undefined },
    { isLast: false, values: [] }, { isLast: false, total: 50 }, { isLast: true, total: 100 }, { total: 0 }, { total: 0.5 },
    { maxResults: 1, total: 2, values: [project, { ...project, id: "10002", key: "TWO" }] },
    { values: Array.from({ length: 51 }, (_, index) => ({ id: String(index + 1), key: `SYN${index}`, name: "Synthetic" })) },
  ])("rejects inconsistent or oversized pagination %#", async invalid => {
    response({ ...page(), ...invalid });
    await expect(listJiraProjects(credentials)).rejects.toThrow();
  });

  it.each([
    { values: [project, project], total: 2 },
    { values: [project, { ...project, id: "10002" }], total: 2 },
    { values: [{ ...project, key: "../secret" }] }, { values: [{ ...project, key: "SYN#x" }] },
    { values: [{ ...project, id: "-1" }] }, { values: [{ ...project, id: "100.1" }] },
    { values: [{ ...project, name: "" }] }, { values: [{ ...project, name: "x".repeat(301) }] },
  ])("rejects ambiguous native identities or project metadata %#", async invalid => {
    response({ ...page(), ...invalid });
    await expect(listJiraProjects(credentials)).rejects.toThrow();
  });

  it("propagates transport failure and does not turn partial verification into a catalog", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce(identity).mockRejectedValueOnce(new Error("Provider request failed (403)"));
    await expect(listJiraProjects(credentials)).rejects.toThrow("Provider request failed (403)");
  });

  it("validates saved catalogs against the chosen site and strict generated links", () => {
    const valid = { workspace: { id: credentials.siteUrl, name: credentials.siteUrl }, account: { id: identity.accountId, name: identity.displayName },
      projects: [{ ...project, url: `${credentials.siteUrl}/browse/SYN` }] };
    expect(jiraCatalogSchema.safeParse(valid).success).toBe(true);
    expect(jiraCatalogSchema.safeParse({ ...valid, projects: [{ ...project, url: "https://other.atlassian.net/browse/SYN" }] }).success).toBe(false);
    for (const url of ["https://evil.example/browse/SYN", `${credentials.siteUrl}/browse/OTHER`, `${credentials.siteUrl}/browse/SYN?x=y`, `${credentials.siteUrl}/browse/SYN#x`])
      expect(jiraProjectSchema.safeParse({ ...project, url }).success).toBe(false);
    expect(jiraCatalogSchema.safeParse({ ...valid, projects: Array.from({ length: 501 }, () => valid.projects[0]) }).success).toBe(false);
  });
});
