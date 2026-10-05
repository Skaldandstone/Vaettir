import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { QueryObserver, onlineManager } from "@tanstack/react-query";
import { AuthQueryClient, authQueryIdentity } from "./auth-query-cache";

type Metadata = { kind: "project" | "member"; sequence: number; organizationId: string; role: string };
type Request = { kind: Metadata["kind"]; sequence: number; resolve: (value: Metadata) => void; reject: (error: Error) => void };

/** Installed observers, not hand-written query caching. Effect publication is
 * explicitly driven like React's committed observer.setOptions effect. No RPC,
 * provider, identity SDK, mounted React or database acceptance is implied. */
function observerHarness(fixed: boolean, transientOuter: boolean, initiallyOpen = false) {
  const scope = { userId: "synthetic-a", sessionId: "synthetic-session-a" };
  const client = new AuthQueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.selectGeneration({ number: 0, identity: authQueryIdentity(scope), scope });
  let open = initiallyOpen, callerActive = true, signedIn = true;
  let organizationId = "original-org", role = "OWNER";
  const counts = { project: 0, member: 0 }, requests: Request[] = [];
  const effects: Array<() => void> = [];
  const options = (kind: Metadata["kind"], enabled: boolean) => ({
    queryKey: ["native-retest-metadata", kind], enabled, staleTime: 0, retry: false,
    queryFn: () => new Promise<Metadata>((resolve, reject) => {
      const sequence = ++counts[kind]; requests.push({ kind, sequence, resolve, reject });
    }),
  });
  const parent = { project: new QueryObserver(client, options("project", true)), member: new QueryObserver(client, options("member", true)) };
  const actions = { project: new QueryObserver(client, options("project", true)), member: new QueryObserver(client, options("member", true)) };
  const wizard = { project: new QueryObserver(client, options("project", fixed && open)), member: new QueryObserver(client, options("member", fixed && open)) };
  const metadataFresh = (pair: typeof parent) => Object.values(pair).every(observer => {
    const result = observer.getCurrentResult();
    return !result.error && !result.isFetching && !result.isPaused && result.data?.organizationId === "original-org";
  });
  const writable = () => actions.member.getCurrentResult().data?.role === "OWNER";
  const outerActive = () => callerActive && (!transientOuter || metadataFresh(parent));
  const factualActive = () => signedIn && outerActive() && metadataFresh(actions) && writable();
  let scheduled = false;
  const publish = () => {
    scheduled = false;
    const admittedActions = signedIn && (fixed || outerActive());
    actions.project.setOptions(options("project", admittedActions));
    actions.member.setOptions(options("member", admittedActions));
    // Former code ignores open and admits a closed child from parent's freshness.
    const admittedWizard = signedIn && (fixed ? open : factualActive());
    wizard.project.setOptions(options("project", admittedWizard));
    wizard.member.setOptions(options("member", admittedWizard));
  };
  const schedule = () => { if (!scheduled) { scheduled = true; effects.push(publish); } };
  const stops = [...Object.values(parent), ...Object.values(actions), ...Object.values(wizard)].map(observer => observer.subscribe(schedule));
  function flushEffects() {
    let publications = 0;
    while (effects.length) { if (++publications > 100) throw Error("Observer effect bound exceeded"); effects.shift()!(); }
  }
  async function completeRound(fail = false) {
    const current = requests.splice(0);
    expect(current.length).toBeGreaterThan(0);
    for (const request of current) {
      if (fail) request.reject(Error("Synthetic fresh metadata refused"));
      else request.resolve({ kind: request.kind, sequence: request.sequence, organizationId, role });
    }
    await vi.waitFor(() => {
      for (const request of current) {
        const state = parent[request.kind].getCurrentQuery().state;
        if (fail) expect(state.status).toBe("error");
        else expect(state.data?.sequence).toBe(request.sequence);
      }
    });
    flushEffects();
  }
  function invalidate() { void client.invalidateQueries(); flushEffects(); }
  return {
    client, counts, requests, parent, actions, wizard, completeRound, flushEffects, factualActive,
    open() { open = true; schedule(); flushEffects(); },
    setOuter(value: boolean) { callerActive = value; schedule(); flushEffects(); },
    setSignedIn(value: boolean) { signedIn = value; schedule(); flushEffects(); },
    setRole(value: string) { role = value; invalidate(); },
    reparent() { organizationId = "foreign-org"; invalidate(); },
    invalidate,
    close() { for (const stop of stops) stop(); for (const observer of [...Object.values(parent), ...Object.values(actions), ...Object.values(wizard)]) observer.destroy(); client.clear(); },
  };
}

