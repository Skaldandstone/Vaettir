import {describe,it,expect} from "vitest";
import {repositoryProcessingFailure,publicRepositoryProcessingError} from "./repositoryProcessingErrors.js";
import {TRPCError} from "@trpc/server";
import {InsufficientAiCreditsError} from "./aiCredits.js";
describe("scoped repository worker operational error privacy",()=>{
  it("preserves useful bounded error type/database code without source, credentials or proposal text",()=>{
    const error=Object.assign(new Error("Invalid create containing PRIVATE CUSTOMER PROPOSAL and synthetic-token-not-live"),{name:"PrismaClientKnownRequestError",code:"P2002"});
    const failure=repositoryProcessingFailure(error);expect(failure.message).toContain("PrismaClientKnownRequestError; database P2002");expect(JSON.stringify(failure)).not.toContain("PRIVATE CUSTOMER");expect(JSON.stringify(failure)).not.toContain("synthetic-token");expect(failure.expected).toBe(false);
  });
  it("exposes only known-static actionable permission/recovery messages",()=>{
    const text="A paid attempt already started. Review recovery status before another AI call; automatic recharging is blocked.";expect(repositoryProcessingFailure(new Error(text))).toMatchObject({expected:true,message:text});
    expect(repositoryProcessingFailure(new Error(text+" PRIVATE CUSTOMER DATA")).message).not.toContain("PRIVATE CUSTOMER DATA");
    expect(repositoryProcessingFailure(new InsufficientAiCreditsError("reverseEngineerTestFile",6,0))).toMatchObject({expected:true});
  });
  it("removes raw provider causes from global Sentry error reporting while preserving static operational guards",()=>{
    const raw=new Error("PRIVATE CUSTOMER PROPOSAL synthetic-token-not-live");const error=publicRepositoryProcessingError(raw);expect(error.cause).toBeUndefined();expect(String(error)).not.toContain("PRIVATE CUSTOMER");expect(String(error)).not.toContain("synthetic-token");expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    const guarded=publicRepositoryProcessingError(new TRPCError({code:"FORBIDDEN",message:"Current full editor access is required to process source and use credits.",cause:raw}));expect(guarded.code).toBe("FORBIDDEN");expect(guarded.cause).toBeUndefined();expect(guarded.message).toContain("full editor");
    const limited=publicRepositoryProcessingError(new TRPCError({code:"TOO_MANY_REQUESTS",message:"This organization has hit its reverse-engineering rate limit (200 jobs/hour). Try again shortly."}));expect(limited.code).toBe("TOO_MANY_REQUESTS");expect(limited.message).toContain("200 jobs/hour");
  });
});
