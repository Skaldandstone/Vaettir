import { z } from "zod";

// Browser-pure metadata contract. Private connector/device/processing inputs do
// not belong in this hosted read. IDs are exact; never trim or infer a mapping.
const identity = z.string().min(1).max(200).refine(value => !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) && new TextEncoder().encode(value).length <= 800);
export const deviceCaptureAccessInput = z.object({
  projectId: identity,
  originalOrganizationId: identity,
  expectedClerkActorId: identity,
  expectedNativeActorId: identity,
  readRequestId: z.string().uuid(),
}).strict();
export const deviceCaptureAccessScope = z.object({
  projectId: identity, organizationId: identity,
  nativeActorId: identity, clerkActorId: identity,
}).strict();
export const deviceCaptureAccessOutput = z.object({
  readRequestId: z.string().uuid(),
  requestKey: z.string().regex(/^[a-f0-9]{64}$/),
  scope: deviceCaptureAccessScope,
  role: z.enum(["OWNER", "ADMIN", "EDITOR"]),
  seatType: z.literal("FULL"),
  authorization: z.literal("CURRENT_LOCKED_FULL_EDITOR_READ"),
  processingPermissionGranted: z.literal(false),
  foregroundTargetVerified: z.literal(false),
  deviceOperationPerformed: z.literal(false),
}).strict();
export type DeviceCaptureAccessInput = z.infer<typeof deviceCaptureAccessInput>;
export type DeviceCaptureAccessOutput = z.infer<typeof deviceCaptureAccessOutput>;
export type DeviceCaptureOrigin = z.infer<typeof deviceCaptureAccessScope>;

// Existing semantic-capture limits, without the server generation parser's
// trims. Client admission either retains exact text or refuses the whole body.
const namedText = (maximum: number) => z.string().min(1).max(maximum).refine(value => value.trim().length > 0);
export const ownedDeviceSemanticCapture = z.object({
  version: z.literal(1), source: z.enum(["ANDROID_ADB", "IOS_CONNECTED", "IOS_REMOTE"]),
  deviceName: namedText(200), appName: namedText(200).optional(), capturedAt: z.string().datetime(),
  screens: z.array(z.object({ id: namedText(120), label: namedText(200),
    elements: z.array(z.object({ role: namedText(80), name: namedText(200),
      stableId: namedText(200).optional(), selector: namedText(500).optional(),
      event: namedText(80).optional(), route: namedText(500).optional(),
    }).strict()).max(150),
  }).strict()).min(1).max(25),
}).strict();
export type OwnedDeviceSemanticCapture = z.infer<typeof ownedDeviceSemanticCapture>;

/** Exact property order shared by native and browser SHA256 implementations. */
export function deviceCaptureAccessRequestText(raw: DeviceCaptureAccessInput) {
  const input = deviceCaptureAccessInput.parse(raw);
  return JSON.stringify({ kind: "DEVICE_CAPTURE_ACCESS", input: {
    projectId: input.projectId, originalOrganizationId: input.originalOrganizationId,
    expectedClerkActorId: input.expectedClerkActorId, expectedNativeActorId: input.expectedNativeActorId,
    readRequestId: input.readRequestId,
  } });
}
