"use client";
import { useLayoutEffect, useState } from "react";
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
  const [view, setView] = useState<StepReviewCompletionView>({ epoch: 0, readable: false, authorityReadable: false, busy: false, canEdit: false, canReview: false, canSave: false, reviewed: false, baselineChanged: false, hasPending: false, pendingKey: null, draft: null, acknowledgement: null, notice: "" });
  const [controller] = useState(() => new StepReviewCompletionController(ref, setView, currentStepReviewSession));
  useLayoutEffect(() => { controller.attach(); return () => controller.detach(); }, [controller]);
  const resource = (typeof window === "undefined" ? null : window.Clerk) as ResourceListener | null | undefined;
  useLayoutEffect(() => {
    controller.bindFrame({ visible, readOnly, activation: reads.activation, observedSessionId: reads.observedSessionId, fresh: reads.fresh });
    const unsubscribe = typeof resource?.addListener === "function" ? resource.addListener(() => controller.observeSession(currentStepReviewSession())) : undefined;
    return () => unsubscribe?.();
  }, [controller, visible, readOnly, reads.activation, reads.observedSessionId, reads.fresh, resource]);
  // All handlers capture this exact admitted epoch and draft identity. Private
  // controller state closes same-tick races before React can update buttons.
  return { reads, view,
    change: (buffer: StepReviewBuffer) => controller.change(buffer, view.epoch, view.draft?.identity ?? null),
    reviewCurrent: () => controller.reviewCurrent(view.epoch, view.draft?.identity ?? null),
    save: () => controller.submit(view.epoch, input => mutation.mutateAsync(input), onAcknowledged, onUnconfirmedChange),
    discardUnsaved: () => controller.discardUnsaved(view.epoch, view.draft?.identity ?? null),
    synchronizeAcknowledged: () => onAcknowledged ? controller.synchronizeAcknowledged(view.epoch, onAcknowledged) : Promise.resolve(),
    finishAcknowledged: () => controller.finishAcknowledged(view.epoch) };
}
