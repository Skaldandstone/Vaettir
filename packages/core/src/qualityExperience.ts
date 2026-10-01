import { z } from "zod";

// Preferences, not connection health, regulatory applicability or execution proof.
export const EXPERIENCE_OFFERINGS = [
  { id: "SOFTWARE", label: "Software" }, { id: "GAME", label: "Games" },
  { id: "HARDWARE", label: "Hardware / embedded" }, { id: "HIL", label: "Hardware in the loop" },
  { id: "SYSTEM_INTEGRATION", label: "Systems integration" }, { id: "FOOD_SAFETY", label: "Food safety" },
  { id: "CLINICAL", label: "Clinical protocols" }, { id: "LABORATORY", label: "Laboratory" },
  { id: "MANUFACTURING", label: "Machinery / manufacturing" },
] as const;
export const SOFTWARE_KINDS = [
  { id: "SAAS", label: "SaaS" }, { id: "B2B", label: "B2B workflows" },
  { id: "WEB", label: "Web application" }, { id: "MOBILE", label: "Mobile application" },
  { id: "DESKTOP", label: "Desktop application" }, { id: "API", label: "API / services" },
  { id: "EMBEDDED", label: "Firmware / embedded software" }, { id: "DATA", label: "Data processing" },
  { id: "OTHER", label: "Other software" },
] as const;
export const GAME_GENRES = [
  { id: "ACTION", label: "Action" }, { id: "RPG", label: "Role-playing" },
  { id: "STRATEGY", label: "Strategy" }, { id: "SIMULATION", label: "Simulation" },
  { id: "PUZZLE", label: "Puzzle" }, { id: "PLATFORMER", label: "Platformer" },
  { id: "RACING", label: "Racing" }, { id: "SPORTS", label: "Sports" },
  { id: "SURVIVAL", label: "Survival / crafting" }, { id: "SOCIAL", label: "Social / party" },
  { id: "VR_AR", label: "VR / AR" }, { id: "OTHER", label: "Other genre" },
] as const;
export const GAME_PLATFORMS = [
  { id: "WINDOWS_PC", label: "Windows PC" }, { id: "MACOS", label: "macOS" },
  { id: "LINUX_PC", label: "Linux PC" }, { id: "PS5", label: "PlayStation 5" },
  { id: "PS4", label: "PlayStation 4" }, { id: "XBOX_SERIES", label: "Xbox Series X|S" },
  { id: "XBOX_ONE", label: "Xbox One" }, { id: "SWITCH", label: "Nintendo Switch" },
  { id: "SWITCH_2", label: "Nintendo Switch 2" }, { id: "IOS", label: "iOS / iPadOS" },
  { id: "ANDROID", label: "Android" }, { id: "WEB", label: "Browser" },
  { id: "OTHER", label: "Other platform" },
] as const;
export const MULTIPLAYER_MODES = [
  { id: "SINGLE_PLAYER", label: "Single player" }, { id: "LOCAL", label: "Local multiplayer" },
  { id: "ONLINE_COOP", label: "Online co-op" }, { id: "ONLINE_COMPETITIVE", label: "Online competitive" },
  { id: "CROSS_PLAY", label: "Cross-platform play" }, { id: "PERSISTENT_WORLD", label: "Persistent online world" },
] as const;
export const HARDWARE_KINDS = [
  { id: "CONTROLLER", label: "Controller / ECU" }, { id: "SENSOR", label: "Sensors / instrumentation" },
  { id: "ROBOTICS", label: "Robotics" }, { id: "MACHINERY", label: "Industrial machinery" },
  { id: "CONNECTED_DEVICE", label: "Connected device" }, { id: "MEDICAL_DEVICE", label: "Medical device" },
  { id: "ELECTRONICS", label: "Electronics" }, { id: "OTHER", label: "Other hardware" },
] as const;
export const PROCESS_KINDS = [
  { id: "MONITORING", label: "Routine monitoring" }, { id: "VALIDATION", label: "Process validation" },
  { id: "VERIFICATION", label: "Verification" }, { id: "PRODUCT_TESTING", label: "Product / sample testing" },
  { id: "ENVIRONMENTAL", label: "Environmental monitoring" }, { id: "QUALITY_CHECK", label: "Quality inspection" },
  { id: "PROTOCOL", label: "Protocol execution" }, { id: "COMMISSIONING", label: "Commissioning / acceptance" },
] as const;

