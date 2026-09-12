import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { fetchLinearIssue, verifyLinearSignature, LinearApiError } from "./linearApi.js";

describe("verifyLinearSignature", () => {
  const secret = "lin_wh_test_secret";
  const body = Buffer.from(JSON.stringify({ type: "Issue", action: "update" }));

  function sign(rawBody: Buffer, key: string): string {
    return createHmac("sha256", key).update(rawBody).digest("hex");
  }

  it("accepts a correctly computed bare-hex signature (no prefix)", () => {
    expect(verifyLinearSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    expect(verifyLinearSignature(body, sign(body, "wrong"), secret)).toBe(false);
  });

  it("rejects a signature computed over a tampered body", () => {
    const tampered = Buffer.from(JSON.stringify({ type: "Issue", action: "create" }));
    expect(verifyLinearSignature(body, sign(tampered, secret), secret)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyLinearSignature(body, undefined, secret)).toBe(false);
  });

  it("rejects a signature carrying a prefix like GitHub's or PagerDuty's - Linear's own format is bare hex", () => {
    expect(verifyLinearSignature(body, `sha256=${sign(body, secret)}`, secret)).toBe(false);
  });
});

describe("fetchLinearIssue", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends the API key as a raw Authorization header, no Bearer prefix", async () => {
    const mocked = vi.mocked(global.fetch);
    mocked.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { issue: { id: "abc", identifier: "ENG-1", title: "Fix bug", state: { name: "In Progress" }, url: "https://linear.app/x/issue/ENG-1" } } }),
    } as Response);

    const issue = await fetchLinearIssue("lin_api_key_123", "ENG-1");
    expect(issue).toEqual({ id: "abc", identifier: "ENG-1", title: "Fix bug", stateName: "In Progress", url: "https://linear.app/x/issue/ENG-1" });
    expect(mocked.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: "lin_api_key_123" } });
  });

  it("throws a clear error on a 401", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as Response);
    await expect(fetchLinearIssue("bad-key", "ENG-1")).rejects.toThrow(/rejected the API key/);
  });

  it("throws when the GraphQL response carries errors", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ message: "Entity not found" }] }),
    } as Response);
    await expect(fetchLinearIssue("key", "ENG-999")).rejects.toThrow(LinearApiError);
  });

  it("throws a clear error when the issue is null (not found or not visible to this key)", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true, json: async () => ({ data: { issue: null } }) } as Response);
    await expect(fetchLinearIssue("key", "ENG-999")).rejects.toThrow(/was not found/);
  });
});
