import { useEffect, useState } from "react";
import { SafeAreaView, ScrollView, Text, TextInput, View, StyleSheet, Button, Modal, Pressable } from "react-native";
import { StatusBar } from "expo-status-bar";
import { ClerkProvider, SignedIn, SignedOut, useAuth, useSignIn } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { trpc, setAuthTokenGetter } from "./lib/trpc";

// P8-06: offline-friendly read caching. A spotty connection shouldn't
// blank the test case list to nothing - show the last-known-good data
// immediately, then refresh in the background. On a genuine fetch
// failure (offline, server down), keep showing the cache instead of
// replacing it with an error screen; the error is surfaced as a small
// banner, not a full-screen blocker.
const CASES_CACHE_KEY_PREFIX = "vaettir:cases:";

async function readCachedCases(projectId: string): Promise<Awaited<ReturnType<typeof trpc.testCases.list.query>> | null> {
  try {
    const raw = await AsyncStorage.getItem(CASES_CACHE_KEY_PREFIX + projectId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeCachedCases(projectId: string, cases: Awaited<ReturnType<typeof trpc.testCases.list.query>>) {
  try {
    await AsyncStorage.setItem(CASES_CACHE_KEY_PREFIX + projectId, JSON.stringify(cases));
  } catch {
    // Best-effort - a full disk or a storage-denied environment shouldn't
    // break the live fetch path, only the offline fallback.
  }
}

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function App() {
  if (!CLERK_PUBLISHABLE_KEY) {
    throw new Error("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not set");
  }
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <StatusBar style="auto" />
      <SignedIn>
        <TestCaseBrowser />
      </SignedIn>
      <SignedOut>
        <SignInScreen />
      </SignedOut>
    </ClerkProvider>
  );
}

// Wires the tRPC client's token source to Clerk's session once signed in --
// see lib/trpc.ts for why this can't just call useAuth() itself.
function TestCaseBrowser() {
  const { getToken } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(getToken);
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  const [projectId, setProjectId] = useState("");
  const [view, setView] = useState<"cases" | "releases" | "compliance">("cases");
  const [cases, setCases] = useState<Awaited<ReturnType<typeof trpc.testCases.list.query>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [showingCached, setShowingCached] = useState(false);

  function loadCases() {
    if (!projectId) return;
    trpc.testCases.list
      .query({ projectId })
      .then((fresh) => {
        setCases(fresh);
        setShowingCached(false);
        setError(null);
        writeCachedCases(projectId, fresh);
      })
      .catch((e) => {
        // Fetch failed (offline, server down) - fall back to whatever was
        // last successfully cached rather than blanking the list. Only
        // surfaces an error if there's no cache to fall back to either.
        readCachedCases(projectId).then((cached) => {
          if (cached) {
            setCases(cached);
            setShowingCached(true);
          } else {
            setError(e instanceof Error ? e.message : String(e));
          }
        });
      });
  }

  // Paint the cache immediately on project switch, before the network
  // round-trip resolves, then loadCases() below refreshes it live.
  useEffect(() => {
    if (!projectId) return;
    readCachedCases(projectId).then((cached) => {
      if (cached) {
        setCases(cached);
        setShowingCached(true);
      }
    });
  }, [projectId]);

  useEffect(loadCases, [projectId]);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Vaettir</Text>
      <TextInput
        style={styles.input}
        placeholder="Project ID"
        value={projectId}
        onChangeText={setProjectId}
      />
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        <Button title="Test Cases" onPress={() => setView("cases")} disabled={view === "cases"} />
        <Button title="Releases" onPress={() => setView("releases")} disabled={view === "releases"} />
        <Button title="Compliance" onPress={() => setView("compliance")} disabled={view === "compliance"} />
      </View>
      {error && <Text style={{ color: "crimson" }}>{error}</Text>}
      {view === "cases" && (
        <>
          {showingCached && !error && <Text style={styles.rowMeta}>Showing cached data - couldn&apos;t reach the server.</Text>}
          <ScrollView>
            {cases.map((tc) => (
              <Pressable key={tc.id} style={styles.row} onPress={() => setOpenCaseId(tc.id)}>
                <Text style={styles.rowTitle}>{tc.title}</Text>
                <Text style={styles.rowMeta}>
                  {tc.testType} {tc.origin === "AI_REVERSE_ENGINEERED" ? "· AI-reversed" : ""}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
      {view === "releases" && <ReleaseReadinessList projectId={projectId} />}
      {view === "compliance" && <ComplianceSignOffList projectId={projectId} />}
      <TestCaseDetailModal id={openCaseId} onClose={() => setOpenCaseId(null)} onChanged={loadCases} />
    </SafeAreaView>
  );
}

// P8-03: the highest-value mobile use case for release readiness is
// "check status from your phone," not full authoring - a plain read-only
// list, no status/criteria/risk-flag mutation anywhere here. Reuses
// releases.list exactly as the web releases page's summary view does
// (score/label/criteria counts/open risk flags in one call), so this can
// never disagree with what the web dashboard shows for the same release.
const READINESS_COLOR: Record<string, string> = { READY: "#2e7d32", AT_RISK: "#b8860b", BLOCKED: "#c62828" };

function ReleaseReadinessList({ projectId }: { projectId: string }) {
  const [releases, setReleases] = useState<Awaited<ReturnType<typeof trpc.releases.list.query>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    trpc.releases.list
      .query({ projectId })
      .then(setReleases)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <Text>Loading…</Text>;
  if (error) return <Text style={{ color: "crimson" }}>{error}</Text>;

  return (
    <ScrollView>
      {releases.map((r) => (
        <View key={r.id} style={styles.row}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.rowTitle}>{r.name}</Text>
            <Text style={{ color: READINESS_COLOR[r.readiness.label] ?? "#666", fontWeight: "700" }}>
              {r.readiness.score}/100 · {r.readiness.label}
            </Text>
          </View>
          <Text style={styles.rowMeta}>
            {r.status}
            {r.targetDate && ` · target ${new Date(r.targetDate).toLocaleDateString()}`}
          </Text>
          <Text style={styles.rowMeta}>
            {r.readiness.criteria.met} met · {r.readiness.criteria.atRisk} at risk · {r.readiness.criteria.notMet} not met ·{" "}
            {r.readiness.criteria.pending} pending
          </Text>
          {r.readiness.riskFlags.openTotal > 0 && (
            <Text style={[styles.rowMeta, { color: "#c62828" }]}>
              {r.readiness.riskFlags.openTotal} open risk flag{r.readiness.riskFlags.openTotal === 1 ? "" : "s"}
              {r.readiness.riskFlags.critical > 0 && ` (${r.readiness.riskFlags.critical} critical)`}
            </Text>
          )}
        </View>
      ))}
      {releases.length === 0 && <Text style={styles.rowMeta}>No releases in this project yet.</Text>}
    </ScrollView>
  );
}

// P8-05 (compliance sign-off half): a real period + written-attestation
// form, same shape as the web compliance page's sign-off panel and
// calling the exact same signOffControl mutation - the server-side
// COMPLIANCE_AUDITOR/ADMIN/OWNER role check (compliance.ts) is the real
// gate regardless of what this screen shows, same as every other mobile
// mutation. Framework picker -> per-framework control list (reusing
// controlCoverage, so mapped-test-case counts can never disagree with
// web) -> tap a control to see its real sign-off history and sign a new
// one.
function ComplianceSignOffList({ projectId }: { projectId: string }) {
  const [frameworks, setFrameworks] = useState<Awaited<ReturnType<typeof trpc.compliance.listFrameworks.query>>>([]);
  const [frameworkId, setFrameworkId] = useState<string | null>(null);
  const [controls, setControls] = useState<Awaited<ReturnType<typeof trpc.compliance.controlCoverage.query>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [openControl, setOpenControl] = useState<{ id: string; code: string; title: string } | null>(null);

  useEffect(() => {
    trpc.compliance.listFrameworks
      .query()
      .then((fw) => {
        setFrameworks(fw);
        setFrameworkId((prev) => prev ?? fw[0]?.id ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (!projectId || !frameworkId) {
      setControls([]);
      return;
    }
    trpc.compliance.controlCoverage
      .query({ projectId, frameworkId })
      .then(setControls)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [projectId, frameworkId]);

  if (error) return <Text style={{ color: "crimson" }}>{error}</Text>;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal style={{ marginBottom: 8 }} showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {frameworks.map((fw) => (
            <Button
              key={fw.id}
              title={fw.name}
              onPress={() => setFrameworkId(fw.id)}
              disabled={fw.id === frameworkId}
            />
          ))}
        </View>
      </ScrollView>
      <ScrollView>
        {controls.map((c) => (
          <Pressable key={c.id} style={styles.row} onPress={() => setOpenControl({ id: c.id, code: c.code, title: c.title })}>
            <Text style={styles.rowTitle}>
              {c.code} · {c.title}
            </Text>
            <Text style={styles.rowMeta}>{c.mappedTestCaseCount} test case(s) mapped</Text>
          </Pressable>
        ))}
        {frameworkId && controls.length === 0 && <Text style={styles.rowMeta}>No controls in this framework yet.</Text>}
        {!frameworkId && <Text style={styles.rowMeta}>No compliance frameworks configured yet.</Text>}
      </ScrollView>
      <SignOffModal projectId={projectId} control={openControl} onClose={() => setOpenControl(null)} />
    </View>
  );
}

function SignOffModal({
  projectId,
  control,
  onClose,
}: {
  projectId: string;
  control: { id: string; code: string; title: string } | null;
  onClose: () => void;
}) {
  const [signOffs, setSignOffs] = useState<Awaited<ReturnType<typeof trpc.compliance.listSignOffs.query>>>([]);
  const [period, setPeriod] = useState("");
  const [statement, setStatement] = useState("");
  const [signingOff, setSigningOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!control) {
      setSignOffs([]);
      return;
    }
    trpc.compliance.listSignOffs
      .query({ projectId, controlId: control.id })
      .then(setSignOffs)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  useEffect(load, [control?.id]);

  async function signOff() {
    if (!control || !period.trim() || !statement.trim()) return;
    setSigningOff(true);
    setError(null);
    try {
      await trpc.compliance.signOffControl.mutate({
        projectId,
        controlId: control.id,
        period: period.trim(),
        statement: statement.trim(),
      });
      setPeriod("");
      setStatement("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSigningOff(false);
    }
  }

  return (
    <Modal visible={control !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <Button title="Close" onPress={onClose} />
        {control && (
          <ScrollView style={{ marginTop: 12 }}>
            <Text style={styles.title}>{control.code}</Text>
            <Text style={styles.rowMeta}>{control.title}</Text>

            <View style={styles.bddSection}>
              <Text style={styles.bddLabel}>Sign off on this control</Text>
              <TextInput style={styles.input} placeholder="Period (e.g. 2026-Q3)" value={period} onChangeText={setPeriod} />
              <TextInput
                style={[styles.input, { minHeight: 80 }]}
                placeholder="Attestation statement - what was reviewed and why it's operating effectively"
                value={statement}
                onChangeText={setStatement}
                multiline
              />
              <Button
                title={signingOff ? "Signing…" : "Sign off"}
                onPress={signOff}
                disabled={signingOff || !period.trim() || !statement.trim()}
              />
              {error && <Text style={{ color: "crimson" }}>{error}</Text>}
            </View>

            <View style={styles.bddSection}>
              <Text style={styles.bddLabel}>Sign-off history</Text>
              {signOffs.map((s) => (
                <View key={s.id} style={{ marginBottom: 10 }}>
                  <Text style={styles.rowTitle}>{s.period}</Text>
                  <Text style={styles.bddLine}>{s.statement}</Text>
                  <Text style={styles.rowMeta}>
                    {s.signedByEmail} · {new Date(s.signedAt).toLocaleDateString()}
                  </Text>
                </View>
              ))}
              {signOffs.length === 0 && <Text style={styles.rowMeta}>No sign-offs recorded yet for this control.</Text>}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// P8-02: test case detail + BDD view in mobile, plus the AI review-queue
// approval flow (parity with web's detail drawer's Approve/Reject).
// Read-only-viewer-safe: buttons only render when reviewStatus is
// actually PENDING_REVIEW, and the server still enforces EDITOR+
// regardless of what this UI shows.
function TestCaseDetailModal({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof trpc.testCases.byId.query>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);

  function load() {
    if (!id) {
      setDetail(null);
      return;
    }
    trpc.testCases.byId
      .query({ id })
      .then(setDetail)
      .catch((e) => setError(String(e)));
  }

  useEffect(load, [id]);

  async function review(decision: "approve" | "reject") {
    if (!id) return;
    setReviewing(true);
    setError(null);
    try {
      await trpc.testCases[decision].mutate({ id, note: reviewNote || undefined });
      setReviewNote("");
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(false);
    }
  }

  return (
    <Modal visible={id !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <Button title="Close" onPress={onClose} />
        {error && <Text style={{ color: "crimson" }}>{error}</Text>}
        {!error && !detail && <Text>Loading…</Text>}
        {detail && (
          <ScrollView style={{ marginTop: 12 }}>
            <Text style={styles.title}>{detail.title}</Text>
            <Text style={styles.rowMeta}>
              {detail.testType} · {detail.priority} · {detail.origin} · {detail.reviewStatus}
            </Text>

            {detail.reviewStatus === "PENDING_REVIEW" && (
              <View style={styles.bddSection}>
                <Text style={styles.bddLabel}>Review</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Optional note"
                  value={reviewNote}
                  onChangeText={setReviewNote}
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button title={reviewing ? "…" : "Approve"} onPress={() => review("approve")} disabled={reviewing} />
                  <Button title={reviewing ? "…" : "Reject"} onPress={() => review("reject")} disabled={reviewing} />
                </View>
              </View>
            )}

            {detail.given.length > 0 && (
              <View style={styles.bddSection}>
                <Text style={styles.bddLabel}>Given</Text>
                {detail.given.map((line, i) => (
                  <Text key={i} style={styles.bddLine}>{line}</Text>
                ))}
                <Text style={styles.bddLabel}>When</Text>
                {detail.when.map((line, i) => (
                  <Text key={i} style={styles.bddLine}>{line}</Text>
                ))}
                <Text style={styles.bddLabel}>Then</Text>
                {detail.then.map((line, i) => (
                  <Text key={i} style={styles.bddLine}>{line}</Text>
                ))}
              </View>
            )}

            {detail.steps.length > 0 && (
              <View style={styles.bddSection}>
                {detail.steps.map((step) => (
                  <View key={step.order} style={{ marginBottom: 10 }}>
                    <Text style={styles.bddLabel}>{detail.stepFieldLabels.action ?? "Step"} {step.order}</Text>
                    <Text style={styles.bddLine}>{step.action}</Text>
                    {step.expectedActionOrData && (
                      <Text style={styles.bddLine}>{detail.stepFieldLabels.expectedActionOrData}: {step.expectedActionOrData}</Text>
                    )}
                    {step.expectedResult && (
                      <Text style={styles.bddLine}>{detail.stepFieldLabels.expectedResult}: {step.expectedResult}</Text>
                    )}
                    {step.expectedResponse && (
                      <Text style={styles.bddLine}>{detail.stepFieldLabels.expectedResponse}: {step.expectedResponse}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {detail.tags.length > 0 && <Text style={styles.rowMeta}>Tags: {detail.tags.join(", ")}</Text>}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// Minimal sign-in form using Clerk's Expo password-strategy flow. A
// prettier UI (and sign-up) is Phase 8 (mobile parity) work -- this is
// enough to authenticate and get a session token for local testing.
function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!isLoaded) return;
    setError(null);
    try {
      const attempt = await signIn.create({ identifier: email, password });
      if (attempt.status === "complete") {
        await setActive({ session: attempt.createdSessionId });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Log in</Text>
      <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" />
      <TextInput style={styles.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <Button title="Log in" onPress={onSubmit} />
      {error && <Text style={{ color: "crimson" }}>{error}</Text>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 16 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, marginBottom: 12 },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#eee" },
  rowTitle: { fontSize: 16, fontWeight: "600" },
  rowMeta: { fontSize: 12, color: "#666" },
  bddSection: { marginTop: 16 },
  bddLabel: { fontSize: 12, fontWeight: "700", color: "#888", marginTop: 10, textTransform: "uppercase" },
  bddLine: { fontSize: 14, marginTop: 2 },
});
