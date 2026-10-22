import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { prisma } from "@vaettir/db";
import type { PrismaClient } from "@vaettir/db";
import { importAndroidExploration } from "./androidExplorationImport.js";
import { androidExplorationCommit } from "./androidExplorationSchema.js";
import { appRouter } from "../router.js";
const marker = `navigation-${Date.now()}`;
let orgId: string,
  otherOrg: string,
  projectId: string,
  userId: string,
  memberId: string;
const clerkId = marker;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
beforeAll(async () => {
  const tier = await prisma.planTier.findUniqueOrThrow({
    where: { key: "free" },
  });
  orgId = (
    await prisma.organization.create({
      data: { name: marker, slug: marker, planTierId: tier.id },
    })
  ).id;
  otherOrg = (
    await prisma.organization.create({
      data: {
        name: marker + "other",
        slug: marker + "other",
        planTierId: tier.id,
      },
    })
  ).id;
  projectId = (
    await prisma.project.create({
      data: {
        organizationId: orgId,
        name: "Synthetic navigation",
        slug: marker,
      },
    })
  ).id;
  userId = (
    await prisma.user.create({
      data: { email: marker + "@example.invalid", clerkUserId: clerkId },
    })
  ).id;
  memberId = (
    await prisma.membership.create({
      data: { organizationId: orgId, userId, role: "EDITOR", seatType: "FULL" },
    })
  ).id;
});
afterAll(async () => {
  if (!orgId) return;
  await prisma.testCaseVersion.deleteMany({
    where: { testCase: { projectId } },
  });
  await prisma.testCaseSource.deleteMany({
    where: { testCase: { projectId } },
  });
  await prisma.testCaseStep.deleteMany({ where: { testCase: { projectId } } });
  await prisma.testCase.deleteMany({ where: { projectId } });
  await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
  await prisma.project.deleteMany({ where: { id: projectId } });
  await prisma.membership.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({
    where: { id: { in: [orgId, otherOrg] } },
  });
});
function input(label = "Browse") {
  const steps = [
    {
      sequence: 1,
      action: { kind: "TAP" as const, label, targetId: digest(label) },
      from: { id: digest("Home"), label: "Home" },
      to: { id: digest(label), label },
      observedAt: "2026-10-22T15:01:00.000Z",
      execution: {
        transport: "ADB" as const,
        connector: {
          method: "POST" as const,
          path: "/exploration/v1/next" as const,
          requestId: "11111111-1111-4111-8111-111111111111",
        },
        commandArgs: ["shell", "input", "tap", "100", "50"] as [
          "shell",
          "input",
          "tap",
          string,
          string,
        ],
        target: {
          packageName: "com.vaettir.synthetic",
          objectId: "com.vaettir.synthetic:id/navigation",
          className: "android.widget.Button",
          selector: {
            kind: "RESOURCE_ID" as const,
            value: "com.vaettir.synthetic:id/navigation",
          },
          bounds: [0, 0, 200, 100] as [number, number, number, number],
        },
        appNetwork: {
          status: "NOT_CAPTURED" as const,
          reason: "APP_NETWORK_INSPECTION_NOT_CONNECTED" as const,
        },
      },
    },
  ];
  return androidExplorationCommit.parse({
    projectId,
    originalOrganizationId: orgId,
    expectedClerkActorId: clerkId,
    requestId: randomUUID(),
    acknowledgeDisclosure: true,
    journeys: [
      {
        id: digest(JSON.stringify(steps)),
        sessionId: "a".repeat(48),
        packageName: "com.vaettir.synthetic",
        startedAt: "2026-10-22T15:00:00.000Z",
        steps,
      },
    ],
  });
}
const authority = () => ({ nativeActorId: userId, clerkActorId: clerkId });
it("a failure after the second case creation rolls back the entire selected batch, versions, source and audit", async () => {
  const counts = async () =>
    Promise.all([
      prisma.testCase.count({ where: { projectId } }),
      prisma.testCaseSource.count({ where: { testCase: { projectId } } }),
      prisma.testCaseStep.count({ where: { testCase: { projectId } } }),
      prisma.testCaseVersion.count({ where: { testCase: { projectId } } }),
      prisma.auditLog.count({
        where: { projectId, entityType: "AndroidExplorationImport" },
      }),
    ]);
  const before = await counts();
  const value = input("Rollback first");
  value.journeys.push(input("Rollback second").journeys[0]!);
  let versions = 0;
  const faulted = prisma.$extends({
    query: {
      testCaseVersion: {
        async create({ args, query }) {
          versions++;
          if (versions === 2)
            throw Error("Synthetic second version write failure");
          return query(args);
        },
      },
    },
  });
  await expect(
    importAndroidExploration(
      faulted as unknown as PrismaClient,
      value,
      authority(),
    ),
  ).rejects.toThrow("Synthetic second version write failure");
  expect(versions).toBe(2);
  expect(await counts()).toEqual(before);
  expect(
    await prisma.auditLog.count({
      where: {
        entityType: "AndroidExplorationImport",
        entityId: value.requestId,
      },
    }),
  ).toBe(0);
});
it("creates only selected pending proposals and exact source/version/audit; concurrent retries return one durable receipt", async () => {
  const value = input(),
    [a, b] = await Promise.all([
      importAndroidExploration(prisma, value, authority()),
      importAndroidExploration(prisma, value, authority()),
    ]);
  expect(a).toEqual(b);
  expect(a.cases).toHaveLength(1);
  const saved = await prisma.testCase.findUniqueOrThrow({
    where: { id: a.cases[0]!.caseId },
    include: { source: true, steps: true, versions: true },
  });
  expect(saved).toMatchObject({
    origin: "IMPORTED",
    reviewStatus: "PENDING_REVIEW",
    title: "Navigate to Browse",
    given: [
      "Open com.vaettir.synthetic at Home using the reviewed test account.",
    ],
    when: ["Choose Browse on Home."],
    then: ["Review that Browse is displayed."],
  });
  expect(saved.source?.importSnapshot).toMatchObject({
    kind: "LOCAL_REPORTED_NAVIGATION",
    nativeExecutionIndependentlyVerified: false,
  });
  expect(saved.steps).toHaveLength(1);
  expect(saved.steps[0]!.action).toContain(
    'objectId="com.vaettir.synthetic:id/navigation"',
  );
  expect(saved.steps[0]!.action).toContain(
    "adb -s <selected-device> shell input tap 100 50",
  );
  expect(saved.steps[0]!.expectedActionOrData).toContain(
    "App backend requests were not captured",
  );
  expect(saved.steps[0]!.expectedResponse).toBeNull();
  expect(saved.versions).toHaveLength(1);
  expect(await prisma.testCase.count({ where: { projectId } })).toBe(1);
  expect(
    await prisma.auditLog.count({
      where: { projectId, entityType: "AndroidExplorationImport" },
    }),
  ).toBe(1);
  expect(await prisma.testRun.count({ where: { projectId } })).toBe(0);
  expect(
    await prisma.aiCreditTransaction.count({
      where: { organizationId: orgId },
    }),
  ).toBe(0);
});
it("fresh request for same journey reuses case without replacing human edits", async () => {
  const original = await importAndroidExploration(prisma, input(), authority());
  const id = original.cases[0]!.caseId;
  await prisma.testCase.update({
    where: { id },
    data: { title: "Human reviewed title", given: ["Keep manual setup"] },
  });
  expect(
    (await importAndroidExploration(prisma, input(), authority())).cases[0]!
      .caseId,
  ).toBe(id);
  expect(
    await prisma.testCase.findUniqueOrThrow({ where: { id } }),
  ).toMatchObject({
    title: "Human reviewed title",
    given: ["Keep manual setup"],
  });
});
it("same request UUID with changed selected content conflicts without adding a case", async () => {
  const first = input(),
    a = await importAndroidExploration(prisma, first, authority());
  const next = input("Details");
  next.requestId = first.requestId;
  await expect(
    importAndroidExploration(prisma, next, authority()),
  ).rejects.toThrow(/different selection/);
  expect(await prisma.testCase.count({ where: { projectId } })).toBe(1);
  expect(a.cases).toHaveLength(1);
});
it("cross-tenant organization, wrong Clerk subject and changed project parent fail before writes", async () => {
  const value = input("About");
  await expect(
    importAndroidExploration(
      prisma,
      { ...value, originalOrganizationId: otherOrg },
      authority(),
    ),
  ).rejects.toThrow(/original project/);
  await expect(
    importAndroidExploration(prisma, value, {
      ...authority(),
      clerkActorId: "other",
    }),
  ).rejects.toThrow(/original project/);
  await prisma.project.update({
    where: { id: projectId },
    data: { organizationId: otherOrg },
  });
  try {
    await expect(
      importAndroidExploration(prisma, value, authority()),
    ).rejects.toThrow(/original project/);
  } finally {
    await prisma.project.update({
      where: { id: projectId },
      data: { organizationId: orgId },
    });
  }
  expect(await prisma.testCase.count({ where: { projectId } })).toBe(1);
});
it("live revocation, read-only seat and suspension deny new writes and retained receipts", async () => {
  const value = input();
  await importAndroidExploration(prisma, value, authority());
  for (const patch of [
    { role: "VIEWER" as const },
    { seatType: "READ_ONLY" as const },
  ]) {
    await prisma.membership.update({ where: { id: memberId }, data: patch });
    await expect(
      importAndroidExploration(prisma, value, authority()),
    ).rejects.toThrow(/original project/);
    await prisma.membership.update({
      where: { id: memberId },
      data: { role: "EDITOR", seatType: "FULL" },
    });
  }
  await prisma.organization.update({
    where: { id: orgId },
    data: { suspendedAt: new Date() },
  });
  try {
    await expect(
      importAndroidExploration(prisma, value, authority()),
    ).rejects.toThrow(/original project/);
  } finally {
    await prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: null },
    });
  }
});
it("changed evidence, extra payloads and discontinuous paths refuse without mutation", async () => {
  const value = input("Help");
  value.journeys[0]!.steps[0]!.to.label = "Changed";
  await expect(
    importAndroidExploration(prisma, value, authority()),
  ).rejects.toThrow(/reviewed journey changed/);
  expect(() =>
    androidExplorationCommit.parse({
      ...input(),
      rawHierarchy: "never admitted",
    }),
  ).toThrow();
  expect(() =>
    androidExplorationCommit.parse({
      ...input(),
      acknowledgeDisclosure: false,
    }),
  ).toThrow();
});
it("an API-key/native row cannot substitute independently authenticated Clerk identity", async () => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { memberships: true },
  });
  // The new procedure retains the existing early-access email gate; isolate the
  // authenticated-subject gate with a synthetic allowlisted caller context.
  const caller = appRouter.createCaller({
    prisma,
    user: { ...user, email: "james@skaldandstone.com" },
  });
  await expect(
    caller.liveAppGeneration.commitExploration(input()),
  ).rejects.toThrow(/authenticated original account/);
  await expect(
    caller.liveAppGeneration.explorationAccess({
      projectId,
      originalOrganizationId: orgId,
      expectedClerkActorId: clerkId,
      readRequestId: randomUUID(),
    }),
  ).rejects.toThrow(/authenticated original account/);
});