describe("native retest stable metadata admission", () => {
  it("reproduces the former closed nested child feedback with installed shared stale0 observers", async () => {
    const h = observerHarness(false, false);
    try {
      for (let round = 0; round < 4; round++) await h.completeRound();
      expect(h.counts.project).toBeGreaterThanOrEqual(5);
      expect(h.counts.member).toBeGreaterThanOrEqual(5);
      expect(h.requests.length).toBe(2);
      expect(h.factualActive()).toBe(false);
    } finally { h.close(); }
  });
  it("settles closed and open children without changing staleTime0, and denies facts throughout each actual refresh", async () => {
    const h = observerHarness(true, false);
    try {
      await h.completeRound();
      expect(h.requests).toHaveLength(0);
      expect(h.counts).toEqual({ project: 1, member: 1 });
      expect(h.factualActive()).toBe(true);
      h.open();
      expect(h.factualActive()).toBe(false);
      await h.completeRound();
      expect(h.requests).toHaveLength(0);
      expect(h.counts).toEqual({ project: 2, member: 2 });
      expect(h.factualActive()).toBe(true);
      h.invalidate();
      expect(h.factualActive()).toBe(false);
      await h.completeRound();
      expect(h.requests).toHaveLength(0);
      expect(h.counts).toEqual({ project: 3, member: 3 });
      expect(h.factualActive()).toBe(true);
    } finally { h.close(); }
  });
  it("also repairs transient outer caller readiness, not just the nested wizard", async () => {
    const old = observerHarness(false, true);
    try {
      for (let round = 0; round < 3; round++) await old.completeRound();
      expect(old.requests).toHaveLength(2);
      expect(old.counts.project).toBeGreaterThanOrEqual(4);
    } finally { old.close(); }
    const current = observerHarness(true, true, true);
    try {
      await current.completeRound();
      expect(current.requests).toHaveLength(0);
      expect(current.factualActive()).toBe(true);
      current.setOuter(false);
      expect(current.factualActive()).toBe(false);
      current.setOuter(true);
      expect(current.requests).toHaveLength(0);
      expect(current.factualActive()).toBe(true);
    } finally { current.close(); }
  });
  it("stable reads do not turn cached Viewer, foreign-org or refused metadata into current writable facts", async () => {
    const h = observerHarness(true, true, true);
    try {
      await h.completeRound();
      h.setRole("VIEWER");
      expect(h.factualActive()).toBe(false);
      await h.completeRound();
      expect(h.factualActive()).toBe(false);
      expect(h.requests).toHaveLength(0);
      h.setRole("OWNER"); await h.completeRound();
      expect(h.factualActive()).toBe(true);
      h.reparent(); await h.completeRound();
      expect(h.factualActive()).toBe(false);
      expect(h.requests).toHaveLength(0);
      h.invalidate(); await h.completeRound(true);
      expect(h.parent.project.getCurrentResult().error).toBeTruthy();
      expect(h.factualActive()).toBe(false);
      expect(h.requests).toHaveLength(0);
      h.setSignedIn(false);
      expect(h.actions.project.options.enabled).toBe(false);
      expect(h.wizard.project.options.enabled).toBe(false);
    } finally { h.close(); }
  });
  it("paused shared metadata remains private even though admission stays stable", async () => {
    const h = observerHarness(true, true, true);
    try {
      await h.completeRound(); onlineManager.setOnline(false); h.invalidate();
      expect(h.parent.project.getCurrentResult().isPaused).toBe(true);
      expect(h.factualActive()).toBe(false);
      expect(h.actions.project.options.enabled).toBe(true);
    } finally { onlineManager.setOnline(true); h.close(); }
  });
  it("actual component binds admission separately while preserving fresh facts, retained requests and verified ACK gates", () => {
    const source = readFileSync(new URL("../components/ManualRetestWizard.tsx", import.meta.url), "utf8");
    for (const literal of ["const metadataReadEnabled = readEnabled && actorReady", "{ enabled: metadataReadEnabled, staleTime: 0, retry: false }", "useRetestAccess(projectId, active, false, undefined, true)", "readEnabled = open", "readEnabled={open}", "useRetestAccess(projectId, active, true, expectedScope, readEnabled)", "const ready = active && !denied && !paused", "!project.error && !project.isFetching && !project.isPaused", "!organizations.error && !organizations.isFetching && !organizations.isPaused", "sameManualRetestScope(origin, current)", "active={active && canRetest && access.ready && access.canWrite && !linksDenied && !linksMismatch && !links.isPaused}", "enabled: active && access.ready", "const request = attempt ??", "verifiedManualRetestAck(request, result)", "if (definitive && !ambiguous && !unknown.current)", "Verified historical ACK is retained even after current UI scope changes"])
      expect(source).toContain(literal);
    const start = source.slice(source.indexOf("async function start()"), source.indexOf("return ("));
    expect(start).not.toContain("setAttempt(null)");
    expect(start.indexOf("verifiedManualRetestAck")).toBeLessThan(start.indexOf("setReceipt(result)"));
    expect(start.indexOf("setReceipt(result)")).toBeLessThan(start.indexOf("void Promise.all"));
  });
});
