import { describe, it, expect } from "vitest";
import { tierHasFeature } from "./featureFlags.js";

describe("tierHasFeature", () => {
  it("returns false for an empty enabledFeatures array", () => {
    expect(tierHasFeature({ enabledFeatures: [] }, "some-flag")).toBe(false);
  });

  it("returns true when the flag is present", () => {
    expect(tierHasFeature({ enabledFeatures: ["some-flag", "other-flag"] }, "some-flag")).toBe(true);
  });

  it("returns false for a flag not in the list", () => {
    expect(tierHasFeature({ enabledFeatures: ["other-flag"] }, "some-flag")).toBe(false);
  });
});
