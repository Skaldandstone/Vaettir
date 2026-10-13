export type RepositoryRequirementsDocument = {fileName:"requirements.md";classification:"INFERRED_FROM_CODE"|"DOCUMENT_DERIVED";confirmed:false;headSha:string;markdown:string;contentHash:string};
export function readRepositoryRequirementsDocument(results:unknown):RepositoryRequirementsDocument|null {
  if(!results||typeof results!=="object"||!("requirementsDocument" in results))return null;
  const value=results.requirementsDocument;
  if(!value||typeof value!=="object"||!("fileName" in value)||value.fileName!=="requirements.md"||!("classification" in value)||(value.classification!=="INFERRED_FROM_CODE"&&value.classification!=="DOCUMENT_DERIVED")||!("confirmed" in value)||value.confirmed!==false||!("headSha" in value)||typeof value.headSha!=="string"||!/^[a-f0-9]{40}$/.test(value.headSha)||!("contentHash" in value)||typeof value.contentHash!=="string"||!/^[a-f0-9]{64}$/.test(value.contentHash)||!("markdown" in value)||typeof value.markdown!=="string"||!value.markdown||new TextEncoder().encode(value.markdown).length>524288)return null;
  return {fileName:value.fileName,classification:value.classification,confirmed:false,headSha:value.headSha,markdown:value.markdown,contentHash:value.contentHash};
}
export async function verifiedRequirementsDocumentBytes(value:RepositoryRequirementsDocument):Promise<Uint8Array>{
  const bytes=new TextEncoder().encode(value.markdown);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),byte=>byte.toString(16).padStart(2,"0")).join("");
  if(hash!==value.contentHash)throw Error("The saved requirements draft checksum did not match. Refresh the saved run; no file was downloaded.");
  return bytes;
}
