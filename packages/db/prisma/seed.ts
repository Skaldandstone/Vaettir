import { PrismaClient, TestPlanCategory } from "@prisma/client";

const prisma = new PrismaClient();

// Built-in test plan types. Orgs can add their own rows at runtime for
// bespoke plan shapes (custom compliance forms, internal QA templates)
// without touching this file or shipping a migration.
const BUILT_IN_TEST_PLAN_TYPES = [
  {
    key: "unit",
    name: "Unit",
    category: TestPlanCategory.FUNCTIONAL,
    description: "Isolated function/module-level tests.",
    fieldSchema: { type: "object", properties: {} },
  },
  {
    key: "functional",
    name: "Functional",
    category: TestPlanCategory.FUNCTIONAL,
    description: "Feature-level behavior verification.",
    fieldSchema: { type: "object", properties: {} },
  },
  {
    key: "contract",
    name: "Contract",
    category: TestPlanCategory.FUNCTIONAL,
    description: "Consumer/provider API contract verification (e.g. Pact).",
    fieldSchema: {
      type: "object",
      properties: {
        consumer: { type: "string" },
        provider: { type: "string" },
      },
    },
  },
  {
    key: "instrumentation",
    name: "Instrumentation",
    category: TestPlanCategory.FUNCTIONAL,
    description: "On-device/platform instrumentation tests (e.g. Android Espresso).",
    fieldSchema: { type: "object", properties: { platform: { type: "string" } } },
  },
  {
    key: "smoke",
    name: "Smoke",
    category: TestPlanCategory.FUNCTIONAL,
    description: "Shallow post-deploy sanity of critical paths.",
    fieldSchema: { type: "object", properties: {} },
  },
  {
    key: "sanity",
    name: "Sanity",
    category: TestPlanCategory.FUNCTIONAL,
    description: "Narrow, targeted verification after a specific fix/change.",
    fieldSchema: { type: "object", properties: {} },
  },
  {
    key: "regression",
    name: "Regression",
    category: TestPlanCategory.FUNCTIONAL,
    description: "Prevents previously-fixed defects from reoccurring.",
    fieldSchema: { type: "object", properties: {} },
  },
  {
    key: "e2e",
    name: "End-to-End",
    category: TestPlanCategory.FUNCTIONAL,
    description: "Full user-journey verification across the system.",
    fieldSchema: { type: "object", properties: {} },
  },
  {
    key: "release-readiness",
    name: "Release Readiness",
    category: TestPlanCategory.RELEASE_READINESS,
    description: "Release acceptance criteria gating a ship decision.",
    fieldSchema: {
      type: "object",
      properties: {
        releaseAcceptanceThresholdPct: { type: "number" },
      },
    },
  },
  {
    key: "qa-strategy",
    name: "QA Strategy",
    category: TestPlanCategory.QUALITY_STRATEGY,
    description: "Holistic strategy plan: scope, risk areas, environments, tooling, staffing.",
    fieldSchema: {
      type: "object",
      properties: {
        riskAreas: { type: "array", items: { type: "string" } },
        environments: { type: "array", items: { type: "string" } },
        entryCriteria: { type: "array", items: { type: "string" } },
        exitCriteria: { type: "array", items: { type: "string" } },
      },
    },
  },
] as const;

const BUILT_IN_COMPLIANCE_FRAMEWORKS = [
  { key: "soc2", name: "SOC 2", version: "2017 TSC" },
  { key: "hipaa", name: "HIPAA", version: null },
  { key: "pci-dss", name: "PCI DSS", version: "4.0" },
  { key: "gdpr", name: "GDPR", version: null },
  { key: "iso27001", name: "ISO/IEC 27001", version: "2022" },
] as const;

// Seat-based pricing tiers. `monthlyPricePerSeatCents` is left null across
// the board -- cost structure isn't finalized yet; this table is where that
// lands when it is, not a code change. See packages/core/src/plan.ts for
// the enforcement logic that reads these bounds.
const PLAN_TIERS = [
  {
    key: "free",
    name: "Free",
    sortOrder: 0,
    minFullSeats: 1,
    maxFullSeats: 3,
    includedReadOnlySeats: 0,
    maxReadOnlySeats: 0,
    monthlyPricePerSeatCents: null,
  },
  {
    key: "team",
    name: "Team",
    sortOrder: 1,
    minFullSeats: 4,
    maxFullSeats: 50,
    includedReadOnlySeats: 10,
    maxReadOnlySeats: 10,
    monthlyPricePerSeatCents: null,
  },
  {
    key: "business",
    name: "Business",
    sortOrder: 2,
    minFullSeats: 51,
    maxFullSeats: 75,
    includedReadOnlySeats: 10,
    maxReadOnlySeats: null,
    monthlyPricePerSeatCents: null,
  },
  {
    key: "corp",
    name: "Corp",
    sortOrder: 3,
    minFullSeats: 76,
    maxFullSeats: null,
    includedReadOnlySeats: 10,
    maxReadOnlySeats: null,
    monthlyPricePerSeatCents: null,
  },
] as const;

async function main() {
  for (const type of BUILT_IN_TEST_PLAN_TYPES) {
    await prisma.testPlanType.upsert({
      where: { key: type.key },
      create: { ...type, isBuiltIn: true },
      update: { ...type, isBuiltIn: true },
    });
  }

  for (const fw of BUILT_IN_COMPLIANCE_FRAMEWORKS) {
    await prisma.complianceFramework.upsert({
      where: { key: fw.key },
      create: { ...fw, isBuiltIn: true },
      update: { ...fw, isBuiltIn: true },
    });
  }

  for (const tier of PLAN_TIERS) {
    await prisma.planTier.upsert({
      where: { key: tier.key },
      create: tier,
      update: tier,
    });
  }

  console.log(
    `Seeded ${BUILT_IN_TEST_PLAN_TYPES.length} test plan types, ${BUILT_IN_COMPLIANCE_FRAMEWORKS.length} compliance frameworks, and ${PLAN_TIERS.length} plan tiers.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
