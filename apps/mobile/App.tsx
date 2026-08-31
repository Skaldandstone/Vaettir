import "./lib/telemetry";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, AppState, KeyboardAvoidingView, Linking, Platform, SafeAreaView, ScrollView, Text as NativeText, TextInput, View, StyleSheet, Button, Modal, Pressable, type TextProps } from "react-native";
import { StatusBar } from "expo-status-bar";
import { ClerkProvider, useAuth, useClerk, useSignIn } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { trpc, setAuthTokenGetter, setSessionExpiredHandler } from "./lib/trpc";
import { mobilePermissions } from "./lib/permissions";
import { readableError, canRevealWorkspace } from "./lib/recovery";

function Text(props: TextProps) { return <NativeText {...props} style={[{ color: "#eee7dc" }, props.style]} />; }
const WEB_URL = "https://vaettir.skaldandstone.com";
const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
function showLegalNotice() {
  Alert.alert("About Vaettir", "© 2026 Skald and Stone LLC\n\nOriginal studio work only. Customer content, third-party materials, and existing software licenses retain their own rights.");
}
function openWeb(path = "") {
  void Linking.openURL(`${WEB_URL}${path}`).catch(() => Alert.alert("Could not open browser", `Open ${WEB_URL}${path} in your browser to continue.`));
}

export default function App() {
  if (!CLERK_PUBLISHABLE_KEY) return <SafeAreaView style={styles.container}><Text>Vaettir is not configured. Install the latest beta build from your invitation.</Text></SafeAreaView>;
  return <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
    <StatusBar style="light" />
    <AuthScreens />
  </ClerkProvider>;
}

function AuthScreens() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  if (!isLoaded) return <SafeAreaView style={styles.container}><ActivityIndicator accessibilityLabel="Loading sign-in" color="#9aaf89" /><Text>Connecting to sign-in. If this does not finish, check your connection and reopen Vaettir.</Text></SafeAreaView>;
  return isSignedIn ? <SessionGate key={userId} /> : <SignInScreen />;
}

function SessionGate() {
  const { getToken, userId } = useAuth();
  const { signOut } = useClerk();
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [sessionError, setSessionError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const gate = { purged: false, foreground: AppState.currentState === "active", invalidated: false };
    setReady(false); setExpired(false); setSessionError(null);
    const reveal = () => { if (active) setReady(canRevealWorkspace(gate)); };
    setAuthTokenGetter(getToken);
    setSessionExpiredHandler(() => { gate.invalidated = true; setExpired(true); setReady(false); });
    // Remove only Vaettir's obsolete case cache; never touch Clerk's tokens
    // or another app's storage. Do not render data until migration completes.
    AsyncStorage.getAllKeys().then((keys) => AsyncStorage.multiRemove(keys.filter((key) => key.startsWith("vaettir:cases:"))))
      .then(() => { gate.purged = true; reveal(); })
      .catch(() => { if (active) setSessionError("Could not clear the old offline cache. Restart the app before continuing."); });
    const subscription = AppState.addEventListener("change", (state) => {
      // Hide project data in the task switcher and revalidate on return.
      gate.foreground = state === "active";
      if (gate.foreground) setEpoch((n) => n + 1);
      reveal();
    });
    return () => { active = false; subscription.remove(); setAuthTokenGetter(null); setSessionExpiredHandler(null); };
  }, [getToken, userId]);
  async function logout() {
    setReady(false); setExpired(true); setAuthTokenGetter(null);
    try { await signOut(); }
    catch { setExpired(true); setSessionError("Sign-out could not finish. Check your connection and try again."); }
  }
  if (expired || sessionError) return <SafeAreaView style={styles.container}>
    <Text style={styles.title}>Sign in again</Text>
    <Text>{sessionError ?? "Your session has expired. No project data is stored offline."}</Text>
    <Button title="Return to sign-in" onPress={() => void logout()} />
  </SafeAreaView>;
  if (!ready) return <SafeAreaView style={styles.container}><ActivityIndicator color="#9aaf89" accessibilityLabel="Checking session" /></SafeAreaView>;
  return <Companion key={`${userId}:${epoch}`} onSignOut={() => void logout()} />;
}

