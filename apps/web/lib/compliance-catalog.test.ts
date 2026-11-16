import { describe, expect, it } from "vitest";
import { COMPLIANCE_STARTERS } from "./compliance-starters";
import { COMPLIANCE_CATALOG, complianceProfileValue, filterComplianceOptions, savedComplianceOptions } from "./compliance-catalog";

describe("shared compliance catalog", () => {
  it("makes every bundled starter and the saved SOC 2 reference discoverable", () => {
    const ids = COMPLIANCE_CATALOG.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(COMPLIANCE_STARTERS.map((starter) => starter.key)));
    expect(ids).toContain("soc2");
    expect(COMPLIANCE_CATALOG.find((option) => option.id === "soc2")?.summary).toContain("not bundled");
    expect(COMPLIANCE_STARTERS.find((starter) => starter.key === "soc2")).toBeUndefined();
  });

  it("preserves existing profile values without reducing the expanded catalog", () => {
    const values = COMPLIANCE_CATALOG.map(complianceProfileValue);
    expect(values).toEqual(expect.arrayContaining(["NIST CSF", "NIST manufacturing", "CISA Secure by Design", "PCI DSS", "ISO 27001"]));
    expect(values).toContain("Music and performance rights");
    expect(new Set(values).size).toBe(COMPLIANCE_CATALOG.length);
  });

  it("searches topics and versions across every option and combines the category filter", () => {
    expect(filterComplianceOptions(COMPLIANCE_CATALOG, "performance 2026", "").map((option) => option.id)).toEqual(["music-rights-us"]);
    expect(filterComplianceOptions(COMPLIANCE_CATALOG, "performance", "Security & privacy")).toEqual([]);
    expect(filterComplianceOptions(COMPLIANCE_CATALOG, "  ", "")).toHaveLength(COMPLIANCE_CATALOG.length);
    const many = Array.from({ length: 251 }, (_, index) => ({ ...COMPLIANCE_CATALOG[0]!, id: `id-${index}` }));
    expect(filterComplianceOptions(many, "", "")).toHaveLength(251);
  });

  it("keeps saved identities, versions and wording even when names or catalog keys overlap", () => {
    const frameworks = [
      { id: "private-a", key: "music-rights-us", name: "Customer wording", version: "1", controlCount: 2, isBuiltIn: false },
      { id: "private-b", key: "another-key", name: "Customer wording", version: "2", controlCount: 1, isBuiltIn: false },
    ];
    const result = savedComplianceOptions(frameworks);
    expect(result.map((option) => option.id)).toEqual(["private-a", "private-b"]);
    expect(result.map((option) => option.version)).toEqual(["1", "2"]);
    expect(result.map((option) => option.name)).toEqual(["Customer wording", "Customer wording"]);
    expect(result.every((option) => option.sourceUrl === undefined)).toBe(true);
    expect(filterComplianceOptions(result, "another-key", "").map((option) => option.id)).toEqual(["private-b"]);
  });
});
