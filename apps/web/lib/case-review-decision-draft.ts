import type { RouterInputs,RouterOutputs } from "./trpcReact";
export type ReviewInput=RouterInputs["caseReview"]["decide"];
export type ReviewPreview=RouterOutputs["caseReview"]["preview"];
export type ReviewAck=RouterOutputs["caseReview"]["decide"];
export type ReviewOrigin=Readonly<{projectId:string;caseId:string;organizationId:string;clerkActorId:string;nativeActorId:string}>;
export type ReviewDraft=Readonly<{identity:string;origin:ReviewOrigin;decision:ReviewInput["decision"];note:ReviewInput["note"];contentHash:string;reviewStateHash:string;snapshot:NonNullable<ReviewPreview["snapshot"]>}>;
export type ReviewPending=Readonly<{input:Readonly<ReviewInput>;draft:ReviewDraft;requestHash:string;everAmbiguous:boolean}>;
/** Snapshot came from the bounded safe native DTO. Clone before recursively
 * freezing so renderers/callers cannot mutate the baseline bound to its hashes. */
export function freezeReviewSnapshot(snapshot:NonNullable<ReviewPreview["snapshot"]>){
  const cloned=structuredClone(snapshot);let nodes=0;
  function freeze(value:unknown,depth:number){if(++nodes>100000||depth>64)throw Error("Unsupported review snapshot structure.");if(value!==null&&typeof value==="object"){for(const child of Object.values(value))freeze(child,depth+1);Object.freeze(value);}}
  freeze(cloned,0);return cloned;
}
export function sameReviewReader(scope:ReviewPreview["readScope"]|undefined,origin:ReviewOrigin){return !!scope&&scope.projectId===origin.projectId&&scope.organizationId===origin.organizationId&&scope.actorClerkUserId===origin.clerkActorId&&scope.actorId===origin.nativeActorId;}
export function freezeReviewInput(draft:ReviewDraft,requestId:string):Readonly<ReviewInput>{
  // Same discriminated-union key order as native parsing; a valid caller may
  // construct value before operation. Exact text is unchanged, not trimmed.
  const note=Object.freeze(draft.note.operation==="SET"?{operation:"SET" as const,value:draft.note.value}:{operation:draft.note.operation});
  return Object.freeze({projectId:draft.origin.projectId,caseId:draft.origin.caseId,originalOrganizationId:draft.origin.organizationId,expectedClerkActorId:draft.origin.clerkActorId,expectedNativeActorId:draft.origin.nativeActorId,expectedContentHash:draft.contentHash,expectedReviewStateHash:draft.reviewStateHash,decision:draft.decision,note,requestId,confirmed:true});
}
export async function reviewDecisionHash(input:Readonly<ReviewInput>){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(input)));return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");}
export function assertReviewAck(ack:ReviewAck,pending:ReviewPending){if(ack.projectId!==pending.input.projectId||ack.caseId!==pending.input.caseId||ack.requestId!==pending.input.requestId||ack.requestHash!==pending.requestHash||ack.decision!==pending.input.decision||typeof ack.replayed!=="boolean"||!sameReviewReader(ack.readScope,pending.draft.origin))throw Error("The review acknowledgement did not match the original native reviewer, case and exact decision. Keep this request for recovery.");}
