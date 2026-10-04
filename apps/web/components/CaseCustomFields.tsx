"use client";
import { useEffect, useState } from "react";
import {
  trpcReact,
  type RouterOutputs,
  type RouterInputs,
} from "@/lib/trpcReact";
import { Modal } from "./Modal";
import { CaseFieldHistory } from "./CaseFieldHistory";
import {
  retainedTraceabilityReceipt,
  type TraceabilityReceipt,
} from "@/lib/traceability-receipt";
type State = RouterOutputs["caseFields"]["get"];
type Values = State["values"];
type Field = State["schema"]["fields"][number];
export type CaseFieldFormDraft = {
  customFields: Values;
  expectedFieldSchemaHash: string;
  expectedCustomFieldRevision: string;
  ready: boolean;
};
export type ReviewedCaseFieldDefaults = {
  values: Values;
  expectedSchemaHash: string;
};
function ValueInputs({
  fields,
  values,
  disabled,
  onChange,
}: {
  fields: Field[];
  values: Values;
  disabled: boolean;
  onChange: (values: Values) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {fields
        .filter((f) => !f.retired)
        .map((field) => (
          <label key={field.key} style={{ display: "grid", gap: 4 }}>
            {field.label}
            {field.required ? " (required)" : " (optional)"}
            {field.type === "BOOLEAN" || field.type === "CHOICE" ? (
              <select
                disabled={disabled}
                required={field.required}
                value={
                  field.type === "BOOLEAN"
                    ? values[field.key] == null
                      ? ""
                      : String(values[field.key])
                    : typeof values[field.key] === "string"
                      ? String(values[field.key])
                      : ""
                }
                onChange={(event) =>
                  onChange({
                    ...values,
                    [field.key]: !event.target.value
                      ? null
                      : field.type === "BOOLEAN"
                        ? event.target.value === "true"
                        : event.target.value,
                  })
                }
              >
                <option value="">Not set</option>
                {field.type === "BOOLEAN" ? (
                  <>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </>
                ) : (
                  field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))
                )}
              </select>
            ) : (
              <input
                disabled={disabled}
                required={field.required}
                type={
                  field.type === "NUMBER"
                    ? "number"
                    : field.type === "DATE"
                      ? "date"
                      : "text"
                }
                step={field.type === "NUMBER" ? "any" : undefined}
                maxLength={2000}
                value={
                  typeof values[field.key] === "string" ||
                  typeof values[field.key] === "number"
                    ? String(values[field.key])
                    : ""
                }
                onChange={(event) =>
                  onChange({
                    ...values,
                    [field.key]:
                      event.target.value === ""
                        ? null
                        : field.type === "NUMBER"
                          ? Number(event.target.value)
                          : event.target.value,
                  })
                }
              />
            )}
          </label>
        ))}
      {Object.keys(values).some(
        (key) => !fields.some((f) => !f.retired && f.key === key),
      ) && (
        <details>
          <summary>Retained retired/unknown metadata (read-only)</summary>
          {Object.entries(values)
            .filter(([key]) => !fields.some((f) => !f.retired && f.key === key))
            .map(([key, value]) => (
              <p key={key} style={{ overflowWrap: "anywhere" }}>
                <strong>
                  {fields.find((f) => f.key === key)?.label ?? key}:
                </strong>{" "}
                {String(value ?? "Not set")}
              </p>
            ))}
        </details>
      )}
    </div>
  );
}
function clientProblems(fields: Field[], values: Values): string[] {
  return fields.flatMap((field) => {
    if (field.retired) return [];
    const value = values[field.key];
    if (value == null || (typeof value === "string" && value.trim() === ""))
      return field.required ? [`${field.label} is required.`] : [];
    const valid =
      field.type === "TEXT"
        ? typeof value === "string" && value.length <= 2000
        : field.type === "NUMBER"
          ? typeof value === "number" &&
            Number.isFinite(value) &&
            Math.abs(value) <= 1e12
          : field.type === "BOOLEAN"
            ? typeof value === "boolean"
            : field.type === "CHOICE"
              ? typeof value === "string" && field.options.includes(value)
              : typeof value === "string" &&
                /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) &&
                Number.isFinite(Date.parse(value)) &&
                new Date(value).toISOString().slice(0, 10) === value;
    return valid
      ? []
      : [`${field.label} needs a valid ${field.type.toLowerCase()} value.`];
  });
}
export function CaseCustomFieldsForm({
  projectId,
  caseId,
  onChange,
  active = true,
  initial,
}: {
  projectId: string;
  caseId?: string;
  onChange: (value: CaseFieldFormDraft | null) => void;
  active?: boolean;
  initial?: ReviewedCaseFieldDefaults;
}) {
  const query = trpcReact.caseFields.get.useQuery(
    { projectId, caseId },
    { enabled:active, retry: false, staleTime: 0, refetchOnWindowFocus: false },
  );
  const [baseline, setBaseline] = useState<State | null>(null),
    [values, setValues] = useState<Values>({});
  const [initialError, setInitialError] = useState<string | null>(null);
  const fresh =
    active && !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.caseId === (caseId ?? null)
      ? query.data
      : null;
  useEffect(() => {
    if (!baseline && fresh) {
      setBaseline(fresh);
      if (initial) {
        if (
          caseId !== undefined ||
          !fresh.canEdit ||
          initial.expectedSchemaHash !== fresh.expectedSchemaHash ||
          Object.keys(initial.values).some(
            (key) =>
              !fresh.schema.fields.some(
                (field) => !field.retired && field.key === key,
              ),
          )
        ) {
          setValues(fresh.values);
          setInitialError(
            "Reviewed preset defaults do not match a fresh editable case and current field definitions. They were not applied. Review the preset again or explicitly start without its metadata defaults.",
          );
        } else setValues({ ...fresh.values, ...initial.values });
      } else setValues(fresh.values);
    }
  }, [baseline, fresh, initial, caseId]);
  const changed = Boolean(
    baseline &&
    fresh &&
    (fresh.expectedSchemaHash !== baseline.expectedSchemaHash ||
      fresh.expectedValueHash !== baseline.expectedValueHash),
  );
  useEffect(() => {
    onChange(
      baseline && fresh && !changed && !initialError
        ? {
            customFields: values,
            expectedFieldSchemaHash: baseline.expectedSchemaHash,
            expectedCustomFieldRevision: baseline.expectedValueHash,
            ready:
              fresh.canEdit &&
              clientProblems(baseline.schema.fields, values).length === 0,
          }
        : null,
    );
  }, [baseline, fresh, changed, values, onChange, initialError]);
  return (
    <section>
      <h3>Project case fields</h3>
      {initialError && (
        <p role="alert">
          {initialError}{" "}
          {caseId === undefined && fresh && (
            <button
              type="button"
              onClick={() => {
                setValues(fresh.values);
                setBaseline(fresh);
                setInitialError(null);
              }}
            >
              Start with current fields without preset defaults
            </button>
          )}
        </p>
      )}
      {query.error && (
        <p role="alert">
          Case fields could not be refreshed.{" "}
          <button type="button" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      {(!baseline || query.isFetching || query.isPaused) && (
        <p role="status">
          {query.isPaused
            ? "Reconnect to load current field definitions before saving."
            : "Loading current case fields…"}
        </p>
      )}
      {changed && (
        <p role="alert">
          Fields or definitions changed after this draft opened. Your draft is
          retained. Review current values before replacing it.{" "}
          <button
            type="button"
            onClick={() => {
              if (fresh) {
                setBaseline(fresh);
                setValues(fresh.values);
              }
            }}
          >
            Load current values
          </button>
        </p>
      )}
      {baseline && (
        <>
          <ValueInputs
            fields={baseline.schema.fields}
            values={values}
            disabled={!fresh || changed || !baseline.canEdit}
            onChange={setValues}
          />
          {clientProblems(baseline.schema.fields, values).map((problem) => (
            <p role="status" key={problem}>
              {problem}
            </p>
          ))}
          {!baseline.schema.fields.length && (
            <p className="text-muted">No project-defined case fields.</p>
          )}
        </>
      )}
    </section>
  );
}
export function CaseCustomFields({
  projectId,
  caseId,
}: {
  projectId: string;
  caseId: string;
}) {
  return (
    <CaseFieldEditor
      key={`${projectId}:${caseId}`}
      projectId={projectId}
      caseId={caseId}
    />
  );
}
function CaseFieldEditor({
  projectId,
  caseId,
}: {
  projectId: string;
  caseId: string;
}) {
  const utils = trpcReact.useUtils();
  const query = trpcReact.caseFields.get.useQuery(
    { projectId, caseId },
    { retry: false, staleTime: 0 },
  );
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<CaseFieldFormDraft | null>(null),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<TraceabilityReceipt<
    RouterInputs["caseFields"]["save"]
  > | null>(null);
  const save = trpcReact.caseFields.save.useMutation();
  const fresh =
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.caseId === caseId
      ? query.data
      : null;
  async function commit() {
    if (
      save.isPending ||
      (!pending &&
        (!draft?.ready ||
          !fresh?.canEdit ||
          fresh.expectedSchemaHash !== draft.expectedFieldSchemaHash ||
          fresh.expectedValueHash !== draft.expectedCustomFieldRevision ||
          !reason.trim() ||
          !confirmed))
    )
      return;
    const attempt = pending ?? {
      input: {
        projectId,
        caseId,
        values: draft!.customFields,
        expectedSchemaHash: draft!.expectedFieldSchemaHash,
        expectedValueHash: draft!.expectedCustomFieldRevision,
        reason: reason.trim(),
        confirmed: true as const,
        requestId: crypto.randomUUID(),
      },
      uncertain: false,
    };
    setPending(attempt);
    setNotice(null);
    try {
      const result = await save.mutateAsync(attempt.input);
      setPending(null);
      setNotice(
        result.replayed
          ? "Confirmed the previous metadata save."
          : "Saved case metadata; existing retired values remain retained.",
      );
      void utils.caseFields.get.invalidate({ projectId, caseId });
      void utils.testCases.byId.invalidate({ id: caseId });
      setOpen(false);
    } catch (error) {
      setPending(retainedTraceabilityReceipt(attempt, error));
      setNotice(
        error instanceof Error
          ? error.message
          : "Save could not be confirmed; retry the exact request.",
      );
    }
  }
  return (
    <section>
      <h3>Project case fields</h3>
      {query.error && (
        <p role="alert">
          Case metadata could not be refreshed.{" "}
          <button type="button" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      {fresh ? (
        <>
          <dl>
            {fresh.schema.fields.map((field) => (
              <div
                key={field.key}
                style={{ marginBottom: 8, overflowWrap: "anywhere" }}
              >
                <dt>
                  {field.label}
                  {field.required ? " (required)" : ""}
                  {field.retired ? " (retired)" : ""}
                </dt>
                <dd>
                  {fresh.values[field.key] == null ||
                  fresh.values[field.key] === ""
                    ? "Not set"
                    : typeof fresh.values[field.key] === "boolean"
                      ? fresh.values[field.key]
                        ? "Yes"
                        : "No"
                      : String(fresh.values[field.key])}
                </dd>
              </div>
            ))}
          </dl>
          {fresh.problems.map((problem) => (
            <p role="status" key={problem}>
              {problem} This existing case is retained but incomplete.
            </p>
          ))}
          {Object.entries(fresh.values)
            .filter(
              ([key]) =>
                !fresh.schema.fields.some((field) => field.key === key),
            )
            .map(([key, value]) => (
              <p key={key} style={{ overflowWrap: "anywhere" }}>
                <strong>{key} (retained, read-only):</strong>{" "}
                {String(value ?? "Not set")}
              </p>
            ))}
        </>
      ) : (
        <p role="status">
          Current case metadata is unavailable while refreshing or offline.
        </p>
      )}
      {(fresh?.canEdit || pending) && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            if (!pending) {
              setDraft(null);
              setReason("");
              setConfirmed(false);
              setNotice(null);
            }
            setOpen(true);
          }}
        >
          {pending ? "Resume exact field save" : "Edit case fields"}
        </button>
      )}
      <p className="text-muted">
        Metadata saves retain an actor-attributed before/after audit. Procedure
        version comparison and restore preserve current metadata. Supported
        metadata snapshots can be reviewed and restored separately below.
      </p>
      <CaseFieldHistory projectId={projectId} caseId={caseId} />
      {notice && <p role="status">{notice}</p>}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit project case fields"
        dismissible={!save.isPending}
      >
        {!pending && (
          <CaseCustomFieldsForm
            key={`${caseId}:${open}`}
            projectId={projectId}
            caseId={caseId}
            onChange={setDraft}
          />
        )}
        {!pending && (
          <>
            <label>
              Reason (required)
              <input
                value={reason}
                maxLength={1000}
                onChange={(event) => {
                  setReason(event.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />{" "}
              I reviewed these metadata changes.
            </label>
          </>
        )}
        {pending?.uncertain && (
          <p role="status">
            Request {pending.input.requestId} is retained. Retry this exact
            request to confirm whether it committed.
          </p>
        )}
        {notice && <p role="alert">{notice}</p>}
        <button
          type="button"
          className="btn-primary"
          disabled={
            save.isPending ||
            (!pending &&
              (!draft?.ready ||
                !fresh?.canEdit ||
                fresh.expectedSchemaHash !== draft.expectedFieldSchemaHash ||
                fresh.expectedValueHash !== draft.expectedCustomFieldRevision ||
                !reason.trim() ||
                !confirmed))
          }
          onClick={() => void commit()}
        >
          {save.isPending
            ? "Saving…"
            : pending
              ? "Retry exact save"
              : "Save reviewed fields"}
        </button>
      </Modal>
    </section>
  );
}
