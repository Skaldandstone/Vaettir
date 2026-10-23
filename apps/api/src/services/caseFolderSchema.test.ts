import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  approvedFolderChangeSchema,
  folderChangeSchema,
  folderPathSchema,
  folderStateSchema,
  pathWithin,
} from "./caseFolderSchema.js";
describe("reviewed folder source contracts (authored, not executed tonight)", () => {
  it("accepts named bounded hierarchy and refuses ambiguous or relative paths", () => {
    for (const path of ["QA", "QA/Login", "ゲーム/Console"])
      expect(folderPathSchema.safeParse(path).success).toBe(true);
    for (const path of [
      "",
      " QA",
      "QA ",
      "QA//Login",
      "QA/../Login",
      "QA\\Login",
      "__unassigned__",
      "a/" + "b/".repeat(8),
      "a".repeat(81),
      "QA\nLogin",
    ])
      expect(folderPathSchema.safeParse(path).success).toBe(false);
    expect(pathWithin("QA/Login", "QA")).toBe(true);
    expect(pathWithin("QA2/Login", "QA")).toBe(false);
  });
  it("requires appropriate source and explicit stable reviewed-write identity", () => {
    const base = {
      projectId: "synthetic-project",
      action: "CREATE" as const,
      toPath: "Empty",
    };
    expect(folderChangeSchema.safeParse(base).success).toBe(true);
    expect(
      folderChangeSchema.safeParse({ ...base, fromPath: "Old" }).success,
    ).toBe(false);
    const approved = {
      ...base,
      expectedHash: "a".repeat(64),
      requestId: randomUUID(),
      confirmed: true,
      reason: "Reviewed empty folder",
    };
    expect(approvedFolderChangeSchema.safeParse(approved).success).toBe(true);
    for (const modified of [
      { ...approved, confirmed: false },
      { ...approved, reason: " " },
      { ...approved, requestId: "new" },
      { ...approved, unexpected: true },
    ])
      expect(approvedFolderChangeSchema.safeParse(modified).success).toBe(
        false,
      );
  });
  it("refuses every C0 control and DEL without normalizing a folder path", () => {
    for (const code of [...Array.from({ length: 32 }, (_, i) => i), 127])
      expect(
        folderPathSchema.safeParse(`QA${String.fromCharCode(code)}Case`)
          .success,
      ).toBe(false);
    expect(folderPathSchema.parse("QA/ゲーム")).toBe("QA/ゲーム");
  });
  it("rejects duplicate stable IDs or paths and excessive persisted empty folders", () => {
    expect(
      folderStateSchema.safeParse([
        { id: "a", path: "QA" },
        { id: "b", path: "QA" },
      ]).success,
    ).toBe(false);
    expect(
      folderStateSchema.safeParse([
        { id: "a", path: "QA" },
        { id: "a", path: "Login" },
      ]).success,
    ).toBe(false);
    expect(
      folderStateSchema.safeParse(
        Array.from({ length: 501 }, (_, i) => ({
          id: String(i),
          path: `folder-${i}`,
        })),
      ).success,
    ).toBe(false);
  });
});
