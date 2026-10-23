import { describe, expect, it, vi } from "vitest";
import { projectMappings } from "./externalTestMapping.js";

function fakeTransaction(sources: Array<{ externalTestId: string | null; testCaseId: string }>, stableCaseIds: string[] = []) {
  return {
    testCaseSource: { findMany: vi.fn().mockResolvedValue(sources) },
    testCase: { findMany: vi.fn().mockResolvedValue(stableCaseIds.map((id) => ({ id }))) },
  } as never;
}

describe("project-scoped external test identity", () => {
  it("scopes legacy mapping lookup to the selected project", async () => {
    const tx = fakeTransaction([{ externalTestId: "TC-123", testCaseId: "case-a" }]);
    const result = await projectMappings(tx, "project-a", ["TC-123"]);
    expect(result.mapping.get("TC-123")).toBe("case-a");
    expect((tx as { testCaseSource: { findMany: ReturnType<typeof vi.fn> } }).testCaseSource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ testCase: { projectId: "project-a" } }),
    }));
  });

  it("fails closed when one project has duplicate legacy mappings", async () => {
    const tx = fakeTransaction([
      { externalTestId: "TC-123", testCaseId: "case-a" },
      { externalTestId: "TC-123", testCaseId: "case-b" },
    ]);
    await expect(projectMappings(tx, "project-a", ["TC-123"])).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("resolves a generated VAE id directly to a case in the same project", async () => {
    const tx = fakeTransaction([], ["cm123"]);
    const result = await projectMappings(tx, "project-a", ["VAE-cm123"]);
    expect(result.mapping.get("VAE-cm123")).toBe("cm123");
  });
});
