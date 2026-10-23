import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  runHistoryAccessInput,
  runHistoryPageInput,
  runHistoryReadKey,
} from "./runHistoryReadSchema.js";
const input = {
  projectId: "p",
  originalOrganizationId: "o",
  expectedClerkActorId: "cl",
  expectedNativeActorId: "n",
  requestId: randomUUID(),
  limit: 20,
  asOf: "2026-09-02T00:00:00.000Z",
};
it("page requires explicit limit/asOf/native actor and exact UTC cursor; no hidden defaults", () => {
  for (const key of ["limit", "asOf", "expectedNativeActorId"]) {
    const partial = { ...input };
    delete partial[key as keyof typeof partial];
    expect(runHistoryPageInput.safeParse(partial).success).toBe(false);
  }
  for (const patch of [
    { limit: 22 },
    { limit: 0 },
    { asOf: "2026-09-02T00:00:00Z" },
    { asOf: "2999-01-01T00:00:00.000Z" },
    { asOf: "0000-01-01T00:00:00.000Z" },
    { asOf: "+012026-01-01T00:00:00.000Z" },
    { before: { id: "cursor", startedAt: "2026-09-03T00:00:00.000Z" } },
  ])
    expect(runHistoryPageInput.safeParse({ ...input, ...patch }).success).toBe(
      false,
    );
});
it("bootstrap alone may omit native ID; read identity includes exact nonce/window/cursor", () => {
  const access = {
    projectId: "p",
    originalOrganizationId: "o",
    expectedClerkActorId: "cl",
    requestId: randomUUID(),
  };
  expect(runHistoryAccessInput.parse(access)).toEqual(access);
  expect(runHistoryPageInput.parse(input)).toEqual(input);
  for (const patch of [
    { requestId: randomUUID() },
    { asOf: "2026-09-01T00:00:00.000Z" },
    { limit: 1 },
    { expectedNativeActorId: "another" },
    { before: { id: "run", startedAt: "2026-09-01T00:00:00.000Z" } },
  ])
    expect(runHistoryReadKey({ ...input, ...patch })).not.toBe(
      runHistoryReadKey(input),
    );
});
