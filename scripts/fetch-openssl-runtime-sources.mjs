import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";

export const pins=JSON.parse(await readFile(new URL("./openssl-runtime-sources.json",import.meta.url),"utf8"));
if(pins.version!=="openssl-security-backport/v1"||pins.sourceVersion!=="3.5.9-1~deb13u1"||pins.packageVersion!=="3.5.9-1~deb13u1+vaettir1"||pins.signer!=="57892E705233051337F6FDD105641F175712FA5B"||pins.files.length!==4||pins.patches.length!==8)throw Error("Unexpected OpenSSL source identity");
const files=["openssl_3.5.9-1~deb13u1.dsc","openssl_3.5.9.orig.tar.gz","openssl_3.5.9.orig.tar.gz.asc","openssl_3.5.9-1~deb13u1.debian.tar.xz"];
const patches=new Set();
for(const [i,f] of pins.files.entries())if(f.name!==files[i])throw Error("Unexpected OpenSSL source file");
for(const p of pins.patches){if(!/^[a-f0-9]{40}$/.test(p.commit)||p.name!==p.commit+".patch"||!/^CVE-2026-\d{5,6}$/.test(p.cve)||patches.has(p.commit))throw Error("Invalid OpenSSL patch identity");patches.add(p.commit);}
for(const p of [...pins.files,...pins.patches])if(!/^[a-f0-9]{64}$/.test(p.sha256)||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>60000000)throw Error("Invalid OpenSSL byte pin");
function freeze(value){if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
freeze(pins);

export async function fetchOpenSSLInput(pin,{fetchImpl=fetch}={}){
  if(![...pins.files,...pins.patches].includes(pin))throw Error("Unapproved OpenSSL input");
  const url=pin.commit?"https://api.github.com/repos/openssl/openssl/commits/"+pin.commit:"https://deb.debian.org/debian/pool/main/o/openssl/"+pin.name;
  const response=await fetchImpl(url,{redirect:"error",headers:{"Accept-Encoding":"identity",...(pin.commit?{Accept:"application/vnd.github.patch"}:{})},signal:AbortSignal.timeout(90000)});
  if(!response.ok||!response.body||![null,"identity"].includes(response.headers.get("content-encoding")))throw Error("OpenSSL source transport failed");
  const chunks=[];let size=0;const hash=createHash("sha256");
  for await(const chunk of response.body){size+=chunk.length;if(size>pin.bytes)throw Error("OpenSSL source exceeded pin");hash.update(chunk);chunks.push(chunk);}
  if(size!==pin.bytes||hash.digest("hex")!==pin.sha256)throw Error("OpenSSL source differs from pin");
  return Buffer.concat(chunks);
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const directory=resolve(process.argv[2]);await mkdir(directory,{recursive:false});
  for(const pin of [...pins.files,...pins.patches])await writeFile(join(directory,pin.name),await fetchOpenSSLInput(pin),{flag:"wx"});
  console.log("Pinned OpenSSL inputs fetched; signed-source and native validation remain required.");
}
