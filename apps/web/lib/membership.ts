// P12-03: read-only seat UI enforcement. A VIEWER-role, READ_ONLY-seat
// member is already blocked server-side from every mutation (every write
// procedure requires at least EDITOR via requireProjectAccess/
// requireOrgRole), but the ticket's point is that seat type is a product
// experience, not just a permission check - edit/create affordances
// shouldn't be visible to click in the first place.
//
// READ_ONLY seats can only hold the VIEWER role (enforced server-side in
// inviteMember/updateMember), so checking seatType alone is sufficient -
// there's no READ_ONLY+EDITOR combination to also handle.
export function isReadOnlySeat(seatType: string | undefined): boolean {
  return seatType === "READ_ONLY";
}
