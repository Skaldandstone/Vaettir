import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canEditProject,
  canAdministerOrganization,
  canSignOffCompliance,
  isReadOnlySeat,
} from "./membership.ts";
import { assertTestEnvironment } from "../e2e/test-environment.ts";
import { saveRequirementDrafts } from "./requirement-drafts.ts";
import { creditOperationLabel } from "./credit-labels.ts";

test("credit operations have user-facing labels with a readable fallback", () => {
  assert.equal(
    creditOperationLabel("generateAutomationDraft"),
    "Draft framework-specific automation",
  );
  assert.equal(
    creditOperationLabel("extractRequirementsFromMarkdown"),
    "Extract requirements from a document",
  );
  assert.equal(creditOperationLabel("newOperation_name"), "New Operation name");
});

test("requirement review keeps acknowledged rows out of retries", async () => {
  const rows = ["One", "Two", "Three"].map((title) => ({
    title,
    description: "Expected behavior",
    sourceFile: null,
  }));
  const saved = new Set();
  const calls = [];
  await assert.rejects(
    saveRequirementDrafts(
      rows,
      [0, 1, 2],
      saved,
      async (draft) => {
        calls.push(draft.title);
        if (draft.title === "Two") throw new Error("temporary failure");
      },
      (index) => saved.add(index),
    ),
    /temporary failure/,
  );
  assert.deepEqual([...saved], [0]);
  rows[1].title = "Repaired second requirement";
  await saveRequirementDrafts(
    rows,
    [0, 1, 2],
    saved,
    async (draft) => calls.push(draft.title),
    (index) => saved.add(index),
  );
  assert.deepEqual(calls, [
    "One",
    "Two",
    "Repaired second requirement",
    "Three",
  ]);
  assert.deepEqual([...saved], [0, 1, 2]);
});

test("blank selected requirement blocks the batch without dropping rows", async () => {
  const rows = [
    { title: "Good", description: "", sourceFile: null },
    { title: "  ", description: "Repair me", sourceFile: null },
  ];
  let writes = 0;
  await assert.rejects(
    saveRequirementDrafts(
      rows,
      [0, 1],
      new Set(),
      async () => writes++,
      () => {},
    ),
    /Add a title/,
  );
  assert.equal(writes, 0);
  assert.equal(rows[1].description, "Repair me");
});

test("requirement review saves edited text and source attribution only for selected rows", async () => {
  const writes = [];
  await saveRequirementDrafts(
    [
      { title: "  Edited  ", description: "Acceptance", sourceFile: "spec.md" },
      { title: "Later", description: "", sourceFile: null },
    ],
    [0],
    new Set(),
    async (draft) => writes.push(draft),
    () => {},
  );
  assert.deepEqual(writes, [
    { title: "Edited", description: "Acceptance\n\n(extracted from spec.md)" },
  ]);
});

for (const role of [
  "OWNER",
  "ADMIN",
  "EDITOR",
  "COMPLIANCE_AUDITOR",
  "VIEWER",
  "UNKNOWN",
]) {
  for (const seatType of ["FULL", "READ_ONLY", "UNKNOWN"]) {
    test(`UI capabilities: ${role}/${seatType}`, () => {
      const member = { role, seatType };
      assert.equal(
        canEditProject(member),
        seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(role),
      );
      assert.equal(
        canAdministerOrganization(member),
        seatType === "FULL" && ["OWNER", "ADMIN"].includes(role),
      );
      assert.equal(
        canSignOffCompliance(member),
        seatType === "FULL" &&
          ["OWNER", "ADMIN", "COMPLIANCE_AUDITOR"].includes(role),
      );
    });
  }
}

test("unknown membership fails closed", () => {
  assert.equal(isReadOnlySeat(undefined), true);
  for (const member of [null, undefined]) {
    assert.equal(canEditProject(member), false);
    assert.equal(canAdministerOrganization(member), false);
    assert.equal(canSignOffCompliance(member), false);
  }
});

const local = {
  DATABASE_URL:
    "postgresql://test:local@127.0.0.1:55440/vaettir_browser_test?schema=public",
  PLAYWRIGHT_BASE_URL: "http://localhost:3000",
  NEXT_PUBLIC_API_URL: "http://localhost:4000",
  CLERK_SECRET_KEY: "sk_test_placeholder",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_placeholder",
};
test("test guard permits local isolated development data", () =>
  assert.doesNotThrow(() => assertTestEnvironment(local)));
for (const [name, change] of Object.entries({
  "production database": { DATABASE_URL: "postgresql://127.0.0.1/vaettir" },
  "remote database": {
    DATABASE_URL: "postgresql://database.example/vaettir_browser_test",
  },
  "database host override": {
    DATABASE_URL: `${local.DATABASE_URL}&host=remote.example`,
  },
  "non-postgres database": {
    DATABASE_URL: "https://localhost/vaettir_browser_test",
  },
  "production web": {
    PLAYWRIGHT_BASE_URL: "https://vaettir.skaldandstone.com",
  },
  "remote API": { NEXT_PUBLIC_API_URL: "https://api.example.com" },
  "non-HTTP web": { PLAYWRIGHT_BASE_URL: "file://localhost/path" },
  "credentials in URL": { NEXT_PUBLIC_API_URL: "http://token@localhost:4000" },
  "production Clerk secret": { CLERK_SECRET_KEY: "sk_live_placeholder" },
  "production Clerk public key": {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_placeholder",
  },
}))
  test(`test guard rejects ${name}`, () =>
    assert.throws(() => assertTestEnvironment({ ...local, ...change })));
