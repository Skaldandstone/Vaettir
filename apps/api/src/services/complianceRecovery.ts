import { TRPCError } from "@trpc/server";
/** Recovery images must contain this guard. Legacy images ignore the setting. */
export function assertComplianceAvailable() {
  const recovery = process.env.VAETTIR_COMPLIANCE_RECOVERY_MODE;
  if (recovery && recovery !== "enabled")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Compliance is temporarily unavailable in recovery mode. Existing records are preserved.",
    });
}
