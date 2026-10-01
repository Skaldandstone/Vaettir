import { z } from "zod";
import { repositoryProviderJson } from "./repositoryProviderHttp.js";

// Cloud metadata only. Standard API tokens use site-local Basic authentication:
// https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/
// Scoped tokens require a different gateway and are not supported by this adapter:
// https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/
// Identity and projects: REST v3 /myself and /project/search. No issue requests.
export function jiraSiteOrigin(raw: string): string {
  const value = raw.trim();
  // Match the input before URL parsing can normalize credentials, Unicode,
  // backslashes, escaped hostnames, or ambiguous paths into an accepted origin.
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net(?::443)?\/?$/i.test(value))
    throw new Error("Use your Jira Cloud HTTPS site, such as https://example.atlassian.net. Self-hosted Jira is not supported yet.");
  return new URL(value).origin;
}

const label = z.string().min(1).max(300).refine(value => value.trim().length > 0 &&
  !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127));
const nativeId = z.string().min(1).max(32).regex(/^[1-9][0-9]*$/);
const projectKey = z.string().min(1).max(100).regex(/^[A-Z][A-Z0-9_]*$/);
const accountId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9:-]+$/)
  .refine(value => !/^(unknown|anonymous|deleted|undefined|null)$/i.test(value));
const canonicalSite = z.string().max(300).refine(value => {
  try { return jiraSiteOrigin(value) === value; } catch { return false; }
});

export const jiraProjectSchema = z.object({
  id: nativeId,
  key: projectKey,
  name: label,
  url: z.string().url().max(1000),
}).superRefine((project, ctx) => {
  try {
    const url = new URL(project.url);
    if (project.url !== `${jiraSiteOrigin(url.origin)}/browse/${project.key}`)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid Jira project link" });
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid Jira project link" });
  }
});

export const jiraCatalogSchema = z.object({
  workspace: z.object({ id: canonicalSite, name: canonicalSite }),
  account: z.object({ id: accountId, name: label }),
  projects: z.array(jiraProjectSchema).max(500),
}).superRefine((catalog, ctx) => {
  if (catalog.workspace.name !== catalog.workspace.id ||
      catalog.projects.some(project => new URL(project.url).origin !== catalog.workspace.id) ||
      new Set(catalog.projects.map(project => project.id)).size !== catalog.projects.length ||
      new Set(catalog.projects.map(project => project.key)).size !== catalog.projects.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Jira catalog identities are inconsistent" });
});

const credentialsSchema = z.object({
  siteUrl: z.string().max(300),
  email: z.string().email().max(320).regex(/^[\x21-\x7e]+$/).refine(value => !value.includes(":")),
  apiToken: z.string().min(1).max(10000).regex(/^[\x21-\x7e]+$/).refine(value => !value.includes(":")),
});
const myselfSchema = z.object({
  accountId,
  displayName: label,
  active: z.literal(true),
  accountType: z.literal("atlassian").optional(),
});
const providerProjectSchema = z.object({ id: nativeId, key: projectKey, name: label });
const offset = z.number().int().min(0).max(1000000);
const pageSchema = z.object({
  startAt: offset,
  maxResults: z.number().int().min(1).max(50),
  isLast: z.boolean(),
  total: offset.optional(),
  values: z.array(providerProjectSchema).max(50),
});

export type JiraSourceCredentials = z.infer<typeof credentialsSchema>;

/** At most two GETs, using the existing DNS-pinned TLS/response/deadline boundary.
 * Provider-supplied self, nextPage, avatar and external project links are neither
 * followed nor retained. Pagination is reconstructed from validated integers.
 */
export async function listJiraProjects(credentials: JiraSourceCredentials, after = 0) {
  const input = credentialsSchema.parse(credentials);
  const origin = jiraSiteOrigin(input.siteUrl);
  const startAt = offset.parse(after);
  const options = { basic: { username: input.email, password: input.apiToken } };
  const myself = myselfSchema.parse(await repositoryProviderJson(origin, "/rest/api/3/myself", options));
  const page = pageSchema.parse(await repositoryProviderJson(origin,
    `/rest/api/3/project/search?startAt=${startAt}&maxResults=50`, options));
  const next = page.startAt + page.maxResults;
  if (page.startAt !== startAt || page.values.length > page.maxResults ||
      (!page.isLast && (page.values.length === 0 || next > 1000000)) ||
      (page.total !== undefined && (page.startAt + page.values.length > page.total ||
        (page.isLast && page.startAt + page.values.length < page.total) ||
        (!page.isLast && next >= page.total))))
    throw new Error("Jira project pagination is inconsistent. Refresh the project list.");

  const catalog = jiraCatalogSchema.parse({
    workspace: { id: origin, name: origin },
    account: { id: myself.accountId, name: myself.displayName },
    projects: page.values.map(project => ({ ...project, url: `${origin}/browse/${project.key}` })),
  });
  return { ...catalog, hasMore: !page.isLast, nextCursor: page.isLast ? null : next };
}
