import React, { useEffect, useState } from "react";
import {
  Button,
  Box,
  DonutChart,
  HorizontalBarChart,
  Heading,
  Inline,
  HelperMessage,
  Label,
  Link,
  Lozenge,
  ProgressBar,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  Textfield,
  useProductContext,
  xcss,
} from "@forge/react";
import { invokeRemote } from "@forge/bridge";
import { createQualityTransport } from "./transport";
import type { QualityVisualReport } from "../../../packages/core/src/qualityVisuals";

type Connection = {
  key: string;
  projectName: string;
  shareTicketTests: boolean;
  hasLive: boolean;
  hasSnapshots: boolean;
  hasReleases: boolean;
  hasClosures: boolean;
};
type Release = {
  visuals?: QualityVisualReport;
  protocol: "vaettir-release-quality/v1";
  mode: "LIVE" | "FROZEN" | "RELEASED_CAPTURE_UNAVAILABLE";
  projectId: string;
  releaseName: string;
  jiraVersionName: string;
  capturedAt: string;
  notice: string;
  counts: {
    planned: number;
    recorded: number;
    pass: number;
    fail: number;
    blocked: number;
    skipped: number;
    flaky: number;
    mixed: number;
    ambiguous: number;
    notRecorded: number;
  };
  recordedFailures: number;
  failedRuns: number;
  unmatchedObservations: number;
  outsideCohortObservations: number;
  totalAttention: number;
  testsLimited: boolean;
  risks: Array<{ severity: string; count: number }>;
  tests: Array<{
    id: string;
    displayId: string;
    title: string;
    outcome: string;
    reviewStatus: string;
    href: string;
  }>;
  runs: Array<{
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    commitSha: string;
    branch: string;
    href: string;
  }>;
};
type RunLink = { id?: string; runId?: string; startedAt: string; href: string };
type Ticket = {
  protocol: "vaettir-ticket-verification/v1";
  issueKey: string;
  asOf: string;
  notice: string;
  tests: Array<{
    id: string;
    displayId: string;
    title: string;
    outcome: string;
    priority: string;
    archived: boolean;
    reviewStatus: string;
    definitionMatch: string;
    href: string;
    runs: RunLink[];
  }>;
};
type Quality = {
  visuals?: QualityVisualReport;
  protocol: "vaettir-quality/v1" | "vaettir-quality-live/v1";
  mode: "FROZEN" | "LATEST_APPROVED" | "LIVE";
  notice: string;
  reportUrl: string;
  runLinks: RunLink[];
  available: Array<{ id: string; title: string; asOf: string }>;
  snapshot: {
    id: string;
    title: string;
    projectName: string;
    asOf: string;
    scope?: { releaseName?: string; cohortBasis: string };
    limitations: string[];
    execution: {
      runs: number;
      results: number;
      distinctCases: number;
      outcomes: Array<{ key: string; count: number }>;
      plannedCaseRunPairs?: number;
      notRecordedCaseRunPairs?: number;
    };
  };
};
type EmptyQuality = { protocol: "vaettir-quality-empty/v1"; projectId: string; reportUrl: string; notice: string };
const remote = createQualityTransport(invokeRemote);
const label = (value: string) =>
  value
    .split("_")
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(" ");
export function QualityApp({
  macroConfig,
}: {
  macroConfig?: Record<string, unknown>;
}) {
  const context = useProductContext();
  const rawConfig = macroConfig;
  const [contextUnavailable, setContextUnavailable] = useState(false);
  useEffect(() => {
    if (context) return;
    const timer = setTimeout(() => setContextUnavailable(true), 10000);
    return () => clearTimeout(timer);
  }, [context]);
  const configuredKey =
    typeof rawConfig?.connectionKey === "string"
      ? rawConfig.connectionKey.trim()
      : "";
  const configuredSnapshot =
    typeof rawConfig?.snapshotId === "string"
      ? rawConfig.snapshotId.trim()
      : "";
  const configuredLive = rawConfig?.mode === "live";
  const [liveTick, setLiveTick] = useState(0);
  const configuredClosure =
    typeof rawConfig?.closureId === "string" ? rawConfig.closureId.trim() : "";
  const [selection, setSelection] = useState(""),
    [details, setDetails] = useState<{
      pin: string;
      releases: Array<{ versionId: string; releaseId: string; name: string }>;
      closureIds: string[];
    } | null>(null);
  const [catalog, setCatalog] = useState<{
      signature: string;
      connections: Connection[];
    } | null>(null),
    [key, setKey] = useState(""),
    [snapshotId, setSnapshotId] = useState("");
  const [response, setResponse] = useState<{
      pin: string;
      value: Ticket | Quality | Release | EmptyQuality;
    } | null>(null),
    [identity, setIdentity] = useState<{
      signature: string;
      connectionUrl: string;
      targetLabel: string;
      expiresAt: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const signature = context
    ? JSON.stringify([
        context.accountId,
        context.cloudId,
        context.environmentId,
        context.moduleKey,
        context.extension,
        configuredKey,
        configuredSnapshot,
        configuredClosure,
        configuredLive,
      ])
    : "";
  const catalogPin = JSON.stringify([signature, key]);
  const pin = JSON.stringify([signature, key, snapshotId, selection]);
  const data = response?.pin === pin ? response.value : null;
  const connections =
    catalog?.signature === signature ? catalog.connections : [];
  const connectionRequest = identity?.signature === signature ? identity : null;
  useEffect(() => {
    if (!signature) return;
    let active = true;
    setResponse(null);
    setError("");
    setBusy(true);
    setIdentity(null);
    void remote({ action: "LIST" })
      .then(async (response) => {
        if (!active) return;
        const available = response.connections as Connection[];
        setCatalog({ signature, connections: available });
        setKey(
          configuredKey || (available.length === 1 ? available[0]!.key : ""),
        );
        setSnapshotId(configuredSnapshot);
        if (!available.length) {
          const prepared = await remote({ action: "CONNECT" });
          if (active) setIdentity({ signature, connectionUrl: prepared.connectionUrl, targetLabel: prepared.targetLabel, expiresAt: prepared.expiresAt });
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Connection lookup failed.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [signature, configuredKey, configuredSnapshot, reload]);
  useEffect(() => {
    if (!connectionRequest || connections.length) return;
    let active = true, inFlight = false;
    const timer = setInterval(() => {
      if (Date.now() >= Date.parse(connectionRequest.expiresAt)) {
        clearInterval(timer);
        if (active) { setIdentity(null); setError("This setup link expired. Refresh the connection to create a new link."); }
        return;
      }
      if (inFlight) return;
      inFlight = true;
      void remote({ action: "LIST" }).then((result) => {
        if (!active) return;
        const available = result.connections as Connection[];
        if (available.length) {
          setCatalog({ signature, connections: available });
          setKey(configuredKey || (available.length === 1 ? available[0]!.key : ""));
          setIdentity(null);
        }
      }).catch(() => {
        if (active) setError("Connection access changed. Refresh the connection before continuing.");
        clearInterval(timer);
      }).finally(() => { inFlight = false; });
    }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [connectionRequest, connections.length, signature, configuredKey]);
  useEffect(() => {
    if (!key || !signature) return;
    let active = true;
    setDetails(null);
    setResponse(null);
    setError("");
    setBusy(true);
    void remote({ action: "RELEASES", connectionKey: key })
      .then((result) => {
        if (!active) return;
        setDetails({
          pin: catalogPin,
          releases: result.releases,
          closureIds: result.closureIds,
        });
        const connection = connections.find((c) => c.key === key);
        setSelection(
          context?.moduleKey === "vaettir-issue-quality"
            ? "ticket"
            : configuredLive && !configuredSnapshot && !configuredClosure
              ? "live"
              : configuredClosure
              ? `closure:${configuredClosure}`
              : configuredSnapshot || connection?.hasSnapshots
                ? "report"
                : result.releases.length
                  ? `release:${result.releases[0].versionId}`
                  : result.closureIds.length
                    ? `closure:${result.closureIds[0]}`
                    : connection?.hasLive ? "live" : "report",
        );
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Release catalog unavailable.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
    // Catalog data is pinned to the exact current product context and target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogPin, configuredClosure, configuredSnapshot, configuredLive, reload]);
  useEffect(() => {
    if (!key || !signature || details?.pin !== catalogPin || !selection) return;
    let active = true;
    setResponse(null);
    setError("");
    setBusy(true);
    void remote({
      action: selection === "live" ? "READ_LIVE" : selection.startsWith("release:")
        ? "READ_RELEASE"
        : selection.startsWith("closure:")
          ? "READ_CLOSURE"
          : "READ",
      connectionKey: key,
      ...(selection === "live" ? {} : selection.startsWith("release:")
        ? { versionId: selection.slice(8) }
        : selection.startsWith("closure:")
          ? { closureId: selection.slice(8) }
          : snapshotId
            ? { snapshotId }
            : {}),
    })
      .then((result) => {
        if (!active) return;
        if (
          ![
            "vaettir-quality/v1",
            "vaettir-quality-live/v1",
            "vaettir-quality-empty/v1",
            "vaettir-ticket-verification/v1",
            "vaettir-release-quality/v1",
          ].includes(result.protocol)
        )
          throw new Error("Unsupported Vaettir quality response.");
        setResponse({ pin, value: result as Ticket | Quality | Release | EmptyQuality });
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Quality evidence unavailable.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [key, snapshotId, signature, pin, reload, selection, details, catalogPin, liveTick]);
  useEffect(() => {
    if (selection !== "live" || !signature || !key) return;
    const timer = setInterval(() => setLiveTick(value => value + 1), 60000);
    return () => clearInterval(timer);
  }, [selection, signature, key]);
  return (
    <Box xcss={xcss({ maxWidth: "1120px" })}><Stack space="space.200">
      {!context &&
        (contextUnavailable ? (
          <SectionMessage
            appearance="warning"
            title="Atlassian page context unavailable"
          >
            <Text>
              Reload this page to try again. No Vaettir data has been requested
              or shared.
            </Text>
          </SectionMessage>
        ) : (
          <Spinner label="Loading Atlassian page context" />
        ))}
      {connections.length > 1 && (
        <>
          <Label labelFor="quality-connection">Vaettir project</Label>
          <Select
            inputId="quality-connection"
            options={connections.map((c) => ({
              value: c.key,
              label: c.projectName,
            }))}
            value={
              connections
                .filter((c) => c.key === key)
                .map((c) => ({ value: c.key, label: c.projectName }))[0] ?? null
            }
            onChange={(option) =>
              setKey(option && !Array.isArray(option) ? option.value : "")
            }
          />
        </>
      )}
      {details?.pin === catalogPin &&
        context?.moduleKey !== "vaettir-issue-quality" &&
        !configuredClosure &&
        !configuredSnapshot && (
          <>
            <Label labelFor="release-view">Quality view</Label>
            <Select
              inputId="release-view"
              value={{
                value: selection,
                label:
                  selection === "live" ? "Live quality dashboard" : selection === "report"
                    ? "Approved quality capture"
                    : selection.startsWith("release:")
                      ? (details.releases.find(
                          (r) => `release:${r.versionId}` === selection,
                        )?.name ?? "Linked release")
                      : "Historical release capture",
              }}
              options={[
                ...(connections.find(c => c.key === key)?.hasLive ? [{ value: "live", label: "Live quality dashboard" }] : []),
                ...(connections.find((c) => c.key === key)?.hasSnapshots
                  ? [{ value: "report", label: "Approved quality capture" }]
                  : []),
                ...details.releases.map((r) => ({
                  value: `release:${r.versionId}`,
                  label: `${r.name} · Jira version ${r.versionId}`,
                })),
                ...details.closureIds.map((id) => ({
                  value: `closure:${id}`,
                  label: `Historical capture · ${id.slice(0, 12)}`,
                })),
              ]}
              onChange={(option) =>
                setSelection(
                  option && !Array.isArray(option) ? option.value : "",
                )
              }
            />
          </>
        )}
      {busy && <Spinner label="Loading quality evidence" />}
      {error && (
        <SectionMessage
          appearance="warning"
          title="Quality evidence unavailable"
        >
          <Text>{error}</Text>
          <Button
            onClick={() => setReload((value) => value + 1)}
            isDisabled={busy}
          >
            Try again
          </Button>
        </SectionMessage>
      )}
      {connectionRequest !== null && (
        <SectionMessage title="Connect a Vaettir project">
          <Text>
            Sign in to Vaettir, choose the project you want connected to {connectionRequest.targetLabel}, and confirm read-only access.
            Source, attachments and architecture mappings remain private in Vaettir.
          </Text>
          <Text>
            <Link href={connectionRequest.connectionUrl} openNewTab>
              Connect a Vaettir project
            </Link>
          </Text>
          <Text>This page checks for the completed connection automatically.</Text>
          <Button onClick={() => setReload(value => value + 1)} isDisabled={busy}>Refresh connection</Button>
        </SectionMessage>
      )}
      {data?.protocol === "vaettir-quality-empty/v1" && (
        <SectionMessage title="Project connected">
          <Text>{data.notice}</Text>
          <Text><Link href={data.reportUrl} openNewTab>Open project reports</Link></Text>
        </SectionMessage>
      )}
      {data?.protocol === "vaettir-ticket-verification/v1" && (
        <>
          <Heading as="h3">Verification tests · {data.issueKey}</Heading>
          <Text>
            {data.tests.length} explicitly linked tests · Updated{" "}
            {new Date(data.asOf).toLocaleString()}
          </Text>
          {!data.tests.length && (
            <Text>
              No tests are linked to this ticket yet. Add an exact Jira ticket
              reference to a case in Vaettir; tests from a whole suite are not
              automatically attributed to this ticket.
            </Text>
          )}
          {data.tests.map((test) => (
            <Box key={test.id} xcss={surface}><Stack space="space.100">
              <Text>
                <Link href={test.href} openNewTab>
                  {test.displayId} · {test.title}
                </Link>
              </Text>
              <Inline space="space.100" shouldWrap>
                <Lozenge
                  appearance={
                    test.outcome === "PASS"
                      ? "success"
                      : test.outcome === "FAIL"
                        ? "removed"
                        : "inprogress"
                  }
                >
                  {test.outcome === "PASS"
                    ? "Recorded Pass"
                    : label(test.outcome)}
                </Lozenge>
                <Text>
                  {test.reviewStatus !== "APPROVED"
                    ? ` · ${label(test.reviewStatus)}`
                    : ""}
                  {test.archived ? " · Archived" : ""}
                </Text>
              </Inline>
              {test.runs.map((run) => (
                <Text key={run.runId}>
                  <Link href={run.href} openNewTab>
                    Run · {new Date(run.startedAt).toLocaleString()}
                  </Link>
                </Text>
              ))}
              <HelperMessage>
                Current definition match not verified.
              </HelperMessage>
            </Stack></Box>
          ))}
          <HelperMessage>{data.notice}</HelperMessage>
        </>
      )}
      {(data?.protocol === "vaettir-quality/v1" || data?.protocol === "vaettir-quality-live/v1") && <QualitySnapshotView key={pin} data={data} configuredSnapshot={configuredSnapshot} setSnapshotId={setSnapshotId} />}
      {data?.protocol === "vaettir-release-quality/v1" && (
        <ReleaseView key={pin} data={data} />
      )}
      {key && (
        <Inline><Button
          isDisabled={busy}
          onClick={() => setReload((value) => value + 1)}
        >
          Refresh evidence
        </Button></Inline>
      )}
    </Stack></Box>
  );
}

const surface = xcss({ padding: "space.250", borderRadius: "radius.medium", borderColor: "color.border", borderStyle: "solid", borderWidth: "border.width" });
const metricSurface = xcss({ padding: "space.200", borderRadius: "radius.medium", minWidth: "150px", flexGrow: 1 });
// Category-keyed colors stay stable when a capture omits an outcome. Counts
// and labels remain visible, so meaning never depends on color alone.
const outcomeColors = [
  { key: "Pass", value: "#22A06B" },
  { key: "Fail", value: "#F15B50" },
  { key: "Blocked", value: "#CF9F02" },
  { key: "Flaky", value: "#9F8FEF" },
  { key: "Mixed", value: "#E774BB" },
  { key: "Ambiguous", value: "#579DFF" },
  { key: "Skip", value: "#8C9BAB" },
  { key: "Skipped", value: "#8C9BAB" },
  { key: "Not recorded", value: "#B6C2CF" },
];
function Metric({ title, value, tone = "neutral" }: { title: string; value: number; tone?: "neutral" | "success" | "danger" | "warning" }) {
  return <Box xcss={metricSurface} backgroundColor={tone === "success" ? "color.background.success" : tone === "danger" ? "color.background.danger" : tone === "warning" ? "color.background.warning" : "color.background.neutral"}>
    <Stack space="space.050"><Text>{title}</Text><Heading as="h2">{value.toLocaleString()}</Heading></Stack>
  </Box>;
}

function EvidenceNotes({ limitations, notice }: { limitations: string[]; notice: string }) {
  const [expanded, setExpanded] = useState(false);
  return <Stack space="space.100"><Inline><Button appearance="subtle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Hide metric definitions and limitations" : "About these metrics and limitations"}</Button></Inline>{expanded && <Box xcss={surface}><Stack space="space.100">{limitations.map((text, index) => <Text key={index}>{text}</Text>)}<Text>{notice}</Text></Stack></Box>}</Stack>;
}

// Display only: Vaettir selects the charts, scope, labels, colors and values.
export function NativeQualityVisuals({ model }: { model: QualityVisualReport }) {
  return <Stack space="space.250">{model.charts.map(chart => <Box key={chart.id} xcss={surface}>
    <Stack space="space.100">
      {chart.rows.length ? chart.kind === "donut"
        ? <DonutChart title={chart.title} data={chart.rows} labelAccessor="label" valueAccessor="value" colorAccessor="label" colorPalette={chart.rows.map(r => ({ key: r.label, value: r.color }))} height={300} showMarkLabels />
        : <HorizontalBarChart title={chart.title} data={chart.rows} xAccessor="label" yAccessor="value" colorAccessor="label" colorPalette={chart.rows.map(r => ({ key: r.label, value: r.color }))} height={260} />
        : <SectionMessage title={chart.title}><Text>{chart.empty}</Text></SectionMessage>}
      <Text>{chart.note}</Text>
    </Stack>
  </Box>)}</Stack>;
}

export function QualitySnapshotView({ data, configuredSnapshot = "", setSnapshotId = () => {} }: { data: Quality; configuredSnapshot?: string; setSnapshotId?: (id: string) => void }) {
  const execution = data.snapshot.execution;
  const outcomeCount = (key: string) => execution.outcomes.filter(item => item.key === key).reduce((sum, item) => sum + item.count, 0);
  const chartData = execution.outcomes.filter(item => item.count > 0).map(item => ({ outcome: label(item.key), count: item.count }));
  const planned = execution.plannedCaseRunPairs;
  // Absence is not zero: never claim completed planning without both counts.
  const remaining = execution.notRecordedCaseRunPairs;
  const hasPlanProgress = planned !== undefined && planned > 0 && remaining !== undefined && remaining >= 0 && remaining <= planned;
  return <Stack space="space.300">
        <Box xcss={surface}><Stack space="space.100">
          <Heading as="h2">{data.snapshot.title}</Heading>
          <Text>
            {data.snapshot.projectName}
            {data.snapshot.scope?.releaseName
              ? ` · ${data.snapshot.scope.releaseName}`
              : ""}
          </Text>
          <Inline space="space.050">
            <Lozenge
              appearance={data.mode === "FROZEN" ? "default" : "inprogress"}
            >
              {data.mode === "FROZEN"
                ? "Frozen snapshot"
                : data.mode === "LIVE" ? "Live · refreshes every minute" : "Latest approved snapshot"}
            </Lozenge>
            <Text>
              Captured {new Date(data.snapshot.asOf).toLocaleString()}
            </Text>
          </Inline>
        </Stack></Box>
          {data.available.length > 1 && !configuredSnapshot && (
            <>
              <Label labelFor="quality-snapshot">Approved capture</Label>
              <Select
                inputId="quality-snapshot"
                options={[
                  { value: "", label: "Latest approved" },
                  ...data.available.map((s) => ({
                    value: s.id,
                    label: `${s.title} · ${new Date(s.asOf).toLocaleString()}`,
                  })),
                ]}
                onChange={(option) =>
                  setSnapshotId(
                    option && !Array.isArray(option) ? option.value : "",
                  )
                }
              />
            </>
          )}
          {data.visuals ? <NativeQualityVisuals model={data.visuals} /> : <>
          <Inline space="space.150" shouldWrap>
            <Metric title="Recorded Pass" value={outcomeCount("PASS")} tone="success" />
            <Metric title="Failed observations" value={outcomeCount("FAIL")} tone="danger" />
            <Metric title="Blocked observations" value={outcomeCount("BLOCKED")} tone="warning" />
            <Metric title="Validation runs" value={execution.runs} />
          </Inline>
          <Box xcss={surface}><Stack space="space.150">
          <Heading as="h3">Execution overview</Heading>
          {execution.results > 0 && chartData.length > 0 ? (
            <DonutChart
              title="Recorded test outcomes"
              data={chartData}
              colorPalette={outcomeColors}
              colorAccessor="outcome"
              labelAccessor="outcome"
              valueAccessor="count"
              height={280}
              showMarkLabels
            />
          ) : (
            <SectionMessage title="No results yet"><Text>This approved capture contains no recorded test outcomes. Run tests in Vaettir and approve a new capture to see the outcome breakdown. Readiness has not been assessed.</Text></SectionMessage>
          )}
          <Text>
            {data.snapshot.execution.runs} runs ·{" "}
            {data.snapshot.execution.distinctCases} distinct cases with results
            · {data.snapshot.execution.results} recorded observations
          </Text>
          {hasPlanProgress ? (
            <>
              <Text>
                {planned - remaining} of {planned} planned case/run pairs have recorded observations · {remaining} not recorded
              </Text>
              <ProgressBar
                value={
                  1 - remaining / planned
                }
              />
            </>
          ) : <Text>{planned === 0 ? "No planned case/run pairs in this capture." : "Planned progress is unavailable in this capture."}</Text>}
          </Stack></Box>
          </>}
          <Box xcss={surface}><Stack space="space.150">
          <Heading as="h3">Validation runs in this capture</Heading>
          {data.runLinks.map((run) => (
            <Text key={run.id}>
              <Link href={run.href} openNewTab>
                {new Date(run.startedAt).toLocaleString()} · {run.id}
              </Link>
            </Text>
          ))}
          {!data.runLinks.length && (
            <Text>
              {execution.runs === 0 ? "No validation runs in this capture." : "Run references were not retained in this capture. Open the private report for available evidence."}
            </Text>
          )}
          </Stack></Box>
          <Text>
            <Link href={data.reportUrl} openNewTab>
              Open private report and evidence in Vaettir
            </Link>
          </Text>
          <Text>Approved snapshot · Not a live feed or issue-specific execution proof.</Text>
          <EvidenceNotes limitations={data.snapshot.limitations} notice={data.notice} />
    </Stack>;
}
function ReleaseView({ data }: { data: Release }) {
  const [showTests, setShowTests] = useState(false),
    [page, setPage] = useState(0);
  const outcomes = [
    "pass",
    "fail",
    "blocked",
    "skipped",
    "flaky",
    "mixed",
    "ambiguous",
    "notRecorded",
  ] as const;
  const attention = data.tests.filter(
    (t) => t.outcome !== "PASS" || t.reviewStatus !== "APPROVED",
  );
  return (
    <Stack space="space.200">
      <Heading as="h2">{data.releaseName}</Heading>
      <Inline space="space.100">
        <Lozenge appearance={data.mode === "FROZEN" ? "default" : "inprogress"}>
          {data.mode === "FROZEN"
            ? "Historical release capture"
            : "Current release metrics"}
        </Lozenge>
        <Text>Jira · {data.jiraVersionName}</Text>
      </Inline>
      <Text>Captured {new Date(data.capturedAt).toLocaleString()}</Text>
      {!data.visuals && <Inline space="space.150" shouldWrap>
        <Metric title="Planned tests" value={data.counts.planned} />
        <Metric title="Recorded Pass" value={data.counts.pass} tone="success" />
        <Metric title="Failing tests" value={data.counts.fail} tone="danger" />
        <Metric title="Not recorded" value={data.counts.notRecorded} tone="warning" />
      </Inline>}
      {data.mode === "RELEASED_CAPTURE_UNAVAILABLE" && (
        <SectionMessage
          appearance="warning"
          title="Historical capture unavailable"
        >
          <Text>
            Jira is Released, but no verified notification capture is retained.
            The metrics below are current, not reconstructed release-time
            evidence.
          </Text>
        </SectionMessage>
      )}
      {data.visuals ? <NativeQualityVisuals model={data.visuals} /> : <>
      <Heading as="h3">Test progress</Heading>
      <Text>
        {data.counts.recorded} of {data.counts.planned} planned tests have
        recorded results · {data.counts.pass} recorded Pass ·{" "}
        {data.counts.notRecorded} not recorded
      </Text>
      {data.counts.planned > 0 ? <ProgressBar
        value={
          Math.min(1, Math.max(0, data.counts.recorded / data.counts.planned))
        }
      /> : <SectionMessage title="No planned tests yet"><Text>Link a test plan to this release in Vaettir to track its validation progress. No release-readiness conclusion is available.</Text></SectionMessage>}
      {data.counts.planned > 0 && (
        <DonutChart
          title="Latest validation outcomes"
          colorPalette={outcomeColors}
          data={outcomes
            .filter((k) => data.counts[k] > 0)
            .map((k) => ({
              outcome:
                k === "notRecorded" ? "Not recorded" : label(k.toUpperCase()),
              count: data.counts[k],
            }))}
          colorAccessor="outcome"
          labelAccessor="outcome"
          valueAccessor="count"
          height={280}
          showMarkLabels
        />
      )}
      </>}
      <Heading as="h3">Failures and release concerns</Heading>
      <Text>
        {data.recordedFailures} failure observations across selected runs ·{" "}
        {data.failedRuns} failed runs · {data.counts.blocked} blocked tests ·{" "}
        {data.counts.flaky} flaky · {data.counts.mixed} mixed ·{" "}
        {data.counts.ambiguous} ambiguous
      </Text>
      {data.risks.map((r) => (
        <Text key={r.severity}>
          {label(r.severity)} · {r.count} unresolved release risks
        </Text>
      ))}
      {(data.unmatchedObservations > 0 ||
        data.outsideCohortObservations > 0) && (
        <HelperMessage>
          {data.unmatchedObservations} unmatched observations and{" "}
          {data.outsideCohortObservations} observations outside the release
          cohort are excluded from its case progress.
        </HelperMessage>
      )}
      <Heading as="h3">Validation runs</Heading>
      {!data.runs.length && (
        <Text>
          No validation runs have been selected. No passing result has been
          inferred.
        </Text>
      )}
      {data.runs.map((r) => (
        <Stack key={r.id} space="space.050">
          <Text>
            <Link href={r.href} openNewTab>
              {label(r.status)} · {new Date(r.startedAt).toLocaleString()}
            </Link>
          </Text>
          <HelperMessage>
            {r.branch || "No branch"} · {r.commitSha || "No recorded revision"}
            {!r.finishedAt ? " · Run is not finished" : ""}
          </HelperMessage>
        </Stack>
      ))}
      <Button onClick={() => setShowTests((value) => !value)}>
        {showTests
          ? "Hide tests needing attention"
          : `Show tests needing attention (${data.totalAttention})`}
      </Button>
      {data.testsLimited && (
        <HelperMessage>
          Showing the first 100 tests needing attention. Full captured
          definitions and the complete cohort are retained privately in Vaettir,
          not truncated from the historical capture.
        </HelperMessage>
      )}
      {showTests && (
        <Stack space="space.100">
          {attention.slice(page * 20, (page + 1) * 20).map((t) => (
            <Stack key={t.id} space="space.050">
              <Text>
                <Link href={t.href} openNewTab>
                  {t.displayId} · {t.title}
                </Link>
              </Text>
              <Text>
                {label(t.outcome)} · {label(t.reviewStatus)}
              </Text>
            </Stack>
          ))}
          <Inline space="space.100">
            <Button
              isDisabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous tests
            </Button>
            <Button
              isDisabled={(page + 1) * 20 >= attention.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Next tests
            </Button>
          </Inline>
        </Stack>
      )}
      <EvidenceNotes limitations={[]} notice={data.notice} />
    </Stack>
  );
}
export function MacroConfig() {
  return (
    <Stack space="space.100">
      <Label labelFor="connectionKey">
        Approved connection key (optional if only one project is shared)
      </Label>
      <Textfield id="connectionKey" name="connectionKey" />
      <Label labelFor="mode">Dashboard mode</Label>
      <Select name="mode" inputId="mode" defaultValue={{ value: "approved", label: "Latest approved capture" }} options={[{ value: "approved", label: "Latest approved capture" }, { value: "live", label: "Live quality dashboard" }]} />
      <Label labelFor="snapshotId">Frozen snapshot ID</Label>
      <Textfield id="snapshotId" name="snapshotId" />
      <Label labelFor="closureId">
        Historical release capture ID (instead of report snapshot)
      </Label>
      <Textfield id="closureId" name="closureId" />
      <HelperMessage>
        A snapshot or historical capture ID freezes the view and takes precedence over live mode. Live mode requires a separate live-sharing grant and refreshes every minute. Each refresh verifies current page access.
      </HelperMessage>
    </Stack>
  );
}
