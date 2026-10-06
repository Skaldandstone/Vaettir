"use client";
import { useLayoutEffect, useMemo, useState } from "react";
import { trpcReact } from "./trpcReact";
import { currentStepReviewSession, useStepExecutionReviewAccess, type StepReviewAccess } from "./use-step-execution-review-access";
import { StepReviewCompletionController, type StepReviewCaseRef, type StepReviewCompletionView } from "./step-execution-review-completion";
import type { StepReviewBuffer } from "./step-execution-review-draft";
import type { ReviewedStepAck } from "@vaettir/api/src/services/manualStepExecutionReviewSchema";
type ResourceListener = { addListener?: (callback: () => void) => () => void };
export type StepReviewController = {
  reads: StepReviewAccess; view: StepReviewCompletionView;
  change: (buffer: StepReviewBuffer) => boolean; reviewCurrent: () => boolean;
  save: () => Promise<void>; discardUnsaved: () => boolean;
  synchronizeAcknowledged: () => Promise<void>; finishAcknowledged: () => boolean;
};
export function useStepExecutionReviewController(ref: StepReviewCaseRef, stepIndex: number, visible: boolean, readOnly: boolean,
  onAcknowledged?: (ack: Readonly<ReviewedStepAck>) => void | Promise<void>, onUnconfirmedChange?: (pending: boolean) => void): StepReviewController {
  const reads = useStepExecutionReviewAccess(ref.projectId, ref.testRunId, ref.testCaseId, stepIndex, visible);
  const mutation = trpcReact.manualStepExecutionReview.record.useMutation();
  const [, setView] = useState<StepReviewCompletionView>({ epoch: 0, readable: false, authorityReadable: false, busy: false, canEdit: false, canReview: false, canSave: false, reviewed: false, baselineChanged: false, hasPending: false, pendingKey: null, draft: null, acknowledgement: null, notice: "" });
  const [controller] = useState(() => new StepReviewCompletionController(ref, setView, currentStepReviewSession));
  const observedSdkGeneration = controller.sessionGeneration();
  const frame = useMemo(() => ({ visible, readOnly, activation: reads.activation, observedSessionId: reads.observedSessionId, observedSdkGeneration, fresh: reads.fresh }), [visible, readOnly, reads.activation, reads.observedSessionId, observedSdkGeneration, reads.fresh]);
  const view = controller.renderView(frame);
  useLayoutEffect(() => { controller.attach(); return () => controller.detach(); }, [controller]);
  const resource = (typeof window === "undefined" ? null : window.Clerk) as ResourceListener | null | undefined;
  useLayoutEffect(() => {
    controller.bindFrame(frame);
    const unsubscribe = typeof resource?.addListener === "function" ? resource.addListener(() => controller.observeSession(currentStepReviewSession())) : undefined;
    return () => unsubscribe?.();
  }, [controller, frame, resource]);
  // All handlers capture this exact admitted epoch and draft identity. Private
  // controller state closes same-tick races before React can update buttons.
  return { reads, view,
    change: (buffer: StepReviewBuffer) => controller.matchesFrame(frame) && controller.change(buffer, view.epoch, view.draft?.identity ?? null),
    reviewCurrent: () => controller.matchesFrame(frame) && controller.reviewCurrent(view.epoch, view.draft?.identity ?? null),
    save: () => controller.matchesFrame(frame) ? controller.submit(view.epoch, input => mutation.mutateAsync(input), onAcknowledged, onUnconfirmedChange) : Promise.resolve(),
    discardUnsaved: () => controller.matchesFrame(frame) && controller.discardUnsaved(view.epoch, view.draft?.identity ?? null),
    synchronizeAcknowledged: () => controller.matchesFrame(frame) && onAcknowledged ? controller.synchronizeAcknowledged(view.epoch, onAcknowledged) : Promise.resolve(),
    finishAcknowledged: () => controller.matchesFrame(frame) && controller.finishAcknowledged(view.epoch, () => onUnconfirmedChange?.(false)) };
}