function Companion({ onSignOut }: { onSignOut: () => void }) {
  const [orgs, setOrgs] = useState<Awaited<ReturnType<typeof trpc.organization.mine.query>>>([]);
  const [orgId, setOrgId] = useState("");
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof trpc.project.list.query>>>([]);
  const [projectId, setProjectId] = useState("");
  const [view, setView] = useState<"cases" | "releases" | "compliance">("cases");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [allowance, setAllowance] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setOrgs([]); setOrgId(""); setProjects([]); setProjectId("");
    trpc.organization.mine.query().then((rows) => {
      if (active) { setOrgs(rows); setOrgId(rows[0]?.id ?? ""); }
    }).catch((e) => { if (active) setError(readableError(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  useEffect(() => {
    let active = true;
    setProjects([]); setProjectId(""); setAllowance(null);
    if (!orgId) return;
    setLoading(true); setError(null);
    Promise.all([
      trpc.project.list.query({ organizationId: orgId }),
      trpc.organization.seatUsage.query({ organizationId: orgId }),
      trpc.organization.aiCreditStatus.query({ organizationId: orgId }),
    ]).then(([rows, seats, credits]) => {
      if (!active) return;
      setProjects(rows); setProjectId(rows[0]?.id ?? "");
      setAllowance(`${seats.planTierName} · ${seats.fullSeatsUsed}/${seats.fullSeatsIncluded ?? "∞"} full seats (${seats.fullSeatsReserved} invited) · ${seats.readOnlySeatsUsed}/${seats.readOnlySeatsMax ?? "∞"} read-only (${seats.readOnlySeatsReserved} invited) · ${credits.balance} AI credits available, ${credits.includedPerMonth}/month${seats.privateBeta ? ", no rollover or automatic overage" : ""}`);
    }).catch((e) => { if (active) setError(readableError(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orgId]);
  const permissions = mobilePermissions(orgs.find((o) => o.id === orgId));
  return <SafeAreaView style={styles.container}>
    <View style={styles.header}><View><Text style={styles.eyebrow}>PRIVATE BETA</Text><Text style={styles.title}>vaettir</Text></View><Button title="Sign out" onPress={onSignOut} color="#9aaf89" /></View>
    <ScrollView horizontal style={styles.selector} contentContainerStyle={{ gap: 8 }}>
      {orgs.map((org) => <Pressable accessibilityRole="button" accessibilityState={{ selected: org.id === orgId }} key={org.id} style={[styles.chip, org.id === orgId && styles.selectedChip]} onPress={() => { if (org.id === orgId) return; setProjectId(""); setProjects([]); setAllowance(null); setOrgId(org.id); }}><Text>{org.name}</Text></Pressable>)}
    </ScrollView>
    {allowance && <Text style={styles.rowMeta}>{allowance}</Text>}
    <ScrollView horizontal style={styles.selector} contentContainerStyle={{ gap: 8 }}>
      {projects.map((project) => <Pressable accessibilityRole="button" accessibilityState={{ selected: project.id === projectId }} key={project.id} style={[styles.chip, project.id === projectId && styles.selectedChip]} onPress={() => setProjectId(project.id)}><Text>{project.name}</Text></Pressable>)}
    </ScrollView>
    {loading && <ActivityIndicator color="#9aaf89" accessibilityLabel="Loading workspace" />}
    {error && <ErrorNotice message={error} retry={() => setRetry((n) => n + 1)} />}
    {!loading && !error && orgs.length === 0 && <View style={styles.panel}><Text style={styles.rowTitle}>Your workspace starts with an invitation</Text><Text>Accept your invitation on the web with this account, then refresh here.</Text><Button title="Open Vaettir on the web" onPress={() => openWeb()} /></View>}
    {!loading && !error && orgId && projects.length === 0 && <Text>No projects yet. Create your first project on the web.</Text>}
    {!loading && !error && projectId && <View key={`${orgId}:${projectId}`} style={{ flex: 1 }}>
      <View style={styles.tabs}>{(["cases", "releases", "compliance"] as const).map((tab) => <Pressable key={tab} accessibilityRole="button" accessibilityState={{ selected: view === tab }} style={[styles.chip, view === tab && styles.selectedChip]} onPress={() => setView(tab)}><Text>{tab === "cases" ? "Cases" : tab === "releases" ? "Releases" : "Compliance"}</Text></Pressable>)}</View>
      {view === "cases" && <CaseList projectId={projectId} canReview={permissions.canReview} />}
      {view === "releases" && <ReleaseReadinessList projectId={projectId} />}
      {view === "compliance" && <ComplianceSignOffList projectId={projectId} canSignOff={permissions.canSignOff} />}
    </View>}
    <Button title="Refresh workspace" disabled={loading} onPress={() => setRetry((n) => n + 1)} />
    <Button title="About Vaettir and legal" onPress={showLegalNotice} />
    <Pressable accessibilityRole="link" style={{ paddingVertical: 12 }} onPress={() => openWeb("/beta-guide")}><Text style={styles.rowMeta}>Beta guide, data policy, and support</Text></Pressable>
  </SafeAreaView>;
}

function ErrorNotice({ message, retry }: { message: string; retry: () => void }) {
  return <View style={styles.panel}><Text accessibilityRole="alert" style={{ color: "#dfb49b" }}>{message}</Text><Button title="Retry" onPress={retry} /></View>;
}
function CaseList({ projectId, canReview }: { projectId: string; canReview: boolean }) {
  const [cases, setCases] = useState<Awaited<ReturnType<typeof trpc.testCases.list.query>>>([]);
  const [id, setId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => setRetry((n) => n + 1), []);
  useEffect(() => {
    let active = true; setCases([]); setError(null); setLoading(true);
    trpc.testCases.list.query({ projectId }).then((rows) => { if (active) setCases(rows); })
      .catch((e) => { if (active) { setId(null); setError(readableError(e)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, retry]);
  if (loading) return <ActivityIndicator color="#9aaf89" accessibilityLabel="Loading test cases" />;
  if (error) return <ErrorNotice message={error} retry={load} />;
  return <>
    <ScrollView>{cases.map((tc) => <Pressable accessibilityRole="button" key={tc.id} style={styles.row} onPress={() => setId(tc.id)}><Text style={styles.rowTitle}>{tc.title}</Text><Text style={styles.rowMeta}>{tc.testType} · {tc.origin}</Text></Pressable>)}
      {cases.length === 0 && <Text>No test cases yet. Import or create cases on the web.</Text>}
      <Button title="Refresh cases" onPress={load} />
    </ScrollView>
    <TestCaseDetailModal key={id ?? "closed"} id={id} canReview={canReview} onClose={() => setId(null)} onChanged={load} />
  </>;
}

// P8-03: the highest-value mobile use case for release readiness is
// "check status from your phone," not full authoring - a plain read-only
// list, no status/criteria/risk-flag mutation anywhere here. Reuses
// releases.list exactly as the web releases page's summary view does
// (score/label/criteria counts/open risk flags in one call), so this can
// never disagree with what the web dashboard shows for the same release.
const READINESS_COLOR: Record<string, string> = { READY: "#a9c991", AT_RISK: "#e8c573", BLOCKED: "#f0a19a" };

function ReleaseReadinessList({ projectId }: { projectId: string }) {
  const [releases, setReleases] = useState<Awaited<ReturnType<typeof trpc.releases.list.query>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setReleases([]); setLoading(true); setError(null);
    trpc.releases.list.query({ projectId })
      .then((rows) => { if (active) setReleases(rows); })
      .catch((e) => { if (active) setError(readableError(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, retry]);

  if (loading) return <ActivityIndicator color="#9aaf89" accessibilityLabel="Loading releases" />;
  if (error) return <ErrorNotice message={error} retry={() => setRetry((n) => n + 1)} />;

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
            <Text style={[styles.rowMeta, { color: "#f0a19a" }]}>
              {r.readiness.riskFlags.openTotal} open risk flag{r.readiness.riskFlags.openTotal === 1 ? "" : "s"}
              {r.readiness.riskFlags.critical > 0 && ` (${r.readiness.riskFlags.critical} critical)`}
            </Text>
          )}
        </View>
      ))}
      {releases.length === 0 && <Text style={styles.rowMeta}>No releases in this project yet.</Text>}
      <Button title="Refresh releases" onPress={() => setRetry((n) => n + 1)} />
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
function ComplianceSignOffList({ projectId, canSignOff }: { projectId: string; canSignOff: boolean }) {
  const [frameworks, setFrameworks] = useState<Awaited<ReturnType<typeof trpc.compliance.listFrameworks.query>>>([]);
  const [frameworkId, setFrameworkId] = useState<string | null>(null);
  const [controls, setControls] = useState<Awaited<ReturnType<typeof trpc.compliance.controlCoverage.query>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [openControl, setOpenControl] = useState<{ id: string; code: string; title: string } | null>(null);

  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; setError(null); setLoading(true);
    trpc.compliance.listFrameworks.query().then((rows) => {
      if (active) { setFrameworks(rows); setFrameworkId(rows[0]?.id ?? null); if (!rows.length) setLoading(false); }
    }).catch((e) => { if (active) { setError(readableError(e)); setLoading(false); } });
    return () => { active = false; };
  }, [retry]);

  useEffect(() => {
    let active = true; setControls([]); setOpenControl(null);
    if (!frameworkId) return;
    setLoading(true); setError(null);
    trpc.compliance.controlCoverage.query({ projectId, frameworkId })
      .then((rows) => { if (active) setControls(rows); })
      .catch((e) => { if (active) setError(readableError(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, frameworkId, retry]);
  if (loading) return <ActivityIndicator color="#9aaf89" accessibilityLabel="Loading compliance" />;
  if (error) return <ErrorNotice message={error} retry={() => setRetry((n) => n + 1)} />;

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
          <Pressable accessibilityRole="button" key={c.id} style={styles.row} onPress={() => setOpenControl({ id: c.id, code: c.code, title: c.title })}>
            <Text style={styles.rowTitle}>
              {c.code} · {c.title}
            </Text>
            <Text style={styles.rowMeta}>{c.mappedTestCaseCount} test case(s) mapped</Text>
          </Pressable>
        ))}
        {frameworkId && controls.length === 0 && <Text style={styles.rowMeta}>No controls in this framework yet.</Text>}
        {!frameworkId && <Text style={styles.rowMeta}>No compliance frameworks configured yet.</Text>}
      </ScrollView>
      <SignOffModal key={openControl?.id ?? "closed"} canSignOff={canSignOff} projectId={projectId} control={openControl} onClose={() => setOpenControl(null)} />
    </View>
  );
}

function SignOffModal({
  projectId,
  canSignOff,
  control,
  onClose,
}: {
  projectId: string;
  canSignOff: boolean;
  control: { id: string; code: string; title: string } | null;
  onClose: () => void;
}) {
  const [signOffs, setSignOffs] = useState<Awaited<ReturnType<typeof trpc.compliance.listSignOffs.query>>>([]);
  const [period, setPeriod] = useState("");
  const [statement, setStatement] = useState("");
  const [signingOff, setSigningOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [success, setSuccess] = useState(false);
  const load = () => setRetry((n) => n + 1);
  useEffect(() => {
    let active = true;
    setError(null); setSignOffs([]); setLoading(true);
    if (!control) { setLoading(false); return; }
    trpc.compliance.listSignOffs
      .query({ projectId, controlId: control.id })
      .then((rows) => { if (active) setSignOffs(rows); })
      .catch((e) => { if (active) setError(readableError(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [control?.id, projectId, retry]);

  async function signOff() {
    if (!canSignOff || signingOff || loading || !control || !period.trim() || !statement.trim()) return;
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
      setSuccess(true);
      load();
    } catch (e) {
      setError(`${readableError(e)} Refresh the history before submitting again; the sign-off may already have been recorded.`);
    } finally {
      setSigningOff(false);
    }
  }

  return (
    <Modal visible={control !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <Button title="Close" onPress={onClose} disabled={signingOff} />
        {control && (
          <ScrollView style={{ marginTop: 12 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{control.code}</Text>
            <Text style={styles.rowMeta}>{control.title}</Text>

            {success && <Text accessibilityRole="alert">Sign-off recorded.</Text>}
            {loading && <ActivityIndicator color="#9aaf89" accessibilityLabel="Loading sign-off history" />}
            {error && <ErrorNotice message={error} retry={load} />}
            {!error && !loading && canSignOff && <View style={styles.bddSection}>
              <Text style={styles.bddLabel}>Sign off on this control</Text>
              <TextInput accessibilityLabel="Sign-off period" placeholderTextColor="#a9a196" style={styles.input} placeholder="Period (e.g. 2026-Q3)" value={period} onChangeText={setPeriod} editable={!signingOff} />
              <TextInput
                style={[styles.input, { minHeight: 80 }]}
                accessibilityLabel="Attestation statement"
                placeholderTextColor="#a9a196"
                placeholder="Attestation statement - what was reviewed and why it's operating effectively"
                value={statement}
                onChangeText={setStatement}
                multiline
                editable={!signingOff}
              />
              <Button
                title={signingOff ? "Signing…" : "Sign off"}
                onPress={signOff}
                disabled={signingOff || !period.trim() || !statement.trim()}
              />
            </View>}

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
              {!loading && !error && signOffs.length === 0 && <Text style={styles.rowMeta}>No sign-offs recorded yet for this control.</Text>}
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView></SafeAreaView>
    </Modal>
  );
}

// P8-02: test case detail + BDD view in mobile, plus the AI review-queue
// approval flow (parity with web's detail drawer's Approve/Reject).
// Read-only-viewer-safe: buttons only render when reviewStatus is
// actually PENDING_REVIEW, and the server still enforces EDITOR+
// regardless of what this UI shows.
function TestCaseDetailModal({ id, canReview, onClose, onChanged }: { id: string | null; canReview: boolean; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof trpc.testCases.byId.query>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [retry, setRetry] = useState(0);
  const load = () => setRetry((n) => n + 1);
  useEffect(() => {
    let active = true;
    setError(null); setDetail(null);
    if (!id) return;
    trpc.testCases.byId
      .query({ id })
      .then((row) => { if (active) setDetail(row); })
      .catch((e) => { if (active) setError(readableError(e)); });
    return () => { active = false; };
  }, [id, retry]);

  async function review(decision: "approve" | "reject") {
    if (!id || !canReview || reviewing || detail?.reviewStatus !== "PENDING_REVIEW") return;
    setReviewing(true);
    setError(null);
    try {
      await trpc.testCases[decision].mutate({ id, note: reviewNote || undefined });
      setReviewNote("");
      onClose();
      onChanged();
    } catch (e) {
      setError(`${readableError(e)} Refresh this case to check whether the review was saved before trying again.`);
    } finally {
      setReviewing(false);
    }
  }

  return (
    <Modal visible={id !== null} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <Button title="Close" onPress={onClose} disabled={reviewing} />
        {error && <ErrorNotice message={error} retry={load} />}
        {!error && !detail && <Text>Loading…</Text>}
        {!error && detail && (
          <ScrollView style={{ marginTop: 12 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{detail.title}</Text>
            <Text style={styles.rowMeta}>
              {detail.testType} · {detail.priority} · {detail.origin} · {detail.reviewStatus}
            </Text>

            {canReview && detail.reviewStatus === "PENDING_REVIEW" && (
              <View style={styles.bddSection}>
                <Text style={styles.bddLabel}>Review</Text>
                <TextInput
                  style={styles.input}
                  accessibilityLabel="Review note"
                  placeholderTextColor="#a9a196"
                  placeholder="Optional note"
                  value={reviewNote}
                  onChangeText={setReviewNote}
                  editable={!reviewing}
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
      </KeyboardAvoidingView></SafeAreaView>
    </Modal>
  );
}

function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit() {
    if (!isLoaded || busy) return;
    setBusy(true); setError(null);
    try {
      const attempt = mfa
        ? await signIn.attemptSecondFactor({ strategy: "totp", code })
        : await signIn.create({ identifier: email.trim(), password });
      if (attempt.status === "complete") {
        setPassword(""); setCode("");
        await setActive({ session: attempt.createdSessionId });
      } else if (attempt.status === "needs_second_factor" && attempt.supportedSecondFactors?.some((factor) => factor.strategy === "totp")) {
        setMfa(true); setPassword("");
      } else {
        setError("This account needs an additional verification step. Open Vaettir on the web to complete account setup, or contact your beta support contact.");
      }
    } catch (e) { setError(readableError(e)); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.container}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}><ScrollView keyboardShouldPersistTaps="handled">
    <Text style={styles.eyebrow}>QUALITY, WITH CONTEXT</Text><Text style={styles.title}>vaettir</Text>
    <Text style={{ marginBottom: 24 }}>Your team's quality companion. Sign in with your invited account.</Text>
    {mfa ? <><Text>Authenticator code</Text><TextInput accessibilityLabel="Authenticator code" style={styles.input} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" /></> : <>
      <Text>Email</Text><TextInput accessibilityLabel="Email" style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
      <Text>Password</Text><TextInput accessibilityLabel="Password" style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
    </>}
    <Button title={busy ? "Signing in..." : mfa ? "Verify code" : "Sign in"} onPress={() => void onSubmit()} disabled={!isLoaded || busy || (mfa ? !code : !email || !password)} color="#9aaf89" />
    {error && <Text accessibilityRole="alert" style={{ color: "#dfb49b", marginTop: 12 }}>{error}</Text>}
    {mfa && <Button title="Use a different account" disabled={busy} onPress={() => { setMfa(false); setCode(""); setPassword(""); setError(null); }} />}
    <Button title="Accept invitation or recover account on web" onPress={() => openWeb()} />
    <Text style={styles.rowMeta}>Private beta. No offline project storage. Use non-regulated data only.</Text>
    <Text style={styles.rowMeta}>© 2026 Skald and Stone LLC</Text>
    <Button title="About Vaettir and legal" onPress={showLegalNotice} />
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: Platform.OS === "android" ? 38 : 12, paddingHorizontal: 20, backgroundColor: "#26211B" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  eyebrow: { fontSize: 10, letterSpacing: 2, color: "#9aaf89", marginBottom: 6 },
  title: { fontSize: 30, fontWeight: "600", marginBottom: 12, color: "#eee7dc" },
  input: { borderWidth: 1, borderColor: "#566151", borderRadius: 8, padding: 12, marginVertical: 8, color: "#eee7dc", backgroundColor: "#312b23" },
  selector: { flexGrow: 0, maxHeight: 60, marginVertical: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: "#485044", minHeight: 44 },
  selectedChip: { backgroundColor: "#394734", borderColor: "#9aaf89" },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 12 },
  panel: { backgroundColor: "#242b24", padding: 16, borderRadius: 12, gap: 10 },
  row: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#374033" },
  rowTitle: { fontSize: 17, fontWeight: "600", marginBottom: 6 },
  rowMeta: { fontSize: 12, lineHeight: 18, color: "#bac2b1" },
  bddSection: { marginTop: 16 },
  bddLabel: { fontSize: 12, fontWeight: "700", color: "#9aaf89", marginTop: 10, textTransform: "uppercase" },
  bddLine: { fontSize: 15, lineHeight: 22, marginTop: 4 },
});
