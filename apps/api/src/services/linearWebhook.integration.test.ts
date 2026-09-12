// P9-02: real-DB proof that an inbound Linear Issue-update webhook routes
// to the right requirement WITHIN the right org (never cross-org, even if
// two orgs happen to link the same Linear identifier string) and updates
// its status - no Linear workspace exists in this environment, so this
// drives handleLinearWebhook directly with a payload shaped like Linear's
// own documented Issue webhook event.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { handleLinearWebhook } from "./linearWebhook.js";

const RUN = `linear-${randomUUID()}`;
let orgAId: string;
let orgBId: string;
let projectAId: string;
let projectBId: string;
let requirementAId: string;

beforeAll(async () => {
  const tier = await prisma.planTier.findFirstOrThrow();
  const [orgA, orgB] = await Promise.all([
    prisma.organization.create({ data: { name: `Linear test A ${RUN}`, slug: `${RUN}-a`, planTierId: tier.id } }),
    prisma.organization.create({ data: { name: `Linear test B ${RUN}`, slug: `${RUN}-b`, planTierId: tier.id } }),
  ]);
  orgAId = orgA.id;
  orgBId = orgB.id;
  const [projectA, projectB] = await Promise.all([
    prisma.project.create({ data: { organizationId: orgAId, name: "Project A", slug: "project-a" } }),
    prisma.project.create({ data: { organizationId: orgBId, name: "Project B", slug: "project-b" } }),
  ]);
  projectAId = projectA.id;
  projectBId = projectB.id;
  // Both orgs link the SAME Linear identifier string - a real ambiguity
  // this routing design must resolve by org, not just by identifier.
  const [reqA] = await Promise.all([
    prisma.requirement.create({ data: { projectId: projectAId, title: "Req A", linearIssueId: "ENG-42" } }),
    prisma.requirement.create({ data: { projectId: projectBId, title: "Req B", linearIssueId: "ENG-42" } }),
  ]);
  requirementAId = reqA.id;
});

afterAll(async () => {
  if (!orgAId) return;
  await prisma.requirement.deleteMany({ where: { project: { organizationId: { in: [orgAId, orgBId] } } } });
  await prisma.project.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
});

describe("handleLinearWebhook (real DB)", () => {
  it("ignores non-Issue event types", async () => {
    const result = await handleLinearWebhook(prisma, orgAId, { type: "Comment" });
    expect(result).toEqual({ handled: false, reason: "ignored type: Comment" });
  });

  it("reports no linked requirement when the identifier doesn't match anything in this org", async () => {
    const result = await handleLinearWebhook(prisma, orgAId, {
      type: "Issue",
      data: { identifier: "ENG-unknown", state: { name: "Done" } },
    });
    expect(result.handled).toBe(false);
    expect(result.reason).toMatch(/no requirement in this org/);
  });

  it("updates only org A's requirement, never org B's, even though both link the same identifier", async () => {
    const result = await handleLinearWebhook(prisma, orgAId, {
      type: "Issue",
      data: { identifier: "ENG-42", title: "Fix the thing", state: { name: "Done" }, url: "https://linear.app/x/issue/ENG-42" },
    });
    expect(result.handled).toBe(true);
    expect(result.requirementId).toBe(requirementAId);

    const reqA = await prisma.requirement.findUniqueOrThrow({ where: { id: requirementAId } });
    expect(reqA.linearStatusName).toBe("Done");
    expect(reqA.linearSyncedAt).not.toBeNull();

    const reqB = await prisma.requirement.findFirstOrThrow({ where: { projectId: projectBId } });
    expect(reqB.linearStatusName).toBeNull();
  });
});
