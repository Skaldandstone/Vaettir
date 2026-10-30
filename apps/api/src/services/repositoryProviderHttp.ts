import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export function repositoryProviderOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.port && url.port !== "443") || isIP(url.hostname) || url.hostname.startsWith("["))
    throw new Error("Use the HTTPS hostname of the provider, without a path or credentials.");
  return url.origin;
}

export function isPublicProviderIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a=0,b=0,c=0] = ip.split(".").map(Number);
  // Include IANA's 192.0.0/24 protocol block and 192.0.2/24 TEST-NET-1.
  return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) ||
    (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && (b===168 || b===0 || (b===0 && c===2) || (b===88 && c===99))) ||
    (a===198 && (b===18 || b===19 || (b===51 && c===100))) || (a===203 && b===0 && c===113));
}

type GithubAppToken = { clientId: string; clientSecret: string; accessToken: string };
type AtlassianTokenBody = { grant_type: "authorization_code" | "refresh_token"; client_id: string; client_secret: string; code?: string; redirect_uri?: string; refresh_token?: string };
type ProviderRequestOptions = { token?: string; basic?: {username:string;password:string}; form?: URLSearchParams; revoke?: GithubAppToken; check?: GithubAppToken; gitlabRevoke?: boolean; linearGraphql?: {apiKey:string;query:string;variables:Record<string,unknown>}; atlassianToken?: AtlassianTokenBody; atlassianPrivacy?: {accounts: Array<{accountId:string;updatedAt:string}>} };
export class ProviderStatusError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds?: number) { super(`Provider request failed (${status}). Reconnect or check access.`); }
}

