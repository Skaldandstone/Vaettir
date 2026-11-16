import { afterEach, describe, expect, it, vi } from "vitest";
const guard = vi.hoisted(() => vi.fn());
vi.mock("./urlGuard.js", () => ({ assertPublicHttpUrl: guard }));
import { postReport, requireReportSlackDestination } from "./reportDelivery.js";
const url = "https://hooks.slack.com/services/SYNTHETIC/REPORT/NO_REAL_TOKEN";
const payload = { text: "Synthetic", blocks: [] };
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
describe("report delivery transport window", () => {
  it("rejects arbitrary hosts, redirects-as-destinations, credentials and query strings", () => {
    for (const target of [
      "http://hooks.slack.com/services/a/b/c",
      "https://example.invalid/services/a/b/c",
      "https://hooks.slack.com@127.0.0.1/services/a/b/c",
      url + "?next=elsewhere",
      url + "#fragment",
      null,
    ])
      expect(() => requireReportSlackDestination(target)).toThrow();
  });
  it("does not dispatch after an expired authorization window or stalled DNS check", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(postReport(url, payload, Date.now() - 1)).rejects.toThrow(
      /expired/,
    );
    expect(guard).not.toHaveBeenCalled();
    let resolve!: (value: string) => void;
    guard.mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const result = postReport(url, payload, Date.now() + 9000);
    const check = expect(result).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(2001);
    await check;
    resolve(url);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("bounds sending, refuses redirects and does not expose provider response text", async () => {
    guard.mockResolvedValue(url);
    const text = vi.fn(),
      cancel = vi.fn().mockResolvedValue(undefined);
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text, body: { cancel } });
    vi.stubGlobal("fetch", fetch);
    await expect(postReport(url, payload, Date.now() + 9000)).rejects.toThrow(
      "Report delivery outcome is unknown",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      redirect: "error",
      method: "POST",
    });
    expect(fetch.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    expect(text).not.toHaveBeenCalled();
  });
});
