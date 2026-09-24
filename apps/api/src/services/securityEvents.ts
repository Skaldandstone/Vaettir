export type PrivilegedAccessSurface =
  "staff_email" | "staff_token" | "live_app_scan";
export type PrivilegedAccessDenialReason =
  | "email_not_allowlisted"
  | "feature_not_allowlisted"
  | "staff_token_disabled"
  | "staff_token_missing_or_invalid";

export type SecurityEventLogger = {
  warn(bindings: Record<string, unknown>, message: string): void;
};

export function reportPrivilegedAccessDenied(
  logger: SecurityEventLogger | undefined,
  event: {
    surface: PrivilegedAccessSurface;
    reason: PrivilegedAccessDenialReason;
    tokenPresented?: boolean;
    actorHeaderPresented?: boolean;
  },
) {
  logger?.warn(
    {
      securityEvent: {
        type: "privileged_access_denied",
        surface: event.surface,
        reason: event.reason,
        ...(event.tokenPresented === undefined
          ? {}
          : { tokenPresented: event.tokenPresented }),
        ...(event.actorHeaderPresented === undefined
          ? {}
          : { actorHeaderPresented: event.actorHeaderPresented }),
      },
    },
    "Privileged access denied",
  );
}
