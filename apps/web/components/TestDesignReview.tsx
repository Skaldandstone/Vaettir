"use client";
import { useState } from "react";
import { Modal } from "./Modal";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";

type Review = NonNullable<
  RouterOutputs["testDesign"]["preview"]["reviews"][number]["content"]
>;
export function TestDesignReview({
  testCaseId,
  onUse,
  canUseDraft = true,
  readOnly = false,
}: {
  testCaseId: string;
  onUse: (review: Review) => void;
  canUseDraft?: boolean;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"evidence" | "approve" | "review">(
    "evidence",
  );
  const [ref, setRef] = useState("");
  const [code, setCode] = useState("");
  const [approved, setApproved] = useState(false);
  const [evidence, setEvidence] = useState<
    { ref: string; code: string } | undefined
  >();
  const preview = trpcReact.testDesign.preview.useQuery(
    { id: testCaseId, evidence: readOnly ? undefined : evidence },
    {
      enabled: open,
      refetchInterval: (query) =>
        query.state.data?.reviews.some((r) => r.status === "GENERATING")
          ? 3000
          : false,
    },
  );
  const generate = trpcReact.testDesign.review.useMutation({
    onSuccess: async () => {
      await preview.refetch();
      setStep("review");
    },
  });
  const matched = preview.data?.reviews.find(
    (r) => r.inputHash === preview.data?.inputHash,
  );
  const saved = matched ?? preview.data?.reviews[0];
  const content = saved?.content;
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setOpen(true)}
      >
        {readOnly ? "View saved design reviews" : "Review test design"}
      </button>
      <Modal
        open={open}
        title={readOnly ? "Saved test design reviews" : "Improve this test"}
        onClose={() => setOpen(false)}
        dismissible={!generate.isPending}
      >
        <p className="text-muted">
          {readOnly
            ? "Saved recommendations. Viewing uses no credits and changes no test cases."
            : step === "evidence"
              ? "1. Choose evidence"
              : step === "approve"
                ? "2. Review cost and permission"
                : "3. Review recommendations"}
        </p>
        {preview.error && <p role="alert">{preview.error.message}</p>}
        {!readOnly && step === "evidence" && (
          <div style={{ display: "grid", gap: 12 }}>
            <p>
              Review the steps, assertions, test level and automation approach.
              Without code, recommendations are provisional. No repository is
              fetched automatically.
            </p>
            <details>
              <summary>Add authorized code evidence (optional)</summary>
              <p>
                Include the relevant implementation or existing test, without
                secrets or customer data.
              </p>
              <label>
                Repository / file / pinned revision
                <input
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  maxLength={500}
                  style={{ width: "100%" }}
                />
              </label>
              <label>
                Code excerpt
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={12000}
                  rows={7}
                  style={{ width: "100%" }}
                />
              </label>
            </details>
            {saved && (
              <button
                className="btn-secondary"
                onClick={() => setStep("review")}
              >
                Open saved review (no credits)
              </button>
            )}
            <button
              disabled={Boolean(code.trim()) !== Boolean(ref.trim())}
              onClick={() => {
                setEvidence(
                  code.trim()
                    ? { ref: ref.trim(), code: code.trim() }
                    : undefined,
                );
                setApproved(false);
                setStep("approve");
              }}
            >
              Continue
            </button>
          </div>
        )}
        {!readOnly && step === "approve" && (
          <div style={{ display: "grid", gap: 12 }}>
            <p>
              Initial charge: {preview.data?.cost ?? "…"} AI credits. Current
              balance: {preview.data?.balance ?? "…"}. Final cost is reconciled
              to actual usage and may differ.
            </p>
            <p>
              {evidence
                ? `Included code: ${evidence.ref}`
                : "Case text and source metadata only. Code has not been inspected."}{" "}
              Nothing will be applied to the case.
            </p>
            {matched?.content ? (
              <button onClick={() => setStep("review")}>
                Open existing review without charging
              </button>
            ) : matched ? (
              <p role="status">
                Review status:{" "}
                {matched.status === "GENERATING"
                  ? "Generating"
                  : "Needs administrator reconciliation"}
                . Another charge is blocked for these inputs.
              </p>
            ) : (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                  />{" "}
                  I authorize processing this case and any supplied code with
                  the AI provider and approve the credit charge.
                </label>
                {preview.data && !preview.data.canSpend && (
                  <p>
                    Ask your workspace administrator for a full editor seat to
                    use credits.
                  </p>
                )}
                <button
                  disabled={
                    !approved ||
                    !preview.data?.canSpend ||
                    preview.data.balance < preview.data.cost ||
                    generate.isPending ||
                    preview.isFetching
                  }
                  onClick={() =>
                    preview.data &&
                    generate.mutate({
                      id: testCaseId,
                      evidence,
                      expectedHash: preview.data.inputHash,
                      approved: true,
                    })
                  }
                >
                  {generate.isPending ? "Reviewing…" : "Confirm and review"}
                </button>
              </>
            )}
            <button
              className="btn-secondary"
              disabled={generate.isPending}
              onClick={() => setStep("evidence")}
            >
              Back
            </button>
          </div>
        )}
        {generate.error && <p role="alert">{generate.error.message}</p>}
        {(readOnly || step === "review") && (
          <div style={{ display: "grid", gap: 12 }}>
            {saved?.stale && (
              <p role="alert">
                This case changed after the review. Reassess before using these
                recommendations.
              </p>
            )}
            {content ? (
              <>
                <p>{content.summary}</p>
                <p>
                  <strong>
                    {content.recommendedLevel.replaceAll("_", " ")}
                  </strong>{" "}
                  ·{" "}
                  {content.framework?.replaceAll("_", " ") ??
                    "Framework needs evidence / not applicable"}
                </p>
                <p>{content.rationale}</p>
                <p className="text-muted">
                  {saved.evidenceRef
                    ? `Reviewer-supplied code: ${saved.evidenceRef}. Repository identity and revision are not independently verified.`
                    : "Provisional: based on case text, not inspected code."}
                </p>
                {content.improvements.map((item, i) => (
                  <div key={i}>
                    <strong>{item.problem}</strong>
                    <p>{item.suggestion}</p>
                  </div>
                ))}
                {!!content.proposedSteps.length && (
                  <details open>
                    <summary>Suggested steps</summary>
                    <ol>
                      {content.proposedSteps.map((s, i) => (
                        <li key={i}>
                          {s.action}
                          <p>Expected: {s.expectedResult}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {!!content.retainCoverage.length && (
                  <div>
                    <strong>Keep this coverage</strong>
                    <ul>
                      {content.retainCoverage.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!content.missingEvidence.length && (
                  <div>
                    <strong>Evidence still needed</strong>
                    <ul>
                      {content.missingEvidence.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!readOnly && (
                  <>
                    <button
                      disabled={
                        saved.stale || !preview.data?.canSpend || !canUseDraft
                      }
                      onClick={() => {
                        onUse(content);
                        setOpen(false);
                      }}
                    >
                      Use recommendations in draft setup
                    </button>
                    {!canUseDraft && (
                      <small>
                        Your existing automation draft is preserved. Reject it
                        explicitly before preparing a replacement.
                      </small>
                    )}
                    <small>
                      This fills draft context and the suggested framework. It
                      does not modify the case, generate code or use more
                      credits.
                    </small>
                  </>
                )}
              </>
            ) : (
              <p role="status">
                {saved
                  ? "Review is pending or needs administrator reconciliation. Your request remains saved."
                  : "No saved review yet."}
              </p>
            )}
            {!readOnly && (
              <button
                className="btn-secondary"
                onClick={() => setStep("evidence")}
              >
                Back to evidence
              </button>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
