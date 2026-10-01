import { describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
import { riskAnalysisRouter } from "./riskAnalysis.js";
import { PATH_GLOB_LIMITS } from "../services/boundedPathGlob.js";

function fixture(policy: unknown = null, role = "OWNER") {
  const upsert = vi.fn();
  const context = {
    prisma: {
      project: { findUnique: vi.fn().mockResolvedValue({ id: "project", organizationId: "org" }) },
      organization: { findUnique: vi.fn().mockResolvedValue({ suspendedAt: null }) },
      prScanPolicy: { findUnique: vi.fn().mockResolvedValue(policy), upsert },
    },
    user: { id: "actor", memberships: [{ organizationId: "org", role }] },
  } as unknown as Context;
  return { caller: riskAnalysisRouter.createCaller(context), upsert };
}
const input = { projectId: "project", triggerBranches: ["main"], commentMode: "COMMENT" as const };

describe("bounded risk policy editor", () => {
  it("refuses a truncated editable view of an oversized stored policy", async () => {
    const rules = Array.from({ length: PATH_GLOB_LIMITS.rules + 1 }, () => ({ pattern: "**", severity: "LOW" }));
    const { caller, upsert } = fixture({ ...input, pathSeverityRules: rules });
    await expect(caller.getPrScanPolicy({ projectId: "project" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(rules).toHaveLength(PATH_GLOB_LIMITS.rules + 1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects unsupported and excessive saves before any policy write", async () => {
    const { caller, upsert } = fixture();
    await expect(caller.savePrScanPolicy({ ...input, pathSeverityRules: [{ pattern: "src/@(auth|payments)", severity: "LOW" }] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.savePrScanPolicy({ ...input, pathSeverityRules: Array.from({ length: PATH_GLOB_LIMITS.rules + 1 }, () => ({ pattern: "**", severity: "LOW" as const })) }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("keeps normal authorized saves and the admin authorization gate", async () => {
    const pathSeverityRules = [{ pattern: "src/{auth,payments}/**", severity: "CRITICAL" as const }];
    const admin = fixture();
    await admin.caller.savePrScanPolicy({ ...input, pathSeverityRules });
    expect(admin.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ pathSeverityRules }) }));
    const viewer = fixture(null, "VIEWER");
    await expect(viewer.caller.savePrScanPolicy({ ...input, pathSeverityRules })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(viewer.upsert).not.toHaveBeenCalled();
  });
});
