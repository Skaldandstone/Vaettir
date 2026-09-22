import { test } from "node:test";
import assert from "node:assert/strict";
import { canEditProject, canAdministerOrganization, canSignOffCompliance, isReadOnlySeat } from "./membership.ts";
import { assertTestEnvironment } from "../e2e/test-environment.ts";

for (const role of ["OWNER", "ADMIN", "EDITOR", "COMPLIANCE_AUDITOR", "VIEWER", "UNKNOWN"]) {
  for (const seatType of ["FULL", "READ_ONLY", "UNKNOWN"]) {
    test(`UI capabilities: ${role}/${seatType}`, () => {
      const member = { role, seatType };
      assert.equal(canEditProject(member), seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(role));
      assert.equal(canAdministerOrganization(member), seatType === "FULL" && ["OWNER", "ADMIN"].includes(role));
      assert.equal(canSignOffCompliance(member), seatType === "FULL" && ["OWNER", "ADMIN", "COMPLIANCE_AUDITOR"].includes(role));
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
  DATABASE_URL: "postgresql://test:local@127.0.0.1:55440/vaettir_browser_test?schema=public",
  PLAYWRIGHT_BASE_URL: "http://localhost:3000",
  NEXT_PUBLIC_API_URL: "http://localhost:4000",
  CLERK_SECRET_KEY: "sk_test_placeholder",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_placeholder",
};
test("test guard permits local isolated development data", () => assert.doesNotThrow(() => assertTestEnvironment(local)));
for (const [name, change] of Object.entries({
  "production database": { DATABASE_URL: "postgresql://127.0.0.1/vaettir" },
  "remote database": { DATABASE_URL: "postgresql://database.example/vaettir_browser_test" },
  "database host override": { DATABASE_URL: `${local.DATABASE_URL}&host=remote.example` },
  "non-postgres database": { DATABASE_URL: "https://localhost/vaettir_browser_test" },
  "production web": { PLAYWRIGHT_BASE_URL: "https://vaettir.skaldandstone.com" },
  "remote API": { NEXT_PUBLIC_API_URL: "https://api.example.com" },
  "non-HTTP web": { PLAYWRIGHT_BASE_URL: "file://localhost/path" },
  "credentials in URL": { NEXT_PUBLIC_API_URL: "http://token@localhost:4000" },
  "production Clerk secret": { CLERK_SECRET_KEY: "sk_live_placeholder" },
  "production Clerk public key": { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_placeholder" },
})) test(`test guard rejects ${name}`, () => assert.throws(() => assertTestEnvironment({ ...local, ...change })));
