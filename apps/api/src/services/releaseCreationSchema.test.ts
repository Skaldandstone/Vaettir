import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  releaseCreationSchema,
  releaseTargetDateSchema,
  releaseCreationIdentity,
} from "./releaseCreationSchema.js";
const scope = {
  requestId: "a18ca26b-dcfa-4118-b2ba-590f753d7aa1",
  originalOrganizationId: "org",
  expectedClerkActorId: "clerk-actor",
};

describe("release creation JSON boundary", () => {
  it("opt-in EXACT retains complete prose/order/duplicates while old parsed body and UUID hash stay unchanged", () => {
    const raw = " \t Verify λ🎮\n  Keep this exact second line \n";
    const old = releaseCreationIdentity({ ...scope, projectId: "p", name: " Release ", newPlan: { name: " Checks ", criteria: [raw, raw] } }, "actor");
    const oldBody = { ...scope, projectId: "p", name: "Release", testPlanIds: [], goals: [], newPlan: { name: "Checks", criteria: [raw.trim(), raw.trim()] } };
    expect(old.input).toEqual(oldBody);
    expect(JSON.stringify(old.input)).toBe(JSON.stringify(oldBody));
    expect(old.requestHash).toBe(createHash("sha256").update(JSON.stringify(oldBody)).digest("hex"));
    expect(old.input.newPlan).not.toHaveProperty("wordingMode");
    const exact = releaseCreationIdentity({ ...scope, projectId: "p", name: " Release ", newPlan: { name: " Checks ", criteria: [raw, raw], wordingMode: "EXACT" } }, "actor");
    expect(exact.input.newPlan).toEqual({ name: "Checks", criteria: [raw, raw], wordingMode: "EXACT" });
    expect(releaseCreationIdentity(exact.input, "actor")).toEqual(exact);
    expect(releaseCreationIdentity(JSON.parse(JSON.stringify(exact.input)), "actor")).toEqual(exact);
    expect(exact.requestHash).not.toBe(old.requestHash);
    expect(exact.releaseId).toBe(old.releaseId);
    expect(releaseCreationIdentity({ ...exact.input, newPlan: { ...exact.input.newPlan!, criteria: [raw.trim(), raw] } }, "actor").requestHash).not.toBe(exact.requestHash);
  });
  it("old trimming bounds remain compatible; EXACT refuses blank, oversized and invalid native text without clipping", () => {
    const padded = " ".repeat(2001) + "Keep";
    expect(releaseCreationSchema.parse({ ...scope, projectId: "p", name: "Release", newPlan: { name: "Checks", criteria: [padded] } }).newPlan?.criteria).toEqual(["Keep"]);
    for (const value of ["", " \n ", padded, "x\0y", "\ud800"]) {
      expect(releaseCreationSchema.safeParse({ ...scope, projectId: "p", name: "Release", newPlan: { name: "Checks", criteria: [value], wordingMode: "EXACT" } }).success).toBe(false);
    }
    expect(releaseCreationSchema.safeParse({ ...scope, projectId: "p", name: "Release", newPlan: { name: "Checks", criteria: ["Keep"], wordingMode: "trim" } }).success).toBe(false);
  });
  it("accepts exactly the date the browser serializes", () => {
    const input = JSON.parse(
      JSON.stringify({
        ...scope,
        projectId: "project",
        name: "Regular release",
        targetDate: new Date("2026-10-17T12:00:00Z"),
      }),
    );
    expect(releaseCreationSchema.parse(input).targetDate?.toISOString()).toBe(
      "2026-10-17T12:00:00.000Z",
    );
  });
  it("preserves direct caller Dates and timezone offsets", () => {
    expect(
      releaseTargetDateSchema
        .parse(new Date("2026-10-17T12:00:00Z"))
        .toISOString(),
    ).toBe("2026-10-17T12:00:00.000Z");
    expect(
      releaseTargetDateSchema.parse("2026-10-17T12:00:00-07:00").toISOString(),
    ).toBe("2026-10-17T19:00:00.000Z");
  });
  it("refuses blank, ambiguous or non-date values instead of converting them to epoch", () => {
    for (const value of [
      null,
      true,
      0,
      "",
      "tomorrow",
      "2026-10-17",
      "2026-13-17T12:00:00Z",
      new Date(NaN),
    ])
      expect(releaseTargetDateSchema.safeParse(value).success).toBe(false);
  });
  it("allows omitted dates and bounded inline pending criteria", () => {
    const input = releaseCreationSchema.parse({
      ...scope,
      projectId: "p",
      name: " v1.2 ",
      newPlan: { name: " Release checks ", criteria: [" Pass regression "] },
    });
    expect(input.targetDate).toBeUndefined();
    expect(input.newPlan).toEqual({
      name: "Release checks",
      criteria: ["Pass regression"],
    });
    expect(
      releaseCreationSchema.safeParse({
        ...input,
        newPlan: { name: "Checks", criteria: [""] },
      }).success,
    ).toBe(false);
  });
  it("requires the reviewed actor/workspace and a durable UUID", () => {
    const input = { ...scope, projectId: "p", name: "Release" };
    for (const key of [
      "requestId",
      "originalOrganizationId",
      "expectedClerkActorId",
    ] as const) {
      const missing = { ...input } as Record<string, unknown>;
      delete missing[key];
      expect(releaseCreationSchema.safeParse(missing).success).toBe(false);
    }
    expect(
      releaseCreationSchema.safeParse({ ...input, requestId: "bad" }).success,
    ).toBe(false);
  });
  it("hashes browser ISO and direct Date identically but detects every changed intent", () => {
    const input = {
      ...scope,
      projectId: "p",
      name: " Release ",
      targetDate: new Date("2026-10-17T12:00:00Z"),
      newPlan: { name: "Checks", criteria: ["Pass regression"] },
    };
    const first = releaseCreationIdentity(input, "actor");
    expect(
      releaseCreationIdentity(JSON.parse(JSON.stringify(input)), "actor"),
    ).toEqual(first);
    expect(
      releaseCreationIdentity(
        { ...input, targetDate: new Date("2026-10-18T12:00:00Z") },
        "actor",
      ).requestHash,
    ).not.toBe(first.requestHash);
    expect(
      releaseCreationIdentity(
        {
          ...input,
          newPlan: { name: "Checks", criteria: ["Different requirement"] },
        },
        "actor",
      ).requestHash,
    ).not.toBe(first.requestHash);
    expect(
      releaseCreationIdentity({ ...input, projectId: "foreign" }, "actor")
        .releaseId,
    ).not.toBe(first.releaseId);
    expect(releaseCreationIdentity(input, "other-actor").releaseId).not.toBe(
      first.releaseId,
    );
    expect(
      releaseCreationIdentity(
        { ...input, originalOrganizationId: "other-org" },
        "actor",
      ).releaseId,
    ).not.toBe(first.releaseId);
    expect(
      releaseCreationIdentity({ ...input, name: "Changed" }, "actor").releaseId,
    ).toBe(first.releaseId);
  });
  it("locks current authorization before durable receipt lookup and commits receipt with the atomic release", () => {
    const source = readFileSync(
      new URL("../routers/releases.ts", import.meta.url),
      "utf8",
    );
    const create = source.slice(
      source.indexOf("  create: protectedProcedure"),
      source.indexOf("  updateStatus: protectedProcedure"),
    );
    expect(create.indexOf("lockCaseFieldProject(")).toBeLessThan(
      create.indexOf("tx.auditLog.findFirst("),
    );
    expect(create.indexOf("lockCurrentCaseFieldActor(")).toBeLessThan(
      create.indexOf("tx.auditLog.findFirst("),
    );
    expect(create).toContain(
      "project.organizationId !== input.originalOrganizationId",
    );
    expect(create).toContain(
      "ctx.user.clerkUserId !== input.expectedClerkActorId",
    );
    expect(create).toContain("saved.data.requestHash !== identity.requestHash");
    expect(create.indexOf("return acknowledge(previous)")).toBeLessThan(
      create.indexOf("tx.release.create("),
    );
    expect(create).toContain("id: identity.releaseId");
    expect(create).toContain('status: "PENDING"');
    expect(create.indexOf("tx.auditLog.create(")).toBeGreaterThan(
      create.indexOf("snapshotTestPlanVersion("),
    );
  });
  it("release wizard retains exact scope and ambiguity history, with bounded generated plan names", () => {
    const page = readFileSync(
      new URL(
        "../../../web/app/projects/[projectId]/releases/page.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(page).toContain("const request = createRequest ??");
    // Recovery moved from a render-owned ref to the event owner. Keep checking
    // the original ambiguity history and current-attempt guard, not the old
    // variable spelling. Actual deferred-callback tests live in Web alongside
    // the real page controller; this remains a source integration contract.
    expect(page).toContain(
      "retainAnalysisRequest(attempt.event.unknown || !this.current(attempt), error)",
    );
    expect(page).toContain("attempt.event.unknown = retained");
    expect(page).toContain("createOwner.request() ?? publishedCreateRequest");
    expect(page).toContain("createOwner.retain(attempt, cause)");
    expect(page).toContain("if (!retained || !current) return");
    expect(page).toContain("if (!retained.retained) { setCreateRequest(null);");
    expect(page).toContain("result.requestId !== request.requestId");
    expect(page).toContain("useManualExecutionAccess(projectId)");
    expect(page).toMatch(
      /fieldset\s+disabled=\{\s*createMutation.isPending \|\| !!createRequest \|\| !access.canWrite\s*\}/,
    );
    expect(page).toContain("`${name.trim()} quality plan`.slice(0, 200)");
    const name = "x".repeat(200);
    expect(
      releaseCreationSchema.safeParse({
        ...scope,
        projectId: "p",
        name,
        newPlan: {
          name: `${name} quality plan`.slice(0, 200),
          criteria: ["Verify"],
        },
      }).success,
    ).toBe(true);
  });
  it("the strategy inline caller also pins scope, freezes payload and preserves unknown acknowledgement history", () => {
    const page = readFileSync(new URL("../../../web/app/projects/[projectId]/test-strategy/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("const request = releaseRequest ??");
    expect(page).toContain("retainAnalysisRequest(releaseUnknown.current, e)");
    expect(page).toContain("if (!retain) setReleaseRequest(null)");
    expect(page).toContain("r.requestId !== request.requestId");
    expect(page).toContain("releaseAccess.origin.organizationId");
    expect(page).toMatch(/disabled=\{\s*creatingRelease \|\| !!releaseRequest \|\| !releaseAccess.canWrite\s*\}/);
  });
});
