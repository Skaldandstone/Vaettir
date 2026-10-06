import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceCodeIncludes } from "./source-contract-tokens.mjs";
const provider = readFileSync(
  new URL("./trpcReact.tsx", import.meta.url),
  "utf8",
);
const runs = readFileSync(
  new URL("../app/projects/[projectId]/test-runs/page.tsx", import.meta.url),
  "utf8",
);
test("provider keeps installed observers and drafts mounted but advances actor/session namespace before descendant hooks", () => {
  assert.match(
    provider,
    /const \[queryClient\] = useState\(\(\) => new AuthQueryClient\(\)\)/,
  );
  assert.match(provider, /generation\.identity !== identity/);
  assert.match(provider, /number: generation\.number \+ 1/);
  assert.ok(
    provider.indexOf("queryClient.selectGeneration(generation)") <
      provider.indexOf("<trpcReact.Provider"),
  );
  assert.match(provider, /queryClient\.commitGeneration\(generation\)/);
  assert.doesNotMatch(
    provider,
    /key=\{|cancelMutations|queryClient\.clear\(|queryClient\.cancelQueries\(\)/,
  );
  assert.match(provider, /headers: \(\) => getAuthHeaders\(scope\)/);
});
test("CI detail uses the independently scoped reader instead of legacy body/cache/healing mutation callers", () => {
  assert.doesNotMatch(runs, /testRuns\.byId|LinkResultPicker|HealingSuggestionPanel|byTestResult|linkResultToTestCase|healingSuggestions\.(?:classify|review)/);
  assert.match(runs, /import \{ CiRunDetail \} from "@\/components\/CiRunDetail"/);
  assert.ok(sourceCodeIncludes(runs, '<CiRunDetail key={`${projectId}:${openRunId}`} projectId={projectId} testRunId={openRunId} organizationId={organizationId} active={Boolean(openRunId)} />'));
  assert.ok(sourceCodeIncludes(runs, '<Drawer open={Boolean(openRunId)} onClose={() => setOpenRunId(null)} title="CI run results">'));
  // Separate existing manual execution and dashboard scope must not disappear
  // merely because the unsafe CI detail caller was replaced.
  assert.match(runs, /<RunHistoryDashboard/);
  assert.match(runs, /<RunAllPagesDashboard/);
  assert.match(runs, /onStart=\{startManualRun\}/);
  assert.match(runs, /onConfirmedStart=\{\(acknowledgement, request\) => \{/);
  assert.ok(sourceCodeIncludes(runs, 'router.push(`/projects/${encodeURIComponent(request.projectId)}/test-runs/manual/${encodeURIComponent(acknowledgement.testRunId)}`,);'));
  assert.ok(sourceCodeIncludes(runs, 'return startManualMutation.mutateAsync(configuration)'));
  assert.doesNotMatch(runs, /manualStartRequest|assertManualStartAcknowledgement|crypto\.randomUUID/);
});
