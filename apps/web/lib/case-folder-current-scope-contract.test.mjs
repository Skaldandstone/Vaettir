// Authored source contracts, NOT runtime/Clerk/QueryClient acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../components/TestCaseFolders.tsx", import.meta.url),
  "utf8",
);
test("current project/member/Clerk actor and exact echoes gate folder tree and impact", () => {
  for (const text of [
    "useAuth()",
    "trpcReact.project.byId.useQuery",
    "trpcReact.organization.mine.useQuery",
    "origin.clerkActorId === userId",
    "list.data.organizationId === organizationId",
    "list.data.clerkActorId === userId",
    "preview.data.organizationId === organizationId",
    "preview.data.clerkActorId === userId",
    "preview.data.action === prepared.action",
    "preview.data.toPath === prepared.toPath",
    'preview.fetchStatus === "idle"',
    'list.fetchStatus === "idle"',
  ])
    assert.ok(source.includes(text), text);
});
test("identity transition and late reads cannot revive prior cached private paths", () => {
  assert.ok(source.includes("accessGeneration === generation"));
  assert.ok(source.includes("previewGeneration === generation"));
  assert.ok(
    source.includes("liveScope.current.generation === generation"),
  );
  assert.match(source, /\[scopeGeneration, setScopeGeneration\] = useState/);
  assert.match(source, /scopeGeneration\.generation \+ 1/);
  assert.doesNotMatch(source, /scopeGeneration\.current/);
  assert.match(source, /useLayoutEffect\(\(\) => \{\s*liveScope.current = \{ scopeReady, origin, generation \}/);
  assert.match(source, /return \(\) => \{\s*liveScope.current = \{ scopeReady: false, origin: null, generation: -1 \}/);
  assert.ok(
    source.includes("Folder paths, impact and draft controls are hidden"),
  );
  assert.ok(source.includes("ready ? (list.data?.paths ?? []) : []"));
});
test("hierarchical destination selection previews resulting path and blocks same-parent noop", () => {
  assert.ok(source.includes("Destination parent folder"));
  assert.ok(source.includes('path.split("/").join(" › ")'));
  assert.ok(source.includes("Resulting folder:"));
  assert.ok(source.includes("change.fromPath === change.toPath"));
  assert.ok(
    source.includes('path === source || path.startsWith(source + "/")'),
  );
});
test("human drafts and exact scope-bound uncertain writes survive close without new actor submission", () => {
  assert.ok(source.includes("if (!pending && !draftStarted)"));
  assert.ok(source.includes("mutation.mutate(pending)"));
  assert.ok(source.includes("expectedScope:"));
  assert.ok(source.includes("organizationId: origin!.organizationId"));
  assert.ok(source.includes("clerkActorId: origin!.clerkActorId"));
  assert.ok(source.includes("approvedHash !== reviewed.expectedHash"));
  assert.ok(source.includes("!liveScope.current.scopeReady"));
});
test("accepted ACK validation precedes clearing exact request and refresh failure does not retry", () => {
  const success = source.slice(
    source.indexOf("onSuccess: (result)"),
    source.indexOf("onError: (error)"),
  );
  assert.ok(
    success.indexOf("result.requestId !== input.requestId") <
      success.indexOf("receipt.current = null"),
  );
  assert.ok(
    success.includes(
      "Current folders could not be refreshed; the accepted change was not retried.",
    ),
  );
  assert.ok(success.includes("throwOnError: true"));
  assert.doesNotMatch(success, /mutation\.mutate/);
});
