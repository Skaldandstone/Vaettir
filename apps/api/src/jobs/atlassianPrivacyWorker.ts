import {randomUUID} from "node:crypto";
import {TRPCError} from "@trpc/server";
import {Prisma,prisma,type PrismaClient,type AtlassianOAuthConnection} from "@vaettir/db";
import {z} from "@vaettir/core/dist/validation.js";
import {encryptToken,decryptToken} from "../services/tokenEncryption.js";
import {atlassianApplicationSchema,atlassianTokenSchema,refreshAtlassianToken,verifyAtlassianToken,ATLASSIAN_PRIVACY_DAY_MS,type AtlassianToken} from "../services/atlassianOAuth.js";
import {eraseAtlassianPersonalData,lockStoredAtlassianScope,checkStoredAtlassianPrivacy,AtlassianPrivacyBusyError} from "../services/atlassianOAuthConnection.js";
import {ProviderStatusError} from "../services/repositoryProviderHttp.js";
import {createSafeSchedulerRunner} from "./safeSchedulerRunner.js";
import {recordHeartbeat} from "../services/heartbeat.js";

export const ATLASSIAN_PRIVACY_INTERVAL_MS=60000;
const LEASE_MS=10*60000;
const cipher=z.object({ciphertext:z.string(),iv:z.string(),authTag:z.string()});
const decode=(value:unknown):unknown=>JSON.parse(decryptToken(cipher.parse(value)));
const encode=(value:unknown)=>({...encryptToken(JSON.stringify(value))});
const held="PRIVACY_CHECKING";
const inactive=["DISCONNECTED","RECOVERY_REQUIRED","CANCELLED"];

