import { z } from "zod";
import type { RepositorySelection } from "./gitlabRepositoryOAuth.js";
import { repositoryProviderJson } from "./repositoryProviderHttp.js";

export const BITBUCKET_ORIGIN = "https://bitbucket.org";
const API_ORIGIN = "https://api.bitbucket.org";
export const BITBUCKET_REQUIRED_SCOPES = ["read:user:bitbucket", "read:repository:bitbucket"] as const;

export type BitbucketCredentials = { email: string; token: string };
const containsControl = (value: string) => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const credentialsSchema = z.object({
  email: z.string().email().max(254).refine(value => !/[\s:]/.test(value) && !containsControl(value)),
  token: z.string().min(1).max(10000).refine(value => !/\s/.test(value) && !containsControl(value)),
});
const workspaceSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const uuidSchema = z.string().regex(/^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i);

function authentication(input: BitbucketCredentials) {
  const result = credentialsSchema.safeParse(input);
  if (!result.success) throw new Error("Enter your Atlassian account email and a valid API token.");
  return { basic: { username: result.data.email, password: result.data.token } };
}

/** Account-bound API tokens: the caller encrypts credentials and owns their retention.
 * GET /user requires read:user:bitbucket. This does not prove repository permission,
 * source-processing consent, or the token's expiration date. No token is issued here.
 */
export async function verifyBitbucketAuthorization(input: BitbucketCredentials): Promise<{ accountId: string; accountLabel: string }> {
  const raw = await repositoryProviderJson(API_ORIGIN, "/2.0/user", authentication(input));
  const result = z.object({ type: z.literal("user"), uuid: uuidSchema, display_name: z.string().min(1).max(200) }).safeParse(raw);
  if (!result.success) throw new Error("Bitbucket returned an invalid account identity.");
  return { accountId: result.data.uuid, accountLabel: result.data.display_name };
}

/** List one bounded metadata page in the customer's selected Cloud workspace.
 * Requires read:repository:bitbucket. Never follows provider-supplied next URLs,
 * reads source, or treats a default branch as a deployed or selected revision.
 */
export async function listBitbucketRepositories(input: BitbucketCredentials & { workspace: string; page: number; search: string }): Promise<{ repositories: RepositorySelection[]; hasMore: boolean; limitReached: boolean }> {
  const auth = authentication(input);
  const selection = z.object({ workspace: workspaceSchema, page: z.number().int().min(1).max(10), search: z.string().max(100).refine(value => !containsControl(value)) }).safeParse(input);
  if (!selection.success) throw new Error("Choose a valid Bitbucket workspace, page, and search term.");
  const { workspace, page, search } = selection.data;
  const params = new URLSearchParams({ pagelen: "100", page: String(page), sort: "full_name" });
  // BBQL string literals use JSON-compatible quoting. User text is never a query.
  if (search) params.set("q", `name ~ ${JSON.stringify(search)}`);
  const endpoint = `/2.0/repositories/${encodeURIComponent(workspace)}`;
  const raw = await repositoryProviderJson(API_ORIGIN, `${endpoint}?${params}`, auth);
  const result = z.object({
    values: z.array(z.object({
      type: z.literal("repository"), scm: z.literal("git"), uuid: uuidSchema,
      full_name: z.string().min(1).max(500), links: z.object({ html: z.object({ href: z.string().url().max(1000) }) }),
      mainbranch: z.object({ name: z.string().min(1).max(200) }).nullable().optional(),
    })).max(100),
    next: z.string().url().max(2000).optional(),
  }).safeParse(raw);
  if (!result.success) throw new Error("Bitbucket returned an invalid repository page.");
  if (result.data.next) {
    const next = new URL(result.data.next);
    if (next.origin !== API_ORIGIN || next.username || next.password || next.hash || next.pathname !== endpoint || next.searchParams.get("page") !== String(page + 1))
      throw new Error("Bitbucket returned an invalid repository continuation.");
  }
  const ids = new Set<string>();
  const repositories = result.data.values.map(row => {
    const url = new URL(row.links.html.href);
    const segments = row.full_name.split("/");
    if (segments.length !== 2 || segments[0]!.toLowerCase() !== workspace.toLowerCase() ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segments[1]!) ||
        url.origin !== BITBUCKET_ORIGIN || url.username || url.password || url.hash || url.search ||
        url.pathname.toLowerCase() !== `/${row.full_name}`.toLowerCase() || ids.has(row.uuid.toLowerCase()))
      throw new Error("Bitbucket returned a repository outside the selected workspace or a duplicate identity.");
    ids.add(row.uuid.toLowerCase());
    return { id: row.uuid, name: row.full_name, url: url.href, defaultBranch: row.mainbranch?.name ?? null };
  });
  return { repositories, hasMore: Boolean(result.data.next) && page < 10, limitReached: Boolean(result.data.next) && page === 10 };
}
