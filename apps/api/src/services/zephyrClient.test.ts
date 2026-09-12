import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAllTestCases, fetchTestScript, ZephyrApiError, type ZephyrConnection, type ZephyrTestCase } from "./zephyrClient.js";

const CONN: ZephyrConnection = { apiToken: "tok_123" };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("fetchAllTestCases", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("paginates via isLast, sending the Bearer token", async () => {
    const page1Values: ZephyrTestCase[] = Array.from({ length: 100 }, (_, i) => ({ key: `PROJ-T${i}`, name: `Case ${i}` }));
    const page2Values: ZephyrTestCase[] = [{ key: "PROJ-T100", name: "Last case" }];
    const mocked = vi.mocked(global.fetch);
    mocked.mockImplementation(async (input) => {
      const url = new URL(String(input));
      const startAt = Number(url.searchParams.get("startAt"));
      if (startAt === 0) return jsonResponse({ startAt: 0, maxResults: 100, isLast: false, values: page1Values });
      return jsonResponse({ startAt: 100, maxResults: 100, isLast: true, values: page2Values });
    });

    const cases = await fetchAllTestCases(CONN, "PROJ");
    expect(cases).toHaveLength(101);
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(mocked.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: "Bearer tok_123" } });
  });

  it("stops after one page when isLast is true immediately", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ startAt: 0, maxResults: 100, isLast: true, values: [{ key: "PROJ-T1", name: "Only case" }] }),
    );
    const cases = await fetchAllTestCases(CONN, "PROJ");
    expect(cases).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("throws ZephyrApiError with a clear message on a 401", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({}, false, 401));
    await expect(fetchAllTestCases(CONN, "PROJ")).rejects.toThrow(/rejected the API token/);
  });
});

describe("fetchTestScript", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns the script when one exists", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ type: "plain", text: "Do the thing" }));
    expect(await fetchTestScript(CONN, "PROJ-T1")).toEqual({ type: "plain", text: "Do the thing" });
  });

  it("returns null (not an error) on a 404 - the case just has no script, it's step-by-step instead", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({}, false, 404));
    expect(await fetchTestScript(CONN, "PROJ-T1")).toBeNull();
  });

  it("still throws on a real error like a 500", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({}, false, 500));
    await expect(fetchTestScript(CONN, "PROJ-T1")).rejects.toThrow(ZephyrApiError);
  });
});
