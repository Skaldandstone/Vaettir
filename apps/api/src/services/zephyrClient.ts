/**
 * P11-04: Zephyr Scale Cloud's REST API v2 - a fixed, Atlassian-hosted base
 * URL (unlike qTest's per-customer self-hosted instance, so no SSRF guard
 * is needed here; the destination is always Zephyr's own API host, never a
 * caller-supplied one), authenticated with a personal access token as a
 * Bearer token.
 *
 * Every resource shape, endpoint path, and pagination envelope below is
 * sourced from `bun913/zephyr-api-client` (a public TypeScript client
 * whose types are regenerated directly from Zephyr Scale's own published
 * OpenAPI specification, `tools/generate-types.ts` in that repo) - the
 * same "build against the documented shape" approach already used for
 * TestRail's XML export, Xray's CSV/JSON export, and qTest's REST API.
 * SmartBear's own documentation site (support.smartbear.com) blocks
 * automated fetches, so this real, OpenAPI-derived third-party client was
 * used as the primary source instead. No Zephyr Scale account or API
 * token exists in this environment to exercise these calls for real.
 *
 * Cloud-only in this pass - Zephyr Scale Server/Data Center uses a
 * different base URL and a different auth scheme entirely, not attempted.
 */

export class ZephyrApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ZephyrApiError";
  }
}

const ZEPHYR_BASE_URL = "https://api.zephyrscale.smartbear.com/v2";
const PAGE_SIZE = 100;

export interface ZephyrConnection {
  apiToken: string;
}

interface PagedList<T> {
  startAt: number;
  maxResults: number;
  total?: number;
  isLast?: boolean;
  values: T[];
}

async function zephyrGet<T>(conn: ZephyrConnection, path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(`${ZEPHYR_BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  let response: Response;
  try {
    response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${conn.apiToken}`, Accept: "application/json" } });
  } catch (err) {
    throw new ZephyrApiError(`Could not reach Zephyr Scale: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new ZephyrApiError(
      response.status === 401 || response.status === 403
        ? "Zephyr Scale rejected the API token (401/403) - check it hasn't expired or been revoked."
        : `Zephyr Scale API request to ${path} failed with HTTP ${response.status}.`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

async function fetchAllPages<T>(conn: ZephyrConnection, path: string, params: Record<string, string | number>): Promise<T[]> {
  const all: T[] = [];
  let startAt = 0;
  for (;;) {
    const page = await zephyrGet<PagedList<T>>(conn, path, { ...params, maxResults: PAGE_SIZE, startAt });
    all.push(...page.values);
    if (page.isLast || page.values.length < PAGE_SIZE) break;
    startAt += PAGE_SIZE;
  }
  return all;
}

// --- Documented resource shapes (only the fields this importer reads) ---

export interface ZephyrPriority {
  id: number;
  name: string;
}

export interface ZephyrFolder {
  id: number;
  parentId: number | null;
  name: string;
}

export interface ZephyrTestCase {
  key: string; // e.g. "PROJ-T123" - the human-facing key, used as this importer's re-import id
  name: string;
  objective?: string | null;
  precondition?: string | null;
  priority?: { id: number } | null; // a reference only - the real name needs the separate /priorities lookup
  folder?: { id: number } | null; // a reference only - the real path needs the separate /folders lookup
}

export interface ZephyrTestStep {
  inline?: { description?: string; testData?: string; expectedResult?: string };
}

export interface ZephyrTestScript {
  type: "plain" | "bdd";
  text: string;
}

export async function fetchAllPriorities(conn: ZephyrConnection, projectKey: string): Promise<ZephyrPriority[]> {
  return fetchAllPages<ZephyrPriority>(conn, "/priorities", { projectKey });
}

export async function fetchAllFolders(conn: ZephyrConnection, projectKey: string): Promise<ZephyrFolder[]> {
  return fetchAllPages<ZephyrFolder>(conn, "/folders", { projectKey, folderType: "TEST_CASE" });
}

export async function fetchAllTestCases(conn: ZephyrConnection, projectKey: string): Promise<ZephyrTestCase[]> {
  return fetchAllPages<ZephyrTestCase>(conn, "/testcases", { projectKey });
}

export async function fetchTestSteps(conn: ZephyrConnection, testCaseKey: string): Promise<ZephyrTestStep[]> {
  return fetchAllPages<ZephyrTestStep>(conn, `/testcases/${encodeURIComponent(testCaseKey)}/teststeps`, {});
}

// A test case has EITHER structured steps OR a single test script (plain
// text or BDD), never both - Zephyr calls this the case's "test script
// type." A 404 here means "no script" (it's a step-by-step case instead),
// not an error.
export async function fetchTestScript(conn: ZephyrConnection, testCaseKey: string): Promise<ZephyrTestScript | null> {
  try {
    return await zephyrGet<ZephyrTestScript>(conn, `/testcases/${encodeURIComponent(testCaseKey)}/testscript`);
  } catch (err) {
    if (err instanceof ZephyrApiError && err.status === 404) return null;
    throw err;
  }
}
