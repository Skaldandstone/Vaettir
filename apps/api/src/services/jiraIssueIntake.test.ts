import { beforeEach, describe, expect, it, vi } from "vitest";
import { repositoryProviderJson } from "./repositoryProviderHttp.js";
import { jiraIssueSchema, listJiraIssuePage } from "./jiraIssueIntake.js";

vi.mock("./repositoryProviderHttp.js", () => ({ repositoryProviderJson: vi.fn() }));
const credentials = { siteUrl: "https://synthetic.atlassian.net", email: "fixture@example.test", apiToken: "synthetic-only-key" };
const providerIssue = () => ({
  id: "11001", key: "SYN-1", fields: {
    summary: "Synthetic issue title", status: { name: "In progress" },
    project: { id: "10001" }, updated: "2026-10-01T10:00:00.000+0000",
  },
});
const expectedIssue = () => ({
  id: "11001", projectId: "10001", key: "SYN-1", title: "Synthetic issue title",
  status: "In progress", updatedAt: "2026-10-01T10:00:00.000Z",
  url: `${credentials.siteUrl}/browse/SYN-1`,
});
const page = () => ({ issues: [providerIssue()], isLast: true });
function respond(body: unknown = page()) { vi.mocked(repositoryProviderJson).mockResolvedValueOnce(body); }
beforeEach(() => vi.resetAllMocks());

