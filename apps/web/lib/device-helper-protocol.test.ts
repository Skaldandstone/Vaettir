import { describe, expect, it } from "vitest";
import { decodeExistingHelperHealth, helperLivenessDescription, pairedHelperLiveness, unsupportedHelperProtocolMessage } from "./device-helper-protocol";

describe("existing v2 paired-liveness metadata, not capture authority", () => {
  it("admits only the exact current health shape and freezes the known result", () => {
    expect(decodeExistingHelperHealth({ connected: true, version: 2 })).toEqual({ connected: true, version: 2 });
    expect(Object.isFrozen(decodeExistingHelperHealth({ connected: true, version: 2 }))).toBe(true);
  });
  it.each([null, [], { connected: true }, { connected: false, version: 2 }, { connected: true, version: "2" },
    { connected: true, version: 3 }, { connected: true, version: 2, capabilities: ["target-proof"] },
    { connected: true, version: 2, error: "private named control" }])("refuses unsupported complete responses without legacy fallback: %j", raw => {
    expect(() => decodeExistingHelperHealth(raw)).toThrow(unsupportedHelperProtocolMessage);
  });
  it("does not execute getters or inherited/symbol/hidden response metadata", () => {
    let calls = 0;
    const getter = { get connected() { calls++; return true; }, version: 2 };
    const inherited = Object.create({ connected: true }) as object;
    const hidden = Object.defineProperty({ connected: true, version: 2 }, "extra", { value: "private" });
    for (const raw of [getter, inherited, hidden, { connected: true, version: 2, [Symbol("private")]: true }]) expect(() => decodeExistingHelperHealth(raw)).toThrow(unsupportedHelperProtocolMessage);
    expect(calls).toBe(0);
  });
  it("expressly refuses target/receipt/processing/redaction/Windows acceptance claims", () => {
    const liveness = pairedHelperLiveness({ connected: true, version: 2 });
    expect(liveness).toEqual({ kind: "PAIRED_LIVENESS_ONLY", reportedConnected: true, protocolVersion: 2,
      nativeTargetProofAvailable: false, operationReceiptAvailable: false, processingPermissionGranted: false,
      semanticRedactionGuaranteed: false, windowsLaunchAcceptanceVerified: false });
    expect(helperLivenessDescription(liveness)).toContain("Named control text may contain sensitive values");
  });
});
