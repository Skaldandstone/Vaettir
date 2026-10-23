import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@vaettir/db";
import { ensureCaseEvidenceNotRetained } from "./caseEvidenceRetention.js";

describe("case evidence retention scope", () => {
  it("scopes attachment reads to the authorized project even for a foreign case ID", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn();
    const query = vi.fn();
    const tx = {
      testCaseAttachment: { findMany },
      manualStepResultRevision: { count },
      $queryRaw: query,
    } as unknown as Prisma.TransactionClient;
    await ensureCaseEvidenceNotRetained(tx, "authorized-project", "foreign-case");
    expect(findMany).toHaveBeenCalledWith({
      where: { testCaseId: "foreign-case", testCase: { projectId: "authorized-project" } },
      select: { id: true },
      take: 1001,
    });
    expect(count).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
