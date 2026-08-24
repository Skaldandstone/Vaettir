import { useEffect, useState } from "react";
import { SafeAreaView, ScrollView, Text, TextInput, View, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { trpc } from "./lib/trpc";

// Minimal read-only test case browser. Shares the exact TestCase shape and
// tRPC contract with apps/web via @tci/api's AppRouter type + @tci/core.
export default function App() {
  const [projectId, setProjectId] = useState("");
  const [cases, setCases] = useState<Awaited<ReturnType<typeof trpc.testCases.list.query>>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    trpc.testCases.list
      .query({ projectId })
      .then(setCases)
      .catch((e) => setError(String(e)));
  }, [projectId]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Test Case Intelligence</Text>
      <TextInput
        style={styles.input}
        placeholder="Project ID"
        value={projectId}
        onChangeText={setProjectId}
      />
      {error && <Text style={{ color: "crimson" }}>{error}</Text>}
      <ScrollView>
        {cases.map((tc) => (
          <View key={tc.id} style={styles.row}>
            <Text style={styles.rowTitle}>{tc.title}</Text>
            <Text style={styles.rowMeta}>
              {tc.testType} {tc.origin === "AI_REVERSE_ENGINEERED" ? "· AI-reversed" : ""}
            </Text>
          </View>
        ))}
      </ScrollView>
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
});
