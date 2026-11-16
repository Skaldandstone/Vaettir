import { expect, it } from "vitest";
import { CaseCreateRecovery } from "./case-create-recovery";
const draft = () => ({ projectId: "p", originalOrganizationId: "o", expectedClerkActorId: "clerk",
  title: " Exact manual\ncase ", testType: "FUNCTIONAL", given: [" Given "], when: ["When"], then: ["Then"],
  customFields: { note: "", enabled: false, count: 0 } });
const ack = (input: ReturnType<CaseCreateRecovery["prepare"]>) => ({ id: "created-case", requestId: input.requestId,
  projectId: input.projectId, originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId,
  requestHash: "a".repeat(64), replayed: true });
it("retains the exact immutable original wire body across unknown responses and later refusals", () => {
  const recovery = new CaseCreateRecovery(), original = draft(), input = recovery.prepare(original);
  original.given[0] = "Later edit";
  recovery.failed(Error("Lost ACK")); recovery.failed({ data: { code: "CONFLICT" } });
  expect(recovery.prepare({ ...draft(), title: "Must not replace original" })).toBe(input);
  expect(input.given).toEqual([" Given "]); expect(Object.isFrozen(input.customFields)).toBe(true);
  expect(input.customFields).toEqual({ note: "", enabled: false, count: 0 });
});
it("only a first proven refusal releases the request for editing", () => {
  const recovery = new CaseCreateRecovery(), first = recovery.prepare(draft());
  recovery.failed({ data: { code: "BAD_REQUEST" } }); expect(recovery.pending).toBeNull();
  expect(recovery.prepare(draft()).requestId).not.toBe(first.requestId);
});
it("rejects mismatched or malformed confirmations and settles one valid original request once", () => {
  const recovery = new CaseCreateRecovery(), input = recovery.prepare(draft());
  for (const wrong of [{ requestId: "other" }, { projectId: "other" }, { expectedClerkActorId: "other" }, { originalOrganizationId: "other" }, { requestHash: "bad" }, { id: "../other" }]) {
    expect(() => recovery.acknowledge({ ...ack(input), ...wrong })).toThrow("did not confirm");
    expect(recovery.pending).toBe(input);
  }
  recovery.acknowledge(ack(input)); expect(recovery.pending).toBeNull(); expect(recovery.createdId).toBe("created-case");
  expect(() => recovery.acknowledge(ack(input))).not.toThrow();
  expect(() => recovery.acknowledge({ ...ack(input), id: "different-case" })).toThrow("did not confirm");
  recovery.failed(Error("Refresh failed after ACK")); expect(recovery.pending).toBeNull();
  expect(() => recovery.prepare(draft())).toThrow("already created");
});
