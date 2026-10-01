import { describe, expect, it } from "vitest";
import { automationTargetForFramework, experienceProfileSchema, resolveQualityExperience } from "./qualityExperience";

describe("quality experience", () => {
  it("keeps granular mixed profiles and hidden selections without inferring applicability", () => {
    const profile = experienceProfileSchema.parse({ version: 1, offerings: ["GAME", "HIL", "FOOD_SAFETY"], gameGenres: ["RPG"], gamePlatforms: ["PS5", "SWITCH_2", "WINDOWS_PC"], multiplayerModes: ["CROSS_PLAY"], hardwareKinds: ["CONTROLLER"], processKinds: ["MONITORING", "VERIFICATION"], jurisdictions: ["United States"] });
    expect(profile.gamePlatforms).toEqual(["PS5", "SWITCH_2", "WINDOWS_PC"]);
    const view = resolveQualityExperience(profile);
    expect(view.physical).toBe(true);
    expect(view.planGuidance.join(" ")).toContain("cross-play");
    expect(view.caseGuidance.join(" ")).toContain("save/load");
    expect(view.runGuidance.join(" ")).toContain("DUT");
    expect(view.reviewNotes.join(" ")).toContain("No universal safety limit");
    expect(view.reviewNotes.join(" ")).toContain("do not grant platform certification access");
    expect(profile).not.toHaveProperty("regulations");
    expect(experienceProfileSchema.parse({ ...profile, offerings: ["SOFTWARE"] }).gamePlatforms).toEqual(profile.gamePlatforms);
  });
  it.each([
    { version: 1, offerings: [] },
    { version: 1, offerings: ["GAME", "GAME"] },
    { version: 1, offerings: ["GAME"], gamePlatforms: ["FAKE_CONSOLE"] },
    { version: 1, offerings: ["GAME"], gameGenres: ["RPG", "RPG"] },
    { version: 1, offerings: ["SOFTWARE"], jurisdictions: Array.from({ length: 17 }, (_, i) => String(i)) },
    { version: 2, offerings: ["SOFTWARE"] },
    { offerings: ["SOFTWARE"] },
    { version: 1, offerings: ["SOFTWARE"], certified: true },
  ])("rejects invalid or unsupported profiles %j", input => {
    expect(experienceProfileSchema.safeParse(input).success).toBe(false);
  });
  it("separates laboratory/privacy and machinery operation boundaries", () => {
    const view = resolveQualityExperience(experienceProfileSchema.parse({ version: 1, offerings: ["CLINICAL", "MANUFACTURING"] }));
    expect(view.runGuidance.join(" ")).toContain("pseudonymous");
    expect(view.reviewNotes.join(" ")).toContain("No equipment is actuated");
    expect(view.reviewNotes.join(" ")).toContain("not a validated clinical");
  });
  it("suggests only known linked framework targets, never a guessed mobile default", () => {
    expect(automationTargetForFramework("UNITY_TEST")).toBe("UNITY_TEST_FRAMEWORK");
    expect(automationTargetForFramework("UNREAL_AUTOMATION")).toBe("UNREAL_AUTOMATION");
    expect(automationTargetForFramework("VITEST")).toBe("JEST_VITEST");
    expect(automationTargetForFramework("PYTEST")).toBe("PYTEST");
    expect(automationTargetForFramework("PLAYWRIGHT")).toBe("PLAYWRIGHT");
    expect(automationTargetForFramework(null)).toBeNull();
    expect(automationTargetForFramework("GAME")).toBeNull();
    expect(automationTargetForFramework("UNKNOWN")).toBeNull();
    for (const name of ["__proto__", "constructor", "toString"]) expect(automationTargetForFramework(name)).toBeNull();
  });
});
