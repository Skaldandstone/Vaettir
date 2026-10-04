// Client-side transport scope, not a substitute for server token verification.
export type AuthTransportScope = Readonly<{
  userId: string;
  sessionId: string;
}>;
export type AuthTransportSession = {
  id: string;
  user: { id: string };
  getToken(): Promise<string | null>;
};

export async function scopedSessionHeaders(
  scope: AuthTransportScope | null,
  currentSession: () => AuthTransportSession | null | undefined,
): Promise<Record<string, string>> {
  const session = currentSession();
  const matches = (value: AuthTransportSession | null | undefined) =>
    !!scope && value?.id === scope.sessionId && value.user.id === scope.userId;
  if (!matches(session))
    throw new Error(
      "Authentication changed. Return to the original account before retrying this request.",
    );
  const token = await session!.getToken();
  // Account switches during asynchronous token retrieval must not dispatch a
  // retained request with the next account's bearer token.
  if (!token || !matches(currentSession()))
    throw new Error(
      "The original authenticated session is no longer available.",
    );
  return { authorization: `Bearer ${token}` };
}