function choices(catalog: readonly { id: string }[]) {
  return z.array(z.string().refine(id => catalog.some(choice => choice.id === id), "Unknown choice"))
    .max(32).refine(ids => new Set(ids).size === ids.length, "Duplicate choices").default([]);
}
export const experienceProfileSchema = z.object({
  version: z.literal(1),
  offerings: z.array(z.enum(["SOFTWARE", "GAME", "HARDWARE", "HIL", "SYSTEM_INTEGRATION", "FOOD_SAFETY", "CLINICAL", "LABORATORY", "MANUFACTURING"]))
    .min(1).max(9).refine(ids => new Set(ids).size === ids.length, "Duplicate offerings"),
  softwareKinds: choices(SOFTWARE_KINDS), gameGenres: choices(GAME_GENRES), gamePlatforms: choices(GAME_PLATFORMS),
  multiplayerModes: choices(MULTIPLAYER_MODES), hardwareKinds: choices(HARDWARE_KINDS), processKinds: choices(PROCESS_KINDS),
  jurisdictions: z.array(z.string().trim().min(1).max(120)).max(16)
    .refine(ids => new Set(ids).size === ids.length, "Duplicate jurisdictions").default([]),
}).strict();
export type ExperienceProfile = z.infer<typeof experienceProfileSchema>;

