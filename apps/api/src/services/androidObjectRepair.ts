// Pure local review logic. This is not a replay endpoint or an authorization
// grant. The caller must obtain the case and native observation under fresh
// original authority; nothing here performs a command or changes a case.
import { z } from "@vaettir/core/dist/validation.js";
import {
  androidExplorationScope,
  observedAndroidObject,
} from "./androidExplorationSchema.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const label = z
  .string()
  .min(1)
  .max(200)
  .refine((value) =>
    Array.from(value).every(
      (c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127,
    ),
  );
const reviewInput = z
  .object({
    original: z
      .object({
        scope: androidExplorationScope,
        caseId: label,
        caseRevision: digest,
        stepId: label,
        expectedResult: z.string().min(1).max(10000),
        label,
        target: observedAndroidObject,
      })
      .strict(),
    failure: z.enum([
      "TARGET_NOT_FOUND",
      "AMBIGUOUS_TARGET",
      "EXPECTED_RESULT_MISMATCH",
      "OUTCOME_UNCERTAIN",
    ]),
    current: z
      .object({
        scope: androidExplorationScope,
        caseRevision: digest,
        packageName: label,
        screenId: digest,
        observedAt: z.number().int(),
        blocked: z.boolean(),
        controls: z
          .array(
            z
              .object({
                id: digest,
                label,
                navigable: z.boolean(),
                enabled: z.boolean(),
                target: observedAndroidObject,
              })
              .strict(),
          )
          .max(150),
      })
      .strict(),
  })
  .strict();
export type AndroidObjectRepairInput = z.infer<typeof reviewInput>;
const unsafe =
  /\b(?:sign[ -]?in|log[ -]?in|sign[ -]?out|log[ -]?out|password|pay|buy|purchase|order|checkout|subscribe|delete|remove|erase|send|submit|save|confirm|accept|agree|install|uninstall|grant|allow|deny|enable|disable|reset|transfer|upload|download)\b/i;
const tokens = (value: string) =>
  new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
const sameSelector = (
  left: z.infer<typeof observedAndroidObject>,
  right: z.infer<typeof observedAndroidObject>,
) =>
  left.packageName === right.packageName &&
  left.selector.kind !== "BOUNDS_ONLY" &&
  left.selector.kind === right.selector.kind &&
  left.selector.value === right.selector.value &&
  (left.selector.kind !== "TEXT_CLASS" || left.className === right.className);

export function recommendAndroidObjectRepair(
  raw: AndroidObjectRepairInput,
  now: number,
) {
  const input = reviewInput.parse(raw),
    { original, current } = input;
  const review = {
    original,
    screenId: current.screenId,
    observedAt: current.observedAt,
    outcome: "NOT_EXECUTED" as const,
    automaticRetryAllowed: false as const,
    caseUpdateAllowed: false as const,
  };
  const stop = (reason: string) => ({
    ...review,
    status: "BLOCKED" as const,
    reason,
    candidates: [],
  });
  if (
    !Number.isSafeInteger(now) ||
    current.observedAt > now ||
    now - current.observedAt > 30000
  )
    return stop("FRESH_OBSERVATION_REQUIRED");
  if (
    JSON.stringify(original.scope) !== JSON.stringify(current.scope) ||
    original.caseRevision !== current.caseRevision
  )
    return stop("ORIGINAL_SCOPE_OR_CASE_CHANGED");
  if (
    current.blocked ||
    original.target.packageName !== current.packageName ||
    current.controls.some(
      (c) => c.target.packageName !== current.packageName,
    ) ||
    new Set(current.controls.map((c) => c.id)).size !== current.controls.length
  )
    return stop("CURRENT_TARGET_UNVERIFIED");
  if (input.failure === "OUTCOME_UNCERTAIN")
    return stop("RECONCILE_UNCERTAIN_ACTION_FIRST");
  if (input.failure === "EXPECTED_RESULT_MISMATCH")
    return stop("REVIEW_EXPECTATION_OR_APP_DEFECT");
  if (unsafe.test(original.label)) return stop("MANUAL_ACTION_REVIEW_REQUIRED");
  // Selector uniqueness includes disabled and non-navigable observed objects.
  // A matching old selector is evidence to investigate the failure, not heal it.
  if (current.controls.some((c) => sameSelector(original.target, c.target)))
    return stop("ORIGINAL_OBJECT_PRESENT_REVIEW_FAILURE");
  const originalTokens = tokens(original.label);
  const candidates = current.controls
    .flatMap((control) => {
      if (
        !control.enabled ||
        !control.navigable ||
        unsafe.test(control.label) ||
        control.target.selector.kind === "BOUNDS_ONLY" ||
        current.controls.filter((c) => sameSelector(control.target, c.target))
          .length !== 1
      )
        return [];
      const common = [...tokens(control.label)].filter((t) =>
        originalTokens.has(t),
      );
      const exactLabel = control.label === original.label;
      // Class or proximity alone must not nominate a new path. Weak token overlap
      // stays manual; scores are evidence ordering, never match probabilities.
      if (!exactLabel && common.length < 2) return [];
      const sameClass =
        original.target.className !== null &&
        original.target.className === control.target.className;
      return [
        {
          object: control.target,
          observationId: control.id,
          label: control.label,
          reasons: [
            ...(exactLabel ? ["SAME_LABEL"] : ["SHARED_LABEL_WORDS"]),
            ...(sameClass ? ["SAME_CLASS"] : []),
          ],
          evidenceScore: (exactLabel ? 4 : 2) + (sameClass ? 1 : 0),
          expectedResult: original.expectedResult,
          requiresCandidateApproval: true as const,
          requiresFreshResolution: true as const,
          requiresOriginalAssertionVerification: true as const,
        },
      ];
    })
    .sort(
      (a, b) =>
        b.evidenceScore - a.evidenceScore ||
        a.observationId.localeCompare(b.observationId),
    );
  return {
    ...review,
    status: candidates.length
      ? ("REVIEW_REPLACEMENTS" as const)
      : ("MANUAL_REVIEW" as const),
    reason: candidates.length
      ? "ASK_WHICH_OBJECT_IS_THE_INTENDED_PATH"
      : "NO_SUPPORTED_REPLACEMENT",
    candidates,
    ambiguous: candidates.length > 1,
  };
}
