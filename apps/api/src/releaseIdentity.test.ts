import { describe, expect, it } from "vitest";
import { getReleaseIdentity } from "./releaseIdentity.js";

describe("getReleaseIdentity", () => {
  it("reports a fully verifiable immutable release", () => {
    expect(
      getReleaseIdentity({
        VAETTIR_RELEASE_COMMIT: "a".repeat(40),
        VAETTIR_IMAGE_DIGEST: `sha256:${"b".repeat(64)}`,
      }),
    ).toEqual({
      commit: "a".repeat(40),
      imageDigest: `sha256:${"b".repeat(64)}`,
      verifiable: true,
    });
  });

  it("fails closed for missing or malformed identity values", () => {
    expect(
      getReleaseIdentity({
        VAETTIR_RELEASE_COMMIT: "latest",
        VAETTIR_IMAGE_DIGEST: "sha256:not-a-digest",
      }),
    ).toEqual({ commit: null, imageDigest: null, verifiable: false });
  });
});
