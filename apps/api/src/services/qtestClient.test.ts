import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAllModules, fetchTestCasesInModule, QTestApiError, type QTestConnection, type QTestModule, type QTestTestCase } from "./qtestClient.js";

// A real, publicly-resolvable domain (same reasoning as urlGuard.test.ts's
// own passing-case test) - assertPublicHttpUrl does a genuine DNS lookup,
// so a made-up hostname would fail the guard before fetch is ever mocked.
const CONN: QTestConnection = { baseUrl: "https://example.com", apiToken: "tok_123" };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("fetchAllModules", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("walks the module tree by recursing on parent_id, sending the Bearer token", async () => {
    const root: QTestModule[] = [{ id: 1, pid: "MD-1", name: "Root A", parent_id: null }];
    const childrenOfRoot: QTestModule[] = [{ id: 2, pid: "MD-2", name: "Child", parent_id: 1 }];
    const mocked = vi.mocked(global.fetch);
    mocked.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (!url.searchParams.has("parent_id")) return jsonResponse(root);
      if (url.searchParams.get("parent_id") === "1") return jsonResponse(childrenOfRoot);
      return jsonResponse([]);
    });

    const modules = await fetchAllModules(CONN, 42);
    expect(modules.map((m) => m.id)).toEqual([1, 2]);
    expect(mocked.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: "Bearer tok_123" } });
  });

  it("throws QTestApiError with a clear message on a 401", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({}, false, 401));
    await expect(fetchAllModules(CONN, 42)).rejects.toThrow(QTestApiError);
    await expect(fetchAllModules(CONN, 42)).rejects.toThrow(/rejected the API token/);
  });

  it("rejects a private/unsafe baseUrl before ever calling fetch", async () => {
    const mocked = vi.mocked(global.fetch);
    await expect(fetchAllModules({ baseUrl: "http://localhost:8080", apiToken: "x" }, 1)).rejects.toThrow(QTestApiError);
    expect(mocked).not.toHaveBeenCalled();
  });
});

describe("fetchTestCasesInModule", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("paginates until a page shorter than the page size is returned", async () => {
    const page1: QTestTestCase[] = Array.from({ length: 100 }, (_, i) => ({ id: i, pid: `TC-${i}`, name: `Case ${i}` }));
    const page2: QTestTestCase[] = [{ id: 100, pid: "TC-100", name: "Last case" }];
    const mocked = vi.mocked(global.fetch);
    mocked.mockImplementation(async (input) => {
      const url = new URL(String(input));
      const page = url.searchParams.get("page");
      return jsonResponse(page === "1" ? page1 : page2);
    });

    const cases = await fetchTestCasesInModule(CONN, 42, 7);
    expect(cases).toHaveLength(101);
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it("stops after one page when the first page is already shorter than the page size", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse([{ id: 1, pid: "TC-1", name: "Only case" }]));
    const cases = await fetchTestCasesInModule(CONN, 42, 7);
    expect(cases).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces a network failure as QTestApiError rather than an unhandled rejection", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(fetchTestCasesInModule(CONN, 42, 7)).rejects.toThrow(QTestApiError);
  });
});
