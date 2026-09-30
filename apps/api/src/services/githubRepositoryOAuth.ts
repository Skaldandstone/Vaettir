import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { repositoryProviderJson, repositoryProviderOrigin, repositoryProviderRevokeGithubToken } from "./repositoryProviderHttp.js";
import type { RepositorySelection } from "./gitlabRepositoryOAuth.js";

export const GITHUB_ORIGIN = "https://github.com";
const GITHUB_API_ORIGIN = "https://api.github.com";

/** The router must retain this token for retry when upstream revocation fails. */
export class GithubOAuthRevocationPendingError extends Error {
  declare readonly token: string;

  constructor(token: string) {
    super("GitHub issued a token that could not be verified or revoked.");
    this.name = "GithubOAuthRevocationPendingError";
    Object.defineProperty(this, "token", { value: token, enumerable: false, writable: false });
  }
}

export async function revokeGithubAuthorization(input: { clientId: string; clientSecret: string; token: string }): Promise<void> {
  await repositoryProviderRevokeGithubToken(input.clientId, input.clientSecret, input.token);
}

export function createGithubAuthorization(clientId: string, redirectUri: string) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const url = new URL("/login/oauth/authorize", GITHUB_ORIGIN);
  // OAuth apps grant the repo scope broadly. Vaettir only lists metadata until
  // the user reviews and selects repositories; the UI must disclose this gap.
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, scope: "repo", state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { state, verifier, url: url.href };
}

export async function verifyGithubAuthorization(input: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string }) {
  const response = await repositoryProviderJson(GITHUB_ORIGIN, "/login/oauth/access_token", {
    form: new URLSearchParams({
      client_id: input.clientId, client_secret: input.clientSecret,
      redirect_uri: input.redirectUri, code: input.code,
      code_verifier: input.verifier,
    }),
  });
  // Once a token exists, every later verification failure must attempt to
  // remove its upstream grant. Keep the token available to the router if
  // revocation cannot be confirmed.
  const issued = z.object({ access_token: z.string().min(1).max(10000) }).parse(response);
  try {
    const token = z.object({
      access_token: z.string().min(1).max(10000),
      token_type: z.string().refine(value => value.toLowerCase() === "bearer"),
      scope: z.string(),
      expires_in: z.number().int().positive().max(86400).optional(),
    }).parse(response);
    if (!token.scope.split(",").map(value => value.trim()).includes("repo"))
      throw new Error("Repository scope was not granted");
    const account = z.object({ id: z.number().int().positive(), login: z.string().min(1).max(200) })
      .parse(await repositoryProviderJson(GITHUB_API_ORIGIN, "/user", { token: token.access_token }));
    // GitHub OAuth apps can issue non-expiring tokens. Bound Vaettir's retained
    // use of one to eight hours and require reauthorization; never claim the
    // upstream token itself expires at this timestamp.
    return {
      token: token.access_token,
      expiresAt: new Date(Date.now() + Math.min(token.expires_in ?? 28800, 28800) * 1000),
      accountLabel: account.login,
    };
  } catch (error) {
    try {
      await revokeGithubAuthorization({ clientId: input.clientId, clientSecret: input.clientSecret, token: issued.access_token });
    } catch {
      throw new GithubOAuthRevocationPendingError(issued.access_token);
    }
    throw error;
  }
}

export async function listGithubRepositories(token: string, page: number): Promise<RepositorySelection[]> {
  const params = new URLSearchParams({ affiliation: "owner,collaborator,organization_member", visibility: "all", sort: "full_name", direction: "asc", per_page: "100", page: String(page) });
  const rows = z.array(z.object({
    id: z.number().int().positive(), full_name: z.string().min(1).max(500),
    html_url: z.string().url().max(1000), default_branch: z.string().max(200).nullable().optional(),
  })).max(100).parse(await repositoryProviderJson(GITHUB_API_ORIGIN, `/user/repos?${params}`, { token }));
  return rows.map(row => {
    const url = new URL(row.html_url);
    if (url.origin !== repositoryProviderOrigin(GITHUB_ORIGIN) || url.username || url.password || url.hash || url.search ||
        url.pathname.toLowerCase() !== `/${row.full_name}`.toLowerCase())
      throw new Error("Provider returned a repository outside GitHub");
    return { id: String(row.id), name: row.full_name, url: url.href, defaultBranch: row.default_branch ?? null };
  });
}
