"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  fieldValueProblem,
  type CaseFieldDefinition,
  type CaseFieldValues,
} from "../../api/src/services/caseFieldSchema";
import {
  resolveCaseFieldPresentation,
  type CaseFieldPresentation,
} from "../../api/src/services/caseFieldPresentationSchema";

type NumberDraft = { text: string; present: boolean; value: unknown };
export function parseCaseFieldNumberDraft(text: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim()))
    return null;
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : null;
}
function currentNumberDraft(
  key: string,
  values: CaseFieldValues,
  drafts: Record<string, NumberDraft>,
) {
  const draft = drafts[key];
  return draft &&
    (parseCaseFieldNumberDraft(draft.text) === null ||
      (draft.present === Object.hasOwn(values, key) &&
        draft.value === values[key]))
    ? draft
    : undefined;
}
function controlProblems(
  fields: readonly CaseFieldDefinition[],
  values: CaseFieldValues,
  drafts: Record<string, NumberDraft>,
) {
  return fields.flatMap((field) => {
    const draft =
      field.type === "NUMBER"
        ? currentNumberDraft(field.key, values, drafts)
        : undefined;
    if (
      !field.retired &&
      draft &&
      parseCaseFieldNumberDraft(draft.text) === null
    )
      return [
        `${field.label}: the typed number is invalid or blank. Explicitly clear it or enter a finite number between -1e12 and 1e12.`,
      ];
    const problem = fieldValueProblem(field, values[field.key]);
    return problem ? [problem] : [];
  });
}
export function CaseFieldValueControls({
  fields,
  values,
  presentation,
  disabled = false,
  onChange,
  onValidityChange,
}: {
  fields: readonly CaseFieldDefinition[];
  values: CaseFieldValues;
  presentation?: CaseFieldPresentation;
  disabled?: boolean;
  onChange: (values: CaseFieldValues) => void;
  onValidityChange: (valid: boolean, problems: string[]) => void;
}) {
  const identity = useId();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [numberDrafts, setNumberDrafts] = useState<Record<string, NumberDraft>>(
    {},
  );
  // A second field event may arrive before React commits the first buffer.
  // Never report a stale "valid" aggregate while another number is unresolved.
  const numberDraftsRef = useRef(numberDrafts);
  const problems = controlProblems(fields, values, numberDrafts);
  const validityKey = JSON.stringify(problems);
  useEffect(() => {
    onValidityChange(problems.length === 0, problems);
  }, [validityKey, onValidityChange]); // eslint-disable-line react-hooks/exhaustive-deps
  function apply(
    key: string,
    value: CaseFieldValues[string] | undefined,
    remove = false,
  ) {
    if (disabled) return;
    const next = { ...values };
    if (remove) delete next[key];
    else next[key] = value!;
    const drafts = { ...numberDraftsRef.current };
    delete drafts[key];
    numberDraftsRef.current = drafts;
    setNumberDrafts(drafts);
    setTouched((current) => ({ ...current, [key]: true }));
    const nextProblems = controlProblems(fields, next, drafts);
    onValidityChange(nextProblems.length === 0, nextProblems);
    onChange(next);
  }
  function numberInput(key: string, text: string) {
    if (disabled) return;
    const number = parseCaseFieldNumberDraft(text);
    const next = number === null ? values : { ...values, [key]: number };
    const drafts = {
      ...numberDraftsRef.current,
      [key]: { text, present: Object.hasOwn(next, key), value: next[key] },
    };
    numberDraftsRef.current = drafts;
    setNumberDrafts(drafts);
    setTouched((current) => ({ ...current, [key]: true }));
    const nextProblems = controlProblems(fields, next, drafts);
    onValidityChange(nextProblems.length === 0, nextProblems);
    if (number !== null) onChange(next);
  }
  const known = new Set(fields.map((field) => field.key));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16, minWidth: 0, overflowWrap: "anywhere" }}>
      {fields.map((field) => {
        const resolved = resolveCaseFieldPresentation({
          key: field.key,
          definition: field,
          setting: presentation?.fields[field.key],
          values,
          touched: touched[field.key],
          revealed: revealed[field.key],
        });
        if (field.retired && !resolved.present) return null;
        const id = `${identity}-${field.key}`,
          locked = disabled || resolved.readOnly;
        const multiline =
          resolved.widget === "TEXT_INPUT" &&
          typeof resolved.value === "string" &&
          /[\r\n]/.test(resolved.value);
        const widget = multiline ? "PARAGRAPH" : resolved.widget;
        if (resolved.canReveal)
          return (
            <div key={field.key}>
              <span>{field.label} (optional, not set)</span>{" "}
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  setRevealed((current) => ({ ...current, [field.key]: true }))
                }
              >
                Reveal {field.label}
              </button>
            </div>
          );
        return (
          <section
            key={field.key}
            aria-labelledby={`${id}-label`}
            style={{ minWidth: 0, gridColumn: widget === "PARAGRAPH" || resolved.readOnly ? "1 / -1" : undefined }}
          >
            <h4 id={`${id}-label`} style={{ margin: "0 0 8px" }}>
              {field.label}
              {field.required ? " (required)" : " (optional)"}
              {field.retired ? " (retired)" : ""}
            </h4>
            {resolved.warning && <p role="status">{resolved.warning}</p>}
            {multiline && (
              <p role="status">
                This saved text contains line breaks. A paragraph control
                preserves the exact prose instead of stripping it into one line.
              </p>
            )}
            {resolved.readOnly ? (
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {resolved.present
                  ? JSON.stringify(resolved.value)
                  : "Unset (key absent)"}
              </pre>
            ) : (
              <>
                <small className="text-muted" style={{display:"block",marginBottom:6}}>
                  {!resolved.present
                    ? "Unset (key absent)"
                    : resolved.value === null
                      ? "Explicit NULL"
                      : resolved.value === ""
                        ? "Empty text"
                        : typeof resolved.value === "boolean"
                          ? resolved.value
                            ? "Yes (true)"
                            : "No (false)"
                          : "Value set"}
                </small>
                {widget === "TEXT_INPUT" || widget === "PARAGRAPH" ? (
                  <>
                    <label htmlFor={id}>{field.label}</label>
                    {widget === "PARAGRAPH" ? (
                      <textarea
                        id={id}
                        required={field.required}
                        rows={4}
                        maxLength={2000}
                        disabled={locked}
                        placeholder={resolved.placeholder}
                        value={
                          typeof resolved.value === "string"
                            ? resolved.value
                            : ""
                        }
                        onChange={(event) =>
                          apply(field.key, event.target.value)
                        }
                        style={{
                          width: "100%",
                          minWidth: 0,
                          resize: "vertical",
                        }}
                      />
                    ) : (
                      <input
                        id={id}
                        type="text"
                        style={{width:"100%",minWidth:0}}
                        required={field.required}
                        maxLength={2000}
                        disabled={locked}
                        placeholder={resolved.placeholder}
                        value={
                          typeof resolved.value === "string"
                            ? resolved.value
                            : ""
                        }
                        onChange={(event) =>
                          apply(field.key, event.target.value)
                        }
                      />
                    )}
                  </>
                ) : widget === "RADIO" ? (
                  <fieldset disabled={locked}>
                    <legend>{field.label}</legend>
                    {field.options.map((option, index) => (
                      <label key={option} htmlFor={`${id}-${index}`}>
                        <input
                          id={`${id}-${index}`}
                          type="radio"
                          required={field.required}
                          name={`${id}-choices`}
                          checked={resolved.value === option}
                          onChange={() => apply(field.key, option)}
                        />
                        {option}
                      </label>
                    ))}
                  </fieldset>
                ) : widget === "CHECKBOX" ? (
                  <label htmlFor={id}>
                    <input
                      id={id}
                      type="checkbox"
                      disabled={locked}
                      checked={resolved.value === true}
                      onChange={(event) =>
                        apply(field.key, event.target.checked)
                      }
                    />
                    {field.label} (checking sets true; unchecking sets false)
                  </label>
                ) : widget === "DROPDOWN" || widget === "TRI_STATE" ? (
                  <label htmlFor={id}>
                    {field.label}
                    <select
                      style={{width:"100%",minWidth:0}}
                      id={id}
                      required={field.required}
                      disabled={locked}
                      value={
                        !resolved.present
                          ? "UNSET"
                          : resolved.value === null
                            ? "NULL"
                            : widget === "TRI_STATE"
                              ? resolved.value
                                ? "TRUE"
                                : "FALSE"
                              : `CHOICE:${String(resolved.value)}`
                      }
                      onChange={(event) => {
                        const selected = event.target.value;
                        if (selected === "UNSET")
                          apply(field.key, undefined, true);
                        else if (selected === "NULL") apply(field.key, null);
                        else
                          apply(
                            field.key,
                            widget === "TRI_STATE"
                              ? selected === "TRUE"
                              : selected.slice(7),
                          );
                      }}
                    >
                      <option value="UNSET">Unset (key absent)</option>
                      <option value="NULL">Explicit NULL</option>
                      {widget === "TRI_STATE" ? (
                        <>
                          <option value="TRUE">Yes</option>
                          <option value="FALSE">No</option>
                        </>
                      ) : (
                        field.options.map((option) => (
                          <option value={`CHOICE:${option}`} key={option}>
                            {option}
                          </option>
                        ))
                      )}
                    </select>
                  </label>
                ) : widget === "NUMBER" ? (
                  <label htmlFor={id}>
                    {field.label}
                    <input
                      id={id}
                      type="text"
                      style={{width:"100%",minWidth:0}}
                      required={field.required}
                      inputMode="decimal"
                      maxLength={2000}
                      disabled={locked}
                      placeholder={resolved.placeholder}
                      value={
                        currentNumberDraft(field.key, values, numberDrafts)
                          ?.text ??
                        (typeof resolved.value === "number"
                          ? String(resolved.value)
                          : "")
                      }
                      onChange={(event) =>
                        numberInput(field.key, event.target.value)
                      }
                    />
                  </label>
                ) : widget === "DATE" ? (
                  <label htmlFor={id}>
                    {field.label}
                    <input
                      id={id}
                      type="date"
                      style={{width:"100%",minWidth:0}}
                      required={field.required}
                      disabled={locked}
                      value={
                        typeof resolved.value === "string" ? resolved.value : ""
                      }
                      onChange={(event) =>
                        apply(
                          field.key,
                          event.target.value === "" ? null : event.target.value,
                        )
                      }
                    />
                  </label>
                ) : (
                  <pre>{JSON.stringify(resolved.value)}</pre>
                )}
                {field.type === "BOOLEAN" && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => apply(field.key, false)}
                    >
                      Set false explicitly
                    </button>
                )}
                <details style={{marginTop:8}}>
                  <summary>Clear or unset value</summary>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop:8 }}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => apply(field.key, null)}
                  >
                    Set NULL explicitly
                  </button>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => apply(field.key, undefined, true)}
                  >
                    Remove value (unset)
                  </button>
                  </div>
                </details>
              </>
            )}
          </section>
        );
      })}
      {Object.entries(values)
        .filter(([key]) => !known.has(key))
        .map(([key, value]) => (
          <section key={key}>
            <h4>{key} (retained unknown metadata, read-only)</h4>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(value)}
            </pre>
          </section>
        ))}
      {problems.map((problem) => (
        <p role="status" key={problem}>
          {problem}
        </p>
      ))}
    </div>
  );
}
