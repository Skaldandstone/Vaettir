import { z } from "zod";
import { deviceCaptureAccessScope } from "./deviceCaptureAccessSchema.js";

// Browser-pure primitive metadata only. First establishment is CURRENT and
// cannot supply or attribute original ownership of legacy paid/source drafts.
const identity = deviceCaptureAccessScope.shape.projectId;
export const deviceHelperSetupAccessInput = z.object({
  kind: z.literal("ESTABLISH_CURRENT_SETUP_SCOPE"),
  projectId: identity,
  originalOrganizationId: identity,
  expectedClerkActorId: identity,
  readRequestId: z.string().uuid(),
}).strict();
export const deviceHelperSetupAccessOutput = z.object({
  readRequestId: z.string().uuid(),
  requestKey: z.string().regex(/^[a-f0-9]{64}$/),
  scope: deviceCaptureAccessScope,
  role: z.enum(["OWNER", "ADMIN", "EDITOR"]),
  seatType: z.literal("FULL"),
  authorization: z.literal("CURRENT_LOCKED_FULL_EDITOR_READ"),
  identityEstablishment: z.literal("CURRENT_SETUP_SCOPE_ONLY"),
  deviceOperationPerformed: z.literal(false),
  helperLaunchPerformed: z.literal(false),
  windowsLaunchAcceptanceVerified: z.literal(false),
  foregroundTargetVerified: z.literal(false),
  captureConsentGranted: z.literal(false),
  processingPermissionGranted: z.literal(false),
  spendingApprovalGranted: z.literal(false),
  legacyDraftAttributionVerified: z.literal(false),
}).strict();
export type DeviceHelperSetupAccessInput = z.infer<typeof deviceHelperSetupAccessInput>;
export type DeviceHelperSetupAccessOutput = z.infer<typeof deviceHelperSetupAccessOutput>;
export const DEVICE_HELPER_SETUP_INPUT_BYTES = 4096;
export const DEVICE_HELPER_SETUP_OUTPUT_BYTES = 8192;

/** Validated flat primitive DTOs only, not a private-source serialization API. */
export function deviceHelperSetupMetadataBytes(value: DeviceHelperSetupAccessInput | DeviceHelperSetupAccessOutput) {
  const input = deviceHelperSetupAccessInput.safeParse(value);
  if (input.success) return new TextEncoder().encode(JSON.stringify(input.data)).length;
  const output = deviceHelperSetupAccessOutput.safeParse(value);
  if (!output.success) throw Error("Complete setup identity metadata is unsupported.");
  return new TextEncoder().encode(JSON.stringify(output.data)).length;
}
export function deviceHelperSetupAccessRequestText(raw: DeviceHelperSetupAccessInput) {
  const input = deviceHelperSetupAccessInput.parse(raw);
  if (deviceHelperSetupMetadataBytes(input) > DEVICE_HELPER_SETUP_INPUT_BYTES) throw Error("Complete setup identity metadata exceeds its supported bound.");
  return JSON.stringify({ kind: "DEVICE_HELPER_SETUP_ACCESS", input: {
    kind: input.kind, projectId: input.projectId, originalOrganizationId: input.originalOrganizationId,
    expectedClerkActorId: input.expectedClerkActorId, readRequestId: input.readRequestId,
  } });
}
