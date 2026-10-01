// Conservative exclusions, not comprehensive secret detection. Files that
// match are not read into jobs or sent to AI by repository scan flows.
export function safeSourcePath(value:string){
  return value === "." || Boolean(value && value.length<=500 && !value.startsWith("/") && !/[\\:]/.test(value) && !value.split("/").some(part=>!part||part==="."||part==="..") && !Array.from(value).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127));
}
export function sourcePathInScope(value:string,prefixes:readonly string[]){
  if(!safeSourcePath(value)||value===".")return false;
  const lower=value.toLowerCase();
  if(lower.split("/").some(part=>["node_modules",".git","dist","build",".next",".turbo","vendor","venv",".venv","coverage","secrets","credentials"].includes(part)))return false;
  if(lower.split("/").some(part=>/^\.env(?:\.|$)/.test(part)||[".npmrc",".netrc",".pypirc","id_rsa","id_ed25519"].includes(part)||/\.(pem|key|p12|pfx|keystore)$/.test(part)))return false;
  return prefixes.some(prefix=>prefix==="."||value===prefix||value.startsWith(prefix+"/"));
}
export function safeRepositoryText(content:string){
  if(Array.from(content).some(char=>{const code=char.charCodeAt(0);return(code<32&&![9,10,13].includes(code))||code===127;}))return false;
  // Same baseline as pinnedRepositoryDocuments, plus GitLab/Slack/token
  // patterns likely to occur in test configuration or README examples.
  return !/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\bglpat-[A-Za-z0-9_-]{20,}|\bxox[baprs]-[A-Za-z0-9-]{20,}|\b(?:password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"']{8,}/i.test(content);
}
