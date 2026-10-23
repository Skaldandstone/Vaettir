import { describe, expect, it } from "vitest";
import {
  observedAndroidObject,
  observedNavigationStep,
  navigationTechnicalAction,
} from "./androidExplorationSchema.js";
function step() {
  return {
    sequence: 1,
    action: { kind: "TAP" as const, label: "Browse", targetId: "a".repeat(64) },
    from: { id: "b".repeat(64), label: "Home" },
    to: { id: "c".repeat(64), label: "Catalog" },
    observedAt: "2026-10-22T15:01:00.000Z",
    execution: {
      transport: "ADB" as const,
      connector: {
        method: "POST" as const,
        path: "/exploration/v1/next" as const,
        requestId: "11111111-1111-4111-8111-111111111111",
      },
      commandArgs: ["shell", "input", "tap", "50", "50"] as [
        "shell",
        "input",
        "tap",
        string,
        string,
      ],
      target: {
        packageName: "com.example.synthetic",
        objectId: "com.example.synthetic:id/browse",
        className: "android.widget.Button",
        selector: {
          kind: "RESOURCE_ID" as const,
          value: "com.example.synthetic:id/browse",
        },
        bounds: [0, 0, 100, 100] as [number, number, number, number],
      },
      appNetwork: {
        status: "NOT_CAPTURED" as const,
        reason: "APP_NETWORK_INSPECTION_NOT_CONNECTED" as const,
      },
    },
  };
}
describe("Android technical step admission", () => {
  it("retains the exact native object and dispatched command, keeping device identity symbolic", () => {
    const value = observedNavigationStep.parse(step()),
      formatted = navigationTechnicalAction(value);
    expect(formatted).toContain('objectId="com.example.synthetic:id/browse"');
    expect(formatted).toContain(
      "adb -s <selected-device> shell input tap 50 50",
    );
    expect(formatted).toContain("connector=POST /exploration/v1/next");
    expect(value.execution.appNetwork.status).toBe("NOT_CAPTURED");
  });
  it("rejects inconsistent resource ids, inverted geometry and a text locator missing its class", () => {
    const target = step().execution.target;
    expect(
      observedAndroidObject.safeParse({
        ...target,
        selector: { kind: "RESOURCE_ID", value: "made-up" },
      }).success,
    ).toBe(false);
    expect(
      observedAndroidObject.safeParse({ ...target, bounds: [0, 0, 0, 100] })
        .success,
    ).toBe(false);
    expect(
      observedAndroidObject.safeParse({
        ...target,
        className: null,
        selector: { kind: "TEXT_CLASS", value: "Browse" },
      }).success,
    ).toBe(false);
    expect(
      observedAndroidObject.safeParse({
        ...target,
        selector: { kind: "BOUNDS_ONLY", value: "50,50" },
      }).success,
    ).toBe(false);
  });
  it("rejects a command or action that does not match the actual observed bounds", () => {
    const value = step();
    value.execution.commandArgs[3] = "51";
    expect(observedNavigationStep.safeParse(value).success).toBe(false);
    const wrongAction = {
      ...step(),
      action: { ...step().action, kind: "SCROLL" },
    };
    expect(observedNavigationStep.safeParse(wrongAction).success).toBe(false);
  });
  it("refuses unimplemented backend capture claims and extra request contents", () => {
    const value = step();
    expect(
      observedNavigationStep.safeParse({
        ...value,
        execution: {
          ...value.execution,
          appNetwork: {
            status: "CAPTURED",
            method: "GET",
            url: "https://example.invalid",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      observedNavigationStep.safeParse({
        ...value,
        execution: {
          ...value.execution,
          appNetwork: {
            ...value.execution.appNetwork,
            authorization: "PRIVATE",
          },
        },
      }).success,
    ).toBe(false);
  });
});
