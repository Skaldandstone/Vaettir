import { beforeEach, describe, expect, it, vi } from "vitest";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = send; },
  HeadObjectCommand: class { constructor(public input: unknown) {} },
  GetObjectCommand: class {},
  PutObjectCommand: class {},
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));

describe("stored attachment metadata verification", () => {
  beforeEach(() => { vi.resetModules(); send.mockReset(); vi.stubEnv("TEST_ARTIFACTS_BUCKET", "synthetic-private-bucket"); });
  const expected = { sizeBytes: 123, contentType: "image/png" };
  it("uses one bounded metadata request and records storage identity, not file content", async () => {
    send.mockResolvedValue({ ContentLength: 123, ContentType: "image/png", ETag: '"synthetic-etag"', VersionId: "synthetic-version" });
    const { verifyStoredAttachment } = await import("./artifactStorage.js");
    const result = await verifyStoredAttachment("test-case-attachments/synthetic/key", expected);
    expect(result).toMatchObject({ etag: '"synthetic-etag"', versionId: "synthetic-version" });
    expect(Number.isFinite(Date.parse(result.verifiedAt))).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].input).toEqual({ Bucket: "synthetic-private-bucket", Key: "test-case-attachments/synthetic/key" });
    expect(send.mock.calls[0]?.[1].abortSignal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    { ContentLength: 124, ContentType: "image/png" },
    { ContentLength: 123, ContentType: "text/plain" },
    { ContentLength: undefined, ContentType: "image/png" },
    { ContentLength: 0, ContentType: "image/png" },
  ])("rejects absent or mismatched stored metadata %#", async head => {
    send.mockResolvedValue(head);
    const { verifyStoredAttachment } = await import("./artifactStorage.js");
    await expect(verifyStoredAttachment("synthetic/key", expected)).rejects.toThrow("does not match");
  });
  it("rejects an oversized object even if it matches its requested metadata", async () => {
    send.mockResolvedValue({ ContentLength: 26 * 1024 * 1024, ContentType: "image/png" });
    const { verifyStoredAttachment } = await import("./artifactStorage.js");
    await expect(verifyStoredAttachment("synthetic/key", { ...expected, sizeBytes: 26 * 1024 * 1024 })).rejects.toThrow("does not match");
  });
  it("sanitizes provider errors without accepting failed uploads", async () => {
    send.mockRejectedValue(new Error("synthetic sensitive transport detail"));
    const { verifyStoredAttachment } = await import("./artifactStorage.js");
    await expect(verifyStoredAttachment("synthetic/key", expected)).rejects.toThrow("Stored file could not be verified.");
  });
});
