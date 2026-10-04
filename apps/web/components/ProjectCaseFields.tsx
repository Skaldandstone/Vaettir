"use client";
import { useState } from "react";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import {
  retainedTraceabilityReceipt,
  type TraceabilityReceipt,
} from "@/lib/traceability-receipt";
import { Modal } from "./Modal";
type State = RouterOutputs["caseFields"]["get"];
type Schema = State["schema"];
const emptyField: Schema["fields"][number] = {
  key: "",
  label: "",
  type: "TEXT",
  required: false,
  retired: false,
  options: [],
};
export function ProjectCaseFields({ projectId }: { projectId: string }) {
  return <FieldDefinitions key={projectId} projectId={projectId} />;
}
function FieldDefinitions({ projectId }: { projectId: string }) {
  const utils = trpcReact.useUtils(),
    query = trpcReact.caseFields.get.useQuery(
      { projectId },
      { retry: false, staleTime: 0, refetchOnWindowFocus: false },
    );
  const review = trpcReact.caseFields.reviewSchema.useMutation(),
    configure = trpcReact.caseFields.configure.useMutation();
  const [open, setOpen] = useState(false),
    [baseline, setBaseline] = useState<State | null>(null),
    [schema, setSchema] = useState<Schema>({ version: 1, fields: [] }),
    [selected, setSelected] = useState(-1),
    [field, setField] = useState(emptyField);
  const [impact, setImpact] = useState<
      RouterOutputs["caseFields"]["reviewSchema"] | null
    >(null),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<TraceabilityReceipt<
    RouterInputs["caseFields"]["configure"]
  > | null>(null);
  const fresh =
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId
      ? query.data
      : null;
  const busy = review.isPending || configure.isPending;
  const canApprove = Boolean(
    fresh?.canConfigure &&
    baseline &&
    impact &&
    fresh.expectedSchemaHash === baseline.expectedSchemaHash &&
    fresh.expectedSchemaHash === impact.expectedSchemaHash,
  );
  async function show() {
    setOpen(true);
    if (pending) return;
    setBaseline(null);
    setImpact(null);
    setConfirmed(false);
    setNotice(null);
    const result = await query.refetch();
    if (
      !result.error &&
      !result.isFetching &&
      !result.isPaused &&
      result.data?.projectId === projectId &&
      result.data.canConfigure
    ) {
      setBaseline(result.data);
      setSchema(result.data.schema);
      setSelected(-1);
      setField(emptyField);
    } else
      setNotice(
        "Current Owner/Admin field configuration could not be loaded. Retry opening after reconnecting.",
      );
  }
  function applyField() {
    if (busy || pending || !field.key.trim() || !field.label.trim()) return;
    const next =
      selected < 0
        ? [...schema.fields, field]
        : schema.fields.map((value, index) =>
            index === selected ? field : value,
          );
    setSchema({ version: 1, fields: next });
    setImpact(null);
    setConfirmed(false);
    setSelected(-1);
    setField(emptyField);
  }
  async function compare() {
    if (busy || pending || !baseline) return;
    setNotice(null);
    setImpact(null);
    setConfirmed(false);
    try {
      const result = await review.mutateAsync({ projectId, schema });
      if (result.expectedSchemaHash !== baseline.expectedSchemaHash) {
        setNotice(
          "Definitions changed since this draft opened. Close and reopen to review the current definitions; no configuration changed.",
        );
        return;
      }
      setImpact(result);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Impact review failed; no configuration changed.",
      );
    }
  }
  async function commit() {
    if (
      busy ||
      (!pending && (!canApprove || !impact || !confirmed || !reason.trim()))
    )
      return;
    const attempt = pending ?? {
      input: {
        projectId,
        schema,
        expectedSchemaHash: impact!.expectedSchemaHash,
        expectedImpactHash: impact!.expectedImpactHash,
        actorId: impact!.actorId,
        reason: reason.trim(),
        confirmed: true as const,
        requestId: crypto.randomUUID(),
      },
      uncertain: false,
    };
    setPending(attempt);
    setNotice(null);
    try {
      await configure.mutateAsync(attempt.input);
      setPending(null);
      setOpen(false);
      setNotice(
        "Saved reviewed field definitions. Existing incomplete cases remain retained; no values were invented.",
      );
      void utils.caseFields.get.invalidate({ projectId });
    } catch (error) {
      setPending(retainedTraceabilityReceipt(attempt, error));
      setNotice(
        error instanceof Error
          ? error.message
          : "Configuration response is uncertain. Retry the exact request.",
      );
    }
  }
  return (
    <>
      {query.error && (
        <p role="alert">
          Case field definitions could not be refreshed.{" "}
          <button type="button" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      {(fresh?.canConfigure || pending) && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void show()}
        >
          Configure case fields
        </button>
      )}
      {notice && !open && <p role="status">{notice}</p>}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Project case field definitions"
        size="wide"
        dismissible={!busy}
      >
        <p>
          Typed metadata for this project&apos;s cases, separate from test-plan
          fields. Saved keys, types and choices stay stable, even after values
          are cleared; retire fields instead of deleting their values.
        </p>
        {notice && <p role="alert">{notice}</p>}
        {!baseline && !pending && (
          <p role="status">Loading current definitions…</p>
        )}
        {baseline && !impact && !pending && (
          <>
            <label>
              Choose a field to edit
              <select
                value={selected}
                disabled={busy}
                onChange={(event) => {
                  const index = Number(event.target.value);
                  setSelected(index);
                  setField(index < 0 ? emptyField : schema.fields[index]!);
                }}
              >
                <option value={-1}>Add a new field</option>
                {schema.fields.map((value, index) => (
                  <option key={value.key} value={index}>
                    {value.label}
                    {value.retired ? " (retired)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <fieldset
              disabled={busy}
              style={{
                border: 0,
                padding: 0,
                minWidth: 0,
                display: "grid",
                gap: 12,
              }}
            >
              <label>
                Stable key (required)
                <input
                  disabled={selected >= 0}
                  value={field.key}
                  maxLength={40}
                  placeholder="component"
                  onChange={(event) =>
                    setField((f) => ({ ...f, key: event.target.value }))
                  }
                />
              </label>
              <label>
                Display label (required)
                <input
                  value={field.label}
                  maxLength={120}
                  onChange={(event) =>
                    setField((f) => ({ ...f, label: event.target.value }))
                  }
                />
              </label>
              <label>
                Type
                <select
                  disabled={selected >= 0}
                  value={field.type}
                  onChange={(event) =>
                    setField((f) => ({
                      ...f,
                      type: event.target.value as typeof field.type,
                      options: [],
                    }))
                  }
                >
                  <option value="TEXT">Text</option>
                  <option value="NUMBER">Number</option>
                  <option value="BOOLEAN">Yes / No</option>
                  <option value="DATE">Date</option>
                  <option value="CHOICE">Single choice</option>
                </select>
              </label>
              {field.type === "CHOICE" && (
                <label>
                  Choices, one per line
                  <textarea
                    disabled={selected >= 0}
                    value={field.options.join("\n")}
                    onChange={(event) =>
                      setField((f) => ({
                        ...f,
                        options: event.target.value.split("\n"),
                      }))
                    }
                  />
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={field.required}
                  disabled={field.retired}
                  onChange={(event) =>
                    setField((f) => ({ ...f, required: event.target.checked }))
                  }
                />{" "}
                Required for new cases and explicit case editing
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={field.retired}
                  onChange={(event) =>
                    setField((f) => ({
                      ...f,
                      retired: event.target.checked,
                      required: event.target.checked ? false : f.required,
                    }))
                  }
                />{" "}
                Retire (retain original values read-only)
              </label>
              <button
                type="button"
                className="btn-secondary"
                disabled={
                  (selected < 0 && schema.fields.length >= 20) ||
                  !field.key ||
                  !field.label
                }
                onClick={applyField}
              >
                Keep field in draft
              </button>
            </fieldset>
            <p>
              {schema.fields.length}/20 definitions, including retired fields.
            </p>
            <ul>
              {schema.fields.map((value) => (
                <li key={value.key}>
                  {value.label}: {value.type.toLowerCase()}
                  {value.required ? ", required" : ""}
                  {value.retired ? ", retired" : ""}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void compare()}
            >
              Review impact before saving
            </button>
          </>
        )}
        {impact && !pending && (
          <>
            <h3>Review definition changes</h3>
            <p>{impact.affectedCases} existing cases will remain retained.</p>
            <ul>
              {impact.missingRequired.map((field) => (
                <li key={field.key}>
                  {field.label}: {field.count} cases need this required value
                  completed.
                </li>
              ))}
            </ul>
            {impact.warnings.map((text) => (
              <p key={text}>{text}</p>
            ))}
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
              I reviewed the retained incomplete cases and approve these
              definitions.
            </label>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setImpact(null);
                setConfirmed(false);
              }}
            >
              Back to definitions
            </button>
          </>
        )}
        {pending?.uncertain && (
          <p role="status">
            Request {pending.input.requestId} is retained. Retry its exact
            configuration to confirm prior acceptance.
          </p>
        )}
        {(impact || pending) && (
          <button
            type="button"
            className="btn-primary"
            disabled={
              busy ||
              (!pending && (!canApprove || !reason.trim() || !confirmed))
            }
            onClick={() => void commit()}
          >
            {configure.isPending
              ? "Saving…"
              : pending
                ? "Retry exact configuration"
                : "Approve definitions"}
          </button>
        )}
      </Modal>
    </>
  );
}