export function resolveQualityExperience(profile: ExperienceProfile) {
  const selected = new Set(profile.offerings);
  const caseGuidance: string[] = [], planGuidance: string[] = [], runGuidance: string[] = [];
  const reviewNotes = ["These choices tailor the workspace; they do not approve source processing, certify compliance or prove execution."];
  const physical = ["HARDWARE", "HIL", "MANUFACTURING", "FOOD_SAFETY", "CLINICAL", "LABORATORY"].some(id => selected.has(id as ExperienceProfile["offerings"][number]));
  const caseFieldLabels = {
    setup: "System under test and fixture setup", safety: "Safety prerequisites and stop conditions",
    instruments: "Instruments, calibration and sampling requirements", acceptanceCriteria: "Measurements, units, limits and pass criteria",
  };
  if (selected.has("SOFTWARE")) {
    caseGuidance.push("Separate unit, component, contract and end-to-end coverage; retain integration assertions when shifting tests left.");
    planGuidance.push("Reuse release regression plans across explicit browser, device, role and configuration variants.");
    runGuidance.push("Record the exact build / revision, environment and configuration tested.");
    if (profile.softwareKinds.some(id => ["SAAS", "B2B"].includes(id))) caseGuidance.push("Cover tenant isolation, role permissions, business workflows, data migration and service integrations.");
  }
  if (selected.has("GAME")) {
    caseGuidance.push("Separate engine/developer tests, gameplay scenarios, exploratory sessions and platform-specific checks.");
    if (profile.gameGenres.includes("RPG") || profile.gameGenres.includes("SURVIVAL")) caseGuidance.push("Exercise save/load, progression, inventory and state persistence across sessions.");
    if (profile.gameGenres.includes("VR_AR")) caseGuidance.push("Record headset/runtime/input configuration and approved comfort/accessibility observations; do not infer physical acceptance from simulation.");
    planGuidance.push("Build a repeatable matrix of selected platforms, device/OS versions, input modes and packaged builds.");
    if (profile.multiplayerModes.some(id => id !== "SINGLE_PLAYER")) planGuidance.push("Add explicit client counts, network conditions, session/reconnection and cross-play combinations where selected.");
    runGuidance.push("Capture platform/device, build, graphics/input configuration and single-player or multi-client session setup.");
    if (profile.gamePlatforms.some(id => ["PS5", "PS4", "XBOX_SERIES", "XBOX_ONE", "SWITCH", "SWITCH_2"].includes(id))) reviewNotes.push("Console selections do not grant platform certification access. Authorized platform requirements and submissions remain separate evidence.");
  }
  if (selected.has("HARDWARE") || selected.has("HIL") || selected.has("MANUFACTURING")) {
    caseGuidance.push("Define the device/configuration, approved setup, stimuli, measurement channels, limits and safety prerequisites.");
    planGuidance.push("Reuse procedures across explicitly identified device, firmware, rig and calibration configurations.");
    runGuidance.push("Record serial/device identity, hardware/firmware revision, rig and instrument/calibration references.");
    reviewNotes.push("No equipment is actuated by saving a profile or starting a record. Machinery operation requires approved procedures and authorized operators.");
  }
  if (selected.has("HIL")) {
    caseGuidance.push("Identify simulated versus physical signals, model/simulator versions, timing requirements and fault-injection scenarios.");
    runGuidance.push("Pin the DUT, plant model, simulator, channel map and test sequence; distinguish HIL from MIL/SIL and physical machine trials.");
  }
  if (selected.has("SYSTEM_INTEGRATION")) {
    caseGuidance.push("Capture interface contracts, component versions, end-to-end dependencies and failure/recovery expectations.");
    planGuidance.push("Track approved component compatibility combinations rather than a single project-wide version.");
  }
  if (selected.has("FOOD_SAFETY")) {
    caseFieldLabels.setup = "Approved procedure, product / process and control point";
    caseFieldLabels.safety = "Hazard/control references, prerequisites and escalation procedure";
    caseFieldLabels.instruments = "Sampling plan, method and instrument/calibration references";
    caseFieldLabels.acceptanceCriteria = "Approved limits, units, monitoring frequency and review criteria";
    caseGuidance.push("Keep monitoring, validation, verification and quality checks distinct; record approved method and actual readings, not only 'OK'.");
    planGuidance.push("Repeat approved procedures by product/lot, process/control point and sampling schedule without overwriting prior records.");
    runGuidance.push("Record product/lot/sample identity, activity date/time, method/version, operator, actual observations and deviation/corrective-action references.");
    reviewNotes.push("Food jurisdiction, commodity and facility applicability must be confirmed by a qualified owner. No universal safety limit or 'food safe' verdict is supplied.");
  }
  if (selected.has("CLINICAL") || selected.has("LABORATORY")) {
    caseGuidance.push("Use an approved protocol/method version, defined endpoints or measurement criteria and controlled sample identifiers.");
    planGuidance.push("Repeat protocol executions by approved sample/cohort/configuration while keeping every execution separate.");
    runGuidance.push("Use pseudonymous study/sample identifiers, protocol version, environment and deviation/reviewer references; do not enter patient identifiers here.");
    reviewNotes.push("This slice is not a validated clinical/electronic-signature system; required approvals, privacy controls and regulatory applicability need domain review.");
  }
  return {
    title: profile.offerings.map(id => EXPERIENCE_OFFERINGS.find(choice => choice.id === id)!.label).join(" + "),
    physical, caseFieldLabels, caseGuidance, planGuidance, runGuidance, reviewNotes,
  };
}

// Only suggests a compatible draft target from an already linked test family.
// A project category or connected repository alone is not stack evidence.
export function automationTargetForFramework(family: string | null | undefined): string | null {
  const targets: Record<string, string> = {
    JEST: "JEST_VITEST", VITEST: "JEST_VITEST", MOCHA: "MOCHA_CHAI", PYTEST: "PYTEST",
    JUNIT: "JUNIT5", TESTNG: "TESTNG", UNITY_TEST: "UNITY_TEST_FRAMEWORK", GODOT_TEST: "GODOT_GDUNIT4",
    APPIUM: "APPIUM_WEBDRIVERIO", FLUTTER_TEST: "FLUTTER_INTEGRATION_TEST",
  };
  const direct = ["MAESTRO", "PLAYWRIGHT", "CYPRESS", "XCUITEST", "XCTEST", "SWIFT_TESTING", "ESPRESSO", "COMPOSE_UI", "UI_AUTOMATOR", "ROBOLECTRIC", "DETOX", "NUNIT", "XUNIT_DOTNET", "MSTEST", "POSTMAN", "PACT", "UNREAL_AUTOMATION"];
  return family ? Object.hasOwn(targets, family) ? targets[family]! : direct.includes(family) ? family : null : null;
}
