import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  admitManualRunCurrent,
  manualRunCurrentBrowserKey,
  type ManualRunCurrentOrigin,
  type ManualRunCurrentSnapshot,
} from "./manual-run-current-reader";
import {
  retainManualRunRows,
  type ManualRunRowRetentionResult,
} from "./manual-run-row-retention";
import type { useRetainedManualRunRows } from "./use-retained-manual-run-rows";

type SnapshotOptions = {
  ids?: string[];
  missing?: string[];
  title?: string;
  origin?: ManualRunCurrentOrigin;
  session?: string;
  epoch?: number;
};
function declarations(path: string, name: string) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const selected = ast.statements.find(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  if (!selected) throw Error(`Missing actual source function ${name}`);
  return selected.getText(ast).replace(/^export\s+/, "");
}
// Reuse the TRACKED synthetic admitted-wire fixture, not an ignored artifact or
// mutable bypass. Host-realm function construction preserves the real strict
// descriptor walk/prototype checks. No native/RPC/browser services execute.
const snapshot = new Function(
  "randomUUID",
  "expect",
  "admitManualRunCurrent",
  "manualRunCurrentBrowserKey",
  ts.transpileModule(
    `${declarations("./manual-run-row-retention.test.ts", "snapshot")}\nreturn snapshot;`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText,
)(randomUUID, expect, admitManualRunCurrent, manualRunCurrentBrowserKey) as (
  options?: SnapshotOptions,
) => ManualRunCurrentSnapshot;
type Slot = { value: unknown; dependencies?: readonly unknown[] };
function harness() {
  const slots: Slot[] = [];
  let cursor = 0,
    changed = false;
  const admission = vi.fn(retainManualRunRows);
  const useState = (initial: unknown) => {
    const index = cursor++;
    if (!slots[index])
      slots[index] = {
        value: typeof initial === "function" ? initial() : initial,
      };
    const slot = slots[index]!;
    return [
      slot.value,
      (action: unknown) => {
        const next = typeof action === "function" ? action(slot.value) : action;
        if (!Object.is(next, slot.value)) {
          slot.value = next;
          changed = true;
        }
      },
    ];
  };
  const useMemo = (
    factory: () => unknown,
    dependencies: readonly unknown[],
  ) => {
    const index = cursor++,
      old = slots[index];
    if (
      !old ||
      old.dependencies?.length !== dependencies.length ||
      dependencies.some(
        (value, position) => !Object.is(value, old.dependencies?.[position]),
      )
    )
      slots[index] = { value: factory(), dependencies: [...dependencies] };
    return slots[index]!.value;
  };
  const hook = new Function(
    "useState",
    "useMemo",
    "retainManualRunRows",
    ts.transpileModule(
      `${declarations("./use-retained-manual-run-rows.ts", "useRetainedManualRunRows")}\nreturn useRetainedManualRunRows;`,
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.None,
        },
      },
    ).outputText,
  )(useState, useMemo, admission) as typeof useRetainedManualRunRows;
  let current: ManualRunRowRetentionResult | null = null;
  function render(candidate: ManualRunCurrentSnapshot | null) {
    const passes: ManualRunRowRetentionResult[] = [];
    do {
      cursor = 0;
      changed = false;
      current = hook(candidate);
      passes.push(current);
      if (passes.length > 4)
        throw Error(
          "Actual retained-row hook failed to stabilize; no loop was waived.",
        );
    } while (changed);
    return { result: current, passes };
  }
  return { admission, render };
}
describe("actual retained-row publication hook, synthetic React runtime only", () => {
  it("first immutable candidate publishes after one guarded component retry, never first speculative pass", () => {
    const h = harness(),
      candidate = snapshot(),
      rendered = h.render(candidate);
    expect(rendered.passes).toHaveLength(2);
    expect(rendered.passes[0]).toMatchObject({
      retained: null,
      current: null,
      reason: "NO_CURRENT_READ",
    });
    expect(rendered.result.current).toBe(candidate);
    expect(rendered.result.retained!.rows[0]).toBe(
      candidate.data.view.cases[0],
    );
    expect(h.admission).toHaveBeenCalledTimes(2); // Initial null plus this candidate.
  });
  it("repeated identical candidate consumes once, returns stable publication and never loops", () => {
    const h = harness(),
      candidate = snapshot(),
      initial = h.render(candidate).result;
    for (let i = 0; i < 30; i++) {
      const next = h.render(candidate);
      expect(next.passes).toHaveLength(1);
      expect(next.result).toBe(initial);
    }
    expect(h.admission).toHaveBeenCalledTimes(2);
  });
  it("initial and repeated null are absence, not a fabricated native empty run", () => {
    const h = harness();
    const first = h.render(null);
    expect(first.result).toEqual({
      retained: null,
      current: null,
      reason: "NO_CURRENT_READ",
    });
    expect(h.render(null).result).toBe(first.result);
    expect(h.admission).toHaveBeenCalledTimes(1);
  });
  it("revocation consumes null once and retains mounted row keys/pointers privately", () => {
    const h = harness(),
      admitted = h.render(snapshot()).result,
      revoked = h.render(null);
    expect(revoked.passes).toHaveLength(2);
    expect(revoked.result).toEqual({
      retained: admitted.retained,
      current: null,
      reason: "NO_CURRENT_READ",
    });
    expect(
      revoked.passes.every(
        (pass) => pass.retained === admitted.retained && pass.current === null,
      ),
    ).toBe(true);
    for (let i = 0; i < 10; i++) expect(h.render(null).passes).toHaveLength(1);
    expect(h.admission).toHaveBeenCalledTimes(3);
  });
  it("same-scope disappearance and restoration update exact row props without deleting mounting identities", () => {
    const h = harness(),
      first = h.render(snapshot()).result.retained!,
      missing = snapshot({ missing: ["first"], title: "current second" }),
      missingResult = h.render(missing).result;
    expect(missingResult.current).toBe(missing);
    expect(missingResult.retained!.rows.map((row) => row.testCaseId)).toEqual([
      "first",
      "second",
    ]);
    expect(missingResult.retained!.rows[0]).toBe(first.rows[0]);
    const restored = snapshot({ title: "restored exact" }),
      last = h.render(restored).result;
    expect(last.retained!.plannedCaseIds).toBe(first.plannedCaseIds);
    expect(last.retained!.rows[0]).toBe(restored.data.view.cases[0]);
    expect(last.retained!.rows).toHaveLength(2);
  });
  it.each([
    "nativeActorId",
    "clerkActorId",
    "organizationId",
    "projectId",
    "testRunId",
  ] as const)(
    "changed %s consumes refusal once without publishing/rebasing/evicting",
    (key) => {
      const h = harness(),
        first = h.render(snapshot()).result.retained!,
        changed = snapshot({
          origin: { ...first.origin, [key]: "replacement" },
        }),
        refused = h.render(changed);
      expect(refused.result).toEqual({
        retained: first,
        current: null,
        reason: "ORIGINAL_SCOPE_CHANGED",
      });
      expect(refused.passes).toHaveLength(2);
      for (let i = 0; i < 10; i++)
        expect(h.render(changed).result).toBe(refused.result);
      expect(h.admission).toHaveBeenCalledTimes(3);
    },
  );
  it.each([
    { ids: ["second", "first"] },
    { ids: ["first"] },
    { ids: ["first", "second", "new"] },
  ])(
    "ordered identity $ids refusal never produces a smaller/growing cohort",
    (options) => {
      const h = harness(),
        first = h.render(snapshot()).result.retained!,
        candidate = snapshot(options),
        refused = h.render(candidate).result;
      expect(refused).toEqual({
        retained: first,
        current: null,
        reason: "ORIGINAL_SCOPE_CHANGED",
      });
      expect(h.render(candidate).result).toBe(refused);
      expect(h.admission).toHaveBeenCalledTimes(3);
    },
  );
  it("aggregate bytes refuse entire publication once, retaining prior exact row and restoring later without evictions", () => {
    const h = harness(),
      title = "x".repeat(9 * 1024 * 1024),
      first = h.render(snapshot({ title, missing: ["second"] })).result
        .retained!,
      candidate = snapshot({ title, missing: ["first"] }),
      refused = h.render(candidate).result;
    expect(refused).toEqual({
      retained: first,
      current: null,
      reason: "RETENTION_BOUND",
    });
    expect(first.rows[0]!.title).toBe(title);
    expect(h.render(candidate).result).toBe(refused);
    const restored = snapshot();
    expect(h.render(restored).result.current).toBe(restored);
    expect(h.admission).toHaveBeenCalledTimes(4);
  });
  it("unsupported mutable candidate is consumed without a loop or mutation of existing rows", () => {
    const h = harness(),
      candidate = snapshot(),
      first = h.render(candidate).result.retained!,
      mutable = structuredClone(candidate),
      refused = h.render(mutable).result;
    expect(refused).toEqual({
      retained: first,
      current: null,
      reason: "UNSUPPORTED_SNAPSHOT",
    });
    expect(h.render(mutable).result).toBe(refused);
    expect(h.admission).toHaveBeenCalledTimes(3);
  });
  it("reader absence/refusal never touches external draft/UUID/known receipt state", () => {
    const h = harness(),
      candidate = snapshot(),
      original = h.render(candidate).result.retained!,
      draft = {
        note: " exact \n draft ",
        rawNumber: "",
        idempotencyKey: randomUUID(),
        pending: true,
      };
    const preserved = structuredClone(draft);
    h.render(null);
    h.render(snapshot({ ids: ["different"] }));
    expect(draft).toEqual(preserved);
    const restored = h.render(candidate).result;
    expect(restored.current).toBe(candidate);
    expect(restored.retained!.plannedCaseIds).toBe(original.plannedCaseIds);
  });
  it("source owns no refs/layout effects/actions or native authority", () => {
    const source = readFileSync(
      new URL("./use-retained-manual-run-rows.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /\b(?:useRef|useEffect|useLayoutEffect|fetch|window|document|Clerk|trpcReact)\b/,
    );
    expect(source).toContain("publication.seenCandidate !== candidate");
    expect(source).toContain("reader.current()");
  });
});
