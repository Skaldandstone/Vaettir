import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ui = readFileSync(
  new URL("../components/DurableCaseAnalysis.tsx", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../../api/src/services/caseAnalysisQueue.ts", import.meta.url),
  "utf8",
);
const router = readFileSync(
  new URL("../../api/src/routers/caseAnalysisQueue.ts", import.meta.url),
  "utf8",
);

test("original mounted Clerk and workspace are pinned once, with fresh private cache gates", () => {
  assert.match(ui, /const \{ isLoaded, isSignedIn, userId \} = useAuth\(\)/);
  assert.match(ui, /if \(!origin && current\) setOrigin\(current\)/);
  for (const query of ["project", "organizations", "state", "history"]) {
    assert.match(ui, new RegExp(`!${query}\\.error`));
    assert.match(ui, new RegExp(`!${query}\\.isFetching`));
    assert.match(ui, new RegExp(`!${query}\\.isPaused`));
  }
  assert.match(ui, /const ready = sameOrigin\(origin, current\)/);
  assert.match(
    ui,
    /!ready \? \([\s\S]*Private saved scopes, balances and controls are hidden/,
  );
  assert.match(ui, /scopeMatches\(history\.data, origin\)/);
  assert.match(ui, /queueMatches\(state\.data, origin, jobId/);
  assert.doesNotMatch(ui, /setOrigin\(null\)|setOrigin\(input\)/);
});

test("all four exact requests retain original scope and independently verify acknowledgement before consumption", () => {
  for (const name of [
    "reviewRequest",
    "approvalRequest",
    "cancelRequest",
    "adminRequest",
  ])
    assert.match(ui, new RegExp(`${name} \\?\\?`));
  assert.match(
    ui,
    /queueMatches\(result, input, undefined, input\.requestId\)/,
  );
  assert.match(ui, /ack\.scopeHash !== input\.scopeHash/);
  assert.match(ui, /ack\.maximumCredits !== input\.maximumCredits/);
  assert.match(ui, /ack\.queueId !== input\.id/);
  assert.match(ui, /!scopeMatches\(ack, input\)/);
  assert.match(ui, /!queueMatches\(ack, input, input\.id\)/);
  assert.match(ui, /retainAnalysisRequest\(Boolean\(adminRequest\), error\)/);
  assert.match(ui, /retainAnalysisRequest\(Boolean\(cancelRequest\), error\)/);
  assert.match(ui, /Retry identical administrator request/);
  assert.match(ui, /Retry identical cancellation/);
});

test("accepted acknowledgement is not lost or reclassified by read or callback failure", () => {
  const refresh = ui.slice(
    ui.indexOf("async function refreshConfirmed"),
    ui.indexOf("async function prepare"),
  );
  assert.match(refresh, /sameOrigin\(accessNow\.current\.origin, input\)/);
  assert.match(refresh, /s\?\.error \|\|[\s\S]*s\?\.isPaused/);
  assert.match(refresh, /h\.error\s*\|\|\s*h\.isPaused\s*\|\|\s*h\.isFetching/);
  assert.match(
    refresh,
    /confirmed, but the current view could not be refreshed/,
  );
  assert.doesNotMatch(
    refresh,
    /mutateAsync|setReviewRequest|setApprovalRequest|setAdminRequest|setCancelRequest/,
  );
  for (const [consumed, label] of [
    ["Review", "Saved scope"],
    ["Approval", "Approval"],
    ["Admin", "Administrator request"],
    ["Cancel", "Cancellation"],
  ]) {
    const clear = `set${consumed}Request(null)`;
    const call = `await refreshConfirmed(input, "${label}"`;
    assert.ok(ui.indexOf(clear) >= 0 && ui.indexOf(clear) < ui.indexOf(call));
  }
});

test("server current mapping and original organization are locked before scoped saved receipt lookup", () => {
  const owned = service.slice(
    service.indexOf("export async function ownedAnalysis"),
    service.indexOf("export async function readAnalysis"),
  );
  assert.ok(
    owned.indexOf("await analysisAccess(") <
      owned.indexOf("tx.caseAnalysisQueue.findFirst"),
  );
  assert.match(
    service,
    /initial\.organizationId !== clientScope\.originalOrganizationId/,
  );
  assert.match(
    service,
    /SELECT "clerkUserId" FROM "User" WHERE id=\$\{actorId\} FOR SHARE/,
  );
  assert.match(service, /clerk !== serverClerkActorId/);
  assert.match(service, /clerk !== clientScope\.expectedClerkActorId/);
  assert.match(owned, /job\.requestedById !== actorId/);
  assert.match(owned, /job\.organizationId !== access\.organizationId/);
  assert.match(
    router,
    /return access\.scope \? \{ scope: access\.scope, items \} : items/,
  );
  assert.match(
    service,
    /scope \? \{ scope, requestId: job\.requestId \} : \{\}/,
  );
  const admin = router.slice(
    router.indexOf("requestAdmin: protectedProcedure"),
  );
  assert.ok(
    admin.indexOf("const { job, scope } = await ownedAnalysis") <
      admin.indexOf("if (scope)"),
  );
  assert.ok(
    admin.indexOf("receipt.reason !== input.reason") <
      admin.indexOf('job.status !== "REVIEW"'),
  );
});
