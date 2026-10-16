/** Short-lived Forge access tokens and the signed FIT must never be included
 * in error-report request headers, including mixed-case SDK representations. */
export function withoutForgeCredentials(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) =>
        ![
          "authorization",
          "cookie",
          "x-forge-oauth-user",
          "x-forge-oauth-system",
        ].includes(key.toLowerCase()),
    ),
  );
}
