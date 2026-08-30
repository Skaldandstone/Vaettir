export function mobilePermissions(membership?: { role: string; seatType: string }) {
  const full = membership?.seatType === "FULL";
  return {
    canReview: full && ["OWNER", "ADMIN", "EDITOR"].includes(membership?.role ?? ""),
    canSignOff: full && ["OWNER", "ADMIN", "COMPLIANCE_AUDITOR"].includes(membership?.role ?? ""),
  };
}
