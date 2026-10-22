import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import type { useScopedManualExecutionAccess } from "./use-scoped-manual-execution-access";

function fixture() {
  const native = { ready: true, canWrite: false, origin: { organizationId: "org" }, refresh: vi.fn(async () => {}) };
  const custom = { ready: true, error: null as string | null, allows: vi.fn((action: string, org?: string) => action === "runs.execute" && org === "org"), retry: vi.fn(async () => {}) };
  const modules: Record<string, unknown> = {
    "./use-manual-execution-access": { useManualExecutionAccess: () => native },
    "./use-project-custom-actions": { useProjectCustomActions: () => custom },
  };
  const code = ts.transpileModule(readFileSync(new URL("./use-scoped-manual-execution-access.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported: { useScopedManualExecutionAccess?: typeof useScopedManualExecutionAccess } = {};
  new Function("require", "exports", code)((name: string) => {
    if (!(name in modules)) throw Error("Unexpected dependency: " + name); return modules[name];
  }, exported);
  return { native, custom, render: () => exported.useScopedManualExecutionAccess!("project") };
}
it("adds only scoped execution without exposing native authority for retests", () => {
  const f = fixture();
  expect(f.render()).toMatchObject({ canWrite: true, nativeCanWrite: false });
  expect(f.custom.allows).toHaveBeenCalledWith("runs.execute", "org");
  f.custom.allows.mockReturnValue(false);
  expect(f.render().canWrite).toBe(false);
});
it("requires native ingress readiness even when a custom grant was cached", () => {
  const f = fixture(); f.native.ready = false;
  expect(f.render().canWrite).toBe(false); expect(f.custom.allows).not.toHaveBeenCalled();
});
it("preserves independent native authority and refreshes both sources", async () => {
  const f = fixture(); f.native.canWrite = true; f.custom.allows.mockReturnValue(false);
  expect(f.render()).toMatchObject({ canWrite: true, nativeCanWrite: true });
  await f.render().refresh();
  expect(f.native.refresh).toHaveBeenCalledOnce(); expect(f.custom.retry).toHaveBeenCalledOnce();
});
it("exposes an unavailable scoped lookup and retries only that read", async () => {
  const f = fixture(); f.custom.error = "Synthetic failure"; f.custom.ready = false; f.custom.allows.mockReturnValue(false);
  expect(f.render()).toMatchObject({ canWrite: false, permissionState: "unavailable" });
  await f.render().retryPermissions();
  expect(f.custom.retry).toHaveBeenCalledOnce(); expect(f.native.refresh).not.toHaveBeenCalled();
  f.custom.error = null;
  expect(f.render().permissionState).toBe("checking");
  f.custom.ready = true;
  expect(f.render()).toMatchObject({ canWrite: false, permissionState: null });
});
it("does not show scoped lookup recovery as a native-access failure or deny native editors", () => {
  const f = fixture(); f.custom.error = "Synthetic failure"; f.custom.ready = false; f.custom.allows.mockReturnValue(false);
  f.native.ready = false;
  expect(f.render()).toMatchObject({ canWrite: false, permissionState: null });
  f.native.ready = true; f.native.canWrite = true;
  expect(f.render()).toMatchObject({ canWrite: true, nativeCanWrite: true, permissionState: null });
});
