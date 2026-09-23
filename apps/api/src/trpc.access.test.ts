import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isStaffEmail } from "./trpc.js";

const originalFullAccess = process.env.FULL_ACCESS_EMAIL_ALLOWLIST;
const originalLegacyAllowlist = process.env.STAFF_EMAIL_ALLOWLIST;

beforeEach(() => {
  delete process.env.FULL_ACCESS_EMAIL_ALLOWLIST;
  delete process.env.STAFF_EMAIL_ALLOWLIST;
});

afterEach(() => {
  if (originalFullAccess === undefined)
    delete process.env.FULL_ACCESS_EMAIL_ALLOWLIST;
  else process.env.FULL_ACCESS_EMAIL_ALLOWLIST = originalFullAccess;
  if (originalLegacyAllowlist === undefined)
    delete process.env.STAFF_EMAIL_ALLOWLIST;
  else process.env.STAFF_EMAIL_ALLOWLIST = originalLegacyAllowlist;
});

describe("full-access identity gate", () => {
  it("defaults to James's exact account", () => {
    expect(isStaffEmail("james@skaldandstone.com")).toBe(true);
    expect(isStaffEmail("JAMES@SKALDANDSTONE.COM ")).toBe(true);
  });

  it("does not grant access from the company domain alone", () => {
    expect(isStaffEmail("sales@skaldandstone.com")).toBe(false);
    expect(isStaffEmail("james+demo@skaldandstone.com")).toBe(false);
    expect(isStaffEmail("visitor@example.com")).toBe(false);
  });

  it("honors an explicit comma-separated deployment allowlist", () => {
    process.env.FULL_ACCESS_EMAIL_ALLOWLIST =
      "owner@example.com, second@example.com";
    expect(isStaffEmail("owner@example.com")).toBe(true);
    expect(isStaffEmail("second@example.com")).toBe(true);
    expect(isStaffEmail("james@skaldandstone.com")).toBe(false);
  });
});
