import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  assertGovernanceAcknowledgement,
  planGovernanceRequestHash,
  retainedGovernancePending,
  reviewedPlanHeaderFields,
  sameGovernanceReader,
} from "./plan-governance-receipt.ts";
const source = readFileSync(
  new URL("../components/PlanHeaderEditor.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const origin = {
  projectId: "project",
  organizationId: "org",
  clerkActorId: "clerk",
  caseId: null,
};
const scope = {
  projectId: "project",
  organizationId: "org",
  actorId: "native",
  actorClerkUserId: "clerk",
};
const baseline = {
  scope,
  planRevision: "a".repeat(64),
  snapshot: {
    id: "plan",
    projectId: "project",
    name: "Original name",
    description: "Original prose",
  },
  canEdit: true,
};
function harness({
  pending = false,
  allowed = true,
  editable = true,
  readOnly = false,
  onHash,
  onSend,
  failure,
  wrongAck = false,
  values = {},
} = {}) {
  const draft = {
    baseline,
    origin,
    name: "  New exact name  ",
    description: "Original prose",
    descriptionText: "Original prose",
    editName: true,
    editDescription: false,
    reason: "Reviewed header",
    confirmed: true,
    ...values,
  };
  const input = {
    projectId: "project",
    testPlanId: "plan",
    originalOrganizationId: "org",
    expectedClerkActorId: "clerk",
    expectedPlanRevision: baseline.planRevision,
    requestId: "6ee2ec04-4d34-40bf-b0e9-d12bb1b851d3",
    reason: draft.reason,
    confirmed: true,
    ...reviewedPlanHeaderFields(baseline.snapshot, draft),
  };
  const held = pending
    ? {
        input,
        origin,
        operation: "EDIT_PLAN_HEADER",
        requestHash: "b".repeat(64),
        uncertain: true,
        reviewedDraft: draft,
      }
    : null;
  const state = { draft, pending: held },
    calls = [];
  const context = {
    draftRef: { current: draft },
    pendingRef: { current: held },
    busyRef: { current: false },
    frame: { current: { projectId: "project", testPlanId: "plan", readOnly } },
    fresh: baseline,
    readOnly,
    projectId: "project",
    testPlanId: "plan",
    crypto: { randomUUID: () => input.requestId },
    access: {
      owns: (_original, mode) => allowed && (mode !== "edit" || editable),
    },
    save: {
      mutateAsync: async (actual) => {
        calls.push(actual);
        onSend?.(context, state);
        if (failure) throw failure;
        return {
          scope,
          requestId: wrongAck ? "wrong" : actual.requestId,
          requestHash: context.pendingRef.current.requestHash,
          operation: "EDIT_PLAN_HEADER",
          testPlanId: "plan",
          criterionId: null,
          releaseId: null,
          versionId: "version",
          versionNumber: 2,
          beforeRevision: actual.expectedPlanRevision,
          afterRevision: "c".repeat(64),
          replayed: pending,
        };
      },
    },
    planGovernanceRequestHash: async (operation, actual) => {
      onHash?.(context, state);
      return planGovernanceRequestHash(operation, actual);
    },
    assertGovernanceAcknowledgement,
    retainedGovernancePending,
    reviewedPlanHeaderFields,
    sameGovernanceReader,
    setPreparing: (value) => {
      state.preparing = value;
    },
    setPending: (value) => {
      state.pending =
        typeof value === "function" ? value(state.pending) : value;
    },
    setDraft: (value) => {
      state.draft = typeof value === "function" ? value(state.draft) : value;
    },
    setNotice: (value) => {
      state.notice = value;
    },
    query: { refetch: async () => calls.push("refetch") },
    onChanged: () => calls.push("changed"),
  };
  const start = source.indexOf("  async function commit()"),
    end = source.indexOf("  const belongsToPlan", start);
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  return {
    commit: runInNewContext(`${compiled}; commit`, context),
    context,
    state,
    calls,
    held,
    input,
    draft,
  };
}
test("header patch helpers preserve absent/null/empty and exact raw text without other write fields", () => {
  const base = { name: "Name", description: null };
  assert.deepEqual(
    reviewedPlanHeaderFields(base, {
      name: "Changed",
      description: "",
      editName: false,
      editDescription: false,
    }),
    {},
  );
  assert.deepEqual(
    reviewedPlanHeaderFields(base, {
      name: "Name",
      description: "",
      editName: false,
      editDescription: true,
    }),
    { description: "" },
  );
  assert.deepEqual(
    reviewedPlanHeaderFields(
      { name: "Name", description: "Existing" },
      {
        name: "Name",
        description: null,
        editName: false,
        editDescription: true,
      },
    ),
    { description: null },
  );
  assert.deepEqual(
    reviewedPlanHeaderFields(base, {
      name: "  Raw\nname  ",
      description: null,
      editName: true,
      editDescription: false,
    }),
    { name: "  Raw\nname  " },
  );
});
test("actual header controller sends only changed raw header fields and settles a scoped matching acknowledgement", async () => {
  const h = harness();
  await h.commit();
  assert.equal(h.calls[0].name, "  New exact name  ");
  assert.equal(Object.hasOwn(h.calls[0], "description"), false);
  for (const field of [
    "status",
    "customFields",
    "criteria",
    "executionTemplate",
    "releaseId",
  ])
    assert.equal(Object.hasOwn(h.calls[0], field), false);
  assert.equal(h.state.pending, null);
  assert.equal(h.state.draft, null);
  assert.equal(h.calls.at(-1), "changed");
});
test("actual header controller sends explicit NULL or empty description without submitting unchanged name", async () => {
  for (const description of [null, ""]) {
    const h = harness({
      values: {
        name: "Original name",
        editName: false,
        editDescription: true,
        description,
      },
    });
    await h.commit();
    assert.equal(h.calls[0].description, description);
    assert.equal(Object.hasOwn(h.calls[0], "name"), false);
  }
});
test("actual header controller refuses revoked roles, changed actors and read-only hosts without erasing a retained request", async () => {
  for (const options of [
    { allowed: false },
    { editable: false },
    { readOnly: true },
  ]) {
    const h = harness({ ...options, pending: true });
    await h.commit();
    assert.deepEqual(h.calls, []);
    assert.equal(h.state.pending, h.held);
  }
});
test("hash preparation never sends or overwrites a newer immutable draft", async () => {
  let newer;
  const h = harness({
    onHash: (ctx, state) => {
      newer = { ...ctx.draftRef.current, name: "Newer unsaved name" };
      ctx.draftRef.current = newer;
      state.draft = newer;
    },
  });
  await h.commit();
  assert.deepEqual(h.calls, []);
  assert.equal(h.state.draft, newer);
  assert.equal(h.state.pending, null);
  assert.equal(h.context.busyRef.current, false);
});
test("hash preparation rechecks original frame and editing permission before freezing or sending", async () => {
  for (const change of [
    (ctx) => {
      ctx.frame.current.readOnly = true;
    },
    (ctx) => {
      ctx.frame.current.testPlanId = "another-plan";
    },
    (ctx) => {
      ctx.access.owns = () => false;
    },
  ]) {
    const h = harness({ onHash: change });
    await h.commit();
    assert.deepEqual(h.calls, []);
    assert.equal(h.state.pending, null);
    assert.equal(h.state.draft, h.draft);
  }
});
test("wrong acknowledgements and late frame/actor changes retain exact UUID inputs without refreshing another context", async () => {
  for (const options of [
    { wrongAck: true },
    {
      onSend: (ctx) => {
        ctx.frame.current.testPlanId = "another-plan";
      },
    },
    {
      onSend: (ctx) => {
        ctx.access.owns = () => false;
      },
    },
  ]) {
    const h = harness({ ...options, pending: true });
    await h.commit();
    assert.equal(h.calls.length, 1);
    assert.equal(h.state.pending.input, h.held.input);
    assert.equal(h.state.pending.uncertain, true);
    assert.equal(h.state.draft, h.draft);
  }
});
test("a matching acknowledgement settles only its own receipt and cannot clear a newer draft", async () => {
  let newer;
  const h = harness({
    pending: true,
    onSend: (ctx, state) => {
      newer = { ...ctx.draftRef.current, name: "A newer draft" };
      ctx.draftRef.current = newer;
      state.draft = newer;
    },
  });
  await h.commit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.pending, null);
  assert.equal(h.state.draft, newer);
  assert.match(h.state.notice, /newer draft remains unchanged/);
});
test("later definitive failures cannot erase an earlier uncertain header receipt", async () => {
  const h = harness({ pending: true, failure: { data: { code: "CONFLICT" } } });
  await h.commit();
  assert.equal(h.state.pending.input, h.held.input);
  assert.equal(h.state.pending.uncertain, true);
  assert.equal(h.state.draft, h.draft);
});
test("actual description toggle controller retains a private text buffer through TEXT/NULL/TEXT", () => {
  const start = source.indexOf("  function change("),
    end = source.indexOf("  async function commit()", start);
  const raw = "  Unsaved raw description\nwith formatting  ",
    draft = { description: raw, descriptionText: raw, confirmed: true };
  const ctx = {
    busyRef: { current: false },
    pendingRef: { current: null },
    readOnly: false,
    access: { canEdit: true },
    draftRef: { current: draft },
    setDraft: (value) => {
      ctx.draft = value;
    },
  };
  const compiled = ts.transpileModule(source.slice(start, end), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  const change = runInNewContext(`${compiled}; change`, ctx);
  change({ description: null });
  assert.equal(ctx.draftRef.current.description, null);
  assert.equal(ctx.draftRef.current.descriptionText, raw);
  change({ description: ctx.draftRef.current.descriptionText });
  assert.equal(ctx.draftRef.current.description, raw);
  assert.equal(ctx.draftRef.current.confirmed, false);
  assert.match(source, /descriptionText: fresh.snapshot.description \?\? ""/);
  assert.match(
    source,
    /event.target.value === "NULL"\s*\? null\s*: draft.descriptionText/,
  );
  assert.match(source, /descriptionText: event.target.value/);
  assert.match(source, /keepMounted/);
});
