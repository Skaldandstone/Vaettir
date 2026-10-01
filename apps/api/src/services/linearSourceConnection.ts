import {z} from "zod";
import {linearProviderGraphql} from "./repositoryProviderHttp.js";

// Official API: https://linear.app/developers/graphql and /pagination.
// Personal API keys use raw Authorization. This adapter never requests issue content.
const id=z.string().uuid();
const label=z.string().min(1).max(300);
const linearUrl=z.string().url().max(1000).refine(value=>{const u=new URL(value);return u.protocol==="https:"&&u.hostname==="linear.app"&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash;});
export const linearProjectSchema=z.object({id,name:label,url:linearUrl});
export const linearCatalogSchema=z.object({workspace:z.object({id,name:label}),account:z.object({id,name:label}),projects:z.array(linearProjectSchema).max(500)});
const responseSchema=z.object({errors:z.array(z.unknown()).optional(),data:z.object({viewer:z.object({id,name:label}),organization:z.object({id,name:label}),projects:z.object({nodes:z.array(linearProjectSchema).max(50),pageInfo:z.object({hasNextPage:z.boolean(),endCursor:z.string().min(1).max(1000).nullable()})})}).optional()});
const query=`query VaettirConnectionMetadata($after: String) {
  viewer { id name }
  organization { id name }
  projects(first: 50, after: $after) { nodes { id name url } pageInfo { hasNextPage endCursor } }
}`;
export async function listLinearProjects(apiKey:string,after:string|null=null){
  const result=responseSchema.parse(await linearProviderGraphql(apiKey,query,{after}));
  if(result.errors?.length || !result.data)throw new Error("Linear did not verify all requested metadata");
  const {viewer,organization,projects}=result.data;
  if(projects.pageInfo.hasNextPage&&!projects.pageInfo.endCursor)throw new Error("Linear pagination is incomplete");
  if(new Set(projects.nodes.map(p=>p.id)).size!==projects.nodes.length)throw new Error("Linear returned duplicate project identities");
  return {workspace:organization,account:viewer,projects:projects.nodes,hasMore:projects.pageInfo.hasNextPage,nextCursor:projects.pageInfo.endCursor};
}