describe("bounded Jira Cloud issue-summary intake", () => {
  it("uses one fixed enhanced-search GET with constructed numeric JQL and four fields", async () => {
    respond();
    await expect(listJiraIssuePage(credentials, ["10001", "10002"])).resolves.toEqual({
      issues: [expectedIssue()], nextPageToken: null,
    });
    expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
    const [origin, path, options] = vi.mocked(repositoryProviderJson).mock.calls[0]!;
    const url = new URL(path, origin);
    expect(origin).toBe(credentials.siteUrl);
    expect(url.pathname).toBe("/rest/api/3/search/jql");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      jql: "project in (10001,10002) ORDER BY id ASC",
      fields: "summary,status,project,updated", maxResults: "20",
    });
    expect(options).toEqual({ basic: { username: credentials.email, password: credentials.apiToken } });
  });

  it("bounds opaque tokens and encodes rather than follows URL-like cursor contents", async () => {
    const token = "https://127.0.0.1/private?credential=x&scope=ALL#frag";
    respond({ ...page(), isLast: false, nextPageToken: "opaque:/+%=&next" });
    await expect(listJiraIssuePage(credentials, ["10001"], token)).resolves.toMatchObject({ nextPageToken: "opaque:/+%=&next" });
    const [origin, path] = vi.mocked(repositoryProviderJson).mock.calls[0]!;
    const url = new URL(path, origin);
    expect(url.origin).toBe(credentials.siteUrl);
    expect(url.pathname).toBe("/rest/api/3/search/jql");
    expect(url.searchParams.get("nextPageToken")).toBe(token);
    expect([...url.searchParams.keys()]).toEqual(["jql", "fields", "maxResults", "nextPageToken"]);
  });

  it("permits an empty final page without inferring deletion", async () => {
    respond({ issues: [], isLast: true, nextPageToken: null });
    await expect(listJiraIssuePage(credentials, ["10001"])).resolves.toEqual({ issues: [], nextPageToken: null });
  });

  it("drops every extra field, provider link, description and attachment without fetching them", async () => {
    const issue = providerIssue();
    respond({ ...page(), self: "https://evil.example", nextPage: "https://127.0.0.1/private", issues: [{
      ...issue, self: "https://evil.example", description: "private", attachments: [{ content: "https://127.0.0.1" }],
      fields: { ...issue.fields, description: { type: "doc", content: ["private"] },
        attachment: [{ content: "https://evil.example/secret" }], comments: ["private"],
        status: { ...issue.fields.status, iconUrl: "https://evil.example" },
        project: { ...issue.fields.project, name: "ignored", self: "https://evil.example" },
      },
    }] });
    const result = await listJiraIssuePage(credentials, ["10001"]);
    expect(result).toEqual({ issues: [expectedIssue()], nextPageToken: null });
    expect(Object.keys(result.issues[0]!)).toEqual(["id", "projectId", "key", "title", "status", "updatedAt", "url"]);
    expect(JSON.stringify(result)).not.toMatch(/private|evil|description|attachment|iconUrl|comments|self/);
    expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
  });

  it("keeps imported display strings as inert data rather than executing or transforming content", async () => {
    const issue = providerIssue();
    respond({ ...page(), issues: [{ ...issue, fields: { ...issue.fields, summary: "<script>throw new Error('synthetic')</script>" } }] });
    const result = await listJiraIssuePage(credentials, ["10001"]);
    expect(result.issues[0]!.title).toBe("<script>throw new Error('synthetic')</script>");
    expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
  });

  it.each([
    "http://synthetic.atlassian.net", "https://127.0.0.1", "https://[::1]", "https://jira.example.test",
    "https://synthetic.atlassian.net:444", "https://synthetic.atlassian.net/path", "https://synthetic.atlassian.net?x=1",
    "https://synthetic.atlassian.net.evil.example", "https://user:pass@synthetic.atlassian.net", "https://%73ynthetic.atlassian.net",
    "https://synthetic.atlassian.net\\@evil.example", "https://sub.synthetic.atlassian.net", "https://synthetic.atlassian.net#x",
  ])("rejects unsupported/unsafe Cloud site before I/O: %s", async siteUrl => {
    await expect(listJiraIssuePage({ ...credentials, siteUrl }, ["10001"])).rejects.toThrow();
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });

  it.each([
    { email: "bad:user@example.test" }, { email: "invalid" }, { email: "fixture@example.test\r\nInjected:yes" },
    { apiToken: "" }, { apiToken: "token:password" }, { apiToken: "contains space" },
    { apiToken: "key\nHeader:yes" }, { apiToken: "x".repeat(10001) },
  ])("rejects malformed credentials before I/O %#", async invalid => {
    await expect(listJiraIssuePage({ ...credentials, ...invalid }, ["10001"])).rejects.toThrow();
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });

  it.each([
    [], ["10001", "10001"], ["0"], ["-1"], ["01"], ["1.0"], ["1 OR project=ALL"], ["1,2"],
    ["x"], ["1".repeat(33)], Array.from({ length: 21 }, (_, index) => String(index + 1)),
  ].map(ids => ({ ids })))("rejects invalid, duplicate or oversized scope before I/O %#", async ({ ids }) => {
    await expect(listJiraIssuePage(credentials, ids)).rejects.toThrow();
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });

  it.each(["", " ", "cursor\nInjected:yes", "\u007f", "é", "x".repeat(1025)])("rejects invalid cursor before I/O %#", async cursor => {
    await expect(listJiraIssuePage(credentials, ["10001"], cursor)).rejects.toThrow();
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, { ...page(), isLast: undefined }, { ...page(), isLast: "true" },
    { ...page(), isLast: false }, { ...page(), isLast: true, nextPageToken: "next" },
    { ...page(), isLast: false, nextPageToken: "" }, { ...page(), isLast: false, nextPageToken: "bad\n" },
    { issues: [], isLast: false, nextPageToken: "next" },
    { ...page(), issues: Array.from({ length: 21 }, (_, index) => ({ ...providerIssue(), id: String(11001 + index), key: `SYN-${index + 1}` })) },
  ])("rejects inconsistent, missing or oversized page shape %#", async body => {
    respond(body);
    await expect(listJiraIssuePage(credentials, ["10001"])).rejects.toThrow();
    expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
  });

  it("rejects repeated continuation tokens instead of permitting a page loop", async () => {
    respond({ ...page(), isLast: false, nextPageToken: "same-token" });
    await expect(listJiraIssuePage(credentials, ["10001"], "same-token")).rejects.toThrow("pagination is inconsistent");
  });

  it.each([
    [providerIssue(), providerIssue()],
    [providerIssue(), { ...providerIssue(), id: "11002" }],
    [providerIssue(), { ...providerIssue(), key: "SYN-2" }],
    [{ ...providerIssue(), fields: { ...providerIssue().fields, project: { id: "99999" } } }],
  ].map(issues => ({ issues })))("rejects duplicate native IDs/keys and issues outside the explicit scope %#", async ({ issues }) => {
    respond({ ...page(), issues });
    await expect(listJiraIssuePage(credentials, ["10001"])).rejects.toThrow("out-of-scope issue identities");
  });

  it.each([
    { id: "0" }, { id: "-1" }, { id: "001" }, { id: "1.1" }, { id: "1".repeat(33) },
    { key: "../secret" }, { key: "syn-1" }, { key: "SYN-0" }, { key: "SYN-1?x=1" },
    { fields: {} }, { fields: { ...providerIssue().fields, summary: "" } },
    { fields: { ...providerIssue().fields, summary: "   " } },
    { fields: { ...providerIssue().fields, summary: "x".repeat(513) } },
    { fields: { ...providerIssue().fields, summary: "hello\nworld" } },
    { fields: { ...providerIssue().fields, status: { name: "x".repeat(201) } } },
    { fields: { ...providerIssue().fields, status: { name: "" } } },
    { fields: { ...providerIssue().fields, project: { id: "0" } } },
    { fields: { ...providerIssue().fields, updated: "not a date" } },
    { fields: { ...providerIssue().fields, updated: "2026-02-30T10:00:00Z" } },
    { fields: { ...providerIssue().fields, updated: "2026-10-01T25:00:00Z" } },
    { fields: { ...providerIssue().fields, updated: "2026-10-01T10:00:00+9900" } },
  ])("rejects invalid native identity and summary/timestamp metadata %#", async invalid => {
    respond({ ...page(), issues: [{ ...providerIssue(), ...invalid }] });
    await expect(listJiraIssuePage(credentials, ["10001"])).rejects.toThrow();
  });

  it.each([
    ["2026-10-01T12:30:00.000+0230", "2026-10-01T10:00:00.000Z"],
    ["2026-10-01T10:00:00Z", "2026-10-01T10:00:00.000Z"],
    ["2026-10-01T11:00:00+01:00", "2026-10-01T10:00:00.000Z"],
  ])("normalizes Jira timestamp %s to UTC", async (updated, normalized) => {
    const issue = providerIssue();
    respond({ ...page(), issues: [{ ...issue, fields: { ...issue.fields, updated } }] });
    const result = await listJiraIssuePage(credentials, ["10001"]);
    expect(result.issues[0]!.updatedAt).toBe(normalized);
  });

  it("propagates provider failure without yielding a partial page or additional requests", async () => {
    vi.mocked(repositoryProviderJson).mockRejectedValueOnce(new Error("Provider request failed (403)"));
    await expect(listJiraIssuePage(credentials, ["10001"])).rejects.toThrow("Provider request failed (403)");
    expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
  });

  it("validates persisted summaries and strips extras without trusting arbitrary links", () => {
    expect(jiraIssueSchema.parse({ ...expectedIssue(), description: "private" })).toEqual(expectedIssue());
    for (const url of ["https://evil.example/browse/SYN-1", `${credentials.siteUrl}/browse/OTHER-1`,
      `${credentials.siteUrl}/browse/SYN-1?x=1`, `${credentials.siteUrl}/browse/SYN-1#x`,
      "https://user:pass@synthetic.atlassian.net/browse/SYN-1", "http://synthetic.atlassian.net/browse/SYN-1"])
      expect(jiraIssueSchema.safeParse({ ...expectedIssue(), url }).success).toBe(false);
  });
});
