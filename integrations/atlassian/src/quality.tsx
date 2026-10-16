import React, { useEffect, useState } from "react";
import {
  Button,
  CodeBlock,
  DonutChart,
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
} from "@forge/react";
import { invokeRemote } from "@forge/bridge";

type Connection = {
  key: string;
  projectName: string;
  shareTicketTests: boolean;
  hasSnapshots: boolean;
  hasReleases: boolean;
  hasClosures: boolean;
};
type Release = {
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
  protocol: "vaettir-quality/v1";
  mode: "FROZEN" | "LATEST_APPROVED";
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
async function remote(body: unknown) {
  const response = await invokeRemote({
    path: "/api/integrations/forge/quality",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (response.status !== 200 || !response.body)
    throw new Error(
      typeof response.body?.error === "string"
        ? response.body.error
        : "Vaettir quality is unavailable. Check the approved connection in Vaettir.",
    );
  return response.body;
}
const label = (value: string) =>
  value
    .split("_")
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(" ");
export function QualityApp({ macroConfig }: { macroConfig?: Record<string, unknown> }) {
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
      value: Ticket | Quality | Release;
    } | null>(null),
    [identity, setIdentity] = useState<{
      signature: string;
      binding: unknown;
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
      ])
    : "";
  const catalogPin = JSON.stringify([signature, key]);
  const pin = JSON.stringify([signature, key, snapshotId, selection]);
  const data = response?.pin === pin ? response.value : null;
  const connections =
    catalog?.signature === signature ? catalog.connections : [];
  const binding = identity?.signature === signature ? identity.binding : null;
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
          const identity = await remote({ action: "IDENTITY" });
          if (active) setIdentity({ signature, binding: identity.binding });
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
  }, [signature, configuredKey, configuredSnapshot]);
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
            : configuredClosure
              ? `closure:${configuredClosure}`
              : configuredSnapshot || connection?.hasSnapshots
                ? "report"
                : result.releases.length
                  ? `release:${result.releases[0].versionId}`
                  : result.closureIds.length
                    ? `closure:${result.closureIds[0]}`
                    : "report",
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
  }, [catalogPin, configuredClosure, configuredSnapshot]);
  useEffect(() => {
    if (!key || !signature || details?.pin !== catalogPin || !selection) return;
    let active = true;
    setResponse(null);
    setError("");
    setBusy(true);
    void remote({
      action: selection.startsWith("release:")
        ? "READ_RELEASE"
        : selection.startsWith("closure:")
          ? "READ_CLOSURE"
          : "READ",
      connectionKey: key,
      ...(selection.startsWith("release:")
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
            "vaettir-ticket-verification/v1",
            "vaettir-release-quality/v1",
          ].includes(result.protocol)
        )
          throw new Error("Unsupported Vaettir quality response.");
        setResponse({ pin, value: result as Ticket | Quality | Release });
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
  }, [key, snapshotId, signature, pin, reload, selection, details, catalogPin]);
  return (
    <Stack space="space.200">
      {!context && (contextUnavailable ? <SectionMessage appearance="warning" title="Atlassian page context unavailable"><Text>Reload this page to try again. No Vaettir data has been requested or shared.</Text></SectionMessage> : <Spinner label="Loading Atlassian page context" />)}
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
                  selection === "report"
                    ? "Approved quality capture"
                    : selection.startsWith("release:")
                      ? (details.releases.find(
                          (r) => `release:${r.versionId}` === selection,
                        )?.name ?? "Linked release")
                      : "Historical release capture",
              }}
              options={[
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
        </SectionMessage>
      )}
      {binding !== null && (
        <SectionMessage title="Approve a Vaettir project connection">
          <Text>
            In Vaettir, open your project’s Settings → Integrations and approve
            sharing to this specific Jira project or Confluence space.
            Architecture analysis and mappings stay in Vaettir.
          </Text>
          <CodeBlock language="json" text={JSON.stringify(binding, null, 2)} />
          <Text>
            <Link href="https://vaettir.skaldandstone.com/projects" openNewTab>
              Open Vaettir projects
            </Link>
          </Text>
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
            <Stack key={test.id} space="space.050">
              <Text>
                <Link href={test.href} openNewTab>
                  {test.displayId} · {test.title}
                </Link>
              </Text>
              <Inline space="space.050">
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
            </Stack>
          ))}
          <HelperMessage>{data.notice}</HelperMessage>
        </>
      )}
      {data?.protocol === "vaettir-quality/v1" && (
        <>
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
                : "Latest approved snapshot"}
            </Lozenge>
            <Text>
              Captured {new Date(data.snapshot.asOf).toLocaleString()}
            </Text>
          </Inline>
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
          {data.snapshot.execution.results > 0 ? (
            <DonutChart
              title="Recorded test outcomes"
              data={data.snapshot.execution.outcomes.map((o) => ({
                outcome: label(o.key),
                count: o.count,
              }))}
              colorAccessor="outcome"
              labelAccessor="outcome"
              valueAccessor="count"
              height={280}
              showMarkLabels
            />
          ) : (
            <Text>No recorded outcomes in this capture.</Text>
          )}
          <Text>
            {data.snapshot.execution.runs} runs ·{" "}
            {data.snapshot.execution.distinctCases} distinct cases with results
            · {data.snapshot.execution.results} recorded observations
          </Text>
          {data.snapshot.execution.plannedCaseRunPairs !== undefined && (
            <>
              <Text>
                {data.snapshot.execution.notRecordedCaseRunPairs ?? 0} /{" "}
                {data.snapshot.execution.plannedCaseRunPairs} planned case/run
                pairs not recorded
              </Text>
              <ProgressBar
                value={
                  data.snapshot.execution.plannedCaseRunPairs
                    ? Math.max(
                        0,
                        1 -
                          (data.snapshot.execution.notRecordedCaseRunPairs ??
                            0) /
                            data.snapshot.execution.plannedCaseRunPairs,
                      )
                    : 0
                }
              />
            </>
          )}
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
              Run references were not retained in this capture. No replacement
              run has been inferred.
            </Text>
          )}
          {data.snapshot.limitations.map((limitation, i) => (
            <HelperMessage key={i}>{limitation}</HelperMessage>
          ))}
          <HelperMessage>{data.notice}</HelperMessage>
          <Text>
            <Link href={data.reportUrl} openNewTab>
              Open private report and evidence in Vaettir
            </Link>
          </Text>
        </>
      )}
      {data?.protocol === "vaettir-release-quality/v1" && (
        <ReleaseView key={pin} data={data} />
      )}
      {key && (
        <Button
          isDisabled={busy}
          onClick={() => setReload((value) => value + 1)}
        >
          Refresh evidence
        </Button>
      )}
    </Stack>
  );
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
      <Heading as="h3">Test progress</Heading>
      <Text>
        {data.counts.recorded} of {data.counts.planned} planned tests have
        recorded results · {data.counts.pass} recorded Pass ·{" "}
        {data.counts.notRecorded} not recorded
      </Text>
      <ProgressBar
        value={
          data.counts.planned ? data.counts.recorded / data.counts.planned : 0
        }
      />
      {data.counts.planned > 0 && (
        <DonutChart
          title="Latest validation outcomes"
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
      <HelperMessage>{data.notice}</HelperMessage>
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
      <Label labelFor="snapshotId">Frozen snapshot ID</Label>
      <Textfield id="snapshotId" name="snapshotId" />
      <Label labelFor="closureId">
        Historical release capture ID (instead of report snapshot)
      </Label>
      <Textfield id="closureId" name="closureId" />
      <HelperMessage>
        Set an approved snapshot ID to freeze a historical capture. Leave blank
        to show the latest explicitly shared approved capture, not a real-time
        run feed.
      </HelperMessage>
    </Stack>
  );
}
