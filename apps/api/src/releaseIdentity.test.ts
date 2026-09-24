import { describe, expect, it } from "vitest";
import {
  assertProductionReleaseIdentity,
  getReleaseIdentity,
} from "./releaseIdentity.js";

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

  it("rejects syntactically valid placeholder identity values", () => {
    expect(
      getReleaseIdentity({
        VAETTIR_RELEASE_COMMIT: "0".repeat(40),
        VAETTIR_IMAGE_DIGEST: `sha256:${"0".repeat(64)}`,
      }),
    ).toEqual({ commit: null, imageDigest: null, verifiable: false });
  });
});

describe("assertProductionReleaseIdentity", () => {
  it("requires a complete immutable identity in production", () => {
    expect(() =>
      assertProductionReleaseIdentity({ NODE_ENV: "production" }),
    ).toThrow(/Production startup requires/);
    expect(() =>
      assertProductionReleaseIdentity({
        NODE_ENV: "production",
        VAETTIR_RELEASE_COMMIT: "0".repeat(40),
        VAETTIR_IMAGE_DIGEST: `sha256:${"0".repeat(64)}`,
      }),
    ).toThrow(/Production startup requires/);

    expect(
      assertProductionReleaseIdentity({
        NODE_ENV: "production",
        VAETTIR_RELEASE_COMMIT: "a".repeat(40),
        VAETTIR_IMAGE_DIGEST: `sha256:${"b".repeat(64)}`,
      }),
    ).toEqual({
      commit: "a".repeat(40),
      imageDigest: `sha256:${"b".repeat(64)}`,
      verifiable: true,
    });
  });

  it("keeps local development and tests usable without release metadata", () => {
    expect(
      assertProductionReleaseIdentity({ NODE_ENV: "development" }),
    ).toEqual({
      commit: null,
      imageDigest: null,
      verifiable: false,
    });
    expect(assertProductionReleaseIdentity({ NODE_ENV: "test" })).toEqual({
      commit: null,
      imageDigest: null,
      verifiable: false,
    });
  });
});
