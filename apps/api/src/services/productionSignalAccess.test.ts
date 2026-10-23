import { expect, it } from "vitest";
import { productionSignalAdmin } from "./productionSignalAccess.js";
it("full-access entitlement never replaces current full Admin/Owner membership", () => {
  for (const role of ["ADMIN", "OWNER"]) {
    expect(productionSignalAdmin({ role, seatType: "FULL" })).toBe(true);
    expect(productionSignalAdmin({ role, seatType: "READ_ONLY" })).toBe(false);
  }
  for (const role of ["EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"]) expect(productionSignalAdmin({ role, seatType: "FULL" })).toBe(false);
  expect(productionSignalAdmin(null)).toBe(false);
});
