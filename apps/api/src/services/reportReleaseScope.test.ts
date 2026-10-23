// Authored source only. Do not execute until morning validation is approved.
import { describe, it, expect } from "vitest";
import {
  reportReleaseScopeIdentity,
  reportReleaseLabel,
} from "./reportReleaseScope.js";
describe("native release identity and bounded label", () => {
  it("rejects unknown shape unsupported and missing identities without inferring names or branches", () => {
    expect(
      reportReleaseScopeIdentity.parse({
        projectId: "native-project",
        releaseId: "native-release",
      }),
    ).toEqual({ projectId: "native-project", releaseId: "native-release" });
    for (const input of [
      { projectId: "p" },
      { projectId: "p", releaseId: "" },
      { projectId: "p", releaseId: " " },
      { projectId: "p", releaseId: "r", branch: "main" },
      { projectId: "p", releaseId: "r".repeat(201) },
      { projectId: "p", releaseId: "r\u0000" },
    ])
      expect(reportReleaseScopeIdentity.safeParse(input).success).toBe(false);
  });
  it("retains exact short names and exposes database or UTF16 excerpt truthfully", () => {
    expect(reportReleaseLabel("Release 1", false)).toEqual({
      releaseName: "Release 1",
      releaseNameIsExcerpt: false,
    });
    expect(reportReleaseLabel("x".repeat(240), true).releaseNameIsExcerpt).toBe(
      true,
    );
    const surrogate = reportReleaseLabel("a".repeat(239) + "😀tail", false);
    expect(surrogate.releaseName).toBe("a".repeat(239));
    expect(surrogate.releaseNameIsExcerpt).toBe(true);
    expect(reportReleaseLabel("😀".repeat(240), false).releaseName).toBe(
      "😀".repeat(120),
    );
    expect(
      reportReleaseLabel("a".repeat(238) + "😀", false).releaseNameIsExcerpt,
    ).toBe(false);
  });
  it("refuses unavailable controls and malformed Unicode instead of silently replacing labels", () => {
    for (const name of ["", " ", "Invalid\u0001name", "\ud800", "\udc00"])
      expect(() => reportReleaseLabel(name, false)).toThrow();
  });
  it("rejects all unsupported controls without removing supported label whitespace", () => {
    for (const code of [...Array.from({ length: 32 }, (_, i) => i), 127]) {
      const name = `Release${String.fromCharCode(code)}One`;
      if ([9, 10, 13].includes(code))
        expect(reportReleaseLabel(name, false).releaseName).toBe(name);
      else expect(() => reportReleaseLabel(name, false)).toThrow();
    }
  });
});
