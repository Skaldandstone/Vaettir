// Minimal client-side session storage. The API is a separate Fastify
// service (not Next.js API routes), so session state is a bearer token this
// app attaches to every tRPC call, not a framework-managed cookie session.
const TOKEN_KEY = "tci_session_token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}
