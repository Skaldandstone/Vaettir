import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
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
test("late healing ACKs cannot be assigned as data in the current namespace", () => {
  assert.doesNotMatch(runs, /byTestResult\.setData\(/);
  assert.equal((runs.match(/onMutate: initiatingScope/g) ?? []).length, 2);
  assert.equal(
    (
      runs.match(
        /sameAuthScope\(originalScope \?\? null, initiatingScope\(\)\)/g,
      ) ?? []
    ).length,
    2,
  );
  assert.equal(
    (runs.match(/byTestResult\.invalidate\(\{ testResultId \}\)/g) ?? [])
      .length,
    2,
  );
});
