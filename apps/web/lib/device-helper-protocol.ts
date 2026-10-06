export type ExistingHelperV2Health = Readonly<{ connected: true; version: 2 }>;
export type PairedHelperLiveness = Readonly<{
  kind: "PAIRED_LIVENESS_ONLY"; reportedConnected: true; protocolVersion: 2;
  nativeTargetProofAvailable: false; operationReceiptAvailable: false;
  processingPermissionGranted: false; semanticRedactionGuaranteed: false;
  windowsLaunchAcceptanceVerified: false;
}>;
export const unsupportedHelperProtocolMessage = "The complete helper response is unsupported. No target verification, operation receipt, processing permission or semantic redaction was inferred.";

/** Exact EXISTING v2 metadata, not an attested process/device/source identity.
 * Never reinterpret unknown version/capability fields as this older protocol. */
export function decodeExistingHelperHealth(raw: unknown): ExistingHelperV2Health {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw Error(unsupportedHelperProtocolMessage);
  const descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(raw);
  if (keys.length !== 2 || keys.some(key => key !== "connected" && key !== "version") ||
    Object.values(descriptors).some(value => !value.enumerable || !Object.hasOwn(value, "value")) ||
    descriptors.connected?.value !== true || descriptors.version?.value !== 2) throw Error(unsupportedHelperProtocolMessage);
  return Object.freeze({ connected: true, version: 2 });
}
export function pairedHelperLiveness(raw: unknown): PairedHelperLiveness {
  decodeExistingHelperHealth(raw);
  return Object.freeze({ kind: "PAIRED_LIVENESS_ONLY", reportedConnected: true, protocolVersion: 2,
    nativeTargetProofAvailable: false, operationReceiptAvailable: false, processingPermissionGranted: false,
    semanticRedactionGuaranteed: false, windowsLaunchAcceptanceVerified: false });
}
export function helperLivenessDescription(value: PairedHelperLiveness) {
  return value.kind === "PAIRED_LIVENESS_ONLY"
    ? "A paired helper response reported protocol v2. This does not verify foreground app isolation, a completed operation, Windows policy acceptance or permission to capture/process source. Named control text may contain sensitive values."
    : unsupportedHelperProtocolMessage;
}