async function eraseVersion(db:PrismaClient,row:Pick<AtlassianOAuthConnection,"id"|"version">){
  await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "AtlassianOAuthConnection" WHERE id=${row.id} FOR UPDATE`;
    const current=await tx.atlassianOAuthConnection.findUnique({where:{id:row.id}});
    if(current?.version===row.version)await eraseAtlassianPersonalData(tx,row.id);
  });
}
function transient(error:unknown){
  return error instanceof ProviderStatusError&&(error.status===429||error.status>=500)||error instanceof Error&&["Could not reach the provider securely. Try again.","Provider request exceeded the safe time limit","Provider response interrupted"].includes(error.message);
}

/** Durable single-account checks at the provider's cycle, not a service-user grant.
 * Each provider request reports only the account belonging to its bearer token.
 * Expired claims are erased rather than replaying a possibly rotated refresh.
 * Network work never holds database locks. */
export async function runDueAtlassianPrivacy(db:PrismaClient=prisma,now=new Date()){
  const rows=await db.atlassianOAuthConnection.findMany({where:{OR:[
    {status:"VERIFIED",OR:[{privacyDueAt:null},{privacyDueAt:{lte:now}}]},
    {status:held,privacyDueAt:{lte:now}},
    {status:"DISCONNECTING",privacyDueAt:{lte:now}},
    {status:{in:inactive},OR:[{accountId:{not:null}},{accountName:{not:null}},{encryptedToken:{not:Prisma.DbNull}}]}
  ]},orderBy:[{privacyDueAt:"asc"},{createdAt:"asc"},{id:"asc"}],take:5});
  for(const candidate of rows){
    recordHeartbeat("atlassianPrivacyWorker");
    if(candidate.status!=="VERIFIED"){await eraseVersion(db,candidate);continue;}
    const operationId=randomUUID();
    let row:AtlassianOAuthConnection|null;
    try{
      row=await db.$transaction(async tx=>{
        await lockStoredAtlassianScope(tx,candidate);
        const locked=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "AtlassianOAuthConnection" WHERE id=${candidate.id} FOR UPDATE SKIP LOCKED`;
        if(!locked.length)return null;
        const current=await tx.atlassianOAuthConnection.findUniqueOrThrow({where:{id:candidate.id}});
        if(current.version!==candidate.version||current.status!=="VERIFIED"||current.privacyDueAt&&current.privacyDueAt>now)return null;
        return tx.atlassianOAuthConnection.update({where:{id:current.id},data:{status:held,operationId,privacyDueAt:new Date(now.getTime()+LEASE_MS),version:{increment:1}}});
      });
    }catch(error){
      if(error instanceof TRPCError&&["FORBIDDEN","NOT_FOUND","UNAUTHORIZED"].includes(error.code)){await eraseVersion(db,candidate);continue;}
      throw new Error("Atlassian privacy maintenance could not claim its records.");
    }
    if(!row)continue;
    let token:AtlassianToken|undefined,observedAt=row.verifiedAt,rotationUncertain=false;
    let receipt:Awaited<ReturnType<typeof checkStoredAtlassianPrivacy>>|undefined;
    const finish=async(erase:boolean,retryMs=3600000)=>db.$transaction(async tx=>{
      // Same parent/actor locks as customer access; losing permission only erases.
      if(!erase){try{await lockStoredAtlassianScope(tx,row);}catch(error){if(error instanceof TRPCError)erase=true;else throw error;}}
      await tx.$queryRaw`SELECT id FROM "AtlassianOAuthConnection" WHERE id=${row.id} FOR UPDATE`;
      const current=await tx.atlassianOAuthConnection.findUnique({where:{id:row.id}});
      if(!current||current.operationId!==operationId)return;
      if(erase||current.status!==held||!token){await eraseAtlassianPersonalData(tx,row.id);return;}
      await tx.atlassianOAuthConnection.update({where:{id:row.id},data:{status:"VERIFIED",operationId:null,privacyClaimId:null,encryptedToken:encode(token),tokenExpiresAt:new Date(token.expiresAt),accountId:token.accountId,accountName:token.accountName,verifiedAt:observedAt,privacyCheckedAt:receipt?.checkedAt??current.privacyCheckedAt,privacyCycleDays:receipt?.cycleDays??current.privacyCycleDays,privacyDueAt:receipt?.dueAt??new Date(Date.now()+retryMs),version:{increment:1}}});
      // A linked Jira catalogue contains a copy of the authorizing user's name.
      // Invalidate it rather than leave an outdated profile in another table.
      await tx.ticketSourceConnection.updateMany({where:{oauthConnectionId:row.id},data:{catalog:Prisma.DbNull,catalogAt:null,tokenExpiresAt:new Date(token.expiresAt),version:{increment:1}}});
    });
    try{
      token=atlassianTokenSchema.parse(decode(row.encryptedToken));
      if(!row.accountId||token.accountId!==row.accountId||!observedAt)throw new Error("Invalid stored privacy identity");
      if(token.expiresAt<=Date.now()+60000){
        rotationUncertain=true;
        const issued=await refreshAtlassianToken(atlassianApplicationSchema.parse(decode(row.encryptedApplication)),token);
        // Persist rotation before verification; neither a disconnect nor a crash
        // can cause an automatic replay of the previous refresh credential.
        const saved=await db.atlassianOAuthConnection.updateMany({where:{id:row.id,operationId,status:{in:[held,"DISCONNECTING"]}},data:{encryptedToken:encode({issued}),tokenExpiresAt:null}});
        if(saved.count!==1)continue;
        token=await verifyAtlassianToken(issued,row.accountId);observedAt=new Date();rotationUncertain=false;
      }
      receipt=await checkStoredAtlassianPrivacy(db,row,operationId,token,observedAt);
      token=receipt.token;observedAt=receipt.observedAt;
      await finish(false);
    }catch(error){
      // An overdue check denies all customer reads immediately. A known token
      // may remain encrypted for one bounded retry day; no grant is broadened.
      const retain=row.privacyCheckedAt&&row.privacyCycleDays&&Date.now()<row.privacyCheckedAt.getTime()+(row.privacyCycleDays+1)*ATLASSIAN_PRIVACY_DAY_MS;
      const retryMs=error instanceof ProviderStatusError&&error.retryAfterSeconds?Math.max(3600000,error.retryAfterSeconds*1000):3600000;
      await finish(rotationUncertain||!retain||!(transient(error)||error instanceof AtlassianPrivacyBusyError),error instanceof AtlassianPrivacyBusyError?60000:retryMs);
    }
  }
}

export function startAtlassianPrivacyWorker(){
  const tick=createSafeSchedulerRunner("atlassian-privacy",async()=>{
    recordHeartbeat("atlassianPrivacyWorker");
    try{await runDueAtlassianPrivacy();}catch{throw new Error("Atlassian account-data maintenance is unavailable.");}
  });
  void tick();
  const timer=setInterval(()=>void tick(),ATLASSIAN_PRIVACY_INTERVAL_MS);timer.unref();
  return()=>clearInterval(timer);
}
