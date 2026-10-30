import { createHash, randomBytes } from "node:crypto";
import { z } from "@vaettir/core/dist/validation.js";
import { atlassianProviderToken, atlassianProviderPrivacy, repositoryProviderJson, repositoryProviderOrigin } from "./repositoryProviderHttp.js";
import { jiraSiteOrigin } from "./jiraSourceConnection.js";

export const atlassianProduct = z.enum(["jira", "confluence"]);
export type AtlassianProduct = z.infer<typeof atlassianProduct>;
// Jira/Confluence content stays read-only. Privacy reporting is required for the
// account identity retained by this app; it does not authorize content writes.
// A fixed union prevents later product consent from removing another scope.
export const ATLASSIAN_READ_SCOPES = ["read:me", "read:jira-work", "read:jira-user", "read:space:confluence", "report:personal-data", "offline_access"] as const;
const printable = z.string().min(1).max(10000).regex(/^[\x21-\x7e]+$/);
const label = z.string().min(1).max(300).refine(s => !Array.from(s).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127));
export const atlassianApplicationSchema = z.object({ clientId: printable.max(300), clientSecret: printable.max(2000), redirectUri: z.string().url().max(1000).refine(value => { try { const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password&&!url.search&&!url.hash&&(!url.port||url.port==="443")&&url.pathname==="/connections/atlassian/callback"; } catch{return false;} }) }).strict();
export type AtlassianApplication = z.infer<typeof atlassianApplicationSchema>;
export const atlassianTokenSchema = z.object({ accessToken: printable, refreshToken: printable, expiresAt: z.number().int().positive(), accountId: printable.max(128), accountName: label }).strict();
export type AtlassianToken = z.infer<typeof atlassianTokenSchema>;
export const ATLASSIAN_PRIVACY_DAY_MS=86400000;
export async function reportAtlassianPrivacy(token:string,accountId:string,updatedAt:Date){
  const envelope=z.object({body:z.unknown(),cycleDays:z.number().positive().max(365)}).strict().parse(await atlassianProviderPrivacy(token,accountId,updatedAt));
  const result=z.object({accounts:z.array(z.object({accountId:z.string(),status:z.enum(["closed","updated"])}).strict()).max(1)}).strict().parse(envelope.body);
  if(result.accounts.some(account=>account.accountId!==accountId))throw new Error("Atlassian privacy identity changed");
  return {decision:result.accounts[0]?.status??"clear" as const,cycleDays:envelope.cycleDays};
}
// Atlassian cloud IDs are opaque hyphenated hex identifiers; do not impose UUID version/variant bits.
const cloudId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const atlassianSiteSchema = z.object({ id: cloudId, name: label, url: z.string().refine(s => { try { return jiraSiteOrigin(s) === s; } catch { return false; } }), products: z.array(atlassianProduct).min(1).max(2) }).strict();
export type AtlassianSite = z.infer<typeof atlassianSiteSchema>;
export const atlassianResourceSchema = z.object({ id: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/), name: label, key: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/), url: z.string().url().max(1000) }).strict();

