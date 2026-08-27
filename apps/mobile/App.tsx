import { useEffect, useState } from "react";
import { SafeAreaView, ScrollView, Text, TextInput, View, StyleSheet, Button, Modal, Pressable } from "react-native";
import { StatusBar } from "expo-status-bar";
import { ClerkProvider, SignedIn, SignedOut, useAuth, useSignIn } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import { trpc, setAuthTokenGetter } from "./lib/trpc";

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
  const [cases, setCases] = useState<Awaited<ReturnType<typeof trpc.testCases.list.query>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);

  function loadCases() {
    if (!projectId) return;
    trpc.testCases.list
      .query({ projectId })
      .then(setCases)
      .catch((e) => setError(String(e)));
  }

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
      {error && <Text style={{ color: "crimson" }}>{error}</Text>}
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
      <TestCaseDetailModal id={openCaseId} onClose={() => setOpenCaseId(null)} onChanged={loadCases} />
    </SafeAreaView>
  );
}

// P8-02/P8-05: test case detail + BDD view in mobile, plus the AI
// review-queue approval flow (parity with web's detail drawer's
// Approve/Reject) - the mobile compliance sign-off flow (the ticket's
// other half) needs a period + statement input, not just a tap, and isn't
// attempted here; this covers what the roadmap itself calls out as the
// clearer mobile-approvable action. Read-only-viewer-safe: buttons only
// render when reviewStatus is actually PENDING_REVIEW, and the server
// still enforces EDITOR+ regardless of what this UI shows.
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
