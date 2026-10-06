"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { StepResourceReader, type StepResourceKind, type StepResourceView, type StepResourceTransport, type StepResourceData } from "./step-execution-resource-reader";
import { currentStepReviewSession } from "./use-step-execution-review-access";
import type { StepReviewOrigin } from "./step-execution-review-draft";
type ResourceListener = { addListener?: (callback: () => void) => () => void };
export type StepExecutionResources = { view: StepResourceView; refresh: () => Promise<void>; next: () => Promise<void>; setSearch: (search: string) => Promise<void>; setLimit: (limit: number) => Promise<void>; currentData: (action: (data: StepResourceData) => boolean) => boolean };
/** The injected transport must be the protected native resource read. This hook
 * owns no editor or provider state and never opens or downloads a file. */
export function useStepExecutionResources(kind: StepResourceKind, origin: StepReviewOrigin | null, active: boolean, expectedProcedureHash: string | null, read: StepResourceTransport): StepExecutionResources {
  const auth = useAuth(), [, setView] = useState<StepResourceView>({ epoch: 0, busy: false, canRequest: false, data: null, error: "", intent: null });
  const hookSession = useMemo(() => auth.isLoaded && auth.isSignedIn && auth.userId && auth.sessionId ? Object.freeze({ userId: auth.userId, sessionId: auth.sessionId }) : null, [auth.isLoaded, auth.isSignedIn, auth.userId, auth.sessionId]);
  const observed = currentStepReviewSession(), sdkIdentity = JSON.stringify(observed);
  const [reader] = useState(() => new StepResourceReader(kind, setView, currentStepReviewSession));
  const sessionGeneration = reader.sessionGeneration();
  const transport = useRef(read);
  useLayoutEffect(() => { transport.current = read; }, [read]);
  const originKey = JSON.stringify(origin), resource = (typeof window === "undefined" ? null : window.Clerk) as ResourceListener | null | undefined;
  useLayoutEffect(() => { reader.attach(); return () => reader.detach(); }, [reader]);
  useLayoutEffect(() => {
    const changed = reader.bindFrame({ origin, active: active && reader.kind === kind, hookSession, expectedProcedureHash });
    // Immediate installed SDK emission catches movement between render and
    // effect commit. It also latches A-B-A before async read settlement.
    const unsubscribe = typeof resource?.addListener === "function" ? resource.addListener(() => reader.observeSession(currentStepReviewSession())) : undefined;
    if (changed) void reader.read(input => transport.current(input));
    return () => unsubscribe?.();
  }, [reader, kind, origin, originKey, active, hookSession, expectedProcedureHash, sdkIdentity, sessionGeneration, resource]);
  // Render-time loss cannot expose a previously published private view while
  // the new layout effect is still pending. Actions recheck the private class.
  const frame = { origin, active: active && reader.kind === kind, hookSession, expectedProcedureHash };
  const displayed = reader.renderView(frame);
  const guarded = (action: () => Promise<void>) => reader.kind === kind && reader.matchesFrame(frame) ? action() : Promise.resolve();
  return { view: displayed, refresh: () => guarded(() => reader.refresh(displayed.epoch, input => transport.current(input))), next: () => guarded(() => reader.next(displayed.epoch, input => transport.current(input))), setSearch: search => guarded(() => reader.setSearch(search, displayed.epoch, input => transport.current(input))), setLimit: limit => guarded(() => reader.setLimit(limit, displayed.epoch, input => transport.current(input))), currentData: action => reader.kind === kind && reader.matchesFrame(frame) ? reader.currentData(displayed.epoch, displayed.data, action) : false };
}
