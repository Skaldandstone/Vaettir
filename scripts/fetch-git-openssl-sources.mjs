import {createHash} from "node:crypto";
import {mkdir,open,readFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
const identities={git:{version:"1:2.47.3-0+deb13u1",signer:"3AFA757FAC6EA11D2FF45DF088D24287A2D898B1",origin:"https://deb.debian.org/debian/pool/main/g/git/",files:[["git_2.47.3-0+deb13u1.dsc",10000],["git_2.47.3.orig.tar.xz",8000000],["git_2.47.3-0+deb13u1.debian.tar.xz",1000000]]},curl:{version:"8.22.0-1",signer:"05DB6A837E105F4B1D02C55FBBA9FAADCCFB4707",origin:"https://deb.debian.org/debian/pool/main/c/curl/",files:[["curl_8.22.0-1.dsc",10000],["curl_8.22.0.orig.tar.gz",5000000],["curl_8.22.0.orig.tar.gz.asc",2000],["curl_8.22.0-1.debian.tar.xz",100000]]}};
function keys(value,expected){if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join(",")!==[...expected].sort().join(","))throw Error("Invalid source metadata fields");}
export function validateSourcePins(value){
  keys(value,["git","curl"]);
  for(const component of ["git","curl"]){const recipe=value[component],expected=identities[component];keys(recipe,["version","signer","origin","files"]);
    if(recipe.version!==expected.version||recipe.signer!==expected.signer||recipe.origin!==expected.origin||!Array.isArray(recipe.files)||recipe.files.length!==expected.files.length)throw Error("Inconsistent source identity");
    recipe.files.forEach((file,index)=>{keys(file,["name","sha256","maxBytes"]);if(typeof file.name!=="string"||!file.name.startsWith(component+"_")||!/^[-a-zA-Z0-9.+~_]+$/.test(file.name)||file.name.includes("..")||file.name!==expected.files[index][0]||file.maxBytes!==expected.files[index][1]||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error("Invalid exact source file pin");});
  }
  return value;
}
function deepFreeze(value){if(value&&typeof value==="object"){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}return value;}
export const sourcePins=deepFreeze(validateSourcePins(JSON.parse(await readFile(new URL("./git-openssl-sources.json",import.meta.url),"utf8"))));
export async function fetchGitOpenSSLSource(component,name,{fetchImpl=fetch,signal}={}){
  if(!["git","curl"].includes(component))throw Error("Unknown Git/OpenSSL source component");
  const recipe=sourcePins[component],pin=recipe.files.find(file=>file.name===name);
  if(typeof name!=="string"||!name.startsWith(component+"_")||!/^[-a-zA-Z0-9.+~_]+$/.test(name)||name.includes("..")||!pin||recipe.origin!==identities[component].origin)throw Error("Invalid Git/OpenSSL source pin");
  let response;try{response=await fetchImpl(recipe.origin+pin.name,{redirect:"error",signal:AbortSignal.any([AbortSignal.timeout(60000),...(signal?[signal]:[])])});}catch{if(signal?.aborted)throw new DOMException("Git/OpenSSL source cancelled","AbortError");throw Error("Git/OpenSSL source transport failed");}
  if(!response.ok||!response.body)throw Error("Git/OpenSSL source download failed");
  const chunks=[];let size=0;
  try{for await(const chunk of response.body){size+=chunk.length;if(size>pin.maxBytes)throw Error("Git/OpenSSL source bound exceeded");chunks.push(chunk);}}catch(error){if(error.message==="Git/OpenSSL source bound exceeded")throw error;if(signal?.aborted)throw new DOMException("Git/OpenSSL source cancelled","AbortError");throw Error("Git/OpenSSL source body transport failed");}
  const data=Buffer.concat(chunks);
  if(createHash("sha256").update(data).digest("hex")!==pin.sha256)throw Error("Git/OpenSSL source hash mismatch");
  return data;
}
async function save(path,data){const fd=await open(path,"wx",0o600);try{await fd.writeFile(data);await fd.sync();}finally{await fd.close();}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const destination=resolve(process.argv[2]??"/build/git-curl-sources"),component=process.argv[3];
  if(!["git","curl"].includes(component))throw Error("Specify git or curl");
  await mkdir(destination,{recursive:true});
  for(const pin of sourcePins[component].files)await save(join(destination,pin.name),await fetchGitOpenSSLSource(component,pin.name));
  await save(join(destination,"source-manifest.json"),JSON.stringify({[component]:sourcePins[component]},null,2)+"\n");
  console.log("Pinned public Debian "+component+" bytes downloaded; signed-source verification remains required before build.");
}