it("the current authenticated metadata gate pins native mapping and never grants local processing", async () => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { memberships: true },
  });
  const caller = appRouter.createCaller({
    prisma,
    user: { ...user, email: "james@skaldandstone.com" },
    authenticatedClerkSubject: clerkId,
  });
  const request = {
    projectId,
    originalOrganizationId: orgId,
    expectedClerkActorId: clerkId,
    readRequestId: randomUUID(),
  };
  const response = await caller.liveAppGeneration.explorationAccess(request);
  expect(response).toMatchObject({
    readRequestId: request.readRequestId,
    scope: {
      projectId,
      organizationId: orgId,
      nativeActorId: userId,
      clerkActorId: clerkId,
    },
    processingPermissionGranted: false,
    deviceOperationPerformed: false,
  });
  await expect(
    caller.liveAppGeneration.explorationAccess({
      ...request,
      expectedNativeActorId: "different",
    }),
  ).rejects.toThrow(/original native account/);
  await prisma.membership.update({
    where: { id: memberId },
    data: { role: "VIEWER" },
  });
  try {
    await expect(
      caller.liveAppGeneration.explorationAccess(request),
    ).rejects.toThrow(/original native account/);
  } finally {
    await prisma.membership.update({
      where: { id: memberId },
      data: { role: "EDITOR" },
    });
  }
});
