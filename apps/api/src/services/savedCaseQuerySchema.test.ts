import { describe, expect, it } from "vitest";
import { defaultCaseQuery } from "./caseQuerySchema.js";
import { savedCaseQueryDefinition, caseQueryColumnsSchema, savedCaseQueryWriteInput } from "./savedCaseQuerySchema.js";
describe("bounded saved typed query definition", () => {
  it("retains ordered columns and all typed groups", () => {
    const input = { name: " Personal risk ", visibility: "PRIVATE", query: defaultCaseQuery(), columns: ["suite", "title", "risk"] };
    expect(savedCaseQueryDefinition.parse(input)).toEqual({ ...input, name: "Personal risk" });
  });
  it("rejects duplicate/unknown/empty columns, unsupported criteria and oversized names", () => {
    for (const columns of [[], ["title", "title"], ["rawSource"]]) expect(() => caseQueryColumnsSchema.parse(columns)).toThrow();
    expect(() => savedCaseQueryDefinition.parse({ name: "x".repeat(81), visibility: "PRIVATE", query: defaultCaseQuery(), columns: ["title"] })).toThrow();
    expect(() => savedCaseQueryDefinition.parse({ name: "SQL", visibility: "SHARED", query: { ...defaultCaseQuery(), sql: "SELECT" }, columns: ["title"] })).toThrow();
  });
  it("requires actor receipt UUID, exact operation payload and positive CAS version", () => {
    const value = { operation: "DELETE", projectId: "project", id: "query", requestId: "f74dbd60-7425-41b5-aa5a-481d8bc6a0bf", expectedVersion: 1 };
    expect(savedCaseQueryWriteInput.parse(value)).toEqual(value);
    expect(() => savedCaseQueryWriteInput.parse({ ...value, expectedVersion: 0 })).toThrow();
    expect(() => savedCaseQueryWriteInput.parse({ ...value, actorId: "client cannot choose" })).toThrow();
  });
});
