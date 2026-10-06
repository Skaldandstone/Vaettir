"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  trpcReact,
  type RouterOutputs,
  type RouterInputs,
} from "@/lib/trpcReact";
import { Modal } from "./Modal";
import { CaseFieldHistory } from "./CaseFieldHistory";
import {
  retainedCaseFieldReceipt,
  assertCaseFieldAcknowledgement,
  sameCaseFieldOrigin,
  caseFieldReadPins,
  type CaseFieldReceipt,
} from "@/lib/case-field-origin";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { fieldStylesForSnapshot } from "@/lib/case-field-style-snapshot";
import type { CaseFieldPresentation } from "../../api/src/services/caseFieldPresentationSchema";
import { CaseFieldValueControls } from "./CaseFieldValueControls";
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
  const access = useCaseFieldAccess(projectId, caseId, active);
  const { query, fresh } = access;
  const stylesQuery = trpcReact.caseFieldPresentation.get.useQuery(
    { projectId, ...caseFieldReadPins(access.origin) },
    {
      enabled: active && access.readable && !!access.origin,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
    },
  );
  const [baseline, setBaseline] = useState<State | null>(null),
    [values, setValues] = useState<Values>({});
  const [styles, setStyles] = useState<{
    configuration?: CaseFieldPresentation;
    warning: string | null;
  } | null>(null);
  const [controlsValid, setControlsValid] = useState(true);
  const [valueSession, setValueSession] = useState(0);
  const valuesRef = useRef(values),
    validityRef = useRef(true);
  const publicationRef = useRef<{
    baseline: State | null;
    fresh: State | null;
    active: boolean;
    initialError: string | null;
  }>({ baseline: null, fresh: null, active, initialError: null });
  const [initialError, setInitialError] = useState<string | null>(null);
  useEffect(() => {
    if (
      !baseline &&
      fresh &&
      (stylesQuery.error ||
        stylesQuery.isPaused ||
        (stylesQuery.isFetchedAfterMount &&
          !stylesQuery.isPending &&
          !stylesQuery.isFetching))
    ) {
      const admitted = fieldStylesForSnapshot(
        stylesQuery.error || stylesQuery.isPaused
          ? undefined
          : stylesQuery.data,
        access.origin,
        fresh.expectedSchemaHash,
      );
      setStyles({
        configuration: admitted.configuration
          ? structuredClone(admitted.configuration)
          : undefined,
        warning:
          stylesQuery.error || stylesQuery.isPaused
            ? "Field presentation could not be refreshed. Native controls are used without resetting values or saved settings."
            : admitted.warning,
      });
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
          valuesRef.current = fresh.values;
          setValues(fresh.values);
          setInitialError(
            "Reviewed preset defaults do not match a fresh editable case and current field definitions. They were not applied. Review the preset again or explicitly start without its metadata defaults.",
          );
        } else {
          const admittedValues = { ...fresh.values, ...initial.values };
          valuesRef.current = admittedValues;
          setValues(admittedValues);
        }
      } else {
        valuesRef.current = fresh.values;
        setValues(fresh.values);
      }
    }
  }, [
    baseline,
    fresh,
    initial,
    caseId,
    stylesQuery.error,
    stylesQuery.isPaused,
    stylesQuery.isPending,
    stylesQuery.isFetchedAfterMount,
    stylesQuery.isFetching,
    stylesQuery.data,
    access.origin,
  ]);
  const changed = Boolean(
    baseline &&
    fresh &&
    (fresh.expectedSchemaHash !== baseline.expectedSchemaHash ||
      fresh.expectedValueHash !== baseline.expectedValueHash),
  );
  useLayoutEffect(() => {
    publicationRef.current = { baseline, fresh, active, initialError };
    return () => {
      publicationRef.current = {
        baseline,
        fresh: null,
        active: false,
        initialError,
      };
    };
  }, [baseline, fresh, active, initialError]);
  const publish = useCallback(
    (next: Values, valid: boolean) => {
      const current = publicationRef.current,
        original = current.baseline;
      const unchanged =
        original &&
        current.fresh &&
        original.expectedSchemaHash === current.fresh.expectedSchemaHash &&
        original.expectedValueHash === current.fresh.expectedValueHash;
      onChange(
        current.active && unchanged && !current.initialError
          ? {
              customFields: next,
              expectedFieldSchemaHash: original.expectedSchemaHash,
              expectedCustomFieldRevision: original.expectedValueHash,
              ready:
                !!current.fresh?.canEdit &&
                valid &&
                clientProblems(original.schema.fields, next).length === 0,
            }
          : null,
      );
    },
    [onChange],
  );
  const updateValues = useCallback(
    (next: Values) => {
      valuesRef.current = next;
      setValues(next);
      publish(next, validityRef.current);
    },
    [publish],
  );
  const updateValidity = useCallback(
    (valid: boolean) => {
      // Inactive/private placeholders must not erase a retained invalid buffer.
      if (!publicationRef.current.active || !publicationRef.current.fresh)
        return;
      validityRef.current = valid;
      setControlsValid(valid);
      publish(valuesRef.current, valid);
    },
    [publish],
  );
  useEffect(() => {
    publish(valuesRef.current, validityRef.current);
  }, [baseline, fresh, active, initialError, publish]);
  return (
    <section>
      <h3>Project case fields</h3>
      {access.readable && initialError && (
        <p role="alert">
          {initialError}{" "}
          {caseId === undefined && fresh && (
            <button
              type="button"
              onClick={() => {
                setValues(fresh.values);
                valuesRef.current = fresh.values;
                setBaseline(fresh);
                setInitialError(null);
                validityRef.current = true;
                setControlsValid(true);
                setValueSession((value) => value + 1);
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
                valuesRef.current = fresh.values;
                validityRef.current = true;
                setControlsValid(true);
                setValueSession((value) => value + 1);
              }
            }}
          >
            Load current values
          </button>
        </p>
      )}
      {!access.readable && (
        <p role="status">
          Draft metadata is withheld until the original account and project
          access are refreshed. Your draft is retained.
        </p>
      )}
      {baseline && (
        <>
          <div hidden={!active || !access.readable}>
            {styles?.warning && access.readable && (
              <p role="status">{styles.warning}</p>
            )}
            <CaseFieldValueControls
              key={valueSession}
              fields={access.readable ? baseline.schema.fields : []}
              values={access.readable ? values : {}}
              presentation={access.readable ? styles?.configuration : undefined}
              disabled={!active || !fresh || changed || !fresh.canEdit}
              onChange={updateValues}
              onValidityChange={updateValidity}
            />
            {access.readable && !controlsValid && (
              <p role="status">
                Resolve the retained invalid input before saving; unchanged old
                numeric values will not be submitted as a replacement.
              </p>
            )}
            {access.readable &&
              clientProblems(baseline.schema.fields, values).map((problem) => (
                <p role="status" key={problem}>
                  {problem}
                </p>
              ))}
            {!baseline.schema.fields.length && (
              <p className="text-muted">No project-defined case fields.</p>
            )}
          </div>
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
  const access = useCaseFieldAccess(projectId, caseId);
  const { query, fresh } = access;
  const [open, setOpen] = useState(false),
    [revision, setRevision] = useState(0),
    [draft, setDraft] = useState<CaseFieldFormDraft | null>(null),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<CaseFieldReceipt<
    RouterInputs["caseFields"]["save"]
  > | null>(null);
  const save = trpcReact.caseFields.save.useMutation();
  const draftRef = useRef(draft),
    reasonRef = useRef(reason),
    confirmedRef = useRef(confirmed),
    pendingRef = useRef(pending),
    busyRef = useRef(false);
  const frameRef = useRef<{ projectId: string; caseId: string } | null>({
    projectId,
    caseId,
  });
  useLayoutEffect(() => {
    frameRef.current = { projectId, caseId };
    return () => {
      frameRef.current = null;
    };
  }, [projectId, caseId]);
  const updateDraft = useCallback((value: CaseFieldFormDraft | null) => {
    if (busyRef.current || pendingRef.current) return;
    draftRef.current = value;
    confirmedRef.current = false;
    setDraft(value);
    setConfirmed(false);
  }, []);
  useEffect(() => {
    if (!access.canEdit) {
      confirmedRef.current = false;
      setConfirmed(false);
    }
  }, [access.canEdit]);
  async function commit() {
    const retained = pendingRef.current,
      currentDraft = draftRef.current;
    const original = retained?.origin ?? access.origin;
    const ownsFrame = () =>
      !!original &&
      access.owns(original, "edit") &&
      frameRef.current?.projectId === original.projectId &&
      frameRef.current.caseId === original.caseId;
    if (
      busyRef.current ||
      save.isPending ||
      !access.canEdit ||
      !original ||
      !ownsFrame() ||
      (!retained &&
        (!currentDraft?.ready ||
          !fresh?.canEdit ||
          fresh.expectedSchemaHash !== currentDraft.expectedFieldSchemaHash ||
          fresh.expectedValueHash !==
            currentDraft.expectedCustomFieldRevision ||
          !reasonRef.current.trim() ||
          !confirmedRef.current))
    )
      return;
    const attempt = retained ?? {
      input: {
        projectId,
        caseId,
        values: structuredClone(currentDraft!.customFields),
        expectedSchemaHash: currentDraft!.expectedFieldSchemaHash,
        expectedValueHash: currentDraft!.expectedCustomFieldRevision,
        reason: reasonRef.current.trim(),
        confirmed: true as const,
        requestId: crypto.randomUUID(),
      },
      uncertain: false,
      origin: original,
    };
    busyRef.current = true;
    pendingRef.current = attempt;
    setPending(attempt);
    setNotice(null);
    try {
      const result = await save.mutateAsync(attempt.input);
      assertCaseFieldAcknowledgement(result, attempt.input.requestId);
      if (pendingRef.current !== attempt) return;
      pendingRef.current = null;
      setPending((current) => (current === attempt ? null : current));
      if (!ownsFrame() || draftRef.current !== currentDraft) return;
      setNotice(
        result.replayed
          ? "Confirmed the previous metadata save."
          : "Saved case metadata; existing retired values remain retained.",
      );
      void utils.caseFields.get.invalidate({ projectId, caseId });
      void utils.testCases.byId.invalidate({ id: caseId });
      setRevision((value) => value + 1);
      setReason("");
      setConfirmed(false);
      draftRef.current = null;
      reasonRef.current = "";
      confirmedRef.current = false;
      setOpen(false);
    } catch (error) {
      if (pendingRef.current === attempt) {
        const retainedRequest = retainedCaseFieldReceipt(attempt, error);
        pendingRef.current = retainedRequest;
        setPending((current) =>
          current === attempt ? retainedRequest : current,
        );
      }
      if (ownsFrame())
        setNotice(
          error instanceof Error
            ? error.message
            : "Save could not be confirmed; retry the exact request.",
        );
    } finally {
      busyRef.current = false;
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
      {access.canEdit &&
        (!pending || sameCaseFieldOrigin(pending.origin, access.current)) && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
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
      {access.readable && notice && <p role="status">{notice}</p>}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit project case fields"
        dismissible={!save.isPending}
        keepMounted
      >
        <div hidden={!!pending || !access.readable}>
          <CaseCustomFieldsForm
            key={`${caseId}:${revision}`}
            projectId={projectId}
            caseId={caseId}
            active={open && access.authReady && !pending && !save.isPending}
            onChange={updateDraft}
          />
        </div>
        {!pending && access.readable && (
          <>
            <label>
              Reason (required)
              <input
                value={reason}
                maxLength={1000}
                onChange={(event) => {
                  if (busyRef.current || pendingRef.current) return;
                  reasonRef.current = event.target.value;
                  confirmedRef.current = false;
                  setReason(event.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => {
                  if (busyRef.current || pendingRef.current) return;
                  confirmedRef.current = event.target.checked;
                  setConfirmed(event.target.checked);
                }}
              />{" "}
              I reviewed these metadata changes.
            </label>
          </>
        )}
        {pending?.uncertain &&
          sameCaseFieldOrigin(pending.origin, access.current) && (
            <p role="status">
              Request {pending.input.requestId} is retained. Retry this exact
              request to confirm whether it committed.
            </p>
          )}
        {access.readable && notice && <p role="alert">{notice}</p>}
        {access.readable && (
          <button
            type="button"
            className="btn-primary"
            disabled={
              save.isPending ||
              !access.canEdit ||
              (!!pending &&
                !sameCaseFieldOrigin(pending.origin, access.current)) ||
              (!pending &&
                (!draft?.ready ||
                  !fresh?.canEdit ||
                  fresh.expectedSchemaHash !== draft.expectedFieldSchemaHash ||
                  fresh.expectedValueHash !==
                    draft.expectedCustomFieldRevision ||
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
        )}
        {!access.readable && (
          <p role="status">
            This draft and any uncertain save remain retained for the original
            account. Refresh its project access before viewing or retrying.
          </p>
        )}
      </Modal>
    </section>
  );
}
