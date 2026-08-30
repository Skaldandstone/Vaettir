import { describe, expect, it } from "vitest";
import { mobilePermissions } from "../../../mobile/lib/permissions.js";

describe("Mobile permission affordances", () => {
  it("fails closed without membership", () => expect(mobilePermissions()).toEqual({ canReview: false, canSignOff: false }));
  it.each(["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"])("never grants write affordances to a read-only %s", (role) => {
    expect(mobilePermissions({ role, seatType: "READ_ONLY" })).toEqual({ canReview: false, canSignOff: false });
  });
  it("separates editing from auditor authority", () => {
    expect(mobilePermissions({ role: "EDITOR", seatType: "FULL" })).toEqual({ canReview: true, canSignOff: false });
    expect(mobilePermissions({ role: "COMPLIANCE_AUDITOR", seatType: "FULL" })).toEqual({ canReview: false, canSignOff: true });
  });
});
