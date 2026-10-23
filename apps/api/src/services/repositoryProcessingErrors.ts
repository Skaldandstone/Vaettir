import {InsufficientAiCreditsError} from "./aiCredits.js";
import {safeInternalErrorDetails} from "../publicErrors.js";
import {TRPCError} from "@trpc/server";
const messages=new Set([
  "Explicit source-processing approval is required for repository jobs.",
  "Explicit source-processing approval is required.",
  "Repository job is outside its approved pinned scope.",
  "Current full editor access is required to process source and use credits.",
  "Source-processing approval expired, was canceled or requires review.",
  "A paid attempt already started. Review recovery status before another AI call; automatic recharging is blocked.",
  "Scoped repository persistence requires durable approval and repository identity.",
  "Repository persistence differs from the approved source revision.",
  "Generated test identities are ambiguous. Paid proposals are retained for review; no cases were replaced or duplicated.",
  "This document already has an approved paid attempt in progress or requiring recovery. Review the saved run; automatic repeated charges are blocked.",
  "The repository revision could not be pinned.",
  "FORBIDDEN",
  "This organization has hit its reverse-engineering rate limit (200 jobs/hour). Try again shortly.",
]);
export function publicRepositoryProcessingError(error:unknown){
  if(error instanceof TRPCError&&messages.has(error.message))return new TRPCError({code:error.code,message:error.message});
  const details=safeInternalErrorDetails(error);
  const diagnostic=details.databaseCode?`${details.errorType}; database ${details.databaseCode}`:details.errorType;
  // No raw cause: the global Sentry handler reports error.cause if present.
  return new TRPCError({code:"INTERNAL_SERVER_ERROR",message:`Repository source processing failed (${diagnostic}). Paid outputs, if any, remain in the saved run.`});
}
export function repositoryProcessingFailure(error:unknown){
  const expected=error instanceof InsufficientAiCreditsError || (error instanceof Error&&messages.has(error.message));
  const details=safeInternalErrorDetails(error);
  const diagnostic=details.databaseCode?`${details.errorType}; database ${details.databaseCode}`:details.errorType;
  const message=error instanceof InsufficientAiCreditsError
    ? "Insufficient AI credits for the approved repository job. Add credits, then retry the unpaid job."
    : error instanceof Error&&messages.has(error.message)?error.message
    : `Repository processing failed (${diagnostic}). Paid proposals, if any, are retained. Contact support with the job ID; no automatic repeated charge will occur.`;
  return{expected,message,details};
}
