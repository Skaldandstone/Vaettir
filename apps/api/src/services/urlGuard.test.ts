import { describe, it, expect } from "vitest";
import { assertPublicHttpUrl, UnsafeUrlError } from "./urlGuard.js";

describe("assertPublicHttpUrl", () => {
  it("rejects the cloud metadata address", async () => {
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
  });

  it("rejects loopback addresses", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1:5432/")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects localhost by name", async () => {
    await expect(assertPublicHttpUrl("http://localhost:3000/")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects private RFC1918 ranges", async () => {
    await expect(assertPublicHttpUrl("http://10.0.0.5/")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicHttpUrl("http://192.168.1.1/")).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicHttpUrl("http://172.16.0.1/")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("rejects malformed URLs", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("accepts a public https URL", async () => {
    const url = await assertPublicHttpUrl("https://hooks.slack.com/services/T000/B000/xxx");
    expect(url.hostname).toBe("hooks.slack.com");
  });
});
