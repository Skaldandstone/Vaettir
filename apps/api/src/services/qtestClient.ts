import { assertPublicHttpUrl, UnsafeUrlError } from "./urlGuard.js";

/**
 * P11-06: qTest is a genuinely live-REST-API importer (unlike TestRail's/
 * Xray's file-export halves) - a customer's own qTest instance URL and API
 * token, fetched from this server, so it goes through the same SSRF-
 * hardened URL guard every other server-side URL fetch in this codebase
 * uses (services/urlGuard.ts) before a single request is made.
 *
 * Every resource shape and endpoint path below is sourced from qTest's own
 * published v3 API reference (documentation.tricentis.com/qtest and the
 * generated rcbops/qtest-swagger-client docs, both public) - the same
 * "build against the documented shape, flag live verification as the open
 * gap" approach this codebase already used for TestRail's XML export and
 * Xray's CSV/JSON export. No qTest instance or API token exists in this
 * environment to exercise these calls against a real server.
 */

export class QTestApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "QTestApiError";
  }
}

export interface QTestConnection {
  baseUrl: string; // e.g. https://yourcompany.qtestnet.com - customer-specific, no fixed default
  apiToken: string; // a qTest personal access token, sent as a Bearer token
}

const PAGE_SIZE = 100;

async function qtestGet<T>(conn: QTestConnection, path: string, params?: Record<string, string | number | boolean>): Promise<T> {
  let base: URL;
  try {
    base = await assertPublicHttpUrl(conn.baseUrl);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new QTestApiError(err.message);
    throw err;
  }
  const url = new URL(`/api/v3${path}`, base);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${conn.apiToken}`, Accept: "application/json" },
    });
  } catch (err) {
    throw new QTestApiError(`Could not reach ${conn.baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new QTestApiError(
      response.status === 401 || response.status === 403
        ? "qTest rejected the API token (401/403) - check it hasn't expired or been revoked."
        : `qTest API request to ${path} failed with HTTP ${response.status}.`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

// --- Documented resource shapes (only the fields this importer reads) ---

export interface QTestProperty {
  field_id: number;
  field_name?: string;
  field_value?: string;
  field_value_name?: string;
}

export interface QTestTestStep {
  id: number;
  description: string;
  expected: string;
  order: number;
}

export interface QTestTestCase {
  id: number;
  pid: string; // e.g. "TC-123" - the human-facing key, used as this importer's re-import id
  name: string;
  description?: string | null;
  precondition?: string | null;
  properties?: QTestProperty[];
  test_steps?: QTestTestStep[];
}

export interface QTestModule {
  id: number;
  pid: string;
  name: string;
  parent_id: number | null;
}

// GET /projects/{projectId}/modules?parent_id=<id|blank> - blank parent_id
// returns the root-level modules; traversing the rest of the tree means
// calling this again with each module's own id as parent_id (qTest's own
// documented traversal pattern - the API does not guarantee a populated
// `children` array on every response, so this walks explicitly rather than
// trusting one to be there).
export async function fetchAllModules(conn: QTestConnection, qtestProjectId: number): Promise<QTestModule[]> {
  const all: QTestModule[] = [];
  async function walk(parentId: number | undefined): Promise<void> {
    const children = await qtestGet<QTestModule[]>(conn, `/projects/${qtestProjectId}/modules`, parentId === undefined ? {} : { parent_id: parentId });
    for (const m of children) {
      all.push(m);
      await walk(m.id);
    }
  }
  await walk(undefined);
  return all;
}

// GET /projects/{projectId}/test-cases?parent_id=<moduleId>&page=&size=&
// expand_props=true&expand_steps=true - a plain array per page (no
// pagination envelope in the documented response), so end-of-pages is
// detected by a returned page shorter than the requested size.
export async function fetchTestCasesInModule(conn: QTestConnection, qtestProjectId: number, moduleId: number): Promise<QTestTestCase[]> {
  const all: QTestTestCase[] = [];
  let page = 1;
  for (;;) {
    const batch = await qtestGet<QTestTestCase[]>(conn, `/projects/${qtestProjectId}/test-cases`, {
      parent_id: moduleId,
      page,
      size: PAGE_SIZE,
      expand_props: true,
      expand_steps: true,
    });
    all.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page += 1;
  }
  return all;
}
