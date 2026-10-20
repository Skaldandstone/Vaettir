import { describe, expect, it } from "vitest";
import { aiDisclosureDeployment } from "./aiDisclosureDeployment.js";

const scope = { organizationId: "sandbox-org", projectId: "synthetic-project" };
const valid = JSON.stringify([scope]);
describe("external AI deployment pilot", () => {
  it.each([
    undefined,
    "",
    "[]",
    "null",
    "{}",
    "*",
    JSON.stringify([scope, scope]),
    JSON.stringify([{ ...scope, organizationId: "*" }]),
    JSON.stringify([{ ...scope, extra: true }]),
    JSON.stringify([scope, { organizationId: "other", projectId: "*" }]),
  ])("fails closed for invalid or missing scope %s", (value) => {
    expect(
      aiDisclosureDeployment({
        VAETTIR_AI_DISCLOSURE_ENABLED: "1",
        VAETTIR_AI_DISCLOSURE_PROJECTS: value,
      })(scope.organizationId, scope.projectId),
    ).toBe(false);
  });
  it("requires enablement plus both exact identifiers without a cross-product", () => {
    expect(
      aiDisclosureDeployment({ VAETTIR_AI_DISCLOSURE_PROJECTS: valid })(
        scope.organizationId,
        scope.projectId,
      ),
    ).toBe(false);
    const allows = aiDisclosureDeployment({
      VAETTIR_AI_DISCLOSURE_ENABLED: "1",
      VAETTIR_AI_DISCLOSURE_PROJECTS: JSON.stringify([
        scope,
        { organizationId: "second", projectId: "another" },
      ]),
    });
    expect(allows(scope.organizationId, scope.projectId)).toBe(true);
    expect(allows("second", "another")).toBe(true);
    expect(allows("second", scope.projectId)).toBe(false);
    expect(allows(scope.organizationId, "another")).toBe(false);
    expect(allows("atwist", scope.projectId)).toBe(false);
  });
});