/** Dedicated callback configuration. Never silently repoint legacy WEB_APP_URL callbacks. */
export function atlassianApplication(env: NodeJS.ProcessEnv = process.env): AtlassianApplication | null {
  try {
    if (!env.ATLASSIAN_OAUTH_PUBLIC_URL) return null;
    const origin = repositoryProviderOrigin(env.ATLASSIAN_OAUTH_PUBLIC_URL);
    return atlassianApplicationSchema.parse({ clientId: env.ATLASSIAN_OAUTH_CLIENT_ID, clientSecret: env.ATLASSIAN_OAUTH_CLIENT_SECRET, redirectUri: `${origin}/connections/atlassian/callback` });
  } catch { return null; }
}
export const atlassianFingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function createAtlassianAuthorization(application: AtlassianApplication) {
  const app = atlassianApplicationSchema.parse(application), state = randomBytes(32).toString("base64url");
  const url = new URL("https://auth.atlassian.com/authorize");
  url.search = new URLSearchParams({ audience: "api.atlassian.com", client_id: app.clientId, scope: ATLASSIAN_READ_SCOPES.join(" "), redirect_uri: app.redirectUri, state, response_type: "code", prompt: "consent" }).toString();
  return { state, url: url.href };
}
/** Parse only account identity/name; discard profile email, avatar, location and all other fields. */
export async function verifyAtlassianToken(response: unknown, expectedAccountId?: string): Promise<AtlassianToken> {
  const issued = z.object({ access_token: printable, refresh_token: printable, token_type: z.string().refine(s => s.toLowerCase() === "bearer"), expires_in: z.number().int().min(60).max(86400) }).parse(response);
  const account=await readAtlassianAccount(issued.access_token,expectedAccountId);
  return { accessToken: issued.access_token, refreshToken: issued.refresh_token, expiresAt: Date.now() + issued.expires_in * 1000, accountId: account.account_id, accountName: account.name };
}
export async function readAtlassianAccount(accessToken:string,expectedAccountId?:string){
  const account = z.object({ account_id: printable.max(128), name: label, account_type: z.literal("atlassian"), account_status: z.literal("active") }).parse(await repositoryProviderJson("https://api.atlassian.com", "/me", { token: printable.parse(accessToken) }));
  if (expectedAccountId && account.account_id !== expectedAccountId) throw new Error("Atlassian identity changed");
  return account;
}
export async function exchangeAtlassianCode(application: AtlassianApplication, code: string) {
  const app = atlassianApplicationSchema.parse(application);
  return atlassianProviderToken({ grant_type: "authorization_code", client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: app.redirectUri, code: printable.parse(code) });
}
export async function refreshAtlassianToken(application: AtlassianApplication, token: AtlassianToken) {
  const app = atlassianApplicationSchema.parse(application), current = atlassianTokenSchema.parse(token);
  return atlassianProviderToken({ grant_type: "refresh_token", client_id: app.clientId, client_secret: app.clientSecret, refresh_token: current.refreshToken });
}
export async function listAtlassianSites(accessToken: string): Promise<AtlassianSite[]> {
  const raw = z.array(z.object({ id: cloudId, name: label, url: z.string().max(300), scopes: z.array(z.string().max(200)).max(100) })).max(100).parse(await repositoryProviderJson("https://api.atlassian.com", "/oauth/token/accessible-resources", { token: printable.parse(accessToken) }));
  const sites = new Map<string, AtlassianSite>();
  for (const row of raw) {
    const url = jiraSiteOrigin(row.url), products: AtlassianProduct[] = [];
    if (["read:jira-work", "read:jira-user"].every(s => row.scopes.includes(s))) products.push("jira");
    if (row.scopes.includes("read:space:confluence")) products.push("confluence");
    if (!products.length) continue;
    const prior = sites.get(row.id);
    if (prior && (prior.url !== url || prior.name !== row.name)) throw new Error("Conflicting Atlassian site identity");
    sites.set(row.id, atlassianSiteSchema.parse({ id: row.id, url, name: row.name, products: [...new Set([...(prior?.products ?? []), ...products])] }));
  }
  return [...sites.values()];
}
/** Fixed gateway/product, validated cloud ID and reconstructed paths only. */
export async function listAtlassianResources(token: string, site: AtlassianSite, product: AtlassianProduct, after: number | string = 0) {
  const admitted = atlassianSiteSchema.parse(site);atlassianProduct.parse(product);
  if (!admitted.products.includes(product)) throw new Error("Site lacks the requested product");
  if (product === "jira") {
    const start=z.number().int().min(0).max(1000000).parse(after);
    const page = z.object({ startAt: z.number().int(), maxResults: z.number().int().min(1).max(50), isLast: z.boolean(), values: z.array(z.object({ id: z.string().regex(/^[1-9][0-9]*$/), key: z.string().regex(/^[A-Z][A-Z0-9_]*$/), name: label })).max(50) }).parse(await repositoryProviderJson("https://api.atlassian.com", `/ex/jira/${admitted.id}/rest/api/3/project/search?startAt=${start}&maxResults=50`, { token: printable.parse(token) }));
    if (page.startAt !== start || page.values.length>page.maxResults || !page.isLast && (!page.values.length || start+page.maxResults>1000000)) throw new Error("Invalid project pagination");
    return { resources: page.values.map(x => atlassianResourceSchema.parse({ ...x, url: `${admitted.url}/browse/${x.key}` })), next: page.isLast ? null : start + page.maxResults };
  }
  const cursor=after===0?null:printable.max(1024).parse(after);
  const path=`/ex/confluence/${admitted.id}/wiki/api/v2/spaces`;
  const query=new URLSearchParams({limit:"50",...(cursor?{cursor}:{})});
  const page=z.object({results:z.array(z.object({id:z.string().regex(/^[1-9][0-9]*$/),key:z.string().regex(/^[A-Za-z0-9_-]+$/),name:label})).max(50),_links:z.object({next:z.string().max(2000).optional()}).default({})}).parse(await repositoryProviderJson("https://api.atlassian.com",`${path}?${query}`,{token:printable.parse(token)}));
  let next:string|null=null;
  if(page._links.next){
    // Never follow provider URLs. Admit only a cursor for the exact endpoint and reconstruct it.
    const link=new URL(page._links.next,"https://api.atlassian.com");
    if(link.origin!=="https://api.atlassian.com"||link.username||link.password||link.hash||![path,"/wiki/api/v2/spaces"].includes(link.pathname)||[...link.searchParams.keys()].some(k=>!["cursor","limit"].includes(k))||link.searchParams.getAll("cursor").length!==1||link.searchParams.getAll("limit").length>1||link.searchParams.has("limit")&&link.searchParams.get("limit")!=="50")throw new Error("Invalid space pagination");
    next=printable.max(1024).parse(link.searchParams.get("cursor"));
    if(next===cursor||!page.results.length)throw new Error("Space pagination did not advance");
  }
  return {resources:page.results.map(x=>atlassianResourceSchema.parse({...x,url:`${admitted.url}/wiki/spaces/${x.key}`})),next};
}