/** Pin public DNS to the actual TLS socket; never follow redirects with credentials. */
async function repositoryProviderRequest(origin: string, path: string, options: ProviderRequestOptions): Promise<unknown> {
  const base = repositoryProviderOrigin(origin);
  if (options.atlassianPrivacy && (base !== "https://api.atlassian.com" || path !== "/app/report-accounts/" || !options.token || options.basic || options.form || options.revoke || options.check || options.gitlabRevoke || options.linearGraphql || options.atlassianToken)) throw new Error("Invalid Atlassian privacy endpoint");
  if (options.atlassianToken && (base !== "https://auth.atlassian.com" || path !== "/oauth/token" || options.token || options.basic || options.form || options.revoke || options.check || options.gitlabRevoke || options.linearGraphql)) throw new Error("Invalid Atlassian token endpoint");
  if(options.linearGraphql && (base!=="https://api.linear.app" || path!=="/graphql" || options.token || options.basic || options.form || options.revoke || options.check || /[^\x21-\x7e]/.test(options.linearGraphql.apiKey) || !options.linearGraphql.apiKey || options.linearGraphql.apiKey.length>10000))throw new Error("Invalid Linear GraphQL request");
  if (options.token && options.basic) throw new Error("Choose one provider authentication method");
  if (options.basic && (options.basic.username.includes(":") || /[\r\n]/.test(options.basic.username + options.basic.password)))
    throw new Error("Invalid provider credentials");
  const url = new URL(path, base);
  if (url.origin !== base) throw new Error("Invalid provider endpoint");
  // One wall-clock budget covers DNS, TLS, headers and the complete response.
  // OS DNS lookup cannot be canceled, but a late result must never open a socket.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Provider request exceeded the safe time limit"));
    }, 15000);
  });
  const operation = async () => {
  const addresses = await lookup(url.hostname, {family:4,all:true});
  controller.signal.throwIfAborted();
  if (!addresses.length || addresses.some(x=>!isPublicProviderIPv4(x.address))) throw new Error("This instance needs a public HTTPS endpoint. Private-network connectors are not available yet.");
  const address = addresses[0]!.address;
  const appToken = options.revoke ?? options.check;
  const body = options.atlassianPrivacy ? JSON.stringify(options.atlassianPrivacy) : options.atlassianToken ? JSON.stringify(options.atlassianToken) : options.linearGraphql ? JSON.stringify({query:options.linearGraphql.query,variables:options.linearGraphql.variables}) : appToken ? JSON.stringify({ access_token: appToken.accessToken }) : options.form?.toString();
  return new Promise((resolve,reject)=>{
    const req=request(url, {
      method: options.revoke ? "DELETE" : body ? "POST" : "GET",
      signal: controller.signal,
      family: 4,
      lookup: (_host,_opts,callback)=>callback(null,address,4),
      headers: {Accept:appToken?"application/vnd.github+json":"application/json","User-Agent":"Vaettir-Repository-Connector",
        ...(options.token?{Authorization:`Bearer ${options.token}`}:{ }),
        ...(options.linearGraphql?{Authorization:options.linearGraphql.apiKey}:{ }),
        ...(options.basic?{Authorization:`Basic ${Buffer.from(`${options.basic.username}:${options.basic.password}`).toString("base64")}`}:{ }),
        ...(appToken?{Authorization:`Basic ${Buffer.from(`${appToken.clientId}:${appToken.clientSecret}`).toString("base64")}`,
          "X-GitHub-Api-Version":"2022-11-28"}:{ }),
        ...(body?{"Content-Type":appToken||options.linearGraphql||options.atlassianToken||options.atlassianPrivacy?"application/json":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(body)}:{})},
    },res=>{
      if (options.check && (res.statusCode===200 || res.statusCode===404)) {res.destroy();resolve(res.statusCode===200);return;}
      if (!res.statusCode || (options.revoke ? res.statusCode!==204 : options.gitlabRevoke ? res.statusCode!==200 : options.atlassianPrivacy ? ![200,204].includes(res.statusCode) : res.statusCode<200 || res.statusCode>=300)) {const retry=Number(res.headers?.["retry-after"]);res.destroy();reject(new ProviderStatusError(res.statusCode ?? 0,Number.isFinite(retry)&&retry>0?Math.min(86400,Math.ceil(retry)):undefined));return;}
      const cycleHeader=res.headers?.["cycle-period"];
      const cycleDays=cycleHeader===undefined?7:Number(cycleHeader);
      if(options.atlassianPrivacy&&(!Number.isFinite(cycleDays)||cycleDays<=0||cycleDays>365)){res.destroy();reject(new Error("Invalid Atlassian privacy cycle"));return;}
      if(options.atlassianPrivacy && res.statusCode===204){res.destroy();resolve({body:{accounts:[]},cycleDays});return;}
      let size=0; const chunks:Buffer[]=[];
      res.on("data",chunk=>{size+=chunk.length;if(size>1024*1024){res.destroy();reject(new Error("Provider response exceeded the safe size limit"));}else chunks.push(Buffer.from(chunk));});
      res.on("error",()=>reject(new Error("Provider response interrupted")));
      res.on("end",()=>{
        if(options.revoke){resolve(undefined);return;}
        try{
          const parsed:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if(options.gitlabRevoke){
            if(!parsed || typeof parsed!=="object" || Array.isArray(parsed) || Object.keys(parsed).length!==0)throw new Error("GitLab did not confirm token revocation");
            resolve(undefined);return;
          }
          resolve(options.atlassianPrivacy?{body:parsed,cycleDays}:parsed);
        }catch{reject(new Error("Provider returned an invalid response"));}
      });
    });
    req.on("error",()=>reject(new Error("Could not reach the provider securely. Try again.")));
    if(body)req.write(body);
    req.end();
  });
  };
  try {
    return await Promise.race([operation(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function repositoryProviderJson(origin: string, path: string, options: {token?: string; basic?: {username:string;password:string}; form?: URLSearchParams} = {}): Promise<unknown> {
  return repositoryProviderRequest(origin, path, options);
}

/** Fixed Atlassian exchange endpoint, using the same pinned DNS/TLS/size/deadline boundary. */
export function atlassianProviderToken(body: AtlassianTokenBody): Promise<unknown> {
  const keys = body.grant_type === "authorization_code" ? ["grant_type", "client_id", "client_secret", "code", "redirect_uri"] : ["grant_type", "client_id", "client_secret", "refresh_token"];
  if (!["authorization_code", "refresh_token"].includes(body.grant_type) || Object.keys(body).length !== keys.length || keys.some(key => typeof body[key as keyof AtlassianTokenBody] !== "string" || !body[key as keyof AtlassianTokenBody] || body[key as keyof AtlassianTokenBody]!.length > 10000 || !/^[!-~]+$/.test(body[key as keyof AtlassianTokenBody]!))) throw new Error("Invalid Atlassian token request");
  return repositoryProviderRequest("https://auth.atlassian.com", "/oauth/token", { atlassianToken: body });
}

/** One account per request: no cross-customer batch or caller-controlled URL.
 * Atlassian's 3LO personal-data reporting endpoint returns 204 for no action.
 * https://developer.atlassian.com/cloud/jira/platform/user-privacy-developer-guide/ */
export function atlassianProviderPrivacy(token:string,accountId:string,updatedAt:Date):Promise<unknown>{
  if(!/^[!-~]{1,10000}$/.test(token)||accountId==="unknown"||!/^[A-Za-z0-9:-]{1,128}$/.test(accountId)||!Number.isFinite(updatedAt.getTime()))throw new Error("Invalid Atlassian privacy request");
  return repositoryProviderRequest("https://api.atlassian.com","/app/report-accounts/",{token,atlassianPrivacy:{accounts:[{accountId,updatedAt:updatedAt.toISOString()}]}});
}

/** Internal static-query intake using the existing DNS/TLS/size/deadline boundary.
 * Never route user-supplied GraphQL text through this transport.
 */
export async function linearProviderGraphql(apiKey:string,query:string,variables:Record<string,unknown>={}):Promise<unknown>{
  if(!query.trim().startsWith("query ")||/\b(mutation|subscription)\b/.test(query))throw new Error("Only named read queries are supported");
  return repositoryProviderRequest("https://api.linear.app","/graphql",{linearGraphql:{apiKey,query,variables}});
}

/** Revoke a GitLab OAuth grant before discarding its local encrypted access token. */
export async function repositoryProviderRevokeGitlabToken(origin: string, clientId: string, clientSecret: string, token: string): Promise<void> {
  if (!clientId || !clientSecret || !token) throw new Error("GitLab revocation credentials are unavailable");
  await repositoryProviderRequest(origin, "/oauth/revoke", {
    form: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, token }),
    gitlabRevoke: true,
  });
}

/** A GitHub token is cleared locally only after its upstream revocation is confirmed. */
export async function repositoryProviderRevokeGithubToken(clientId: string, clientSecret: string, accessToken: string): Promise<void> {
  if (!clientId || !clientSecret || !accessToken) throw new Error("GitHub revocation credentials are unavailable");
  const appToken = { clientId, clientSecret, accessToken };
  const path = `/applications/${encodeURIComponent(clientId)}/token`;
  try {
    await repositoryProviderRequest("https://api.github.com", path, { revoke: appToken });
  } catch (error) {
    // A previous DELETE may have succeeded before the local transaction could
    // commit. GitHub's check-token endpoint documents 404 as an invalid token;
    // only that independent confirmation makes a retry safe to finish locally.
    if (!(error instanceof ProviderStatusError) || error.status !== 404) throw error;
    const stillValid = await repositoryProviderRequest("https://api.github.com", path, { check: appToken });
    if (stillValid !== false) throw error;
  }
}
