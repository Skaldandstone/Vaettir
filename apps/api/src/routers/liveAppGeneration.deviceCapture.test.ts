import { describe, expect, it } from "vitest";
import { deviceCaptureInput } from "./liveAppGeneration.js";

const validCapture = {
  version: 1 as const,
  source: "ANDROID_ADB" as const,
  deviceName: "Pixel 9",
  appName: "Example",
  capturedAt: "2026-09-24T19:00:00.000Z",
  screens: [
    {
      id: "screen-1",
      label: "Sign in",
      elements: [{ role: "button", name: "Continue" }],
    },
  ],
};

describe("device capture input", () => {
  it("accepts a bounded semantic device capture", () => {
    expect(deviceCaptureInput.parse(validCapture)).toEqual(validCapture);
  });

  it("rejects raw hierarchy and credential fields", () => {
    expect(() =>
      deviceCaptureInput.parse({
        ...validCapture,
        rawHierarchy: "<xml />",
        appiumAccessKey: "secret",
      }),
    ).toThrow();
  });

  it("rejects more than 25 screens or 150 elements per screen", () => {
    expect(() =>
      deviceCaptureInput.parse({
        ...validCapture,
        screens: Array.from({ length: 26 }, (_, index) => ({
          id: `screen-${index}`,
          label: `Screen ${index}`,
          elements: [{ role: "button", name: "Continue" }],
        })),
      }),
    ).toThrow();
    expect(() =>
      deviceCaptureInput.parse({
        ...validCapture,
        screens: [
          {
            ...validCapture.screens[0],
            elements: Array.from({ length: 151 }, (_, index) => ({
              role: "button",
              name: `Control ${index}`,
            })),
          },
        ],
      }),
    ).toThrow();
  });
});
