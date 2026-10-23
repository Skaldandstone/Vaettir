import { describe, expect, it, vi } from "vitest";
import { reportPrivilegedAccessDenied } from "./securityEvents.js";

describe("reportPrivilegedAccessDenied", () => {
  it("emits a bounded structured event without identity or credential values", () => {
    const warn = vi.fn();

    reportPrivilegedAccessDenied(
      { warn },
      {
        surface: "staff_token",
        reason: "staff_token_missing_or_invalid",
        tokenPresented: true,
        actorHeaderPresented: true,
      },
    );

    expect(warn).toHaveBeenCalledWith(
      {
        securityEvent: {
          type: "privileged_access_denied",
          surface: "staff_token",
          reason: "staff_token_missing_or_invalid",
          tokenPresented: true,
          actorHeaderPresented: true,
        },
      },
      "Privileged access denied",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /token-value|actor@example\.com/,
    );
  });

  it("is safe when no request logger is available", () => {
    expect(() =>
      reportPrivilegedAccessDenied(undefined, {
        surface: "staff_email",
        reason: "email_not_allowlisted",
      }),
    ).not.toThrow();
  });
});
