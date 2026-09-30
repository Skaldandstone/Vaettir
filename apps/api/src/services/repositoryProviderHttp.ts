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
  return !(a===0 || a===10 || a===127 || a>=224 || (a===100 && b>=64 && b<=127) ||
    (a===169 && b===254) || (a===172 && b>=16 && b<=31) || (a===192 && (b===168 || b===0 || (b===88 && c===99))) ||
    (a===198 && (b===18 || b===19 || (b===51 && c===100))) || (a===203 && b===0 && c===113));
}

type ProviderRequestOptions = { token?: string; form?: URLSearchParams; revoke?: { clientId: string; clientSecret: string; accessToken: string } };

/** Pin public DNS to the actual TLS socket; never follow redirects with credentials. */
async function repositoryProviderRequest(origin: string, path: string, options: ProviderRequestOptions): Promise<unknown> {
  const base = repositoryProviderOrigin(origin);
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
  const body = options.revoke ? JSON.stringify({ access_token: options.revoke.accessToken }) : options.form?.toString();
  return new Promise((resolve,reject)=>{
    const req=request(url, {
      method: options.revoke ? "DELETE" : body ? "POST" : "GET",
      signal: controller.signal,
      family: 4,
      lookup: (_host,_opts,callback)=>callback(null,address,4),
      headers: {Accept:options.revoke?"application/vnd.github+json":"application/json","User-Agent":"Vaettir-Repository-Connector",
        ...(options.token?{Authorization:`Bearer ${options.token}`}:{ }),
        ...(options.revoke?{Authorization:`Basic ${Buffer.from(`${options.revoke.clientId}:${options.revoke.clientSecret}`).toString("base64")}`,
          "X-GitHub-Api-Version":"2022-11-28"}:{ }),
        ...(body?{"Content-Type":options.revoke?"application/json":"application/x-www-form-urlencoded","Content-Length":Buffer.byteLength(body)}:{})},
    },res=>{
      if (!res.statusCode || (options.revoke ? res.statusCode!==204 : res.statusCode<200 || res.statusCode>=300)) {res.destroy();reject(new Error(`Provider request failed (${res.statusCode ?? 0}). Reconnect or check access.`));return;}
      let size=0; const chunks:Buffer[]=[];
      res.on("data",chunk=>{size+=chunk.length;if(size>1024*1024){res.destroy();reject(new Error("Provider response exceeded the safe size limit"));}else chunks.push(Buffer.from(chunk));});
      res.on("error",()=>reject(new Error("Provider response interrupted")));
      res.on("end",()=>{if(options.revoke){resolve(undefined);return;}try{resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));}catch{reject(new Error("Provider returned an invalid response"));}});
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

export function repositoryProviderJson(origin: string, path: string, options: {token?: string; form?: URLSearchParams} = {}): Promise<unknown> {
  return repositoryProviderRequest(origin, path, options);
}

/** A GitHub token is cleared locally only after its upstream revocation is confirmed. */
export async function repositoryProviderRevokeGithubToken(clientId: string, clientSecret: string, accessToken: string): Promise<void> {
  if (!clientId || !clientSecret || !accessToken) throw new Error("GitHub revocation credentials are unavailable");
  await repositoryProviderRequest("https://api.github.com", `/applications/${encodeURIComponent(clientId)}/token`,
    { revoke: { clientId, clientSecret, accessToken } });
}
