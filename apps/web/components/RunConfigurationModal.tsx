"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  GAME_PLATFORMS,
  resolveQualityExperience,
  type ExperienceProfile,
} from "@vaettir/core";
import { trpcReact } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { useManualExecutionAccess } from "@/lib/use-manual-execution-access";
import { retainAnalysisRequest } from "@/lib/analysis-request-recovery";
import {
  MAX_MANUAL_CASES,
  freezeRunConfiguration,
  reviewedRunCasesMatch,
  runConfigurationScopeMatches,
  verifiedRunConfigurationAck,
  type RunExecutionContext,
  type ReviewedRunConfiguration,
} from "@/lib/run-configuration-request";
import { Modal } from "./Modal";
export type {
  RunExecutionContext,
  ReviewedRunConfiguration,
} from "@/lib/run-configuration-request";
type Field = {
  key: keyof RunExecutionContext;
  label: string;
  help?: string;
  long?: boolean;
};
type Screen = { id: string; title: string; fields: Field[] };
const labels: Record<keyof RunExecutionContext, string> = {
  configuration: "Configuration / variant",
  platform: "Platform / device",
  build: "Build / revision",
  hardwareRevision: "Hardware revision",
  firmwareVersion: "Firmware version",
  rig: "Rig / simulator reference",
  batchOrLot: "Batch / lot / controlled sample reference",
  environment: "Execution environment",
  calibrationReference: "Instrument / calibration reference",
  protocolReference: "Approved protocol / method reference",
};
const emptyContext = (): RunExecutionContext => ({
  configuration: "",
  platform: "",
  build: "",
  hardwareRevision: "",
  firmwareVersion: "",
  rig: "",
  batchOrLot: "",
  environment: "",
  calibrationReference: "",
  protocolReference: "",
});

function screensFor(profile: ExperienceProfile | null): Screen[] {
  const offerings = new Set<string>(profile?.offerings);
  const hardware = ["HARDWARE", "HIL", "MANUFACTURING"].some((id) =>
    offerings.has(id),
  );
  const process = [
    "FOOD_SAFETY",
    "CLINICAL",
    "LABORATORY",
    "MANUFACTURING",
  ].some((id) => offerings.has(id));
  const screens: Screen[] = [
    {
      id: "configuration",
      title: "Which configuration will this record cover?",
      fields: [
        { key: "configuration", label: labels.configuration, long: true },
        { key: "platform", label: labels.platform },
        { key: "build", label: labels.build },
      ],
    },
  ];
  if (hardware)
    screens.push({
      id: "hardware",
      title: "Which device and rig will be tested?",
      fields: [
        { key: "hardwareRevision", label: labels.hardwareRevision },
        { key: "firmwareVersion", label: labels.firmwareVersion },
        {
          key: "rig",
          label: labels.rig,
          help: "Identify physical versus simulated equipment and its version.",
        },
        { key: "calibrationReference", label: labels.calibrationReference },
      ],
    });
  if (process)
    screens.push({
      id: "process",
      title: "Which lot, sample or procedure will be verified?",
      fields: [
        {
          key: "batchOrLot",
          label: labels.batchOrLot,
          help: "Use controlled identifiers, not patient or other personal information.",
        },
        {
          key: "protocolReference",
          label: labels.protocolReference,
          help: "Reference the approved procedure and version; entering a reference does not approve it.",
        },
        ...(!hardware
          ? [
              {
                key: "calibrationReference" as const,
                label: labels.calibrationReference,
              },
            ]
          : []),
      ],
    });
  screens.push({
    id: "environment",
    title: "Where and under what conditions?",
    fields: [
      {
        key: "environment",
        label: labels.environment,
        long: true,
        help: "Record the environment or operating conditions. Leave credentials and personal data out.",
      },
    ],
  });
  screens.push({
    id: "review",
    title: "Review the execution record",
    fields: [],
  });
  return screens;
}

