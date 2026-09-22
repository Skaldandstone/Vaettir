// P12-03: read-only seat UI enforcement. A VIEWER-role, READ_ONLY-seat
// member is already blocked server-side from every mutation (every write
// procedure requires at least EDITOR via requireProjectAccess/
// requireOrgRole), but the ticket's point is that seat type is a product
// experience, not just a permission check - edit/create affordances
// shouldn't be visible to click in the first place.
//
// Seat-only callers fail closed while membership is unknown. New write
// controls should also use the role-aware predicates below.
export function isReadOnlySeat(seatType: string | undefined): boolean {
  return seatType !== "FULL";
}

type Membership = { role: string; seatType: string } | null | undefined;

export function canEditProject(member: Membership): boolean {
  return member?.seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(member.role);
}

export function canAdministerOrganization(member: Membership): boolean {
  return member?.seatType === "FULL" && ["OWNER", "ADMIN"].includes(member.role);
}

export function canSignOffCompliance(member: Membership): boolean {
  return member?.seatType === "FULL" && ["OWNER", "ADMIN", "COMPLIANCE_AUDITOR"].includes(member.role);
}
