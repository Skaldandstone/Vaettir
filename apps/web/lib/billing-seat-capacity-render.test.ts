import React from "react";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Render the complete actual page using synthetic reads, never live billing.
const seats = { fullSeatsUsed: 4, fullSeatsIncluded: null as number | null,
  readOnlySeatsUsed: 0, readOnlySeatsIncluded: 2, readOnlySeatsMax: null as number | null,
  planTierName: "Synthetic private plan" };
const query = (data: unknown) => ({ useQuery: () => ({ data, isLoading: false }) });
const mutation = { useMutation: () => ({ isPending: false, mutate: () => { throw Error("No mutation in render fixture"); } }) };
const sdk = { trpcReact: { organization: {
  mine: query([{ id: "synthetic-org", name: "Synthetic workspace" }]),
  billingOverview: query({ currentPlan: { name: "Synthetic private plan", monthlyPricePerSeatCents: 0 }, purchasesEnabled: false, operationCosts: [], topupPacks: [], hasActiveSubscription: false }),
  seatUsage: query(seats), aiCreditStatus: query({ balance: 923, includedPerMonth: 500 }),
  listPlanTiers: query([]), createBillingCheckout: mutation, createBillingPortalSession: mutation, createCreditTopup: mutation,
}, creditUseRequests: { adminList: query([]), resolve: mutation } } };
const code = ts.transpileModule(readFileSync(new URL("../app/settings/billing/page.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const imports: Record<string, unknown> = { react: React,
  "../../../lib/trpcReact": sdk, "../../../lib/membership": { canAdministerOrganization: () => false },
  "../../../lib/credit-labels": { creditOperationLabel: (value: string) => value } };
const context = vm.createContext({ React, Intl, exports: {}, require: (name: string) => {
  if (!Object.hasOwn(imports, name)) throw Error(`Unexpected dependency ${name}`);
  return imports[name];
} });
vm.runInContext(code, context);
const Page = (context.exports as { default: React.ComponentType }).default;
describe("actual billing seat capacities", () => {
  it.each([null, 7, 0])("uses the enforced read-only cap %s, not its included allowance", cap => {
    seats.readOnlySeatsMax = cap;
    const html = renderToStaticMarkup(React.createElement(Page));
    expect(html).toContain(`Plan capacity: ${cap ?? "Unlimited"}`);
    expect(html).not.toContain("Plan capacity: 2");
    expect(seats.readOnlySeatsIncluded).toBe(2);
  });
});
