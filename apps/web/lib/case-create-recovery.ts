import type { RouterInputs } from "./trpcReact";
import { manualStartDefinitivelyRejected } from "./manual-run-start";

type CreateInput = RouterInputs["testCases"]["createDurable"];
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Retains an exact wire request, never evidence that a server write failed. */
export class CaseCreateRecovery {
  pending: CreateInput | null = null;
  createdId: string | null = null;
  confirmed: CreateInput | null = null;
  private confirmedHash: string | null = null;
  private ambiguous = false;
  prepare(input: Omit<CreateInput, "requestId">): CreateInput {
    if (this.createdId) throw new Error("This case was already created. Open the saved case instead.");
    if (!this.pending) {
      this.pending = freeze(JSON.parse(JSON.stringify({ ...input, requestId: crypto.randomUUID() })));
      this.ambiguous = false;
    }
    return this.pending!;
  }
  acknowledge(value: unknown) {
    const input = this.pending ?? this.confirmed, ack = value as Record<string, unknown> | null;
    if (!input || !ack || typeof ack.id !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(ack.id) ||
      ack.requestId !== input.requestId || ack.projectId !== input.projectId ||
      ack.originalOrganizationId !== input.originalOrganizationId || ack.expectedClerkActorId !== input.expectedClerkActorId ||
      typeof ack.requestHash !== "string" || !/^[a-f0-9]{64}$/.test(ack.requestHash) || typeof ack.replayed !== "boolean" ||
      (this.createdId !== null && (this.createdId !== ack.id || this.confirmedHash !== ack.requestHash)))
      throw new Error("The save response did not confirm this request. Retry the original save.");
    this.createdId = ack.id;
    this.confirmedHash = ack.requestHash;
    this.confirmed = input;
    this.pending = null;
  }
  failed(cause: unknown) {
    if (!this.pending) return;
    if (manualStartDefinitivelyRejected(cause, this.ambiguous)) this.pending = null;
    else this.ambiguous = true;
  }
}
