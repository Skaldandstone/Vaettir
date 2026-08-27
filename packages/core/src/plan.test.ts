import { describe, it, expect } from "vitest";
import { canAddSeat, minimumTierForSeatCount, type PlanTierLimits } from "./plan.js";

const FREE: PlanTierLimits = { key: "free", minFullSeats: 1, maxFullSeats: 3, includedReadOnlySeats: 0, maxReadOnlySeats: 0 };
const TEAM: PlanTierLimits = { key: "team", minFullSeats: 4, maxFullSeats: 50, includedReadOnlySeats: 10, maxReadOnlySeats: 10 };
const BUSINESS: PlanTierLimits = { key: "business", minFullSeats: 51, maxFullSeats: 75, includedReadOnlySeats: 10, maxReadOnlySeats: null };
const CORP: PlanTierLimits = { key: "corp", minFullSeats: 76, maxFullSeats: null, includedReadOnlySeats: 10, maxReadOnlySeats: null };
const TIERS = [FREE, TEAM, BUSINESS, CORP];

describe("canAddSeat", () => {
  it("allows a full seat under the tier's cap", () => {
    expect(canAddSeat(FREE, { fullSeats: 2, readOnlySeats: 0 }, "FULL").allowed).toBe(true);
  });

  it("rejects a full seat at the tier's cap", () => {
    const result = canAddSeat(FREE, { fullSeats: 3, readOnlySeats: 0 }, "FULL");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("full seat limit");
  });

  it("allows unlimited full seats when maxFullSeats is null", () => {
    expect(canAddSeat(CORP, { fullSeats: 500, readOnlySeats: 0 }, "FULL").allowed).toBe(true);
  });

  it("rejects any read-only seat when the tier includes zero (Free)", () => {
    const result = canAddSeat(FREE, { fullSeats: 0, readOnlySeats: 0 }, "READ_ONLY");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("does not include read-only seats");
  });

  it("rejects a read-only seat at the tier's read-only cap", () => {
    const result = canAddSeat(TEAM, { fullSeats: 5, readOnlySeats: 10 }, "READ_ONLY");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("read-only seat limit");
  });

  it("allows unlimited read-only seats once maxReadOnlySeats is null (Business+)", () => {
    expect(canAddSeat(BUSINESS, { fullSeats: 60, readOnlySeats: 1000 }, "READ_ONLY").allowed).toBe(true);
  });
});

describe("minimumTierForSeatCount", () => {
  it("returns the tier whose range contains the seat count", () => {
    expect(minimumTierForSeatCount(TIERS, 2).key).toBe("free");
    expect(minimumTierForSeatCount(TIERS, 4).key).toBe("team");
    expect(minimumTierForSeatCount(TIERS, 50).key).toBe("team");
    expect(minimumTierForSeatCount(TIERS, 51).key).toBe("business");
    expect(minimumTierForSeatCount(TIERS, 76).key).toBe("corp");
  });

  it("falls through to the top tier when the count exceeds every bounded tier", () => {
    expect(minimumTierForSeatCount(TIERS, 100_000).key).toBe("corp");
  });

  it("throws on an empty tier list", () => {
    expect(() => minimumTierForSeatCount([], 5)).toThrow();
  });
});
