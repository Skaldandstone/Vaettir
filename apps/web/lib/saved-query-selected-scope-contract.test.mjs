// SOURCE ONLY: authored NOT RUN; installed QueryClient/Clerk render still required.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("read-only membership retains reads independently of full-seat write authority", () => {
  const source = readFileSync(
    new URL("../../api/src/services/savedCaseQueries.ts", import.meta.url),
    "utf8",
  );
  const access = source.slice(
    source.indexOf("export async function withSavedQueryAccess"),
    source.indexOf("const unavailable"),
  );
  assert.match(access, /!\["FULL", "READ_ONLY"\]\.includes\(member.seatType\)/);
  assert.doesNotMatch(
    access,
    /member.seatType === "READ_ONLY" && member.role !== "VIEWER"/,
  );
  assert.match(
    access,
    /canWrite:\s*member.seatType === "FULL" &&\s*\["OWNER", "ADMIN", "EDITOR"\]\.includes\(member.role\)/,
  );
});

test("selected-body query captures original scope independently and refuses it before body lookup", () => {
  const ui = readFileSync(
    new URL("../components/SavedCaseQueries.tsx", import.meta.url),
    "utf8",
  );
  const selected = ui.slice(
    ui.indexOf("const current ="),
    ui.indexOf("const write ="),
  );
  assert.match(
    selected,
    /expectedScope:\s*\{\s*organizationId: origin.organizationId,\s*clerkActorId: origin.clerkActorId/,
  );
  assert.match(selected, /enabled: scopeReady && !!selected/);
  const router = readFileSync(
    new URL("../../api/src/routers/caseQueries.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    router,
    /savedById: protectedProcedure[\s\S]*?\.input\(savedCaseQueryReadInput\)/,
  );
  const service = readFileSync(
    new URL("../../api/src/services/savedCaseQueries.ts", import.meta.url),
    "utf8",
  );
  const body = service.slice(
    service.indexOf("export async function getSavedCaseQuery"),
    service.indexOf("export async function writeSavedCaseQuery"),
  );
  const refusal = body.indexOf(
    "expectedScope.organizationId !== access.organizationId",
  );
  assert.ok(refusal > 0);
  assert.ok(
    body.indexOf("expectedScope.clerkActorId !== access.clerkActorId") >
      refusal,
  );
  assert.ok(body.indexOf("tx.savedTypedCaseQuery.findFirst") > refusal);
});
