"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  GAME_PLATFORMS,
  resolveQualityExperience,
  type ExperienceProfile,
} from "@vaettir/core";
import { trpcReact } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { Modal } from "./Modal";

export type RunExecutionContext = {
  configuration: string;
  platform: string;
  build: string;
  hardwareRevision: string;
  firmwareVersion: string;
  rig: string;
  batchOrLot: string;
  environment: string;
  calibrationReference: string;
  protocolReference: string;
};
export type ReviewedRunConfiguration = {
  expectedProfileHash: string;
  executionContext: RunExecutionContext;
  idempotencyKey: string;
};
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
  projectId,
  caseCount,
  onClose,
  onStart,
}: {
  projectId: string;
  caseCount: number;
  onClose: () => void;
  onStart: (configuration: ReviewedRunConfiguration) => Promise<unknown>;
}) {
  const { loaded, canEdit, accessError, retryAccess } =
    useProjectPermissions(projectId);
  const query = trpcReact.project.experience.useQuery({ projectId });
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
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const platformListId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  if (query.data && baseline === null) setBaseline(query.data);
  const screens = screensFor(baseline?.experience ?? null);
  const index = Math.max(
    0,
    screens.findIndex((screen) => screen.id === screenId),
  );
  const screen = screens[index]!;
  const countValid =
    Number.isInteger(caseCount) && caseCount > 0 && caseCount <= 500;
  const experience = baseline?.experience
    ? resolveQualityExperience(baseline.experience)
    : null;
  useEffect(() => {
    headingRef.current?.focus();
  }, [screenId]);
  function next() {
    const nextScreen = screens[index + 1]!;
    if (nextScreen.id === "review") setReviewedCount(caseCount);
    setScreenId(nextScreen.id);
  }
  async function start() {
    if (
      !baseline ||
      !canEdit ||
      busy ||
      refreshing ||
      !countValid ||
      reviewedCount !== caseCount
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await onStart({
        expectedProfileHash: baseline.profileHash,
        executionContext: Object.fromEntries(
          Object.entries(context).map(([key, value]) => [key, value.trim()]),
        ) as RunExecutionContext,
        idempotencyKey,
      });
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : "The execution record could not be started."} Your configuration is retained. No automatic retry was sent.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function refreshContext() {
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
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <Modal
      open
      title="Configure execution record"
      onClose={onClose}
      dismissible={!busy && !refreshing}
    >
      {accessError ? (
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
            Step {index + 1} of {screens.length} · {caseCount} selected{" "}
            {caseCount === 1 ? "case" : "cases"}
          </p>
          <h3 ref={headingRef} tabIndex={-1}>
            {screen.title}
          </h3>
          {!countValid && (
            <p role="alert" style={{ color: "var(--ember)" }}>
              Select between 1 and 500 cases. Required prerequisites also count
              toward the server&apos;s 500-case limit.
            </p>
          )}
          {screen.id === "configuration" && (
            <p className="text-muted">
              These fields describe what you intend to test. They do not claim
              the build is deployed or the equipment is ready.
            </p>
          )}
          <fieldset
            disabled={busy || refreshing}
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
                    value={context[field.key]}
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
                    value={context[field.key]}
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
                {caseCount} selected cases, plus required prerequisites. The
                server freezes the current case definitions, prerequisite graph
                and saved project context for this run. Later edits will not
                change that record.
              </p>
              <dl style={{ margin: 0 }}>
                {Object.entries(context).map(([key, value]) =>
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
              {!Object.values(context).some((value) => value.trim()) && (
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
              {reviewedCount !== caseCount && (
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
                  !countValid ||
                  reviewedCount !== caseCount
                }
                onClick={() => void start()}
              >
                {busy ? "Starting…" : "Start execution record"}
              </button>
            ) : (
              <button
                className="btn-primary"
                disabled={busy || refreshing || !countValid}
                onClick={next}
              >
                Continue
              </button>
            )}
          </footer>
          {error && (
            <button
              className="btn-secondary"
              disabled={busy || refreshing}
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
