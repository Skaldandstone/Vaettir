import { describe, it, expect } from "vitest";
import { admitWholeCaseFrozenGraph } from "./manualCaseReviewedGraph.js";
describe("complete saved prerequisite graph admission", () => {
  it("keeps original edge order and supports the existing 1000-case count", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `c${i}`),
      graph = Object.fromEntries(
        ids.map((id, i) => [id, i ? [ids[i - 1]] : []]),
      );
    expect(admitWholeCaseFrozenGraph(ids, graph)).toEqual(graph);
  });
  it.each([
    { c: [], b: ["a"], a: ["b"] },
    { c: [], a: [] },
    { c: [], a: [], b: [], foreign: [] },
    { c: [], a: ["foreign"], b: [] },
    { c: [], a: ["b", "b"], b: [] },
    { c: [], a: ["a"], b: [] },
  ])(
    "refuses omitted/foreign/duplicate/cyclic disconnected whole graph",
    (graph) =>
      expect(() => admitWholeCaseFrozenGraph(["c", "a", "b"], graph)).toThrow(
        /complete frozen/,
      ),
  );
});
