import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@vaettir/db";
import { deviceCaptureAccessScope } from "./deviceCaptureAccessSchema.js";
import { readDeviceCaptureAccess, type DeviceCaptureAuthentication } from "./deviceCaptureAccess.js";
import { DEVICE_HELPER_SETUP_INPUT_BYTES, DEVICE_HELPER_SETUP_OUTPUT_BYTES, deviceHelperSetupAccessInput,
  deviceHelperSetupAccessOutput, deviceHelperSetupAccessRequestText, deviceHelperSetupMetadataBytes,
  type DeviceHelperSetupAccessInput, type DeviceHelperSetupAccessOutput } from "./deviceHelperSetupAccessSchema.js";

const unsupported = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "The complete current setup identity metadata is unsupported. No identity was clipped or attributed to retained drafts." });
const denied = () => new TRPCError({ code: "FORBIDDEN", message: "Independently verified current native account and full editor workspace access are required. Retained requests were not rebound." });
export function deviceHelperSetupAccessRequestKey(input: DeviceHelperSetupAccessInput) {
  return createHash("sha256").update(deviceHelperSetupAccessRequestText(input)).digest("hex");
}

/** CURRENT first-establishment read only. Later caller reads must use
 * existing mandatory original native pins; this is not UNKNOWN recovery, a
 * historical ownership assertion, setup/device action or processing approval. */
export async function readDeviceHelperSetupAccess(db: PrismaClient, currentNativeUserId: string,
  raw: DeviceHelperSetupAccessInput, authentication: DeviceCaptureAuthentication): Promise<DeviceHelperSetupAccessOutput> {
  const parsed = deviceHelperSetupAccessInput.safeParse(raw);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Supply exact current setup metadata and a fresh read identity, without private device, source or session data." });
  const input = parsed.data;
  if (deviceHelperSetupMetadataBytes(input) > DEVICE_HELPER_SETUP_INPUT_BYTES) throw unsupported();
  const actor = deviceCaptureAccessScope.shape.nativeActorId.safeParse(currentNativeUserId);
  if (!actor.success) throw unsupported();
  if (!authentication?.authenticatedClerkSubject || authentication.authenticatedClerkSubject !== input.expectedClerkActorId) throw denied();
  const requestKey = deviceHelperSetupAccessRequestKey(input);
  // Reuse the exact independently verified four-lock scalar/native FULL read.
  // Required native pin is NOT weakened: CURRENT authenticated server actor is
  // supplied explicitly and the locked native mapping must match JWT subject.
  const access = await readDeviceCaptureAccess(db, actor.data, {
    projectId: input.projectId, originalOrganizationId: input.originalOrganizationId,
    expectedClerkActorId: input.expectedClerkActorId, expectedNativeActorId: actor.data,
    readRequestId: input.readRequestId,
  }, authentication);
  const output = deviceHelperSetupAccessOutput.safeParse({
    readRequestId: input.readRequestId, requestKey, scope: access.scope, role: access.role, seatType: access.seatType,
    authorization: access.authorization, identityEstablishment: "CURRENT_SETUP_SCOPE_ONLY",
    deviceOperationPerformed: false, helperLaunchPerformed: false, windowsLaunchAcceptanceVerified: false,
    foregroundTargetVerified: false, captureConsentGranted: false, processingPermissionGranted: false,
    spendingApprovalGranted: false, legacyDraftAttributionVerified: false,
  });
  if (!output.success || deviceHelperSetupMetadataBytes(output.data) > DEVICE_HELPER_SETUP_OUTPUT_BYTES) throw unsupported();
  return output.data;
}
