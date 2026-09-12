import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchJiraIssue, verifyJiraWebhookSecret, JiraApiError, type JiraConnection } from "./jiraApi.js";

const CONN: JiraConnection = { baseUrl: "https://acme.atlassian.net", email: "person@acme.com", apiToken: "tok_123" };

describe("verifyJiraWebhookSecret", () => {
  it("accepts a matching shared secret", () => {
    expect(verifyJiraWebhookSecret("shh-its-a-secret", "shh-its-a-secret")).toBe(true);
  });

  it("rejects a mismatched secret", () => {
    expect(verifyJiraWebhookSecret("wrong", "shh-its-a-secret")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyJiraWebhookSecret(undefined, "shh-its-a-secret")).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    expect(verifyJiraWebhookSecret("anything", "")).toBe(false);
  });
});

describe("fetchJiraIssue", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("authenticates with Basic base64(email:apiToken), not a bearer token", async () => {
    const mocked = vi.mocked(global.fetch);
    mocked.mockResolvedValue({
      ok: true,
      json: async () => ({ key: "PROJ-1", fields: { summary: "Fix bug", status: { name: "In Progress" } } }),
    } as Response);

    const issue = await fetchJiraIssue(CONN, "PROJ-1");
    expect(issue).toEqual({ key: "PROJ-1", summary: "Fix bug", statusName: "In Progress" });

    const expectedAuth = `Basic ${Buffer.from("person@acme.com:tok_123").toString("base64")}`;
    expect(mocked.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: expectedAuth } });
  });

  it("hits the real rest/api/3/issue/{key} path with fields=summary,status", async () => {
    const mocked = vi.mocked(global.fetch);
    mocked.mockResolvedValue({ ok: true, json: async () => ({ key: "PROJ-1", fields: { summary: "x", status: { name: "Done" } } }) } as Response);
    await fetchJiraIssue(CONN, "PROJ-1");
    const url = new URL(String(mocked.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/rest/api/3/issue/PROJ-1");
    expect(url.searchParams.get("fields")).toBe("summary,status");
  });

  it("throws a clear error on a 401/403", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response);
    await expect(fetchJiraIssue(CONN, "PROJ-1")).rejects.toThrow(/rejected the email\/API token/);
  });

  it("throws a clear not-found error on a 404", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response);
    await expect(fetchJiraIssue(CONN, "PROJ-999")).rejects.toThrow(/was not found/);
  });

  it("throws when the response is missing summary or status", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: async () => ({ key: "PROJ-1", fields: {} }) } as Response);
    await expect(fetchJiraIssue(CONN, "PROJ-1")).rejects.toThrow(JiraApiError);
  });
});
