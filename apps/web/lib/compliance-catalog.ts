import { COMPLIANCE_STARTERS } from "./compliance-starters";

export type ComplianceOption = {
  id: string;
  name: string;
  version?: string | null;
  category: string;
  summary: string;
  aliases?: readonly string[];
  sourceUrl?: string;
};

// Preserve the original profile labels; adding a catalog must not silently
// rewrite an existing project's saved assurance preferences.
const legacyLabels: Record<string, string> = {
  "nist-csf-2": "NIST CSF",
  "nist-manufacturing-profile": "NIST manufacturing",
  "cisa-secure-by-design": "CISA Secure by Design",
  "pci-dss": "PCI DSS",
  iso27001: "ISO 27001",
};

export const COMPLIANCE_CATALOG: readonly ComplianceOption[] = [
  ...COMPLIANCE_STARTERS.map((starter) => ({
    id: starter.key,
    name: starter.name,
    version: starter.version,
    category: starter.category,
    summary: starter.summary,
    aliases: [legacyLabels[starter.key] ?? starter.name],
    sourceUrl: starter.sourceUrl,
  })),
  {
    id: "soc2", name: "SOC 2", version: "Applicable Trust Services Criteria",
    category: "Security & privacy",
    summary: "Reference framework. Select the applicable criteria with the auditor; a full control set is not bundled.",
    sourceUrl: "https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022",
  },
];

export function complianceProfileValue(option: ComplianceOption): string {
  return legacyLabels[option.id] ?? option.name;
}

export function filterComplianceOptions(
  options: readonly ComplianceOption[], query: string, category: string,
): ComplianceOption[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((option) => {
    if (category && option.category !== category) return false;
    const text = [option.name, option.id, option.version, option.category,
      option.summary, ...(option.aliases ?? [])].join(" ").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

// Retain every saved identity, including duplicate names and modified versions.
// A matching name/key must never silently substitute a different saved control set.
export function savedComplianceOptions(frameworks: readonly {
  id: string; key: string; name: string; version: string | null;
  controlCount: number; isBuiltIn: boolean;
}[]): ComplianceOption[] {
  return frameworks.map((framework) => ({
    id: framework.id, name: framework.name, version: framework.version,
    category: framework.isBuiltIn ? "Built-in references" : "Saved references",
    summary: `${framework.controlCount} saved control${framework.controlCount === 1 ? "" : "s"}`,
    aliases: [framework.key],
  }));
}
