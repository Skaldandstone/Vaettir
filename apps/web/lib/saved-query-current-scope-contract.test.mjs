// Source contracts only, authored but not executed. Morning also needs real Clerk
// and QueryClient cached-error/offline/token-switch acceptance, not just regexes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../components/SavedCaseQueries.tsx", import.meta.url),
  "utf8",
);
test("saved private bodies require loaded current Clerk actor and echoed original organization", () => {
  assert.match(
    source,
    /const \{ isLoaded, isSignedIn, userId \} = useAuth\(\)/,
  );
  assert.match(source, /organizationId: string \| undefined/);
  assert.match(source, /origin\.organizationId === organizationId/);
  assert.match(source, /origin\.clerkActorId === userId/);
  for (const name of ["catalog", "current"]) {
    assert.match(
      source,
      new RegExp(
        `!${name}\\.error\\s*&&\\s*!${name}\\.isFetching\\s*&&\\s*!${name}\\.isPaused`,
      ),
    );
    assert.match(
      source,
      new RegExp(
        `${name}\\.data\\.organizationId === origin\\?\\.organizationId`,
      ),
    );
    assert.match(
      source,
      new RegExp(`${name}\\.data\\.clerkActorId === userId`),
    );
  }
});
test("account changes hide bodies without erasing original draft or exact pending write", () => {
  assert.match(source, /scopeChanged \|\| \(isLoaded && !actorReady\)/);
  assert.match(
    source,
    /Saved-query names, loaded criteria and draft controls are hidden/,
  );
  assert.match(source, /pendingRequest \?\? structuredClone\(input\)/);
  assert.match(source, /if \(!pendingRequest\)\s*input = \{/);
  assert.match(source, /organizationId: origin!\.organizationId/);
  assert.match(source, /clerkActorId: origin!\.clerkActorId/);
  assert.match(source, /if \(busy \|\| !freshWrite \|\| !scopeReady\) return/);
  const scopeEffect = source.slice(
    source.indexOf("useEffect(() =>"),
    source.indexOf("const scopeReady"),
  );
  assert.doesNotMatch(scopeEffect, /setPendingRequest|setName|setBaseline/);
  assert.match(
    source,
    /draftReady = freshWrite && \(!selected \|\| !!readyCurrent\)/,
  );
  assert.match(source, /if \(!pendingRequest && !draftReady\) return/);
});
test("accepted acknowledgement is not turned into uncertain mutation by refresh denial", () => {
  const accepted = source.indexOf("// An accepted receipt is distinct");
  const writeCatch = source.indexOf("catch (error)");
  assert.ok(writeCatch > 0 && accepted > writeCatch);
  assert.match(source.slice(writeCatch, accepted), /return;\s*\}/);
  assert.match(
    source.slice(accepted),
    /catalog\.refetch\(\{ throwOnError: true \}\)/,
  );
  assert.match(source.slice(accepted), /accepted change was not retried/);
  assert.doesNotMatch(source.slice(accepted), /retainSavedQueryRequest/);
});
test("mismatched identities offer explicit recovery and do not authorize edits", () => {
  assert.match(
    source,
    /disabled=\{!scopeReady \|\| catalog\.isFetching \|\| catalog\.isPaused\}/,
  );
  assert.match(source, /Current saved definitions could not be refreshed/);
  assert.match(source, /readyCurrent\.value\.version === baseline\.version/);
  assert.match(source, /freshWrite = !!readyCatalog\?\.canWrite/);
});
