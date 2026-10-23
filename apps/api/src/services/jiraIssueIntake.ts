import { z } from "zod";
import { repositoryProviderJson } from "./repositoryProviderHttp.js";
import { jiraSiteOrigin, type JiraSourceCredentials } from "./jiraSourceConnection.js";

const nativeId = z.string().min(1).max(32).regex(/^[1-9][0-9]*$/);
const issueKey = z.string().min(3).max(133).regex(/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/);
const printable = (max: number) => z.string().min(1).max(max).refine(value =>
  value.trim().length > 0 && !Array.from(value).some(character =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127));
const cursorSchema = z.string().min(1).max(1024).regex(/^[\x21-\x7e]+$/);
const isoTimestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));

/** Deliberately minimal issue summary. Imported strings remain data, not HTML or code. */
export const jiraIssueSchema = z.object({
  id: nativeId,
  projectId: nativeId,
  key: issueKey,
  title: printable(512),
  status: printable(200),
  updatedAt: isoTimestamp,
  url: z.string().url().max(1000),
}).superRefine((issue, ctx) => {
  try {
    const url = new URL(issue.url);
    if (issue.url !== `${jiraSiteOrigin(url.origin)}/browse/${issue.key}`)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid Jira issue link" });
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid Jira issue link" });
  }
});

const credentialsSchema = z.object({
  siteUrl: z.string().max(300),
  email: z.string().email().max(320).regex(/^[\x21-\x7e]+$/).refine(value => !value.includes(":")),
  apiToken: z.string().min(1).max(10000).regex(/^[\x21-\x7e]+$/).refine(value => !value.includes(":")),
});
const projectScopeSchema = z.array(nativeId).min(1).max(20)
  .refine(ids => new Set(ids).size === ids.length);
// Jira commonly emits +0000 rather than ISO's +00:00. Normalize that syntax,
// validate the calendar/time/offset, then retain a canonical UTC ISO timestamp.
const providerTimestamp = z.string().max(40)
  .transform(value => value.replace(/([+-][0-9]{2})([0-9]{2})$/, "$1:$2"))
  .pipe(isoTimestamp).transform(value => new Date(value).toISOString());
const providerIssueSchema = z.object({
  id: nativeId,
  key: issueKey,
  fields: z.object({
    summary: printable(512),
    status: z.object({ name: printable(200) }),
    project: z.object({ id: nativeId }),
    updated: providerTimestamp,
  }),
});
const providerPageSchema = z.object({
  issues: z.array(providerIssueSchema).max(20),
  isLast: z.boolean(),
  nextPageToken: cursorSchema.nullable().optional(),
});

/** Caller must authorize issue reading separately from metadata scope approval.
 * Exactly one read, never a legacy /search fallback or issue-detail fetch.
 * Public DNS/TLS pinning, 15s deadline, 1MiB response cap and no redirect following
 * are enforced by repositoryProviderJson. Descriptions/attachments/provider URLs
 * are neither requested nor retained. Run/page bounds and consent live upstream.
 * https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-get
 * Enhanced search is eventually consistent and returns only issues visible under
 * Browse Projects and any issue-level security permission; missing is not deleted.
 */
export async function listJiraIssuePage(
  credentials: JiraSourceCredentials,
  projectIds: string[],
  nextPageToken: string | null = null,
) {
  const input = credentialsSchema.parse(credentials);
  const origin = jiraSiteOrigin(input.siteUrl);
  const scope = projectScopeSchema.parse(projectIds);
  const cursor = cursorSchema.nullable().parse(nextPageToken);
  const query = new URLSearchParams({
    jql: `project in (${scope.join(",")}) ORDER BY id ASC`,
    fields: "summary,status,project,updated",
    maxResults: "20",
  });
  if (cursor !== null) query.set("nextPageToken", cursor);
  const page = providerPageSchema.parse(await repositoryProviderJson(origin,
    `/rest/api/3/search/jql?${query.toString()}`,
    { basic: { username: input.email, password: input.apiToken } }));
  const next = page.nextPageToken ?? null;
  if ((page.isLast && next !== null) || (!page.isLast && (next === null || page.issues.length === 0)) ||
      (next !== null && next === cursor))
    throw new Error("Jira issue pagination is inconsistent. Retry the preview.");
  if (new Set(page.issues.map(issue => issue.id)).size !== page.issues.length ||
      new Set(page.issues.map(issue => issue.key)).size !== page.issues.length ||
      page.issues.some(issue => !scope.includes(issue.fields.project.id)))
    throw new Error("Jira returned ambiguous or out-of-scope issue identities. Retry the preview.");
  return {
    issues: page.issues.map(issue => jiraIssueSchema.parse({
      id: issue.id, projectId: issue.fields.project.id, key: issue.key,
      title: issue.fields.summary, status: issue.fields.status.name,
      updatedAt: issue.fields.updated, url: `${origin}/browse/${issue.key}`,
    })),
    nextPageToken: next,
  };
}
