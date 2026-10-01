import { z } from "zod";
import { repositoryProviderJson } from "./repositoryProviderHttp.js";
import type { RepositorySelection } from "./gitlabRepositoryOAuth.js";

export const AZURE_REPOSITORY_ORIGIN = "https://dev.azure.com";
const MAX_REPOSITORIES = 1000;
const PAGE_SIZE = 100;

/** Services only. Legacy visualstudio.com and on-premises Server need separate adapters. */
export function azureOrganizationUrl(raw: string) {
  const url = new URL(raw);
  const match = /^\/([a-zA-Z0-9][a-zA-Z0-9-]{0,49})\/?$/.exec(url.pathname);
  if (url.origin !== AZURE_REPOSITORY_ORIGIN || url.username || url.password || url.port || url.search || url.hash || !match)
    throw new Error("Use the Azure DevOps Services organization URL: https://dev.azure.com/organization");
  return { origin: AZURE_REPOSITORY_ORIGIN, organization: match[1]!, url: `${AZURE_REPOSITORY_ORIGIN}/${match[1]!}` };
}

const displayName = z.string().min(1).max(200).refine(value => value !== "." && value !== ".." && !/[/\\]/.test(value) &&
  Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
const repositorySchema = z.object({
  id: z.string().uuid(), name: displayName,
  project: z.object({ id: z.string().uuid(), name: displayName }),
  defaultBranch: z.string().min(1).max(200).nullable().optional(),
  isDisabled: z.boolean().optional(),
});
export type AzureRepositorySelection = RepositorySelection & { projectId: string; projectName: string };

function credential(pat: string) {
  // Treat PATs as opaque; support both existing and new provider token formats.
  if (!pat || pat.length > 10000 || /[^\x21-\x7e]/.test(pat))
    throw new Error("Enter a valid organization-scoped personal access token with Code (Read) permission.");
  return { basic: { username: "", password: pat } };
}

function selection(row: z.infer<typeof repositorySchema>, organizationUrl: string): AzureRepositorySelection {
  // Do not trust remoteUrl/webUrl links from the response. No subsequent network
  // request uses metadata-supplied origins, URLs or paths.
  return {
    id: row.id, name: `${row.project.name}/${row.name}`,
    url: `${organizationUrl}/${encodeURIComponent(row.project.name)}/_git/${encodeURIComponent(row.name)}`,
    defaultBranch: row.defaultBranch ?? null, projectId: row.project.id, projectName: row.project.name,
  };
}

async function authenticatedPrincipal(organization: ReturnType<typeof azureOrganizationUrl>, pat: string) {
  // Microsoft's Locations client uses this endpoint/version. An anonymous public
  // repository response alone is not sufficient evidence that the PAT works.
  const result = z.object({ authenticatedUser: z.object({
    id: z.string().uuid().refine(value => value !== "00000000-0000-0000-0000-000000000000"),
    isActive: z.literal(true), isContainer: z.literal(false),
  }) }).safeParse(await repositoryProviderJson(organization.origin,
    `/${organization.organization}/_apis/ConnectionData?api-version=7.2-preview.1`, credential(pat)));
  if (!result.success) throw new Error("Azure DevOps did not confirm an authenticated organization member. Check the token and access.");
  return result.data.authenticatedUser.id;
}

async function catalog(organizationUrl: string, pat: string) {
  const organization = azureOrganizationUrl(organizationUrl);
  const accountId = await authenticatedPrincipal(organization, pat);
  const response = z.object({ count: z.number().int().min(0).max(MAX_REPOSITORIES), value: z.array(repositorySchema).max(MAX_REPOSITORIES) })
    .parse(await repositoryProviderJson(organization.origin, `/${organization.organization}/_apis/git/repositories?api-version=7.1&includeHidden=false`, credential(pat)));
  // This endpoint has no documented server paging in API 7.1. Bound the complete
  // catalog and paginate locally rather than silently accepting a truncated list.
  if (response.count !== response.value.length || new Set(response.value.map(row => row.id)).size !== response.value.length)
    throw new Error("Azure DevOps returned an incomplete or duplicate repository catalog. Try again.");
  return { organization, accountId, repositories: response.value.filter(row => !row.isDisabled).map(row => selection(row, organization.url)) };
}

/** Confirm an active provider identity and read-only catalog; source processing still needs approval. */
export async function verifyAzureRepositoryConnection(organizationUrl: string, pat: string) {
  const result = await catalog(organizationUrl, pat);
  return {
    organization: result.organization.organization, organizationUrl: result.organization.url,
    evidence: "authenticated-repository-metadata-access" as const, accountId: result.accountId, accountLabel: result.accountId, repositoryCount: result.repositories.length,
    repositories: result.repositories.sort((left, right) => left.name.localeCompare(right.name, "en-US") || left.id.localeCompare(right.id)).slice(0, PAGE_SIZE),
    hasMore: result.repositories.length > PAGE_SIZE,
  };
}

export async function listAzureRepositories(organizationUrl: string, pat: string, page = 1, search = "") {
  if (!Number.isInteger(page) || page < 1 || page > MAX_REPOSITORIES / PAGE_SIZE || search.length > 200)
    throw new Error("Invalid repository search or page.");
  const result = await catalog(organizationUrl, pat);
  const query = search.trim().toLocaleLowerCase("en-US");
  const rows = result.repositories.filter(row => row.name.toLocaleLowerCase("en-US").includes(query))
    .sort((left, right) => left.name.localeCompare(right.name, "en-US") || left.id.localeCompare(right.id));
  const start = (page - 1) * PAGE_SIZE;
  return { repositories: rows.slice(start, start + PAGE_SIZE), hasMore: rows.length > start + PAGE_SIZE };
}

/** Revalidate a selected native repository ID before committing registrations. */
export async function getAzureRepository(organizationUrl: string, pat: string, repositoryId: string): Promise<AzureRepositorySelection> {
  const organization = azureOrganizationUrl(organizationUrl);
  if (!z.string().uuid().safeParse(repositoryId).success) throw new Error("Invalid Azure DevOps repository identifier.");
  await authenticatedPrincipal(organization, pat);
  const row = repositorySchema.parse(await repositoryProviderJson(organization.origin,
    `/${organization.organization}/_apis/git/repositories/${repositoryId}?api-version=7.1`, credential(pat)));
  if (row.id !== repositoryId || row.isDisabled) throw new Error("The selected Azure DevOps repository is unavailable.");
  return selection(row, organization.url);
}
