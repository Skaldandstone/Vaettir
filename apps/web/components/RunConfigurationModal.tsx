"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  GAME_PLATFORMS,
  resolveQualityExperience,
  type ExperienceProfile,
} from "@vaettir/core";
import { trpcReact } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { useManualExecutionAccess } from "@/lib/use-manual-execution-access";
import { currentSessionScope } from "@/lib/auth-query-cache";
import {
  emptyRunStartCompletion,
  RunConfigCompletionController,
  type ConfirmedRunStartAck,
  type RunStartRecheckToken,
} from "@/lib/run-config-completion";
import {
  MAX_MANUAL_CASES,
  freezeRunConfiguration,
  reviewedRunCasesMatch,
  type RunExecutionContext,
  type ReviewedRunConfiguration,
} from "@/lib/run-configuration-request";
import { Modal } from "./Modal";
import {
  applyRunBulkSelection,
  type RunBulkScope,
  type RunBulkSelectionMode,
} from "@/lib/run-bulk-selection";
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
  bulkScopes,
  bulkScopesReady = false,
  onSelectionChange,
  onClose,
  onStart,
  onConfirmedStart,
}: {
  open?: boolean;
  projectId: string;
  caseCount: number;
  testCaseIds: string[];
  bulkScopes?: RunBulkScope[];
  bulkScopesReady?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  onClose: () => void;
  onStart: (configuration: ReviewedRunConfiguration) => Promise<unknown>;
  /** Mutation-only onStart must not navigate. This callback is gated after ACK. */
  onConfirmedStart?: (
    acknowledgement: ConfirmedRunStartAck,
    configuration: ReviewedRunConfiguration,
  ) => void;
}) {
  const { loaded, canEdit, accessError, retryAccess } =
    useProjectPermissions(projectId);
  const access = useManualExecutionAccess(projectId);
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
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
  const [localError, setError] = useState<string | null>(null);
  const [completion, setCompletion] = useState(emptyRunStartCompletion);
  const [controller] = useState(
    () => new RunConfigCompletionController(projectId, setCompletion, true),
  );
  const [monitorRetry, setMonitorRetry] = useState(0);
  const [recheckCandidate, setRecheckCandidate] =
    useState<RunStartRecheckToken | null>(null);
  const recheckOperation = useRef(0);
  const sdkResource =
    typeof window === "undefined" ? null : (window.Clerk ?? null);
  const busy = completion.busy;
  const error = localError ?? completion.error;
  const [refreshing, setRefreshing] = useState(false);
  const [reviewedCount, setReviewedCount] = useState<number | null>(null);
  const [reviewedIds, setReviewedIds] = useState<string[] | null>(null);
  const pendingRequest = completion.pendingRequest;
  const confirmedStart = completion.confirmed;
  const [bulkScopeKey, setBulkScopeKey] = useState("");
  const [bulkMode, setBulkMode] = useState<RunBulkSelectionMode>("SET");
  const [bulkNotice, setBulkNotice] = useState("");
  const refreshingNow = useRef(false);
  const platformListId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const draftKey = JSON.stringify({
    caseCount,
    testCaseIds,
    context,
    profileHash: baseline?.profileHash ?? null,
  });
  useLayoutEffect(() => {
    controller.attach();
    return () => controller.detach();
  }, [controller]);
  useLayoutEffect(() => {
    const operationHolder = recheckOperation;
    const refreshingHolder = refreshingNow;
    const release = controller.installSdkMonitor(
      sdkResource,
      liveSession,
      () => (typeof window === "undefined" ? null : (window.Clerk ?? null)),
    );
    return () => {
      operationHolder.current++;
      refreshingHolder.current = false;
      setRefreshing(false);
      release();
    };
  }, [controller, sdkResource, monitorRetry]);
  useLayoutEffect(() => {
    controller.bindFrame({
      open,
      draftKey,
      scope:
        isLoaded &&
        isSignedIn &&
        userId &&
        sessionId &&
        access.ready &&
        access.origin
          ? {
              projectId,
              organizationId: access.origin.organizationId,
              clerkActorId: userId,
              sessionId,
            }
          : null,
      canWrite: loaded && canEdit && !accessError && access.canWrite,
    });
  }, [
    controller,
    open,
    draftKey,
    projectId,
    isLoaded,
    isSignedIn,
    userId,
    sessionId,
    access.ready,
    access.origin,
    access.canWrite,
    loaded,
    canEdit,
    accessError,
  ]);
  function liveSession() {
    return currentSessionScope(
      window.Clerk?.loaded ? window.Clerk.session : null,
    );
  }
  useLayoutEffect(() => {
    if (recheckCandidate)
      controller.finishRecheck(recheckCandidate, liveSession());
    // The controller consumes this exact token once and publishes its mirrored
    // state. Keeping the last token does not loop or grant a second admission.
  }, [
    controller,
    recheckCandidate,
    completion.activationEpoch,
    access.ready,
    access.canWrite,
    loaded,
    canEdit,
    accessError,
  ]);
  if (
    open &&
    access.ready &&
    query.data &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.isFetchedAfterMount &&
    completion.authorized &&
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
  const retainedRequest = confirmedStart?.request ?? pendingRequest;
  const displayedCount = retainedRequest?.testCaseIds.length ?? caseCount;
  const displayedContext = retainedRequest?.executionContext ?? context;
  const selectionReviewed =
    reviewedCount === caseCount &&
    reviewedRunCasesMatch(reviewedIds, testCaseIds);
  const bulkScope = bulkScopeKey
    ? (bulkScopes?.find((scope) => scope.key === bulkScopeKey) ?? null)
    : (bulkScopes?.[0] ?? null);
  const bulkPreview = bulkScope
    ? applyRunBulkSelection(testCaseIds, bulkScope.testCaseIds, bulkMode)
    : null;
  function applyBulk() {
    if (
      !bulkScope ||
      !onSelectionChange ||
      !bulkScopesReady ||
      !access.canWrite ||
      busy ||
      refreshingNow.current ||
      !controller.canEdit(liveSession(), completion.activationEpoch)
    )
      return;
    const result = applyRunBulkSelection(
      testCaseIds,
      bulkScope.testCaseIds,
      bulkMode,
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSelectionChange(result.ids);
    controller.revokeReview();
    setReviewedCount(null);
    setReviewedIds(null);
    setError(null);
    setBulkNotice(
      `${bulkMode === "SET" ? "Set" : bulkMode === "ADD" ? "Added from" : "Removed from"} ${bulkScope.label}: ${result.added} added, ${result.removed} removed. ${result.before} → ${result.after} selected.`,
    );
  }
  const experience = baseline?.experience
    ? resolveQualityExperience(baseline.experience)
    : null;
  useEffect(() => {
    headingRef.current?.focus();
  }, [screenId]);
  function next() {
    if (
      refreshingNow.current ||
      !controller.frameCurrent(liveSession(), completion.activationEpoch) ||
      busy ||
      confirmedStart
    )
      return;
    const nextScreen = screens[index + 1]!;
    if (nextScreen.id === "review" && !pendingRequest) {
      if (!controller.review(liveSession(), completion.activationEpoch)) return;
      setReviewedCount(caseCount);
      setReviewedIds([...testCaseIds]);
    }
    setScreenId(nextScreen.id);
  }
  async function start() {
    const origin = access.origin;
    if (
      !baseline ||
      !access.canWrite ||
      !origin ||
      !canEdit ||
      busy ||
      refreshingNow.current ||
      (!pendingRequest && (!countValid || !selectionReviewed))
    )
      return;
    const current = controller.snapshot();
    if (
      !controller.frameCurrent(liveSession(), completion.activationEpoch) ||
      (!current.canStart && !current.canRetry)
    )
      return;
    setError(null);
    await controller.submit(
      completion.activationEpoch,
      () =>
        freezeRunConfiguration(
          {
            projectId,
            testCaseIds,
            expectedProfileHash: baseline.profileHash,
            executionContext: context,
            originalOrganizationId: origin.organizationId,
            expectedClerkActorId: origin.clerkActorId,
          },
          crypto.randomUUID(),
        ),
      onStart,
      liveSession,
      onConfirmedStart,
    );
  }
  async function refreshContext() {
    if (
      refreshingNow.current ||
      !controller.canEdit(liveSession(), completion.activationEpoch)
    )
      return;
    const epoch = completion.activationEpoch;
    const operation = ++recheckOperation.current;
    refreshingNow.current = true;
    controller.revokeReview();
    setRefreshing(true);
    setError(null);
    try {
      const result = await query.refetch();
      if (!controller.frameCurrent(liveSession(), epoch)) return;
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
      if (operation === recheckOperation.current) {
        refreshingNow.current = false;
        setRefreshing(false);
      }
    }
  }
  async function recheckOriginalAccess() {
    if (refreshingNow.current || busy) return;
    const token = controller.beginRecheck(liveSession());
    if (!token) {
      // Explicitly retry installation only. No cached/session-return admission
      // is granted; another explicit recheck needs fresh metadata results.
      setMonitorRetry((value) => value + 1);
      setError(
        "Installed session monitoring is unavailable or original access is not ready. Drafts are retained; explicitly recheck again after restoring the original account.",
      );
      return;
    }
    const operation = ++recheckOperation.current;
    setRecheckCandidate(null);
    refreshingNow.current = true;
    setRefreshing(true);
    setError(null);
    try {
      const [projectResult, organizationsResult] = await access.refresh();
      const profileResult = await query.refetch();
      if (operation !== recheckOperation.current) return;
      const origin = access.origin;
      const member = organizationsResult.data?.find(
        (row) => row.id === origin?.organizationId,
      );
      if (
        !origin ||
        !projectResult.isSuccess ||
        !organizationsResult.isSuccess ||
        !profileResult.isSuccess ||
        projectResult.fetchStatus !== "idle" ||
        organizationsResult.fetchStatus !== "idle" ||
        profileResult.fetchStatus !== "idle" ||
        projectResult.isError ||
        organizationsResult.isError ||
        profileResult.isError ||
        projectResult.isFetching ||
        organizationsResult.isFetching ||
        profileResult.isFetching ||
        projectResult.isPaused ||
        organizationsResult.isPaused ||
        profileResult.isPaused ||
        !projectResult.isFetchedAfterMount ||
        !organizationsResult.isFetchedAfterMount ||
        !profileResult.isFetchedAfterMount ||
        projectResult.data?.id !== projectId ||
        projectResult.data.organizationId !== origin.organizationId ||
        !member ||
        member.seatType !== "FULL" ||
        !["OWNER", "ADMIN", "EDITOR"].includes(member.role) ||
        !profileResult.data ||
        !/^[a-f0-9]{64}$/.test(profileResult.data.profileHash)
      ) {
        setError(
          "Original access and project context could not be freshly verified. Drafts and identical requests remain retained.",
        );
        return;
      }
      // Hook/layout currentness is checked by the controller when publishing;
      // fresh metadata is not a native scope nonce or new write permission.
      setRecheckCandidate(token);
    } catch {
      if (operation === recheckOperation.current)
        setError(
          "Original access could not be rechecked. Drafts and identical requests remain retained.",
        );
    } finally {
      if (operation === recheckOperation.current) {
        refreshingNow.current = false;
        setRefreshing(false);
      }
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
      {!access.ready || !completion.authorized ? (
        <section role="status">
          <p>
            Verify the original account, workspace and full editor seat before
            configuring or retrying. Private configuration is hidden; drafts and
            identical requests remain retained.
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || refreshing}
            onClick={recheckOriginalAccess}
          >
            Recheck original access
          </button>
          {localError && <p role="alert">{localError}</p>}
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
          {!retainedRequest && !countValid && (
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
          {screen.id === "configuration" && bulkScopes && onSelectionChange && (
            <section
              aria-label="Build run selection"
              className="panel"
              style={{ padding: 12, marginBottom: 16 }}
            >
              <h4 style={{ marginTop: 0 }}>Build the selected case set</h4>
              <p className="text-muted">
                Set replaces the selection, Add keeps it and adds matches,
                Remove subtracts matches. Browsing suites or changing filters
                does not apply these operations.
              </p>
              <fieldset
                disabled={
                  busy || refreshing || !completion.canEdit || !bulkScopesReady
                }
                style={{
                  border: 0,
                  padding: 0,
                  minWidth: 0,
                  display: "grid",
                  gap: 10,
                }}
              >
                <label>
                  Approved scope
                  <select
                    value={bulkScope?.key ?? bulkScopeKey}
                    onChange={(event) => setBulkScopeKey(event.target.value)}
                    style={{ width: "100%" }}
                  >
                    {bulkScopeKey && !bulkScope && (
                      <option value={bulkScopeKey} disabled>
                        Selected scope unavailable — choose an approved scope
                      </option>
                    )}
                    {bulkScopes.map((scope) => (
                      <option key={scope.key} value={scope.key}>
                        {scope.label} ({scope.testCaseIds.length})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Selection operation
                  <select
                    value={bulkMode}
                    onChange={(event) =>
                      setBulkMode(event.target.value as RunBulkSelectionMode)
                    }
                    style={{ width: "100%" }}
                  >
                    <option value="SET">Set — replace selection</option>
                    <option value="ADD">
                      Add — keep existing and add matches
                    </option>
                    <option value="REMOVE">Remove — subtract matches</option>
                  </select>
                </label>
                {pendingRequest ? (
                  <p role="status">
                    Selection changes are locked while confirming the original{" "}
                    {pendingRequest.testCaseIds.length}-case request.
                  </p>
                ) : bulkPreview?.ok ? (
                  <p role="status" style={{ margin: 0 }}>
                    Applying this operation will add {bulkPreview.added}, remove{" "}
                    {bulkPreview.removed}, and leave {bulkPreview.after}{" "}
                    selected ({bulkPreview.matched} scope matches).
                  </p>
                ) : (
                  bulkPreview && <p role="alert">{bulkPreview.error}</p>
                )}
                {!pendingRequest && !bulkScope && (
                  <p role="alert">
                    Choose a currently available approved scope. The previous
                    scope was not replaced with different cases.
                  </p>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!bulkPreview?.ok}
                  onClick={applyBulk}
                >
                  Apply{" "}
                  {bulkMode === "SET"
                    ? "Set"
                    : bulkMode === "ADD"
                      ? "Add"
                      : "Remove"}{" "}
                  selection
                </button>
              </fieldset>
              {!bulkScopesReady && (
                <p role="status">
                  Verify the current loaded approved scope before applying a
                  selection change.
                </p>
              )}
              {bulkNotice && <p role="status">{bulkNotice}</p>}
            </section>
          )}
          <fieldset
            disabled={busy || refreshing || !completion.canEdit}
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
                    onChange={(event) => {
                      if (
                        !controller.canEdit(
                          liveSession(),
                          completion.activationEpoch,
                        )
                      )
                        return;
                      setContext({
                        ...context,
                        [field.key]: event.target.value,
                      });
                    }}
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
                    onChange={(event) => {
                      if (
                        !controller.canEdit(
                          liveSession(),
                          completion.activationEpoch,
                        )
                      )
                        return;
                      setContext({
                        ...context,
                        [field.key]: event.target.value,
                      });
                    }}
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
              {!retainedRequest &&
                (!selectionReviewed || !completion.canStart) && (
                  <p role="alert">
                    The selection, configuration or original access frame
                    changed. Go back and explicitly review the current
                    configuration and case count before starting.
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
          {confirmedStart && (
            <section role="status" aria-label="Confirmed run start">
              <h4>Run start confirmed</h4>
              <p>
                The exact original request was acknowledged. Configuration and
                reviewed cases are retained; this draft cannot start another
                run.
              </p>
              <p style={{ overflowWrap: "anywhere" }}>
                {confirmedStart.acknowledgement.testRunId}
              </p>
              <p>
                {confirmedStart.opened
                  ? "The guarded open action was requested. No additional run start was submitted."
                  : "Open the confirmed run after restoring this original account, session and current workspace access."}
              </p>
            </section>
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
            {confirmedStart ? (
              <button
                type="button"
                className="btn-primary"
                disabled={busy || refreshing || !completion.canOpen}
                onClick={() =>
                  controller.openConfirmed(
                    liveSession(),
                    onConfirmedStart,
                    completion.activationEpoch,
                  )
                }
              >
                Open confirmed run
              </button>
            ) : screen.id === "review" || pendingRequest ? (
              <button
                className="btn-primary"
                disabled={
                  busy ||
                  refreshing ||
                  !access.canWrite ||
                  (!pendingRequest &&
                    (!countValid ||
                      !selectionReviewed ||
                      !completion.canStart)) ||
                  (!!pendingRequest && !completion.canRetry)
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
              disabled={busy || refreshing || !completion.canEdit}
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
