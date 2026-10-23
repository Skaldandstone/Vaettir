import { describe, expect, it } from "vitest";
import { architectureAnalysisScope } from "./architectureAnalysisScope.js";

const diagram =
  "@startuml\ncomponent API\ndatabase Ledger\nAPI --> Ledger : reserve funds\n@enduml";
const c = (id: string) => ({
  id,
  displayId: `T-${id}`,
  title: "Reserve funds",
  background: null,
  given: [],
  when: [],
  then: [],
  steps: [
    {
      action: "Reserve funds",
      expectedActionOrData: null,
      expectedResult: "Exactly one reservation is persisted",
      expectedResponse: null,
    },
  ],
  sharedSteps: null,
  verificationProfile: {},
});
describe("Vaettir architecture scope", () => {
  it("batches complete definitions and reserves a distinct final gap review", () => {
    const result = architectureAnalysisScope(
      "p",
      "a.puml",
      diagram,
      Array.from({ length: 43 }, (_, i) => c(String(i))),
    );
    expect(result.batches.map((b) => b.length)).toEqual([20, 20, 3, 0]);
    expect(result.batches.flat()).toEqual(result.definitions);
    expect(result.unprocessed).toEqual([]);
  });
  it("hashes behavior and context, not just IDs, without silently truncating large cases", () => {
    const original = architectureAnalysisScope("p", "a.puml", diagram, [
      c("1"),
    ]);
    for (const changed of [
      { ...c("1"), title: "New title" },
      { ...c("1"), sharedSteps: [{ action: "Audit reservation" }] },
      { ...c("1"), verificationProfile: { voltage: "12V" } },
    ]) {
      expect(
        architectureAnalysisScope("p", "a.puml", diagram, [changed]).scopeHash,
      ).not.toBe(original.scopeHash);
    }
    const large = { ...c("large"), background: "x".repeat(61_000) };
    const result = architectureAnalysisScope("p", "a.puml", diagram, [
      large,
      c("1"),
    ]);
    expect(result.definitions[0]).toEqual(large);
    expect(result.unprocessed).toMatchObject([{ caseId: "large" }]);
    expect(result.batches.flat().map((c) => c.id)).toEqual(["1"]);
  });
  it("refuses duplicate IDs and unsafe documents before analysis", () => {
    expect(() =>
      architectureAnalysisScope("p", "a.puml", diagram, [c("1"), c("1")]),
    ).toThrow(/distinct/);
    expect(() =>
      architectureAnalysisScope(
        "p",
        "a.svg",
        "<svg><script>alert(1)</script><text>API</text></svg>",
        [],
      ),
    ).toThrow();
    expect(
      architectureAnalysisScope("p", "a.puml", diagram, []).batches,
    ).toEqual([[]]);
  });
});
