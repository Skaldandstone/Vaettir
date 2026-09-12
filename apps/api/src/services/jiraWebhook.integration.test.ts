// P9-01: real-DB proof that an inbound Jira webhook delivery routes to the
// right requirement WITHIN the right org (never cross-org, even if two
// orgs happen to link the same Jira issue key) and updates its status - no
// Jira site exists in this environment, so this drives handleJiraWebhook
// directly with the payload shape Vaettir asks customers to configure in
// their own Jira Automation rule.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { handleJiraWebhook } from "./jiraWebhook.js";

const RUN = `jira-${randomUUID()}`;
let orgAId: string;
let orgBId: string;
let projectAId: string;
let projectBId: string;
let requirementAId: string;

beforeAll(async () => {
  const tier = await prisma.planTier.findFirstOrThrow();
  const [orgA, orgB] = await Promise.all([
    prisma.organization.create({ data: { name: `Jira test A ${RUN}`, slug: `${RUN}-a`, planTierId: tier.id } }),
    prisma.organization.create({ data: { name: `Jira test B ${RUN}`, slug: `${RUN}-b`, planTierId: tier.id } }),
  ]);
  orgAId = orgA.id;
  orgBId = orgB.id;
  const [projectA, projectB] = await Promise.all([
    prisma.project.create({ data: { organizationId: orgAId, name: "Project A", slug: "project-a" } }),
    prisma.project.create({ data: { organizationId: orgBId, name: "Project B", slug: "project-b" } }),
  ]);
  projectAId = projectA.id;
  projectBId = projectB.id;
  // Both orgs link the SAME Jira issue key - a real ambiguity this routing
  // design must resolve by org, not just by key.
  const [reqA] = await Promise.all([
    prisma.requirement.create({ data: { projectId: projectAId, title: "Req A", jiraIssueKey: "PROJ-42" } }),
    prisma.requirement.create({ data: { projectId: projectBId, title: "Req B", jiraIssueKey: "PROJ-42" } }),
  ]);
  requirementAId = reqA.id;
});

afterAll(async () => {
  if (!orgAId) return;
  await prisma.requirement.deleteMany({ where: { project: { organizationId: { in: [orgAId, orgBId] } } } });
  await prisma.project.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
});

describe("handleJiraWebhook (real DB)", () => {
  it("reports missing issueKey rather than crashing on a malformed payload", async () => {
    const result = await handleJiraWebhook(prisma, orgAId, { status: "Done" });
    expect(result).toEqual({ handled: false, reason: "payload has no issueKey" });
  });

  it("reports missing status", async () => {
    const result = await handleJiraWebhook(prisma, orgAId, { issueKey: "PROJ-42" });
    expect(result).toEqual({ handled: false, reason: "payload has no status" });
  });

  it("reports no linked requirement when the key doesn't match anything in this org", async () => {
    const result = await handleJiraWebhook(prisma, orgAId, { issueKey: "PROJ-unknown", status: "Done" });
    expect(result.handled).toBe(false);
    expect(result.reason).toMatch(/no requirement in this org/);
  });

  it("updates only org A's requirement, never org B's, even though both link the same issue key", async () => {
    const result = await handleJiraWebhook(prisma, orgAId, { issueKey: "PROJ-42", status: "Done" });
    expect(result.handled).toBe(true);
    expect(result.requirementId).toBe(requirementAId);

    const reqA = await prisma.requirement.findUniqueOrThrow({ where: { id: requirementAId } });
    expect(reqA.jiraStatusName).toBe("Done");
    expect(reqA.jiraSyncedAt).not.toBeNull();

    const reqB = await prisma.requirement.findFirstOrThrow({ where: { projectId: projectBId } });
    expect(reqB.jiraStatusName).toBeNull();
  });
});
