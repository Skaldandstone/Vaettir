import { describe, expect, it, vi } from "vitest";
import { createIdentityDirectoryGroupReader } from "./identityDirectoryGroupReader.js";

const directory = { object: "directory", id: "dir_test", enterprise_connection_id: "ec_test",
  enabled: true, paused: false, updated_at: 1, api_key: "SYNTHETIC-OMIT" };
const group = { object: "directory_group", id: "group_test", updated_at: 1, display_name: "Not an identifier" };
const member = (id = "external_one", user_id: string | null = "user_one") => ({ object: "directory_group_member", id, user_id });
const page = (data = [member()], next: string | null = null) => ({ data,
  cursor: { has_next_page: next !== null, starting_after: next } });
function fixture(values: unknown[] = [directory, group, page(), group, directory]) {
  const responses = [...values];
  const request = vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200 }));
  const assertCurrent = vi.fn(async () => {});
  const reader = createIdentityDirectoryGroupReader({ directoryId: "dir_test", enterpriseConnectionId: "ec_test",
    secretKey: "sk_test_SYNTHETIC", fetch: request as typeof fetch, assertCurrent });
  return { reader, request, assertCurrent };
}
describe("internal directory group reader (synthetic transport only)", () => {
  it("uses authenticated fixed-origin GETs and retains null links without inferring subjects", async () => {
    const f = fixture([directory, group, page([member()], "next&cursor"), page([member("external_two", null)]), group, directory]);
    expect(await f.reader.readGroupMembers("group_test")).toEqual({ directoryId: "dir_test", enterpriseConnectionId: "ec_test",
      externalGroupId: "group_test", members: [{ externalSubjectId: "external_one", clerkSubject: "user_one" },
        { externalSubjectId: "external_two", clerkSubject: null }] });
    const calls = f.request.mock.calls as unknown as [string, RequestInit][];
    expect(calls).toHaveLength(6);
    expect(calls[3]![0]).toBe("https://api.clerk.com/v1/directories/dir_test/groups/group_test/members?limit=500&starting_after=next%26cursor");
    for (const [url, init] of calls) {
      expect(new URL(url).origin).toBe("https://api.clerk.com");
      expect(init).toMatchObject({ method: "GET", redirect: "error",
        headers: { Authorization: "Bearer sk_test_SYNTHETIC", "Cache-Control": "no-store" } });
    }
    expect(f.assertCurrent).toHaveBeenCalledTimes(7);
  });
  it.each([
    { ...directory, id: "other" }, { ...directory, enterprise_connection_id: "other" },
    { ...directory, enabled: false }, { ...directory, paused: true },
  ])("rejects wrong or inactive directory before reading any group", async value => {
    const f = fixture([value]);
    await expect(f.reader.readGroupMembers("group_test")).rejects.toThrow("Directory group evidence is unavailable");
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    [directory, { ...group, id: "other" }],
    [directory, group, page(), { ...group, updated_at: 2 }, directory],
    [directory, group, page(), group, { ...directory, updated_at: 2 }],
    [directory, group, page(), group, { ...directory, paused: true }],
  ].map(values => ({ values })))("rejects mismatched or changed provider bindings and group revisions", async ({ values }) => {
    await expect(fixture(values).reader.readGroupMembers("group_test")).rejects.toThrow("Directory group evidence is unavailable");
  });
  it.each([
    [page([member()], "loop"), page([member("two")], "loop")],
    [page([member()], "next"), page([member()])],
    [{ data: [member()], cursor: { has_next_page: true } }],
    [page([], "next")], [{ data: [member()] }],
    [{ data: [{ id: "one", object: "directory_group_member" }], cursor: { has_next_page: false } }],
  ].map(pages => ({ pages })))("rejects incomplete, looping, duplicate or malformed pagination instead of returning partial results", async ({ pages }) => {
    await expect(fixture([directory, group, ...pages]).reader.readGroupMembers("group_test")).rejects.toThrow("Directory group evidence is unavailable");
  });
  it("does not treat a provider 404 as an empty group or deletion receipt", async () => {
    const f = fixture();
    f.request.mockImplementation(async () => new Response("private provider detail", { status: 404 }));
    await expect(f.reader.readGroupMembers("group_test")).rejects.toThrow(/^Directory group evidence is unavailable\. Start a fresh read\.$/);
  });
  it("bounds endless otherwise valid pagination without publishing partial results", async () => {
    const pages = Array.from({ length: 100 }, (_, i) => page([member(`external_${i}`)], `cursor_${i}`));
    const f = fixture([directory, group, ...pages]);
    await expect(f.reader.readGroupMembers("group_test")).rejects.toThrow("Directory group evidence is unavailable");
    expect(f.request).toHaveBeenCalledTimes(102);
  });
  it("encodes provider group IDs as a path segment rather than a URL or query", async () => {
    const f = fixture([directory, { ...group, id: "a/b?c#d" }, page([]), { ...group, id: "a/b?c#d" }, directory]);
    expect((await f.reader.readGroupMembers("a/b?c#d")).members).toEqual([]);
    const calls = f.request.mock.calls as unknown as [string, RequestInit][];
    expect(calls[1]![0]).toBe("https://api.clerk.com/v1/directories/dir_test/groups/a%2Fb%3Fc%23d");
  });
  it("rechecks caller scope at the end and discards results after revocation", async () => {
    const f = fixture(); let calls = 0;
    f.assertCurrent.mockImplementation(async () => { if (++calls === 6) throw new Error("private scope detail"); });
    await expect(f.reader.readGroupMembers("group_test")).rejects.toThrow(/^Directory group evidence is unavailable\. Start a fresh read\.$/);
  });
  it("stops before network access when caller authorization is unavailable", async () => {
    const f = fixture(); f.assertCurrent.mockRejectedValue(new Error("revoked"));
    await expect(f.reader.readGroupMembers("group_test")).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
  it("rejects oversized responses and redacts transport error details", async () => {
    const f = fixture();
    f.request.mockImplementation(async () => new Response("x".repeat(1048577)));
    await expect(f.reader.readGroupMembers("group_test")).rejects.toThrow(/^Directory group evidence is unavailable\. Start a fresh read\.$/);
    f.request.mockRejectedValue(new Error("sk_test_SYNTHETIC raw provider error"));
    await expect(f.reader.readGroupMembers("group_test")).rejects.toThrow(/^Directory group evidence is unavailable\. Start a fresh read\.$/);
  });
  it.each([".", "..", "\n", ""])("rejects unsafe group ID %j without requests", async id => {
    const f = fixture(); await expect(f.reader.readGroupMembers(id)).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
});
