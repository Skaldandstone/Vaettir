import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  approvedFolderRecoverySchema,
  recoverableFolderReceiptSchema,
} from "./caseFolderRecoverySchema.js";
import { folderCaseHeadHash } from "./caseFolders.js";

describe("reviewed folder recovery contracts (authored, execution deferred)", () => {
  it("rejects missing applied baselines, duplicate IDs and unsupported or inverse receipts", () => {
    const move = {
      id: "synthetic-case",
      displayId: "qa-01",
      fromSuitePath: "Old/Login",
      sourceFilePath: null,
      toSuitePath: "New/Login",
      sortPosition: 0,
      updatedAt: new Date(0).toISOString(),
      version: 1,
      archived: false,
      newVersion: 2,
      appliedUpdatedAt: new Date(1).toISOString(),
      appliedCaseHash: "a".repeat(64),
    };
    const baseline = {
      schemaVersion: 1,
      organizationId: "synthetic-org",
      action: "RENAME",
      fromPath: "Old",
      toPath: "New",
      reason: "Reviewed",
      revision: 1,
      foldersBefore: [],
      foldersAfter: [{ id: "folder-fixture", path: "New" }],
      moves: [move],
    };
    expect(recoverableFolderReceiptSchema.safeParse(baseline).success).toBe(
      true,
    );
    const { appliedCaseHash: _omitted, ...legacyMove } = move;
    expect(
      recoverableFolderReceiptSchema.safeParse({
        ...baseline,
        moves: [legacyMove],
      }).success,
    ).toBe(false);
    expect(
      recoverableFolderReceiptSchema.safeParse({
        ...baseline,
        moves: [move, move],
      }).success,
    ).toBe(false);
    expect(
      recoverableFolderReceiptSchema.safeParse({
        ...baseline,
        schemaVersion: 2,
        action: "RESTORE",
      }).success,
    ).toBe(false);
    expect(
      recoverableFolderReceiptSchema.safeParse({
        ...baseline,
        organizationId: undefined,
      }).success,
    ).toBe(false);
  });
  it("requires an approved exact UUID-bound recovery, not a blind rollback", () => {
    const input = {
      projectId: "fixture-project",
      originalReceiptId: "fixture-receipt",
      expectedHash: "a".repeat(64),
      requestId: randomUUID(),
      confirmed: true,
      reason: "Reviewed inverse placement",
    };
    expect(approvedFolderRecoverySchema.safeParse(input).success).toBe(true);
    for (const bad of [
      { ...input, confirmed: false },
      { ...input, reason: " " },
      { ...input, expectedHash: "short" },
      { ...input, overwrite: true },
    ])
      expect(approvedFolderRecoverySchema.safeParse(bad).success).toBe(false);
  });
  it("includes actual date and all own case metadata in applied head identity", () => {
    const first = {
      id: "synthetic",
      updatedAt: new Date(1),
      customFields: { platform: "Console" },
      steps: [],
    };
    expect(folderCaseHeadHash(first)).not.toBe(
      folderCaseHeadHash({ ...first, updatedAt: new Date(2) }),
    );
    expect(folderCaseHeadHash(first)).not.toBe(
      folderCaseHeadHash({ ...first, customFields: { platform: "PC" } }),
    );
    expect(folderCaseHeadHash(first)).toBe(
      folderCaseHeadHash(JSON.parse(JSON.stringify(first))),
    );
  });
});
