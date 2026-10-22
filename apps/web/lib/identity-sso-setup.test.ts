// Actual setup bridge with synthetic Clerk/query boundaries, no provider calls.
import { readFileSync } from "node:fs";
import React from "react";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import type { IdentitySetupStatus } from "../components/IdentitySsoPanel";

function fixture() {
  const ready = { status: "ready" as const, clerkOrganizationId: "provider-org", clerkSubject: "subject", revision: 1, connections: [] };
  const auth = { userId: "subject", sessionId: "session", orgId: "provider-org" };
  const clerk = { loaded: true, user: { id: "subject" }, session: { id: "session" }, organization: { id: "provider-org" },
    setActive: vi.fn(async ({ organization }: { organization: string }) => { clerk.organization.id = organization; auth.orgId = organization; }),
    openOrganizationProfile: vi.fn(), closeOrganizationProfile: vi.fn() };
  const query = { refetch: vi.fn(async () => ({ data: ready as IdentitySetupStatus, error: null })) };
  const slots: unknown[] = []; let index = 0;
  const effects: (() => void)[] = [];
  const cleanups = new Set<() => void>();
  const modules: Record<string, unknown> = {
    react: { useRef: (value: unknown) => { const i = index++; return slots[i] ?? (slots[i] = { current: value }); },
      useLayoutEffect: (effect: () => void | (() => void), deps: unknown[]) => {
        const i = index++, previous = slots[i] as { deps: unknown[]; cleanup?: () => void } | undefined;
        if (!previous || deps.some((value, n) => value !== previous.deps[n])) effects.push(() => {
          if (previous?.cleanup) { previous.cleanup(); cleanups.delete(previous.cleanup); }
          const cleanup = effect(); if (cleanup) cleanups.add(cleanup); slots[i] = { deps, cleanup };
        });
      } },
    "@clerk/nextjs": { useAuth: () => auth, useClerk: () => clerk },
    "@/lib/trpcReact": { trpcReact: { identityAccess: { providerSetup: { useQuery: () => query } } } },
    "./IdentitySsoPanel": { IdentitySsoPanel: () => null },
  };
  const source = readFileSync(new URL("../components/IdentitySsoSetup.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const exported: Record<string, (input: unknown) => React.ReactElement> = {};
  new Function("require", "exports", "React", code)((name: string) => {
    if (!(name in modules)) throw Error("Unexpected dependency: " + name); return modules[name];
  }, exported, React);
  function render() {
    index = 0; const result = exported.IdentitySsoSetup!({ organizationId: "native-org" });
    for (const effect of effects.splice(0)) effect();
    return result.props as { inspect: () => Promise<unknown>; openSetup: (status: typeof ready) => Promise<void> };
  }
  return { ready, auth, clerk, query, render, unmount: () => { for (const cleanup of cleanups) cleanup(); } };
}
it("does not open on mount or status read, and rechecks before the explicit open", async () => {
  const f = fixture(), props = f.render(); expect(f.query.refetch).not.toHaveBeenCalled();
  await props.inspect(); expect(f.clerk.openOrganizationProfile).not.toHaveBeenCalled();
  await props.openSetup(f.ready); expect(f.query.refetch).toHaveBeenCalledTimes(2); expect(f.clerk.openOrganizationProfile).toHaveBeenCalledOnce();
  f.unmount(); expect(f.clerk.closeOrganizationProfile).toHaveBeenCalledOnce();
});
it("pins the selected provider organization rather than opening the old one", async () => {
  const f = fixture(); f.clerk.organization.id = "other"; f.auth.orgId = "other";
  await f.render().openSetup(f.ready);
  expect(f.clerk.setActive).toHaveBeenCalledWith({ organization: "provider-org" });
  expect(f.clerk.openOrganizationProfile).toHaveBeenCalledOnce();
});
it.each(["disabled", "revision", "subject", "organization"])("does not open when the post-switch binding is %s", async fault => {
  const f = fixture();
  const changed: IdentitySetupStatus = fault === "disabled" ? { status: "unavailable", connections: [] } : {
    ...f.ready, ...(fault === "revision" ? { revision: 2 } : fault === "subject" ? { clerkSubject: "other" } : { clerkOrganizationId: "other" }),
  };
  f.query.refetch.mockResolvedValue({ data: changed, error: null });
  await expect(f.render().openSetup(f.ready)).rejects.toThrow(); expect(f.clerk.openOrganizationProfile).not.toHaveBeenCalled();
});
it("closes on account/session/organization change and refuses an unmounted in-flight open", async () => {
  const f = fixture(); await f.render().openSetup(f.ready);
  f.auth.orgId = "other"; f.clerk.organization.id = "other"; f.render(); expect(f.clerk.closeOrganizationProfile).toHaveBeenCalledOnce();
  let release!: () => void; f.clerk.setActive.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const pending = f.render().openSetup(f.ready); f.unmount(); f.clerk.organization.id = "provider-org"; release();
  await expect(pending).rejects.toThrow(); expect(f.clerk.openOrganizationProfile).toHaveBeenCalledOnce();
});
