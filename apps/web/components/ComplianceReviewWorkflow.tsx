"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import { CaseFieldValueControls } from "./CaseFieldValueControls";
import { useSearchParams } from "next/navigation";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { CompliancePicker } from "./CompliancePicker";
import { IconButton } from "./ui/IconButton";
import { complianceProfileValue } from "@/lib/compliance-catalog";

type Review = RouterOutputs["compliance"]["preview"];
type Selection = RouterInputs["compliance"]["saveReview"]["selection"];
type Apply = RouterInputs["compliance"]["applyReview"];
const errorMessage = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "No confirmed result. Check the saved review before trying again.";

function CaseProcedure({
  value,
}: {
  value: Review["cases"][number] | undefined;
}) {
  if (!value) return null;
  return (
    <details>
      <summary>
        {value.title} · {value.reviewStatus.replaceAll("_", " ").toLowerCase()}
      </summary>
      {value.background && (
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          <strong>Background</strong>
          <br />
          {value.background}
        </p>
      )}
      {value.tags.length > 0 && (
        <p style={{ overflowWrap: "anywhere" }}>
          <strong>Tags:</strong> {value.tags.join(", ")}
        </p>
      )}
      {(
        [
          ["Given", value.given],
          ["When", value.when],
          ["Then", value.then],
        ] as const
      ).map(([label, lines]) => (
        <div key={label}>
          <strong>{label}</strong>
          <ul>
            {lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
      <ol>
        {value.steps.map((step, i) => (
          <li key={i}>
            <p>{step.action}</p>
            {step.expectedActionOrData && (
              <p>Expected action or data: {step.expectedActionOrData}</p>
            )}
            {step.expectedResult && (
              <p>Expected result: {step.expectedResult}</p>
            )}
            {step.expectedResponse && (
              <p>Expected response: {step.expectedResponse}</p>
            )}
          </li>
        ))}
      </ol>
      {value.sharedSteps && (
        <details>
          <summary>Shared procedure</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {value.sharedSteps}
          </pre>
        </details>
      )}
    </details>
  );
}

export function ComplianceReviewWorkflow({ projectId }: { projectId: string }) {
  const access = useCaseFieldAccess(projectId),
    origin = access.origin;
  const pins = {
    projectId,
    originalOrganizationId: origin?.organizationId ?? "",
    expectedClerkActorId: origin?.clerkActorId ?? "",
  };
  const params = useSearchParams();
  const catalog = trpcReact.compliance.catalog.useQuery(undefined, {
    retry: false,
  });
  const saved = trpcReact.compliance.listFrameworks.useQuery(
    { projectId },
    { enabled: access.canEdit, retry: false },
  );
  const project = trpcReact.project.byId.useQuery(
    { id: projectId },
    { enabled: access.canEdit, retry: false },
  );
  const drafts = trpcReact.compliance.reviewDrafts.useQuery(pins, {
    enabled: access.canEdit,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const utils = trpcReact.useUtils();
  const load = trpcReact.compliance.loadReference.useMutation(),
    preview = trpcReact.compliance.preview.useMutation();
  const save = trpcReact.compliance.saveReview.useMutation(),
    apply = trpcReact.compliance.applyReview.useMutation();
  const [selected, setSelected] = useState<string[]>([]),
    [review, setReview] = useState<Review | null>(null);
  const [selection, setSelection] = useState<Selection>([]),
    [error, setError] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>(
    {},
  );
  const fieldsInvalid = selection.some(
    (r) => r.newCase && invalidFields[r.controlId],
  );
  const [pending, setPending] = useState<Apply | null>(null),
    [busy, setBusy] = useState(false);
  const running = useRef(false),
    initialized = useRef(false),
    automatic = useRef(false);
  const [analysisRequest, setAnalysisRequest] = useState(() =>
    crypto.randomUUID(),
  );
  const current = () => !!origin && access.owns(origin, "edit");
  const ready =
    access.canEdit &&
    !catalog.isFetching &&
    !catalog.error &&
    !saved.isFetching &&
    !saved.error &&
    !project.isFetching &&
    !project.error &&
    !drafts.isFetching &&
    !drafts.error;
  const choices = useMemo(
    () => [
      ...(catalog.data ?? []).map((o) => ({ ...o, id: `public:${o.id}` })),
      ...(saved.data ?? [])
        .filter((f) => f.workspaceOwned)
        .map((f) => ({
          id: `saved:${f.id}`,
          name: f.name,
          version: f.version,
          category: "Workspace definitions",
          summary: `${f.controlCount} controls · exact saved version ${f.revision}`,
        })),
    ],
    [catalog.data, saved.data],
  );
  useEffect(() => {
    if (initialized.current || !ready) return;
    initialized.current = true;
    const needs = project.data?.qualityProfile.complianceNeeds ?? [];
    setSelected(
      choices
        .filter(
          (o) =>
            needs.includes(o.id) ||
            (o.id.startsWith("public:") &&
              needs.includes(
                complianceProfileValue({
                  ...o,
                  id: o.id.replace(/^public:/, ""),
                }),
              )),
        )
        .map((o) => o.id),
    );
  }, [ready, project.data, choices]);
  function adopt(value: Review) {
    setReview(value);
    setSelection(value.selection);
    setPending(null);
    setInvalidFields({});
  }
  async function resume(id: string) {
    if (!current() || running.current || pending) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await utils.compliance.reviewDraft.fetch({
        ...pins,
        draftId: id,
      });
      if (current()) adopt(value);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function analyze() {
    if (!current() || !ready || running.current || pending || !selected.length)
      return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const frameworkIds: string[] = [];
      for (const key of selected) {
        if (!current()) return;
        if (key.startsWith("saved:")) frameworkIds.push(key.slice(6));
        else {
          const ref = catalog.data?.find((o) => `public:${o.id}` === key);
          if (!ref?.controls) continue;
          const f = await load.mutateAsync({ ...pins, key: ref.id });
          frameworkIds.push(f.id);
        }
      }
      if (!current()) return;
      if (!frameworkIds.length) {
        setError(
          "These references have no bundled controls. Add the applicable licensed criteria as a workspace custom definition, then prepare a review.",
        );
        return;
      }
      const value = await preview.mutateAsync({
        ...pins,
        requestId: analysisRequest,
        frameworkIds,
      });
      if (current()) {
        adopt(value);
        void drafts.refetch();
        void saved.refetch();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      params.get("setup") !== "1" ||
      !ready ||
      !initialized.current ||
      automatic.current ||
      !selected.length
    )
      return;
    automatic.current = true;
    if (drafts.data?.[0]) void resume(drafts.data[0].id);
    else void analyze();
  });
  function edit(controlId: string, patch: Partial<Selection[number]>) {
    if (!current() || busy || pending || review?.state !== "DRAFT") return;
    setSelection((rows) => {
      const row = rows.find((r) => r.controlId === controlId) ?? {
        controlId,
        caseIds: [],
        newCase: null,
      };
      return [
        ...rows.filter((r) => r.controlId !== controlId),
        { ...row, ...patch },
      ];
    });
  }
  async function saveSelection() {
    if (!current() || !review || running.current || pending || fieldsInvalid)
      return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await save.mutateAsync({
        ...pins,
        draftId: review.id,
        expectedDigest: review.digest,
        selection,
      });
      if (current()) adopt(value);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function applySelected() {
    if (
      !current() ||
      !review ||
      running.current ||
      fieldsInvalid ||
      JSON.stringify(selection) !== JSON.stringify(review.selection)
    )
      return;
    const request = pending ?? {
      ...pins,
      draftId: review.id,
      expectedDigest: review.digest,
      requestId: crypto.randomUUID(),
      confirmed: true as const,
    };
    setPending(request);
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      // First reconcile an ambiguous response through the durable receipt.
      if (pending) {
        const recorded = await utils.compliance.reviewDraft.fetch({
          ...pins,
          draftId: review.id,
        });
        if (recorded.state === "APPLIED") {
          if (current()) adopt(recorded);
          return;
        }
      }
      if (!current()) return;
      const value = await apply.mutateAsync(request);
      if (current()) {
        adopt(value);
        void utils.compliance.controlCoverage.invalidate();
      }
    } catch (e) {
      // These explicit transactional refusals have no committed apply. Transport
      // errors remain ambiguous and retain the exact request for receipt recovery.
      if (
        e instanceof TRPCClientError &&
        ["BAD_REQUEST", "CONFLICT", "FORBIDDEN", "NOT_FOUND"].includes(
          e.data?.code,
        )
      )
        setPending(null);
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  if (!access.canEdit)
    return (
      <p>
        Compliance review drafts are hidden until original editor access is
        verified.
      </p>
    );
  const dirty =
    !!review && JSON.stringify(selection) !== JSON.stringify(review.selection);
  return (
    <section
      aria-label="Compliance review"
      style={{
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 16,
        marginBlock: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2>Review coverage</h2>
        <IconButton
          label="Review help"
          icon="help"
          tooltip="Choose references, review suggestions, then save and apply your selection. Nothing is selected automatically. Applicability and rights evidence need a responsible reviewer; suggestions do not establish legal clearance, a test pass or compliance sign-off."
        />
      </div>
      <p>New cases need ordinary approval.</p>
      {error && <p role="alert">{error}</p>}
      {!ready && (
        <p role="status">
          Refreshing access and catalog. Actions are unavailable until this
          completes.
        </p>
      )}
      {!review && (
        <>
          <CompliancePicker
            label="References and workspace definitions"
            options={choices}
            multiple
            selected={selected}
            disabled={!ready || busy}
            onSelect={(id) => {
              setAnalysisRequest(crypto.randomUUID());
              setSelected((s) =>
                s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
              );
            }}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={!ready || busy || !selected.length}
            onClick={() => void analyze()}
          >
            {busy ? "Preparing…" : "Prepare review"}
          </button>
          {(drafts.data ?? []).map((d) => (
            <div
              key={d.id}
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
                marginBlock: 8,
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void resume(d.id)}
              >
                Open
              </button>
              <span>
                {d.state.toLowerCase()} ·{" "}
                {new Date(d.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </>
      )}
      {review && (
        <>
          {!pending && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setReview(null);
                setSelection([]);
                setAnalysisRequest(crypto.randomUUID());
                setError(null);
              }}
            >
              New review
            </button>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <p>
              Scanned {review.scope.scanned} of {review.scope.total} active
              cases.
            </p>
            <IconButton
              label="Scan details"
              icon="help"
              tooltip={
                <>
                  {review.scope.fields}. Archived cases excluded:{" "}
                  {review.scope.archived}. Scan limit: {review.scope.limit}.
                </>
              }
            />
          </div>
          {review.scope.omitted > 0 && (
            <p role="status">
              Incomplete scan: {review.scope.omitted} cases omitted. New-case
              proposals are unavailable.
            </p>
          )}
          {review.state === "APPLIED" ? (
            <p role="status">
              Saved {review.receipt?.mappedCount ?? 0} mappings and{" "}
              {review.receipt?.createdIds.length ?? 0} proposed cases. New cases
              still need ordinary approval.
            </p>
          ) : (
            <>
              {review.proposals.map((p) => {
                const row = selection.find(
                  (r) => r.controlId === p.controlId,
                ) ?? { controlId: p.controlId, caseIds: [], newCase: null };
                return (
                  <fieldset
                    key={p.controlId}
                    disabled={busy || !!pending || !ready}
                    style={{ marginBlock: 12, minWidth: 0 }}
                  >
                    <legend>
                      {p.code} · {p.title}
                    </legend>
                    <p>{p.description}</p>
                    <p>
                      {p.kind.replaceAll("_", " ").toLowerCase()} ·{" "}
                      {p.existing.length} existing mappings
                    </p>
                    {p.existing.map((id) => (
                      <CaseProcedure
                        key={id}
                        value={review.cases.find((c) => c.id === id)}
                      />
                    ))}
                    {p.matches.map((m) => (
                      <div key={m.caseId}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <label
                            style={{ minWidth: 0, overflowWrap: "anywhere" }}
                          >
                            <input
                              type="checkbox"
                              checked={row.caseIds.includes(m.caseId)}
                              onChange={() =>
                                edit(p.controlId, {
                                  caseIds: row.caseIds.includes(m.caseId)
                                    ? row.caseIds.filter(
                                        (id) => id !== m.caseId,
                                      )
                                    : [...row.caseIds, m.caseId],
                                })
                              }
                            />{" "}
                            {m.title}
                          </label>
                          <IconButton
                            label={`Match help for ${m.title}`}
                            icon="help"
                            tooltip={
                              <>
                                {m.explanation} Title terms:{" "}
                                {m.titleTerms.join(", ") || "none"}. Procedure
                                terms: {m.procedureTerms.join(", ") || "none"}.
                              </>
                            }
                          />
                        </div>
                        <CaseProcedure
                          value={review.cases.find((c) => c.id === m.caseId)}
                        />
                      </div>
                    ))}
                    <label>
                      Additional scanned case{" "}
                      <select
                        style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}
                        value=""
                        onChange={(e) => {
                          if (
                            e.target.value &&
                            !row.caseIds.includes(e.target.value)
                          )
                            edit(p.controlId, {
                              caseIds: [...row.caseIds, e.target.value],
                            });
                        }}
                      >
                        <option value="">Choose a case</option>
                        {review.cases
                          .filter((c) => !p.existing.includes(c.id))
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                      </select>
                    </label>
                    {row.caseIds
                      .filter((id) => !p.matches.some((m) => m.caseId === id))
                      .map((id) => (
                        <CaseProcedure
                          key={id}
                          value={review.cases.find((c) => c.id === id)}
                        />
                      ))}
                    {row.caseIds.map((id) => (
                      <div
                        key={id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          overflowWrap: "anywhere",
                        }}
                      >
                        <span>
                          {review.cases.find((c) => c.id === id)?.title}
                        </span>
                        <IconButton
                          label={`Remove ${review.cases.find((c) => c.id === id)?.title}`}
                          icon="close"
                          tooltip="Remove this case from the proposed mappings. The case itself is kept."
                          onClick={() =>
                            edit(p.controlId, {
                              caseIds: row.caseIds.filter((x) => x !== id),
                            })
                          }
                        />
                      </div>
                    ))}
                    <label>
                      <input
                        type="checkbox"
                        disabled={review.scope.omitted > 0}
                        checked={!!row.newCase}
                        onChange={(e) =>
                          edit(p.controlId, {
                            newCase: e.target.checked ? p.outline : null,
                          })
                        }
                      />{" "}
                      Propose case
                    </label>
                    {row.newCase && (
                      <CaseFieldValueControls
                        fields={review.fields.schema.fields}
                        values={row.newCase.customFields ?? {}}
                        disabled={busy || !!pending || !ready}
                        onChange={(customFields) =>
                          edit(p.controlId, {
                            newCase: { ...row.newCase!, customFields },
                          })
                        }
                        onValidityChange={(valid) =>
                          setInvalidFields((old) =>
                            old[p.controlId] === !valid
                              ? old
                              : { ...old, [p.controlId]: !valid },
                          )
                        }
                      />
                    )}
                    {row.newCase &&
                      (
                        [
                          "title",
                          "prerequisite",
                          "action",
                          "expectedResult",
                        ] as const
                      ).map((key) => (
                        <label key={key} style={{ display: "block" }}>
                          {key === "expectedResult" ? "Expected result" : key}
                          <textarea
                            style={{ width: "100%", boxSizing: "border-box" }}
                            value={row.newCase![key]}
                            onChange={(e) =>
                              edit(p.controlId, {
                                newCase: {
                                  ...row.newCase!,
                                  [key]: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                  </fieldset>
                );
              })}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={
                    !dirty || busy || !!pending || !ready || fieldsInvalid
                  }
                  onClick={() => void saveSelection()}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={
                    dirty ||
                    fieldsInvalid ||
                    busy ||
                    !ready ||
                    !selection.some((r) => r.caseIds.length || r.newCase)
                  }
                  onClick={() => void applySelected()}
                >
                  {pending ? "Check result" : "Apply"}
                </button>
              </div>
              {pending && (
                <p>
                  Outcome unknown. Changes are locked. Check result reads the
                  recorded outcome before retrying the same retained request.
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
