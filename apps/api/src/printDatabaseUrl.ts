import { resolveDatabaseUrlFromManagedSecret } from "./resolveDatabaseUrl.js";

// Thin CLI wrapper so the container's shell CMD can compose DATABASE_URL
// *before* running `prisma migrate deploy` - see resolveDatabaseUrl.ts's
// own comment for why that step, not just the server process, needed this.
// Prints exactly one line (the resolved URL, or the existing DATABASE_URL
// verbatim if one's already set) to stdout and nothing else - the caller
// captures it via `$(...)`, so any stray output here would corrupt the URL.
// All diagnostics go to stderr; a real failure exits non-zero so the
// Dockerfile's `&&` chain stops instead of proceeding with an empty
// DATABASE_URL into a confusing Prisma error.
async function main(): Promise<void> {
  if (process.env.DATABASE_URL) {
    process.stdout.write(process.env.DATABASE_URL);
    return;
  }
  const resolved = await resolveDatabaseUrlFromManagedSecret();
  if (!resolved) {
    throw new Error("Neither DATABASE_URL nor DB_SECRET_ID is set - nothing to print.");
  }
  process.stdout.write(resolved);
}

main().catch((err: unknown) => {
  console.error(`[printDatabaseUrl] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
