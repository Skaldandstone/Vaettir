export function productionSignalAdmin(member: { role: string; seatType: string } | null) {
  return !!member && member.seatType === "FULL" && ["ADMIN", "OWNER"].includes(member.role);
}
