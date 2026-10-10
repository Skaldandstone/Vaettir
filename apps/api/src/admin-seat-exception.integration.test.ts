import {randomUUID} from "node:crypto";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {prisma} from "@vaettir/db";
import {adminRouter} from "./routers/admin.js";
import {organizationRouter} from "./routers/organization.js";
const url=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
const isolated=!!url&&["localhost","127.0.0.1"].includes(url.hostname)&&/test/i.test(url.pathname)&&!url.searchParams.has("host");
describe.skipIf(!isolated)("scoped unlimited private workspace seats",()=>{
  let orgId:string,actorId:string,subject:string,planId:string;
  let caller:ReturnType<typeof adminRouter.createCaller>;
  let usage:ReturnType<typeof organizationRouter.createCaller>;
  const request=()=>({organizationId:orgId,expectedPlanTierId:planId,expectedClerkActorId:subject,reason:"Owner-requested synthetic exception"});
  beforeEach(async()=>{
    const key=randomUUID();subject=key;
    vi.stubEnv("FULL_ACCESS_EMAIL_ALLOWLIST",`${key}@example.com`);
    const base=await prisma.planTier.findUniqueOrThrow({where:{key:"private-beta"}});planId=base.id;
    orgId=(await prisma.organization.create({data:{name:key,slug:key,planTierId:planId}})).id;
    const user=await prisma.user.create({data:{email:`${key}@example.com`,clerkUserId:subject,memberships:{create:{organizationId:orgId,seatType:"FULL",role:"OWNER"}}},include:{memberships:true}});actorId=user.id;
    const ctx={prisma,user,authenticatedClerkSubject:subject,staff:null,securityLogger:undefined,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false}};
    caller=adminRouter.createCaller(ctx);usage=organizationRouter.createCaller(ctx);
  });
  afterEach(()=>vi.unstubAllEnvs());
  it("changes only this organization’s caps, preserves shared tier and credits, and records one atomic audit on retry",async()=>{
    const base=await prisma.planTier.findUniqueOrThrow({where:{id:planId}});
    const result=await caller.unlimitedPrivateBetaSeats(request());
    expect(await caller.unlimitedPrivateBetaSeats(request())).toEqual(result);
    const tier=await prisma.planTier.findUniqueOrThrow({where:{id:result.planTierId}});
    expect(tier).toMatchObject({maxFullSeats:null,maxReadOnlySeats:null,isPublic:false,minFullSeats:base.minFullSeats,includedReadOnlySeats:base.includedReadOnlySeats,monthlyPricePerSeatCents:base.monthlyPricePerSeatCents,stripePriceId:base.stripePriceId,includedAiCreditsPerMonth:base.includedAiCreditsPerMonth,enabledFeatures:base.enabledFeatures});
    expect(await prisma.planTier.findUniqueOrThrow({where:{id:planId}})).toEqual(base);
    expect(await prisma.auditLog.count({where:{organizationId:orgId,entityType:"Admin:SeatException"}})).toBe(1);
    expect(await prisma.aiCreditTransaction.count({where:{organizationId:orgId}})).toBe(0);
    expect(await usage.seatUsage({organizationId:orgId})).toMatchObject({fullSeatsIncluded:null,readOnlySeatsMax:null,privateBeta:true});
  });
  it("serializes duplicate submissions without duplicate tiers or audits",async()=>{
    const results=await Promise.all([caller.unlimitedPrivateBetaSeats(request()),caller.unlimitedPrivateBetaSeats(request())]);
    expect(results[0]).toEqual(results[1]);expect(await prisma.auditLog.count({where:{organizationId:orgId,entityType:"Admin:SeatException"}})).toBe(1);
  });
  it.each(["foreign","stale-clerk","staff-removed","not-owner","read-only","suspended","subscription","plan-changed"])("rejects %s without creating a tier or changing the plan",async mode=>{
    const input=request();
    if(mode==="foreign")input.organizationId="foreign";
    if(mode==="stale-clerk")await prisma.user.update({where:{id:actorId},data:{clerkUserId:randomUUID()}});
    if(mode==="staff-removed")await prisma.user.update({where:{id:actorId},data:{email:`not-staff-${randomUUID()}@example.com`}});
    if(mode==="not-owner")await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:actorId}},data:{role:"ADMIN"}});
    if(mode==="read-only")await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:actorId}},data:{seatType:"READ_ONLY"}});
    if(mode==="suspended")await prisma.organization.update({where:{id:orgId},data:{suspendedAt:new Date()}});
    if(mode==="subscription")await prisma.organization.update({where:{id:orgId},data:{stripeSubscriptionId:"synthetic-subscription"}});
    if(mode==="plan-changed")input.expectedPlanTierId="stale-plan";
    await expect(caller.unlimitedPrivateBetaSeats(input)).rejects.toThrow();
    expect((await prisma.organization.findUniqueOrThrow({where:{id:orgId}})).planTierId).toBe(planId);
    expect(await prisma.planTier.count({where:{key:`private-beta-unlimited:${orgId}`}})).toBe(0);
  });
});
