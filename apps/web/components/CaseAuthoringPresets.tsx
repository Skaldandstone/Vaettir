"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import {
  retainedTraceabilityReceipt,
  type TraceabilityReceipt,
} from "@/lib/traceability-receipt";
import { inspectorLabel } from "@/lib/case-inspector";
import { moveListItem } from "@/lib/move-list-item";
import { resolveQualityExperience } from "@vaettir/core";
import { Modal } from "./Modal";
import TestCaseForm from "./TestCaseForm";
import { CaseDesignGuide } from "./CaseDesignGuide";
import { CaseProcedureColumns } from "./CaseProcedureColumns";
type Catalog = RouterOutputs["caseAuthoringPresets"]["list"];
type Definition =
  RouterOutputs["caseAuthoringPresets"]["get"]["value"]["definition"];
type Review = RouterInputs["caseAuthoringPresets"]["preview"];
type Write = RouterInputs["caseAuthoringPresets"]["write"];
type Prefill = RouterOutputs["caseAuthoringPresets"]["confirmPrefill"];
type ExpectedScope = NonNullable<Write["expectedScope"]>;
function useReviewEpoch(available: boolean) {
  const [state, setState] = useState({ available, epoch: 0 });
  const epoch = state.available === available ? state.epoch : state.epoch + 1;
  if (state.available !== available) setState({ available, epoch });
  return epoch;
}
function usePresetAccess(projectId: string, organizationId: string) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [origin, setOrigin] = useState<ExpectedScope | null>(null);
  const project = trpcReact.project.byId.useQuery({ id: projectId }, { retry: false, staleTime: 0, refetchOnMount: "always" });
  const organizations = trpcReact.organization.mine.useQuery(undefined, { retry: false, staleTime: 0, refetchOnMount: "always" });
  const projectReady = !project.isError && project.isFetchedAfterMount && project.fetchStatus === "idle" && project.data?.id === projectId && project.data.organizationId === organizationId;
  const member = !organizations.isError && organizations.isFetchedAfterMount && organizations.fetchStatus === "idle"
    ? organizations.data?.find(row => row.id === organizationId) : undefined;
  const actorReady = isLoaded && isSignedIn && !!userId;
  useEffect(() => {
    if (!origin && actorReady && projectReady && member) setOrigin({ organizationId, clerkActorId: userId! });
  }, [origin, actorReady, projectReady, member, organizationId, userId]);
  const ready = !!origin && actorReady && projectReady && !!member && origin.organizationId === organizationId && origin.clerkActorId === userId;
  return { ready, expectedScope: origin ?? undefined, matches: (value: { projectId: string; organizationId: string; clerkActorId: string } | undefined) =>
    ready && value?.projectId === projectId && value.organizationId === origin!.organizationId && value.clerkActorId === origin!.clerkActorId,
    retry: () => Promise.all([project.refetch(), organizations.refetch()]) };
}
const control = {
  display: "block",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  marginTop: 4,
} as const;
const blank = (): Definition => ({
  version: 1,
  titleSuggestion: "",
  background: "",
  given: [],
  when: [],
  then: [],
  steps: [],
  testType: "FUNCTIONAL",
  priority: "MEDIUM",
  tags: [],
  validationDomain: "SOFTWARE",
  verificationProfile: {
    setup: "",
    safety: "",
    instruments: "",
    acceptanceCriteria: "",
  },
  customFields: {},
  applicability: null,
});
function CurrentProfile({ experience }: { experience: Catalog["experience"] }) {
  return (
    <details>
      <summary>Current project profile to compare (advisory)</summary>
      {experience ? (
        <>
          <p>{resolveQualityExperience(experience).title}</p>
          <dl>
            {Object.entries(experience)
              .filter(([key]) => key !== "version")
              .map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {inspectorLabel(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}
                  </dt>
                  <dd>
                    {Array.isArray(value)
                      ? value.join(", ") || "Not selected"
                      : String(value)}
                  </dd>
                </div>
              ))}
          </dl>
        </>
      ) : (
        <p>
          No granular project profile is saved. No domain, framework or
          regulatory applicability is inferred.
        </p>
      )}
    </details>
  );
}
function PresetProcedure({
  definition,
  fieldSchema,
}: {
  definition: Definition;
  fieldSchema: Catalog["fieldSchema"];
}) {
  return (
    <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <h4>Title suggestion</h4>
      <p>{definition.titleSuggestion || "Must be authored for the new case"}</p>
      <p>
        {inspectorLabel(definition.testType)} ·{" "}
        {inspectorLabel(definition.priority)} ·{" "}
        {inspectorLabel(definition.validationDomain)}
      </p>
      <h4>Preconditions / setup</h4>
      <p style={{ whiteSpace: "pre-wrap" }}>
        {definition.background || "Not supplied"}
      </p>
      {(["given", "when", "then"] as const).map((phase) => (
        <section key={phase}>
          <h4>{inspectorLabel(phase)}</h4>
          {definition[phase].length ? (
            <ol>
              {definition[phase].map((item, index) => (
                <li key={index} style={{ whiteSpace: "pre-wrap" }}>
                  {item}
                </li>
              ))}
            </ol>
          ) : (
            <p>Not supplied</p>
          )}
        </section>
      ))}
      <h4>Ordered action / expected columns</h4>
      {definition.steps.length ? (
        <CaseProcedureColumns steps={definition.steps} />
      ) : (
        <p>
          Must be authored if no complete Given / When / Then procedure is
          supplied
        </p>
      )}
      <p>Tags: {definition.tags.join(", ") || "None"}</p>
      <dl>
        {Object.entries(definition.verificationProfile).map(([key, value]) => (
          <div key={key}>
            <dt>{inspectorLabel(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>
              {value || "Not supplied"}
            </dd>
          </div>
        ))}
        {Object.entries(definition.customFields).map(([key, value]) => (
          <div key={key}>
            <dt>
              {fieldSchema.fields.find((f) => f.key === key)?.label ?? key}
            </dt>
            <dd>
              {value === null
                ? "Must be filled"
                : typeof value === "boolean"
                  ? value
                    ? "Yes"
                    : "No"
                  : String(value)}
            </dd>
          </div>
        ))}
      </dl>
      <h4>Advisory applicability</h4>
      {definition.applicability ? (
        <>
          <p>{resolveQualityExperience(definition.applicability).title}</p>
          <dl>
            {Object.entries(definition.applicability)
              .filter(([key]) => key !== "version")
              .map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {inspectorLabel(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}
                  </dt>
                  <dd>
                    {Array.isArray(value)
                      ? value.join(", ") || "Not selected"
                      : String(value)}
                  </dd>
                </div>
              ))}
          </dl>
        </>
      ) : (
        <p>Any project profile, subject to human review</p>
      )}
    </div>
  );
}
function PresetEditor({
  value,
  onChange,
  catalog,
}: {
  value: Definition;
  onChange: (value: Definition) => void;
  catalog: Catalog;
}) {
  const set = <K extends keyof Definition>(key: K, next: Definition[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <CaseDesignGuide />
      <label>
        Title suggestion (optional)
        <input
          style={control}
          maxLength={10000}
          value={value.titleSuggestion}
          onChange={(e) => set("titleSuggestion", e.target.value)}
        />
      </label>
      <label>
        Preconditions / setup (separate from executable steps)
        <textarea
          style={control}
          rows={3}
          maxLength={10000}
          value={value.background}
          onChange={(e) => set("background", e.target.value)}
        />
      </label>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
          gap: 12,
        }}
      >
        <label>
          Type
          <select
            style={control}
            value={value.testType}
            onChange={(e) =>
              set("testType", e.target.value as Definition["testType"])
            }
          >
            {[
              "UNIT",
              "FUNCTIONAL",
              "CONTRACT",
              "INSTRUMENTATION",
              "SMOKE",
              "SANITY",
              "REGRESSION",
              "E2E",
              "PERFORMANCE",
              "SECURITY",
              "ACCESSIBILITY",
              "EXPLORATORY",
              "COMPLIANCE",
              "OTHER",
            ].map((type) => (
              <option key={type} value={type}>
                {inspectorLabel(type)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            style={control}
            value={value.priority}
            onChange={(e) =>
              set("priority", e.target.value as Definition["priority"])
            }
          >
            {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((priority) => (
              <option key={priority} value={priority}>
                {inspectorLabel(priority)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Validation domain
          <select
            style={control}
            value={value.validationDomain}
            onChange={(e) =>
              set(
                "validationDomain",
                e.target.value as Definition["validationDomain"],
              )
            }
          >
            {[
              "SOFTWARE",
              "HARDWARE",
              "SYSTEM_INTEGRATION",
              "HIL",
              "MANUFACTURING",
              "MEDICAL_DEVICE",
              "PHARMA_LAB",
              "OTHER",
            ].map((domain) => (
              <option key={domain} value={domain}>
                {inspectorLabel(domain)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(["given", "when", "then"] as const).map((phase) => (
        <section key={phase}>
          <h4>{inspectorLabel(phase)}</h4>
          {value[phase].map((line, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 6,
              }}
            >
              <textarea
                aria-label={`${inspectorLabel(phase)} item ${index + 1}`}
                style={control}
                rows={2}
                maxLength={10000}
                value={line}
                onChange={(e) =>
                  set(
                    phase,
                    value[phase].map((current, i) =>
                      i === index ? e.target.value : current,
                    ),
                  )
                }
              />
              <button
                type="button"
                disabled={!index}
                aria-label={`Move ${phase} item ${index + 1} up`}
                onClick={() =>
                  set(phase, moveListItem(value[phase], index, index - 1))
                }
              >
                Move up
              </button>
              <button
                type="button"
                disabled={index === value[phase].length - 1}
                aria-label={`Move ${phase} item ${index + 1} down`}
                onClick={() =>
                  set(phase, moveListItem(value[phase], index, index + 1))
                }
              >
                Move down
              </button>
              <button
                type="button"
                onClick={() =>
                  set(
                    phase,
                    value[phase].filter((_, i) => i !== index),
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={value[phase].length >= 100}
            onClick={() => set(phase, [...value[phase], ""])}
          >
            Add {inspectorLabel(phase)} item
          </button>
        </section>
      ))}
      <section>
        <h4>Ordered structured steps</h4>
        <p>
          Up to 100 steps. This template has no media, dependency-case or
          shared-library references.
        </p>
        {value.steps.map((step, index) => (
          <fieldset key={index} style={{ minWidth: 0, marginBottom: 12 }}>
            <legend>Step {index + 1}</legend>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                gap: 10,
              }}
            >
              {(
                [
                  "action",
                  "expectedActionOrData",
                  "expectedResult",
                  "expectedResponse",
                ] as const
              ).map((column) => (
                <label key={column}>
                  {inspectorLabel(column.replace(/([a-z])([A-Z])/g, "$1 $2"))}
                  <textarea
                    style={control}
                    rows={3}
                    maxLength={10000}
                    value={step[column]}
                    onChange={(e) =>
                      set(
                        "steps",
                        value.steps.map((current, i) =>
                          i === index
                            ? { ...current, [column]: e.target.value }
                            : current,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 8,
              }}
            >
              <button
                type="button"
                disabled={!index}
                onClick={() => {
                  const steps = [...value.steps];
                  [steps[index - 1], steps[index]] = [
                    steps[index]!,
                    steps[index - 1]!,
                  ];
                  set("steps", steps);
                }}
              >
                Move up
              </button>
              <button
                type="button"
                disabled={index === value.steps.length - 1}
                onClick={() => {
                  const steps = [...value.steps];
                  [steps[index + 1], steps[index]] = [
                    steps[index]!,
                    steps[index + 1]!,
                  ];
                  set("steps", steps);
                }}
              >
                Move down
              </button>
              <button
                type="button"
                onClick={() =>
                  set(
                    "steps",
                    value.steps.filter((_, i) => i !== index),
                  )
                }
              >
                Remove step
              </button>
            </div>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={value.steps.length >= 100}
          onClick={() =>
            set("steps", [
              ...value.steps,
              {
                action: "",
                expectedActionOrData: "",
                expectedResult: "",
                expectedResponse: "",
              },
            ])
          }
        >
          Add structured step
        </button>
      </section>
      <section>
        <h4>Tags</h4>
        {value.tags.map((tag, index) => (
          <div key={index} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              aria-label={`Tag ${index + 1}`}
              style={control}
              maxLength={200}
              value={tag}
              onChange={(event) =>
                set(
                  "tags",
                  value.tags.map((old, i) =>
                    i === index ? event.target.value : old,
                  ),
                )
              }
            />
            <button
              type="button"
              onClick={() =>
                set(
                  "tags",
                  value.tags.filter((_, i) => i !== index),
                )
              }
            >
              Remove tag
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={value.tags.length >= 50}
          onClick={() => set("tags", [...value.tags, ""])}
        >
          Add tag
        </button>
      </section>
      {Object.entries(value.verificationProfile).map(([key, text]) => (
        <label key={key}>
          {inspectorLabel(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}
          <textarea
            style={control}
            rows={2}
            maxLength={10000}
            value={text}
            onChange={(e) =>
              set("verificationProfile", {
                ...value.verificationProfile,
                [key]: e.target.value,
              })
            }
          />
        </label>
      ))}
      <section>
        <h4>Typed human defaults (optional)</h4>
        <p>
          Required fields without a preset default must be filled for each new
          case. Defaults do not change project field definitions.
        </p>
        {catalog.fieldSchema.fields
          .filter((f) => !f.retired)
          .map((field) => (
            <label
              key={field.key}
              style={{ display: "block", marginBottom: 10 }}
            >
              {field.label}
              {field.required ? " (required on each case)" : ""}
              {field.type === "CHOICE" || field.type === "BOOLEAN" ? (
                <select
                  style={control}
                  value={
                    value.customFields[field.key] == null
                      ? ""
                      : String(value.customFields[field.key])
                  }
                  onChange={(e) =>
                    set("customFields", {
                      ...value.customFields,
                      [field.key]: !e.target.value
                        ? null
                        : field.type === "BOOLEAN"
                          ? e.target.value === "true"
                          : e.target.value,
                    })
                  }
                >
                  <option value="">Fill in each case</option>
                  {(field.type === "BOOLEAN"
                    ? ["true", "false"]
                    : field.options
                  ).map((option) => (
                    <option key={option} value={option}>
                      {field.type === "BOOLEAN"
                        ? option === "true"
                          ? "Yes"
                          : "No"
                        : option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  style={control}
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
                    typeof value.customFields[field.key] === "string" ||
                    typeof value.customFields[field.key] === "number"
                      ? String(value.customFields[field.key])
                      : ""
                  }
                  onChange={(e) =>
                    set("customFields", {
                      ...value.customFields,
                      [field.key]: !e.target.value
                        ? null
                        : field.type === "NUMBER"
                          ? Number(e.target.value)
                          : e.target.value,
                    })
                  }
                />
              )}
            </label>
          ))}
        {Object.keys(value.customFields).some(
          (key) =>
            !catalog.fieldSchema.fields.some(
              (f) => f.key === key && !f.retired,
            ),
        ) && (
          <div role="alert">
            <p>
              Retained defaults include an unavailable field. Edit its
              compatible active definition, or explicitly remove its default
              from the next preset revision before reviewing. Existing cases and
              prior receipts remain unchanged; no default will be silently
              removed.
            </p>
            {Object.entries(value.customFields)
              .filter(
                ([key]) =>
                  !catalog.fieldSchema.fields.some(
                    (field) => field.key === key && !field.retired,
                  ),
              )
              .map(([key, retained]) => (
                <div key={key}>
                  <p>
                    {key}: {retained === null ? "Not set" : String(retained)}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...value.customFields };
                      delete next[key];
                      set("customFields", next);
                    }}
                  >
                    Remove {key} default only from proposed revision
                  </button>
                </div>
              ))}
          </div>
        )}
      </section>
      <section>
        <h4>Granular applicability (advisory)</h4>
        {value.applicability ? (
          <p>
            {resolveQualityExperience(value.applicability).title}. Existing
            saved choices are retained until you explicitly replace them.
          </p>
        ) : (
          <p>Generic authoring scaffold.</p>
        )}
        <button
          type="button"
          disabled={!catalog.experience}
          onClick={() => set("applicability", catalog.experience)}
        >
          Use current project&apos;s complete profile
        </button>{" "}
        <button type="button" onClick={() => set("applicability", null)}>
          Make generic
        </button>
        {value.applicability && (
          <details>
            <summary>Review exact selected variants</summary>
            <PresetProcedure
              definition={{ ...blank(), applicability: value.applicability }}
              fieldSchema={catalog.fieldSchema}
            />
          </details>
        )}
      </section>
    </div>
  );
}
export function CaseAuthoringPresets({ projectId, organizationId }: { projectId: string; organizationId: string }) {
  const access = usePresetAccess(projectId, organizationId);
  const utils = trpcReact.useUtils();
  const [open, setOpen] = useState(false),
    [fresh, setFresh] = useState(false),
    [selection, setSelection] = useState(""),
    [name, setName] = useState(""),
    [definition, setDefinition] = useState<Definition>(blank),
    [loaded, setLoaded] = useState(false),
    [prepared, setPrepared] = useState<Review | null>(null),
    [reviewFresh, setReviewFresh] = useState(false),
    [reason, setReason] = useState(""),
    [approvedReview, setApprovedReview] = useState<{ value: RouterOutputs["caseAuthoringPresets"]["preview"]; epoch: number } | null>(null),
    [pending, setPending] = useState<Write | null>(null),
    [savedMessage, setSavedMessage] = useState("");
  const receipt = useRef<TraceabilityReceipt<Write> | null>(null);
  const live = useRef<{ ready: boolean; approved: unknown } | null>(null);
  const setApproved = (value: boolean) => setApprovedReview(value && reviewed ? { value: reviewed, epoch: reviewEpoch } : null);
  const catalog = trpcReact.caseAuthoringPresets.list.useQuery(
    { projectId, expectedScope: access.expectedScope },
    { enabled: open && access.ready, retry: false, staleTime: 0, refetchOnMount: "always" },
  );
  const preset = trpcReact.caseAuthoringPresets.get.useQuery(
    { projectId, presetId: selection || "placeholder", expectedScope: access.expectedScope },
    {
      enabled: open && access.ready && !!selection,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const history = trpcReact.caseAuthoringPresets.history.useQuery(
    { projectId, presetId: selection || "placeholder", expectedScope: access.expectedScope },
    {
      enabled: open && access.ready && !!selection,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const review = trpcReact.caseAuthoringPresets.preview.useQuery(
    prepared ?? {
      projectId,
      operation: "CREATE",
      name: "placeholder",
      definition: blank(),
    },
    {
      enabled: open && access.ready && !!prepared,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const mutation = trpcReact.caseAuthoringPresets.write.useMutation({
    onSuccess: (result) => {
      if (!live.current?.ready || !access.matches(result) || result.requestId !== receipt.current?.input.requestId) {
        // A response withheld after close/identity change may still be committed.
        // A later permission error cannot justify discarding its exact request.
        if (receipt.current) receipt.current = { ...receipt.current, uncertain: true };
        return;
      }
      receipt.current = null;
      setPending(null);
      setPrepared(null);
      setSavedMessage(
        `${result.replayed ? "Recovered saved" : "Acknowledged saved"} ${result.value.name}, revision ${result.value.version}. Your human definition draft is retained. Current catalog refresh is separate.`,
      );
      setFresh(false);
      void utils.caseAuthoringPresets.invalidate().then(() => catalog.refetch()).then(result => {
        if (result.isError) throw new Error("Independent preset refresh unavailable");
        setFresh(true);
      }).catch(() => setSavedMessage(previous => `${previous} Refresh failed; retry current access without repeating the acknowledged write.`));
    },
    onError: (error) => {
      if (!receipt.current) return;
      receipt.current = retainedTraceabilityReceipt(receipt.current, error);
      setPending(receipt.current?.input ?? null);
      if (!receipt.current) {
        setApproved(false);
        setReviewFresh(false);
      }
    },
  });
  const { refetch: refreshCatalog } = catalog;
  useEffect(() => {
    let active = true;
    if (open && access.ready)
      void refreshCatalog().then((r) => {
        if (active && !r.isError) setFresh(true);
      });
    return () => {
      active = false;
    };
  }, [open, access.ready, refreshCatalog]);
  const { refetch: refreshReview } = review;
  useEffect(() => {
    let active = true;
    if (open && access.ready && prepared)
      void refreshReview().then((r) => {
        if (active && !r.isError) setReviewFresh(true);
      });
    return () => {
      active = false;
    };
  }, [open, access.ready, prepared, refreshReview]);
  const current =
    open && access.ready && fresh &&
    !catalog.isError &&
    catalog.isFetchedAfterMount &&
    catalog.fetchStatus === "idle" && access.matches(catalog.data)
      ? catalog.data
      : null;
  const reviewed =
    !!current?.canManage && reviewFresh &&
    !review.isError &&
    review.isFetchedAfterMount &&
    review.fetchStatus === "idle" && access.matches(review.data)
      ? review.data
      : null;
  const currentPreset =
    !!current?.canManage && !preset.isError &&
    preset.isFetchedAfterMount &&
    preset.fetchStatus === "idle" &&
    preset.data?.value.presetId === selection && access.matches(preset.data)
      ? preset.data
      : null;
  const rows =
    !!current?.canManage && !history.isError &&
    history.isFetchedAfterMount &&
    history.fetchStatus === "idle" && access.matches(history.data)
      ? history.data
      : null;
  const reviewEpoch = useReviewEpoch(!!reviewed);
  const approved = !!reviewed && approvedReview?.value === reviewed && approvedReview.epoch === reviewEpoch;
  const canManageCurrent = !!current?.canManage;
  useLayoutEffect(() => {
    live.current = { ready: canManageCurrent, approved: reviewed };
    return () => { live.current = null; };
  }, [canManageCurrent, reviewed, reviewEpoch]);
  useEffect(() => { if (!reviewed) setApprovedReview(null); }, [reviewed]);
  const close = () => {
    live.current = null;
    setApprovedReview(null);
    setOpen(false);
    setFresh(false);
    setReviewFresh(false);
  };
  const prepare = (next: Review) => {
    if (!current?.canManage || pending) return;
    setPrepared({ ...next, expectedScope: access.expectedScope });
    setReviewFresh(false);
    setReason("");
    setApproved(false);
    mutation.reset();
  };
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFresh(false);
          setReviewFresh(false);
          setOpen(true);
        }}
      >
        Manage authoring presets
      </button>
      {access.ready && savedMessage && <p role="status">{savedMessage}</p>}
      <Modal
        open={open}
        onClose={close}
        title="Controlled case authoring presets"
        size="wide"
      >
        {!current ? (
          <div role={catalog.isError ? "alert" : "status"}>
            <p>
              {catalog.isError
                ? catalog.error.message
                : "Checking current project access…"}
            </p>
            <button
              onClick={() =>
                void access.retry().then(() => catalog.refetch()).then((r) => {
                  if (!r.isError) setFresh(true);
                })
              }
            >
              Retry current access
            </button>
          </div>
        ) : !current.canManage ? (
          <p role="alert">
            A current full Owner or Admin seat is required. Editors can use
            active presets to start new reviewed drafts.
          </p>
        ) : !prepared ? (
          <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
            <p>{current.notice}</p>
            <p>
              Up to 50 retained presets, including archived identities; each
              complete definition is limited to 256 KiB, 100 items per Given /
              When / Then phase and 100 structured steps. Typed defaults retain
              the separate 64 KiB case metadata limit. History shows the latest
              25 immutable changes; no prior records are deleted.
            </p>
            <label>
              Preset
              <select
                style={control}
                value={selection}
                disabled={loaded}
                onChange={(e) => {
                  setSelection(e.target.value);
                  setLoaded(false);
                }}
              >
                <option value="">Create a new preset</option>
                {current.items.map((item) => (
                  <option key={item.presetId} value={item.presetId}>
                    {item.name} · revision {item.version}
                    {item.archived ? " · Archived" : ""}
                  </option>
                ))}
              </select>
            </label>
            {!loaded ? (
              <>
                {!selection ? (
                  <button
                    onClick={() => {
                      setName("");
                      setDefinition(blank());
                      setLoaded(true);
                    }}
                  >
                    Start separate empty definition
                  </button>
                ) : (
                  <>
                    {preset.isError && (
                      <p role="alert">{preset.error.message}</p>
                    )}
                    <button
                      disabled={!currentPreset || currentPreset.value.archived}
                      onClick={() => {
                        if (currentPreset) {
                          setName(currentPreset.value.name);
                          setDefinition(currentPreset.value.definition);
                          setLoaded(true);
                        }
                      }}
                    >
                      Load retained definition for editing
                    </button>
                    {currentPreset && (
                      <>
                        <p>
                          Stable identity: {currentPreset.value.presetId},
                          revision {currentPreset.value.version}
                          {currentPreset.value.archived ? " (archived)" : ""}
                        </p>
                        <button
                          onClick={() =>
                            prepare({
                              projectId,
                              presetId: selection,
                              operation: currentPreset.value.archived
                                ? "UNARCHIVE"
                                : "ARCHIVE",
                            })
                          }
                        >
                          {currentPreset.value.archived
                            ? "Review unarchive"
                            : "Review archive"}
                        </button>
                        <details>
                          <summary>
                            Retained revision history / reviewed recovery
                          </summary>
                          {history.isError ? (
                            <p role="alert">
                              {history.error.message}
                              <button onClick={() => void history.refetch()}>
                                Retry history
                              </button>
                            </p>
                          ) : !rows ? (
                            <p role="status">Loading retained receipts…</p>
                          ) : (
                            <>
                              <p>{rows.limitation}</p>
                              {rows.items.map((item) => (
                                <details key={item.receiptId}>
                                  <summary>
                                    Revision {item.receipt.after.version} ·{" "}
                                    {inspectorLabel(item.receipt.operation)} ·{" "}
                                    {item.recordedAt}
                                  </summary>
                                  <p>Recorded actor ID: {item.actorId}</p>
                                  <p>Reason: {item.receipt.reason}</p>
                                  <PresetProcedure
                                    definition={item.receipt.after.definition}
                                    fieldSchema={current.fieldSchema}
                                  />
                                  <button
                                    onClick={() =>
                                      prepare({
                                        projectId,
                                        presetId: selection,
                                        operation: "RESTORE",
                                        restoreReceiptId: item.receiptId,
                                      })
                                    }
                                  >
                                    Review this content as a new revision
                                  </button>
                                </details>
                              ))}
                            </>
                          )}
                        </details>
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <p>
                  Your definition is retained through close/reopen. Other
                  selections cannot overwrite it.
                </p>
                <label>
                  Preset name (required)
                  <input
                    style={control}
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <PresetEditor
                  value={definition}
                  onChange={setDefinition}
                  catalog={current}
                />
                <button
                  className="btn-primary"
                  disabled={!name.trim() || !!currentPreset?.value.archived}
                  onClick={() =>
                    prepare({
                      projectId,
                      operation: selection ? "UPDATE" : "CREATE",
                      ...(selection ? { presetId: selection } : {}),
                      name,
                      definition,
                    })
                  }
                >
                  Review complete preset
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => {
                      if (
                        window.confirm(
                          "Discard only this local definition draft? Retained server revisions are unchanged.",
                        )
                      ) {
                        setLoaded(false);
                        setSelection("");
                        setName("");
                        setDefinition(blank());
                      }
                    }}
                  />
                  Discard local definition draft
                </label>
              </>
            )}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
            {review.isError ? (
              <div role="alert">
                <p>{review.error.message}</p>
                <button
                  onClick={() =>
                    void review.refetch().then((r) => {
                      if (!r.isError) setReviewFresh(true);
                    })
                  }
                >
                  Retry complete review
                </button>
              </div>
            ) : !reviewed ? (
              <p role="status">
                Comparing current revision, field schema and granular profile…
              </p>
            ) : (
              <>
                <p>
                  {inspectorLabel(prepared.operation)} {reviewed.name} as
                  revision {reviewed.nextVersion},{" "}
                  {reviewed.nextArchived ? "archived" : "active"}. Original
                  receipts and existing cases/runs remain unchanged.
                </p>
                {reviewed.warnings.map((warning, index) => (
                  <p key={index}>{warning}</p>
                ))}
                {!reviewed.applicabilityMatches && (
                  <p role="alert">
                    Profile mismatch must be explicitly considered before
                    approval.
                  </p>
                )}
                <CurrentProfile experience={reviewed.currentExperience} />
                {reviewed.requiredFields.length > 0 && (
                  <ul>
                    {reviewed.requiredFields.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                )}
                <details>
                  <summary>Compare current retained procedure</summary>
                  {reviewed.current ? (
                    <PresetProcedure
                      definition={reviewed.current.definition}
                      fieldSchema={reviewed.fieldSchema}
                    />
                  ) : (
                    <p>New identity, no prior revision.</p>
                  )}
                </details>
                <details open>
                  <summary>
                    Review complete proposed procedure and defaults
                  </summary>
                  <PresetProcedure
                    definition={reviewed.definition}
                    fieldSchema={reviewed.fieldSchema}
                  />
                </details>
                <label>
                  Reason (required)
                  <textarea
                    style={control}
                    rows={3}
                    value={reason}
                    disabled={!!pending}
                    maxLength={1000}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={approved}
                    disabled={!!pending}
                    onChange={(e) => setApproved(e.target.checked)}
                  />
                  I reviewed the full content, profile applicability, missing
                  fields and evidence limitations.
                </label>
              </>
            )}
            {mutation.isError && (
              <p role="alert">
                {mutation.error.message}{" "}
                {pending
                  ? "An earlier attempt may have completed. Retain and retry its exact approved request, not a new identity."
                  : "Your local definition is retained; review a fresh baseline before trying again."}
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                disabled={!!pending}
                onClick={() => {
                  setPrepared(null);
                  setReviewFresh(false);
                  mutation.reset();
                }}
              >
                Back to retained draft
              </button>
              <button
                className="btn-primary"
                disabled={
                  !current?.canManage || mutation.isPending ||
                  (!pending && (!reviewed || !approved || !reason.trim()))
                }
                onClick={() => {
                  if (!live.current?.ready) return;
                  if (pending) {
                    mutation.mutate(pending);
                    return;
                  }
                  if (!prepared || !reviewed || !approved || !reason.trim()) return;
                  const input: Write = {
                    ...prepared,
                    expectedHash: reviewed.expectedHash,
                    requestId: crypto.randomUUID(),
                    confirmed: true,
                    reason,
                  };
                  receipt.current = { input, uncertain: false };
                  setPending(input);
                  mutation.mutate(input);
                }}
              >
                {mutation.isPending
                  ? "Saving…"
                  : pending
                    ? "Retry exact approved change"
                    : "Approve new preset revision"}
              </button>
            </div>
          </div>
        )}
        <button style={{ marginTop: 12 }} onClick={close}>
          Close
        </button>
      </Modal>
    </>
  );
}
export function NewCaseFromAuthoringPreset({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  const access = usePresetAccess(projectId, organizationId);
  const draftReceipt = useRef<{ key: string; value: Prefill } | null>(null);
  const [open, setOpen] = useState(false),
    [fresh, setFresh] = useState(false),
    [selected, setSelected] = useState(""),
    [prepared, setPrepared] = useState(""),
    [reviewFresh, setReviewFresh] = useState(false),
    [approvedReview, setApprovedReview] = useState<{ value: Prefill; epoch: number } | null>(null),
    [draft, setDraft] = useState<{ key: string; value: Prefill } | null>(null);
  const catalog = trpcReact.caseAuthoringPresets.list.useQuery(
    { projectId, expectedScope: access.expectedScope },
    {
      enabled: open && access.ready,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const review = trpcReact.caseAuthoringPresets.reviewPrefill.useQuery(
    { projectId, presetId: prepared || "placeholder", expectedScope: access.expectedScope },
    {
      enabled: open && access.ready && !!prepared && !draft,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    },
  );
  const live = useRef<{ available: boolean; epoch: number; reviewed: Prefill | null } | null>(null);
  const attempt = useRef<{ epoch: number; reviewed: Prefill; expectedHash: string } | null>(null);
  const mutation = trpcReact.caseAuthoringPresets.confirmPrefill.useMutation({
    onSuccess: (value) => {
      if (draftReceipt.current || !live.current?.available || !attempt.current ||
          live.current.epoch !== attempt.current.epoch || live.current.reviewed !== attempt.current.reviewed ||
          value.expectedHash !== attempt.current.expectedHash || !access.matches(value)) return;
      const next = { key: crypto.randomUUID(), value };
      draftReceipt.current = next;
      setDraft(next);
    },
  });
  const { refetch: refreshCatalog } = catalog;
  useEffect(() => {
    let active = true;
    if (open && access.ready)
      void refreshCatalog().then((r) => {
        if (active && !r.isError) setFresh(true);
      });
    return () => {
      active = false;
    };
  }, [open, access.ready, draft, refreshCatalog]);
  const { refetch: refreshReview } = review;
  useEffect(() => {
    let active = true;
    if (open && access.ready && prepared && !draft)
      void refreshReview().then((r) => {
        if (active && !r.isError) setReviewFresh(true);
      });
    return () => {
      active = false;
    };
  }, [open, access.ready, prepared, draft, refreshReview]);
  const current =
    open && access.ready && fresh &&
    !catalog.isError &&
    catalog.isFetchedAfterMount &&
    catalog.fetchStatus === "idle" && access.matches(catalog.data)
      ? catalog.data
      : null;
  const reviewed =
    !!current?.canEdit && !draft && reviewFresh &&
    !review.isError &&
    review.isFetchedAfterMount &&
    review.fetchStatus === "idle" && access.matches(review.data) && review.data?.value.presetId === prepared
      ? review.data
      : null;
  const reviewEpoch = useReviewEpoch(!!reviewed);
  const approved = !!reviewed && approvedReview?.value === reviewed && approvedReview.epoch === reviewEpoch;
  const setApproved = (value: boolean) => setApprovedReview(value && reviewed ? { value: reviewed, epoch: reviewEpoch } : null);
  useLayoutEffect(() => {
    live.current = { available: !!reviewed, epoch: reviewEpoch, reviewed };
    return () => { live.current = null; };
  }, [reviewed, reviewEpoch]);
  useEffect(() => { if (!reviewed) setApprovedReview(null); }, [reviewed]);
  const draftActive = open && !!current?.canEdit && !!draft && access.matches(draft.value);
  const close = () => {
    live.current = null;
    attempt.current = null;
    setApprovedReview(null);
    setOpen(false);
    setFresh(false);
    setReviewFresh(false);
  };
  return (
    <>
      <button
        onClick={() => {
          setFresh(false);
          setReviewFresh(false);
          setOpen(true);
        }}
      >
        {draft ? "Resume preset case draft" : "New case from preset"}
      </button>
      <Modal
        open={open}
        onClose={close}
        title={
          draft
            ? "Review and complete new case draft"
            : "Start a separate case draft from a preset"
        }
        size="wide"
        keepMounted={!!draft}
      >
        {draft ? (
          <>
            {!draftActive && <div role="alert"><p>Current original-organization editor access is unavailable. The human draft is retained but hidden; retry access without replacing it.</p><button onClick={() => void access.retry().then(() => catalog.refetch()).then(r => { if (!r.isError) setFresh(true); })}>Retry original draft access</button></div>}
            <div hidden={!draftActive} ref={(element) => { if (element) element.inert = !draftActive; }} style={!draftActive ? { display: "none" } : undefined}>
            <p>
              Separate local draft from {draft.value.value.name}, revision{" "}
              {draft.value.value.version}. It is not an approved case and
              contains no old execution/evidence. Later preset edits do not
              overwrite this human draft.
            </p>
            {draft.value.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
            {current && draft.value.profileHash !== current.profileHash && <p role="alert">The project profile changed after this separate draft was reviewed. Its original prefill and your edits remain unchanged; review current applicability again. This is not a regulatory or console TRC qualification.</p>}
            {current && draft.value.fieldSchemaHash !== current.fieldSchemaHash && <p role="alert">The current human field schema changed. Retained defaults are not silently reapplied or discarded; review the form&apos;s current field compatibility before saving.</p>}
            {current && <CurrentProfile experience={current.experience} />}
            <TestCaseForm
              key={draft.key}
              mode="create"
              projectId={projectId}
              active={draftActive}
              initial={{
                title: draft.value.value.definition.titleSuggestion,
                background: draft.value.value.definition.background,
                testType: draft.value.value.definition.testType,
                priority: draft.value.value.definition.priority,
                tags: draft.value.value.definition.tags,
                given: draft.value.value.definition.given,
                when: draft.value.value.definition.when,
                then: draft.value.value.definition.then,
                steps: draft.value.value.definition.steps.map((step) => ({
                  ...step,
                  mediaAttachmentIds: [],
                })),
                validationDomain: draft.value.value.definition.validationDomain,
                verificationProfile:
                  draft.value.value.definition.verificationProfile,
              }}
              initialCustomFields={{
                values: draft.value.value.definition.customFields,
                expectedSchemaHash: draft.value.fieldSchemaHash,
              }}
            />
            <p>
              Case creation remains a separate existing workflow. No template
              usage link or execution proof is asserted.
            </p>
            <p>
              Closing this module retains edits in this open workspace only.
              Reloading or leaving the page can lose an unsaved draft; no
              durable case-save or reload guarantee is claimed.
            </p>
            </div>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "Discard this unsaved case draft? Server presets and cases remain unchanged.",
                  )
                ) {
                  draftReceipt.current = null;
                  setDraft(null);
                  setPrepared("");
                  setSelected("");
                  setApproved(false);
                  setReviewFresh(false);
                  setFresh(false);
                  mutation.reset();
                }
              }}
            >
              Discard only local case draft
            </button>
          </>
        ) : !current ? (
          <div role={catalog.isError ? "alert" : "status"}>
            <p>
              {catalog.isError
                ? catalog.error.message
                : "Checking current full-editor access…"}
            </p>
            <button
              onClick={() =>
                void access.retry().then(() => catalog.refetch()).then((r) => {
                  if (!r.isError) setFresh(true);
                })
              }
            >
              Retry current access
            </button>
          </div>
        ) : !current.canEdit ? (
          <p role="alert">
            A current full editor seat is required to start a new case draft.
          </p>
        ) : !prepared ? (
          <>
            <p>
              Choose one current preset. This starts a separately reviewed fresh
              draft; it does not replace any case or another open authoring
              form.
            </p>
            <label>
              Active preset
              <select
                style={control}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Choose a preset…</option>
                {current.items
                  .filter((item) => !item.archived)
                  .map((item) => (
                    <option key={item.presetId} value={item.presetId}>
                      {item.name} · revision {item.version}
                    </option>
                  ))}
              </select>
            </label>
            {!current.items.some((item) => !item.archived) && (
              <p>No active presets. Ask an Owner/Admin to author one.</p>
            )}
            <button
              disabled={!selected}
              onClick={() => {
                setPrepared(selected);
                setApproved(false);
                setReviewFresh(false);
                mutation.reset();
              }}
            >
              Review complete prefill
            </button>
          </>
        ) : (
          <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
            {review.isError ? (
              <div role="alert">
                <p>{review.error.message}</p>
                <button
                  onClick={() =>
                    void review.refetch().then((r) => {
                      if (!r.isError) setReviewFresh(true);
                    })
                  }
                >
                  Retry fresh review
                </button>
              </div>
            ) : !reviewed ? (
              <p role="status">
                Checking current preset, typed fields and profile…
              </p>
            ) : (
              <>
                <p>
                  {reviewed.value.name} · revision {reviewed.value.version}
                </p>
                {reviewed.warnings.map((warning, index) => (
                  <p key={index}>{warning}</p>
                ))}
                {!reviewed.applicabilityMatches && (
                  <p role="alert">
                    This preset&apos;s exact selected profile differs from this
                    project. Continue only after reviewing this mismatch.
                  </p>
                )}
                <CurrentProfile experience={reviewed.currentExperience} />
                {reviewed.requiredFields.length > 0 && (
                  <ul>
                    {reviewed.requiredFields.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                )}
                <PresetProcedure
                  definition={reviewed.value.definition}
                  fieldSchema={reviewed.fieldSchema}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                  />
                  I reviewed the full scaffold, profile mismatch if any, missing
                  fields and lack of approval/evidence.
                </label>
              </>
            )}
            {mutation.isError && (
              <p role="alert">
                {mutation.error.message} No existing draft was replaced.
              </p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                disabled={mutation.isPending}
                onClick={() => {
                  setPrepared("");
                  setApproved(false);
                  setReviewFresh(false);
                  mutation.reset();
                }}
              >
                Back
              </button>
              <button
                className="btn-primary"
                disabled={!reviewed || !approved || mutation.isPending}
                onClick={() => {
                  if (draftReceipt.current || draft || !reviewed || !approved || !live.current?.available) return;
                  attempt.current = { epoch: reviewEpoch, reviewed, expectedHash: reviewed.expectedHash };
                  mutation.mutate({
                    projectId,
                    expectedScope: access.expectedScope,
                    presetId: prepared,
                    expectedHash: reviewed.expectedHash,
                    confirmed: true,
                  });
                }}
              >
                {mutation.isPending
                  ? "Rechecking…"
                  : "Start separate reviewed draft"}
              </button>
            </div>
          </div>
        )}
        <button onClick={close} style={{ marginTop: 12 }}>
          Close and retain local draft
        </button>
      </Modal>
    </>
  );
}
