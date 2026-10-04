// Test-only admission, NOT application authorization or cryptographic CI proof.
// Never return or interpolate connection credentials in diagnostics.
export function assertOwnedTestDatabase(
  configured: string | undefined,
  env: Record<string, string | undefined> = process.env,
): { route: "LOCAL_DISPOSABLE" | "GITHUB_SERVICE"; database: string } {
  const refuse = () => { throw Error("Exact owned disposable loopback test database required"); };
  if (!configured || configured !== configured.trim() || Array.from(configured).some(character => {
    const code = character.charCodeAt(0);
    return code <= 32 || code === 127;
  })) return refuse();
  let url: URL;
  try { url = new URL(configured); } catch { return refuse(); }
  if (!["postgresql:", "postgres:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      (url.port !== "" && url.port !== "5432") || url.hash) return refuse();
  const keys = [...url.searchParams.keys()];
  if (keys.some(key => !["schema", "connection_limit"].includes(key)) || new Set(keys).size !== keys.length ||
      (url.searchParams.has("schema") && url.searchParams.get("schema") !== "public") ||
      (url.searchParams.has("connection_limit") && !/^[1-5]$/.test(url.searchParams.get("connection_limit")!))) return refuse();
  if (/^\/vaettir_(?:day|away_full)_test_[0-9]{13}$/.test(url.pathname)) {
    return { route: "LOCAL_DISPOSABLE", database: url.pathname.slice(1) };
  }
  const ref = env.GITHUB_REF ?? "";
  const validRef = /^(?:refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}|refs\/pull\/[1-9][0-9]{0,19}\/merge)$/.test(ref) &&
    !ref.includes("..") && !ref.includes("//") && !ref.endsWith("/");
  // This exact service is configured in .github/workflows/ci.yml. Local names
  // never admit it; flags alone cannot admit it. Require the build job's full
  // supplied GitHub identity and source-configured public schema/pool route.
  if (url.pathname !== "/vaettir_test" ||
      url.searchParams.get("schema") !== "public" || url.searchParams.get("connection_limit") !== "5" ||
      env.CI !== "true" || env.GITHUB_ACTIONS !== "true" ||
      env.GITHUB_REPOSITORY !== "Skaldandstone/Vaettir" ||
      !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID ?? "") ||
      !/^[1-9][0-9]{0,5}$/.test(env.GITHUB_RUN_ATTEMPT ?? "") ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
      env.GITHUB_WORKFLOW !== "CI" || env.GITHUB_JOB !== "build" || !validRef ||
      env.GITHUB_WORKFLOW_REF !== `Skaldandstone/Vaettir/.github/workflows/ci.yml@${ref}`) return refuse();
  return { route: "GITHUB_SERVICE", database: "vaettir_test" };
}
