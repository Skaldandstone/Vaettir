import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { admitReviewedRunStart } from "./services/manualRunStartReviewedAdmission.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname) && /test/i.test(url.pathname) && !url.searchParams.has("host");

describe.skipIf(!isolated)("reviewed run-start admission against real PostgreSQL", () => {
  it("admits exact project and organization metadata with literal case content and no execution writes", async () => {
    const suffix = randomUUID();
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const labels = { action: "Stimulus", expectedActionOrData: "Input", expectedResult: "Expected", expectedResponse: "Response" };
    const organization = await prisma.organization.create({ data: { name: "Synthetic run admission", slug: `run-admission-${suffix}`, planTierId: tier.id, stepFieldLabels: labels } });
    const project = await prisma.project.create({ data: { organizationId: organization.id, name: "Synthetic admission", slug: `admission-${suffix}` } });
    const testCase = await prisma.testCase.create({ data: { projectId: project.id, title: "Literal synthetic case", testType: "FUNCTIONAL", given: ["  retained setup\nline  "], when: [], then: ["retained result"], tags: [], steps: { create: { order: 0, action: "  retained action  ", expectedResult: "retained result" } } } });

    // Uses the actual parameterized native queries, including project equality.
    // A synthetic SQL interpreter cannot detect PostgreSQL syntax errors here.
    const admitted = await prisma.$transaction(tx => admitReviewedRunStart(tx, { projectId: project.id, testCaseIds: [testCase.id] }));
    expect(admitted.project.organization.stepFieldLabels).toEqual(labels);
    expect(admitted.cases).toHaveLength(1);
    expect(admitted.cases[0]).toMatchObject({ id: testCase.id, title: testCase.title, given: ["  retained setup\nline  "], steps: [{ order: 0, action: "  retained action  ", expectedResult: "retained result" }] });
    expect(await prisma.testRun.count({ where: { projectId: project.id } })).toBe(0);
  });
});
