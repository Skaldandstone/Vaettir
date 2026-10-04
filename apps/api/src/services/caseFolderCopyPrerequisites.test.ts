// SOURCE ONLY. Authored assertions have not been executed tonight.
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { reviewedInternalPrerequisites } from "./caseFolderCopyPrerequisites.js";
import {
  folderCopyReviewSchema,
  folderCopyApprovalSchema,
} from "./caseFolderCopySchema.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";

describe("bounded complete internal prerequisite copy", () => {
  const projectId = "synthetic-project";
  const edge = (dependentId: string, prerequisiteId: string) => ({
    projectId,
    dependentId,
    prerequisiteId,
  });
  it("keeps absent legacy input bytes/hash and requires complete explicit opt-in evidence", () => {
    const old = {
      projectId,
      fromPath: "Source",
      toPath: "Copy",
      expectedHash: "a".repeat(64),
      requestId: randomUUID(),
      confirmed: true as const,
      reason: "Reviewed copy",
    };
    expect(folderCopyApprovalSchema.parse(old)).toEqual(old);
    expect(qualityProfileHash(folderCopyApprovalSchema.parse(old))).toBe(
      qualityProfileHash(old),
    );
    const opts = {
      ...old,
      copyInternalPrerequisites: true,
      expectedPrerequisiteHash: "b".repeat(64),
      expectedInternalPrerequisites: [
        { dependentId: "b", prerequisiteId: "a" },
      ],
    };
    expect(folderCopyApprovalSchema.safeParse(opts).success).toBe(true);
    for (const wrong of [
      { ...old, copyInternalPrerequisites: false },
      { ...old, copyInternalPrerequisites: true },
      { ...old, expectedPrerequisiteHash: "b".repeat(64) },
      { ...opts, expectedPrerequisiteHash: undefined },
      { ...opts, expectedInternalPrerequisites: undefined },
    ])
      expect(folderCopyApprovalSchema.safeParse(wrong).success).toBe(false);
    expect(
      folderCopyReviewSchema.parse({
        projectId,
        fromPath: "Source",
        toPath: "Copy",
      }),
    ).not.toHaveProperty("copyInternalPrerequisites");
  });
  it("canonicalizes only complete acyclic project-local edges and includes isolated selected cases", () => {
    expect(
      reviewedInternalPrerequisites(
        projectId,
        ["a", "b", "c", "isolated"],
        [edge("c", "b"), edge("b", "a")],
      ),
    ).toEqual([
      { dependentId: "b", prerequisiteId: "a" },
      { dependentId: "c", prerequisiteId: "b" },
    ]);
    expect(reviewedInternalPrerequisites(projectId, [], [])).toEqual([]);
  });
  it("refuses external incoming/outgoing, cross-project, duplicate and self edges without revealing the foreign identity", () => {
    for (const touching of [
      [edge("outside-private", "a")],
      [edge("a", "outside-private")],
      [{ ...edge("a", "b"), projectId: "foreign-private" }],
      [edge("a", "a")],
      [edge("a", "b"), edge("a", "b")],
    ]) {
      expect(() =>
        reviewedInternalPrerequisites(projectId, ["a", "b"], touching),
      ).toThrow("complete selected subtree");
      try {
        reviewedInternalPrerequisites(projectId, ["a", "b"], touching);
      } catch (error) {
        expect(String(error)).not.toContain("outside-private");
        expect(String(error)).not.toContain("foreign-private");
      }
    }
  });
  it("refuses complete cycles, overbound cases and the 2501 touching-edge sentinel instead of truncating", () => {
    expect(() =>
      reviewedInternalPrerequisites(
        projectId,
        ["a", "b", "c"],
        [edge("a", "b"), edge("b", "c"), edge("c", "a")],
      ),
    ).toThrow("cyclic");
    expect(() =>
      reviewedInternalPrerequisites(
        projectId,
        Array.from({ length: 51 }, (_, n) => `case-${n}`),
        [],
      ),
    ).toThrow();
    expect(() =>
      reviewedInternalPrerequisites(
        projectId,
        ["a", "b"],
        Array.from({ length: 2501 }, () => edge("a", "b")),
      ),
    ).toThrow();
    expect(
      folderCopyApprovalSchema.safeParse({
        projectId,
        fromPath: "Source",
        toPath: "Copy",
        copyInternalPrerequisites: true,
        expectedHash: "a".repeat(64),
        requestId: randomUUID(),
        confirmed: true,
        reason: "Bound",
        expectedPrerequisiteHash: "b".repeat(64),
        expectedInternalPrerequisites: Array.from({ length: 2501 }, () => ({
          dependentId: "a",
          prerequisiteId: "b",
        })),
      }).success,
    ).toBe(false);
  });
});