export function RunConfigurationModal({
  open = true,
  projectId,
  caseCount,
  testCaseIds,
  onClose,
  onStart,
}: {
  open?: boolean;
  projectId: string;
  caseCount: number;
  testCaseIds: string[];
  onClose: () => void;
  onStart: (configuration: ReviewedRunConfiguration) => Promise<unknown>;
}) {
  const { loaded, canEdit, accessError, retryAccess } =
    useProjectPermissions(projectId);
  const access = useManualExecutionAccess(projectId);
  const accessNow = useRef(access);
  useLayoutEffect(() => {
    accessNow.current = access;
  }, [access]);
  const query = trpcReact.project.experience.useQuery(
    { projectId },
    { enabled: open && access.ready, staleTime: 0, retry: false },
  );
  const [baseline, setBaseline] = useState<{
    experience: ExperienceProfile | null;
    profileHash: string;
  } | null>(null);
  const [context, setContext] = useState<RunExecutionContext>(emptyContext);
  const [screenId, setScreenId] = useState("configuration");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewedCount, setReviewedCount] = useState<number | null>(null);
  const [reviewedIds, setReviewedIds] = useState<string[] | null>(null);
  const [pendingRequest, setPendingRequest] =
    useState<ReviewedRunConfiguration | null>(null);
  const everAmbiguous = useRef(false);
  const inFlight = useRef(false);
  const platformListId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  if (
    open &&
    access.ready &&
    query.data &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    baseline === null
  )
    setBaseline(query.data);
  const screens = screensFor(baseline?.experience ?? null);
  const index = Math.max(
    0,
    screens.findIndex((screen) => screen.id === screenId),
  );
  const screen = screens[index]!;
  const countValid =
    Number.isInteger(caseCount) &&
    caseCount > 0 &&
    caseCount <= MAX_MANUAL_CASES &&
    testCaseIds.length === caseCount;
  const displayedCount = pendingRequest?.testCaseIds.length ?? caseCount;
  const displayedContext = pendingRequest?.executionContext ?? context;
  const selectionReviewed =
    reviewedCount === caseCount &&
    reviewedRunCasesMatch(reviewedIds, testCaseIds);
  const experience = baseline?.experience
    ? resolveQualityExperience(baseline.experience)
    : null;
  useEffect(() => {
    headingRef.current?.focus();
  }, [screenId]);
  function next() {
    const nextScreen = screens[index + 1]!;
    if (nextScreen.id === "review") {
      setReviewedCount(caseCount);
      setReviewedIds([...testCaseIds]);
    }
    setScreenId(nextScreen.id);
  }
  async function start() {
    if (
      !baseline ||
      !access.canWrite ||
      !access.origin ||
      inFlight.current ||
      !canEdit ||
      busy ||
      refreshing ||
      (!pendingRequest && (!countValid || !selectionReviewed))
    )
      return;
    setBusy(true);
    inFlight.current = true;
    setError(null);
    let requestWasSubmitted = false;
    try {
      const request =
        pendingRequest ??
        freezeRunConfiguration(
          {
            projectId,
            testCaseIds,
            expectedProfileHash: baseline.profileHash,
            executionContext: context,
            originalOrganizationId: access.origin.organizationId,
            expectedClerkActorId: access.origin.clerkActorId,
          },
          crypto.randomUUID(),
        );
      if (
        !runConfigurationScopeMatches(request, {
          projectId,
          organizationId: access.origin.organizationId,
          clerkActorId: access.origin.clerkActorId,
        })
      )
        throw Error(
          "Restore the original run-start account and workspace before retrying. The retained request was not rebound.",
        );
      setPendingRequest(request);
      requestWasSubmitted = true;
      const acknowledgement = await onStart(request);
      if (!verifiedRunConfigurationAck(request, acknowledgement))
        throw Error(
          "The run acknowledgement did not match its original scope and UUID. The exact request remains retained for retry.",
        );
      const current = accessNow.current;
      if (
        !current.canWrite ||
        !current.origin ||
        !runConfigurationScopeMatches(request, {
          projectId,
          organizationId: current.origin.organizationId,
          clerkActorId: current.origin.clerkActorId,
        })
      )
        throw Error(
          "Restore original account and workspace access to confirm the acknowledged request. The retained request is unchanged.",
        );
      setPendingRequest(null);
      everAmbiguous.current = false;
      setReviewedCount(null);
      setReviewedIds(null);
    } catch (cause) {
      if (requestWasSubmitted) {
        const retain = retainAnalysisRequest(everAmbiguous.current, cause);
        everAmbiguous.current = retain;
        if (!retain) setPendingRequest(null);
      }
      setError(
        `${cause instanceof Error ? cause.message : "The execution record could not be started."} Your configuration is retained. No automatic retry was sent.`,
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  async function refreshContext() {
    if (pendingRequest || !access.ready) return;
    setRefreshing(true);
    setError(null);
    try {
      const result = await query.refetch();
      if (result.error || !result.data) {
        setError(
          "Project context could not be refreshed. Your configuration is retained.",
        );
        return;
      }
      setBaseline(result.data);
      setScreenId("configuration");
      setReviewedCount(null);
      setReviewedIds(null);
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <Modal
      open={open}
      keepMounted
      title="Configure execution record"
      onClose={onClose}
      dismissible={!busy && !refreshing}
    >
      {!access.ready ? (
        <section role="status">
          <p>
            Verify the original account, workspace and full editor seat before
            configuring or retrying. Private configuration is hidden; drafts and
            identical requests remain retained.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void access.refresh()}
          >
            Recheck original access
          </button>
        </section>
      ) : accessError ? (
        <div>
          <p role="alert">
            Project access could not be checked. A new record has not been
            started.
          </p>
          <button className="btn-secondary" onClick={() => void retryAccess()}>
            Retry access check
          </button>
        </div>
      ) : !loaded ? (
        <p role="status">Checking project access…</p>
      ) : !canEdit ? (
        <p>A full editor seat is required to start an execution record.</p>
      ) : query.error && !baseline ? (
        <div>
          <p role="alert">
            Project testing context could not be loaded. A new record has not
            been started.
          </p>
          <button
            className="btn-secondary"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </div>
      ) : !baseline ? (
        <p role="status">Loading project context…</p>
      ) : (
        <>
          <p className="eyebrow" role="status">
            Step {index + 1} of {screens.length} · {displayedCount} selected{" "}
            {displayedCount === 1 ? "case" : "cases"}
          </p>
          <h3 ref={headingRef} tabIndex={-1}>
            {screen.title}
          </h3>
          {!pendingRequest && !countValid && (
            <p role="alert" style={{ color: "var(--ember)" }}>
              Select between 1 and 1,000 cases. Required prerequisites also
              count toward the server&apos;s 1,000-case limit.
            </p>
          )}
          {screen.id === "configuration" && (
            <p className="text-muted">
              These fields describe what you intend to test. They do not claim
              the build is deployed or the equipment is ready.
            </p>
          )}
          <fieldset
            disabled={
              busy || refreshing || !!pendingRequest || !access.canWrite
            }
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            {screen.fields.map((field) => (
              <div key={field.key} style={{ marginBottom: 14 }}>
                <label htmlFor={`${platformListId}-${field.key}`}>
                  {field.label}
                </label>
                {field.long ? (
                  <textarea
                    id={`${platformListId}-${field.key}`}
                    aria-describedby={
                      field.help
                        ? `${platformListId}-${field.key}-help`
                        : undefined
                    }
                    rows={3}
                    maxLength={2000}
                    value={displayedContext[field.key]}
                    onChange={(event) =>
                      setContext({
                        ...context,
                        [field.key]: event.target.value,
                      })
                    }
                    style={{ width: "100%", display: "block", marginTop: 6 }}
                  />
                ) : (
                  <input
                    id={`${platformListId}-${field.key}`}
                    aria-describedby={
                      field.help
                        ? `${platformListId}-${field.key}-help`
                        : undefined
                    }
                    maxLength={300}
                    value={displayedContext[field.key]}
                    list={field.key === "platform" ? platformListId : undefined}
                    onChange={(event) =>
                      setContext({
                        ...context,
                        [field.key]: event.target.value,
                      })
                    }
                    style={{ width: "100%", display: "block", marginTop: 6 }}
                  />
                )}
                {field.help && (
                  <p
                    id={`${platformListId}-${field.key}-help`}
                    className="text-muted"
                    style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}
                  >
                    {field.help}
                  </p>
                )}
              </div>
            ))}
          </fieldset>
          <datalist id={platformListId}>
            {(baseline.experience?.gamePlatforms ?? []).map((id) => (
              <option
                key={id}
                value={
                  GAME_PLATFORMS.find((choice) => choice.id === id)?.label ?? id
                }
              />
            ))}
          </datalist>
          {screen.id === "review" && (
            <>
              <p>
                {displayedCount} selected cases, plus required prerequisites.
                The server freezes the current case definitions, prerequisite
                graph and saved project context for this run. Later edits will
                not change that record.
              </p>
              <dl style={{ margin: 0 }}>
                {Object.entries(displayedContext).map(([key, value]) =>
                  value.trim() ? (
                    <div
                      key={key}
                      style={{ marginBottom: 10, overflowWrap: "anywhere" }}
                    >
                      <dt style={{ fontWeight: 650 }}>
                        {labels[key as keyof RunExecutionContext]}
                      </dt>
                      <dd style={{ marginLeft: 0, whiteSpace: "pre-wrap" }}>
                        {value.trim()}
                      </dd>
                    </div>
                  ) : null,
                )}
              </dl>
              {!Object.values(displayedContext).some((value) =>
                value.trim(),
              ) && (
                <p className="text-muted">
                  No configuration identifiers were supplied. This record will
                  not identify a specific build, platform, device, lot or
                  environment.
                </p>
              )}
              {experience && (
                <details>
                  <summary>Run evidence to capture</summary>
                  <ul style={{ paddingLeft: 20 }}>
                    {experience.runGuidance.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                </details>
              )}
              <p className="text-muted">
                Starting creates a record for people to execute and report. It
                does not actuate machinery, execute imported code, spend AI
                credits or certify safety/compliance.
              </p>
              {!pendingRequest && !selectionReviewed && (
                <p role="alert">
                  The selection changed. Go back and review the new case count
                  before starting.
                </p>
              )}
            </>
          )}
          {error && (
            <p role="alert" style={{ color: "var(--ember)" }}>
              {error}
            </p>
          )}
          {pendingRequest && (
            <p role="status">
              This request retains its original{" "}
              {pendingRequest.testCaseIds.length} cases and configuration, even
              if the background selection changed. Closing this dialog preserves
              it. Retry confirms the same request without creating a second run.
            </p>
          )}
          <footer
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              gap: 8,
              marginTop: 20,
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                className="btn-secondary"
                disabled={busy || refreshing || index === 0}
                onClick={() => setScreenId(screens[index - 1]!.id)}
              >
                Back
              </button>
              <button
                className="btn-secondary"
                disabled={busy || refreshing}
                onClick={onClose}
              >
                Cancel
              </button>
            </div>
            {screen.id === "review" ? (
              <button
                className="btn-primary"
                disabled={
                  busy ||
                  refreshing ||
                  !access.canWrite ||
                  (!pendingRequest && (!countValid || !selectionReviewed))
                }
                onClick={() => void start()}
              >
                {busy
                  ? "Starting…"
                  : pendingRequest
                    ? "Retry retained run start"
                    : "Start execution record"}
              </button>
            ) : (
              <button
                className="btn-primary"
                disabled={
                  busy || refreshing || (!pendingRequest && !countValid)
                }
                onClick={next}
              >
                Continue
              </button>
            )}
          </footer>
          {error && (
            <button
              className="btn-secondary"
              disabled={busy || refreshing || !!pendingRequest}
              style={{ marginTop: 12 }}
              onClick={() => void refreshContext()}
            >
              Refresh project context and review again
            </button>
          )}
        </>
      )}
    </Modal>
  );
}
