type RuntimeEnvironment = Record<string, string | undefined>;

const LOCAL_DEVELOPMENT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
];

function parseOrigin(value: string, variableName: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === "*") {
    throw new Error(
      `${variableName} must list exact origins; wildcard access is not allowed`,
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${variableName} contains an invalid origin`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${variableName} origins must use http or https`);
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      `${variableName} must contain origins only, without credentials, paths, queries, or fragments`,
    );
  }
  return url.origin;
}

export function allowedCorsOrigins(env: RuntimeEnvironment = process.env) {
  const origins = new Set<string>();
  const production = env.NODE_ENV === "production";

  if (!production) {
    for (const origin of LOCAL_DEVELOPMENT_ORIGINS) origins.add(origin);
  }

  const webAppOrigin = env.WEB_APP_URL
    ? parseOrigin(env.WEB_APP_URL, "WEB_APP_URL")
    : null;
  if (webAppOrigin) origins.add(webAppOrigin);

  for (const entry of (env.CORS_ALLOWED_ORIGINS ?? "").split(",")) {
    const origin = parseOrigin(entry, "CORS_ALLOWED_ORIGINS");
    if (origin) origins.add(origin);
  }

  return origins;
}

export function createCorsOriginPolicy(env: RuntimeEnvironment = process.env) {
  const allowed = allowedCorsOrigins(env);

  return (
    origin: string | undefined,
    callback: (error: Error | null, allowed: boolean) => void,
  ) => {
    // Requests without Origin are not browser cross-origin requests. This
    // preserves health probes, webhooks, native clients, and server-to-server
    // calls without weakening the browser boundary.
    callback(null, origin === undefined || allowed.has(origin));
  };
}
