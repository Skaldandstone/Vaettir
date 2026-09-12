// Real-DB, real-router proof of the share-link access model: nothing is
// exposed until a human explicitly generates a link (createShareLink),
// the token itself is the only access control getSharedSummary checks (no
// session required - the whole point, since a Jira/Linear unfurl bot has
// no way to authenticate as a Vaettir user), and revoking or regenerating
// immediately invalidates whatever was pasted anywhere before.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "../router.js";

const RUN = `share-link-${randomUUID()}`;
let orgId: string;
let projectId: string;
let requirementId: string;
let editorUserId: string;

function callerFor(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: true } }).then((user) =>
    appRouter.createCaller({ prisma, user }),
  );
}

beforeAll(async () => {
  const tier = await prisma.planTier.findFirstOrThrow();
  const org = await prisma.organization.create({ data: { name: `Share link test ${RUN}`, slug: RUN, planTierId: tier.id } });
  orgId = org.id;
  const project = await prisma.project.create({ data: { organizationId: orgId, name: "Share project", slug: "share-project" } });
  projectId = project.id;
  const requirement = await prisma.requirement.create({ data: { projectId, title: "Share me" } });
  requirementId = requirement.id;
  const editor = await prisma.user.create({ data: { clerkUserId: `${RUN}-editor`, email: `${RUN}-editor@example.com` } });
  editorUserId = editor.id;
  await prisma.membership.create({ data: { organizationId: orgId, userId: editorUserId, role: "EDITOR" } });
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.requirement.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { organizationId: orgId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: editorUserId } });
  await prisma.organization.delete({ where: { id: orgId } });
});

describe("requirement share-link (real DB, real router)", () => {
  it("getSharedSummary returns null for a requirement that never generated a link", async () => {
    const caller = appRouter.createCaller({ prisma, user: null });
    const result = await caller.requirements.getSharedSummary({ shareToken: "not-a-real-token" });
    expect(result).toBeNull();
  });

  it("createShareLink generates a token, and getSharedSummary then serves the real summary with no auth", async () => {
    const editorCaller = await callerFor(editorUserId);
    const { shareToken } = await editorCaller.requirements.createShareLink({ requirementId });
    expect(shareToken).toBeTruthy();

    const publicCaller = appRouter.createCaller({ prisma, user: null });
    const result = await publicCaller.requirements.getSharedSummary({ shareToken });
    expect(result?.requirementId).toBe(requirementId);
    expect(result?.requirementTitle).toBe("Share me");
  });

  it("revokeShareLink invalidates the token immediately", async () => {
    const editorCaller = await callerFor(editorUserId);
    const { shareToken } = await editorCaller.requirements.createShareLink({ requirementId });
    await editorCaller.requirements.revokeShareLink({ requirementId });

    const publicCaller = appRouter.createCaller({ prisma, user: null });
    const result = await publicCaller.requirements.getSharedSummary({ shareToken });
    expect(result).toBeNull();
  });

  it("regenerating a link invalidates the previous token", async () => {
    const editorCaller = await callerFor(editorUserId);
    const first = await editorCaller.requirements.createShareLink({ requirementId });
    const second = await editorCaller.requirements.createShareLink({ requirementId });
    expect(second.shareToken).not.toBe(first.shareToken);

    const publicCaller = appRouter.createCaller({ prisma, user: null });
    expect(await publicCaller.requirements.getSharedSummary({ shareToken: first.shareToken })).toBeNull();
    expect((await publicCaller.requirements.getSharedSummary({ shareToken: second.shareToken }))?.requirementId).toBe(requirementId);
  });
});
