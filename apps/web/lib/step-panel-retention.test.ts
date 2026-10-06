import { expect, it } from "vitest";
import { StepPanelRetention } from "./step-panel-retention";
it("visits are original indexed instances, not reset by collapse/filter or duplicate opens", () => {
  const state = new StepPanelRetention();
  expect(state.visit(2, 4)).toBe(true); expect(state.visit(0, 4)).toBe(true); expect(state.visit(2, 4)).toBe(true);
  expect(state.indexes()).toEqual([0, 2]); expect(state.has(1)).toBe(false);
  for (const index of [-1, 0.1, 4, Infinity, NaN]) expect(state.visit(index, 4)).toBe(false);
  expect(state.visit(0, 1001)).toBe(false); expect(state.indexes()).toEqual([0, 2]);
});
it("aggregate pending is synchronous and one ACK cannot clear another step", () => {
  const state = new StepPanelRetention(); state.visit(0, 2); state.visit(1, 2);
  expect(state.markPending(0, true)).toBe(true); expect(state.markPending(1, true)).toBe(true);
  expect(state.markPending(0, false)).toBe(true); expect(state.markPending(8, false)).toBe(true);
  expect(state.markPending(1, false)).toBe(false); expect(state.indexes()).toEqual([0, 1]);
});
