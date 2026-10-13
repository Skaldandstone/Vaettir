import { describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
vi.mock("../services/caseFields.js", () => ({ lockCaseFieldProject: vi.fn() }));
vi.mock("../services/testPlanVersion.js", () => ({ snapshotTestPlanVersion: vi.fn() }));
import { snapshotTestPlanVersion } from "../services/testPlanVersion.js";
import { testPlansRouter } from "./testPlans.js";

function fixture({ seat = "FULL", currentOrg = "org", type = { id: "functional-id", category: "FUNCTIONAL", isBuiltIn: true } as object | null } = {}) {
  const events: string[] = [];
  const db = {
    organization: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    project: {
      findUnique: vi.fn(async () => ({ id: "project", organizationId: "org", organization: { suspendedAt: null } })),
      findUniqueOrThrow: vi.fn(async () => ({ organizationId: currentOrg })),
    },
    membership: { findUnique: vi.fn(async () => ({ role: "EDITOR", seatType: seat })) },
    testPlanType: { upsert: vi.fn(async () => { events.push("default"); return type; }), findUnique: vi.fn(async () => type) },
    testPlan: { create: vi.fn(async ({ data }) => { events.push("plan"); return { ...data, id: "plan-id", status: "DRAFT", executionTemplate: {} }; }) },
    auditLog: { create: vi.fn(async () => { events.push("audit"); }) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  const ctx = { prisma: db, user: { id: "actor", clerkUserId: "synthetic-clerk", memberships: [{ organizationId: "org", role: "EDITOR", seatType: "FULL" }] }, staff: null } as unknown as Context;
  return { db, events, api: testPlansRouter.createCaller(ctx) };
}
describe("manual plan creation (synthetic callers, not native transactions)", () => {
  it("creates a default functional plan without an earlier seeded type", async () => {
    const f = fixture();
    expect(await f.api.create({ projectId: "project", name: "  Regression  " })).toEqual({ id: "plan-id", name: "Regression" });
    expect(f.db.testPlanType.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "functional" }, update: {}, create: expect.objectContaining({ isBuiltIn: true, category: "FUNCTIONAL" }) }));
    expect(f.db.testPlan.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ testPlanTypeId: "functional-id", projectId: "project" }) }));
    expect(f.events).toEqual(["default", "plan", "audit"]);
    expect(snapshotTestPlanVersion).toHaveBeenCalled();
  });
  it("retains explicit type selection without seeding or replacing it", async () => {
    const f = fixture({ type: { id: "custom-id", category: "CUSTOM", isBuiltIn: false } });
    await f.api.create({ projectId: "project", name: "Custom", testPlanTypeId: "custom-id" });
    expect(f.db.testPlanType.upsert).not.toHaveBeenCalled();
    expect(f.db.testPlanType.findUnique).toHaveBeenCalledWith({ where: { id: "custom-id" } });
  });
  it("refuses missing explicit types instead of silently changing the selected shape", async () => {
    const f = fixture({ type: null });
    await expect(f.api.create({ projectId: "project", name: "Plan", testPlanTypeId: "deleted" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.db.testPlan.create).not.toHaveBeenCalled();
  });
  it("refuses a custom collision at the default key without overwriting its schema", async () => {
    const f = fixture({ type: { id: "custom", isBuiltIn: false, category: "CUSTOM" } });
    await expect(f.api.create({ projectId: "project", name: "Plan" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.db.testPlan.create).not.toHaveBeenCalled();
  });
  it("rechecks a native seat downgrade before any default or plan write", async () => {
    const f = fixture({ seat: "READ_ONLY" });
    await expect(f.api.create({ projectId: "project", name: "Plan" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.db.testPlanType.upsert).not.toHaveBeenCalled();
    expect(f.db.testPlan.create).not.toHaveBeenCalled();
  });
  it("refuses project reassignment before any default or plan write", async () => {
    const f = fixture({ currentOrg: "foreign" });
    await expect(f.api.create({ projectId: "project", name: "Plan" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.db.testPlanType.upsert).not.toHaveBeenCalled();
  });
  it("rejects blank names instead of creating an unnamed plan", async () => {
    const f = fixture();
    await expect(f.api.create({ projectId: "project", name: "  " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
});
