import { describe, it, expect } from "vitest";
import { substituteDatasetPlaceholders } from "./datasetSubstitution.js";

describe("substituteDatasetPlaceholders", () => {
  it("replaces every matching placeholder", () => {
    expect(substituteDatasetPlaceholders("<user> logs in with <password>", { user: "alice", password: "hunter2" })).toBe(
      "alice logs in with hunter2",
    );
  });

  it("leaves an unmatched placeholder untouched rather than blanking it", () => {
    expect(substituteDatasetPlaceholders("<user> does <unknown>", { user: "alice" })).toBe("alice does <unknown>");
  });

  it("passes through text with no placeholders unchanged", () => {
    expect(substituteDatasetPlaceholders("no placeholders here", {})).toBe("no placeholders here");
  });

  it("substitutes the same placeholder used more than once", () => {
    expect(substituteDatasetPlaceholders("<x> plus <x> equals double <x>", { x: "5" })).toBe("5 plus 5 equals double 5");
  });
});
