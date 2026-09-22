// Known-framework detection heuristics. Anything that doesn't match falls
// back to the AI-assisted "custom framework" evaluation path — the agent is
// given these hints plus the raw source and asked to infer structure itself.

export type FrameworkFamily =
  | "JEST"
  | "VITEST"
  | "MOCHA"
  | "PYTEST"
  | "JUNIT"
  | "TESTNG"
  | "RSPEC"
  | "GO_TEST"
  | "CYPRESS"
  | "PLAYWRIGHT"
  | "SELENIUM"
  | "APPIUM"
  | "MAESTRO"
  | "XCUITEST"
  | "XCTEST"
  | "SWIFT_TESTING"
  | "ESPRESSO"
  | "COMPOSE_UI"
  | "UI_AUTOMATOR"
  | "ROBOLECTRIC"
  | "DETOX"
  | "FLUTTER_TEST"
  | "NUNIT"
  | "XUNIT_DOTNET"
  | "MSTEST"
  | "UNITY_TEST"
  | "UNREAL_AUTOMATION"
  | "GODOT_TEST"
  | "POSTMAN"
  | "PACT"
  | "ROBOT_FRAMEWORK"
  | "CUSTOM";

export interface FrameworkSignature {
  family: FrameworkFamily;
  label: string;
  filePatterns: RegExp[];
  contentSignals: RegExp[];
}

export const KNOWN_FRAMEWORKS: FrameworkSignature[] = [
  {
    family: "MAESTRO",
    label: "Maestro",
    filePatterns: [/(?:^|[\\/])\.maestro[\\/].*\.ya?ml$/i, /maestro.*\.ya?ml$/i],
    contentSignals: [/^appId:\s*\S+/m, /^\s*-\s+(?:launchApp|tapOn|assertVisible|assertNotVisible|inputText):/m],
  },
  {
    family: "XCUITEST",
    label: "XCUITest",
    filePatterns: [/Tests?\.swift$/],
    contentSignals: [/XCUIApplication\s*\(/, /\bXCUIElement\b/, /\bXCUIDevice\b/],
  },
  {
    family: "SWIFT_TESTING",
    label: "Swift Testing",
    filePatterns: [/Tests?\.swift$/],
    contentSignals: [/import\s+Testing\b/, /@Test\b/, /#(?:expect|require)\s*\(/],
  },
  {
    family: "XCTEST",
    label: "XCTest",
    filePatterns: [/Tests?\.swift$/],
    contentSignals: [/import\s+XCTest\b/, /:\s*XCTestCase\b/, /\bXCTAssert\w*\s*\(/],
  },
  {
    family: "COMPOSE_UI",
    label: "Jetpack Compose UI Test",
    filePatterns: [/Test\.(?:kt|java)$/],
    contentSignals: [/androidx\.compose\.ui\.test/, /create(?:Android)?ComposeRule\s*\(/, /onNodeWith(?:Tag|Text)\s*\(/],
  },
  {
    family: "UI_AUTOMATOR",
    label: "Android UI Automator",
    filePatterns: [/Test\.(?:kt|java)$/],
    contentSignals: [/androidx\.test\.uiautomator/, /UiDevice\.getInstance\s*\(/, /BySelector\b/],
  },
  {
    family: "ROBOLECTRIC",
    label: "Robolectric",
    filePatterns: [/Test\.(?:kt|java)$/],
    contentSignals: [/org\.robolectric/, /@RunWith\s*\(RobolectricTestRunner/, /Robolectric\.buildActivity/],
  },
  {
    family: "ESPRESSO",
    label: "Espresso",
    filePatterns: [/Test\.(?:kt|java)$/],
    contentSignals: [/androidx\.test\.espresso/, /\bonView\s*\(/, /Espresso\.onView\s*\(/],
  },
  {
    family: "DETOX",
    label: "Detox",
    filePatterns: [/\.e2e\.(?:t|j)sx?$/, /\.detox\.(?:t|j)sx?$/],
    contentSignals: [/from ["']detox["']/, /\bdevice\.launchApp\s*\(/, /\belement\s*\(by\./],
  },
  {
    family: "FLUTTER_TEST",
    label: "Flutter test / integration_test",
    filePatterns: [/_test\.dart$/],
    contentSignals: [/package:flutter_test\/flutter_test\.dart/, /package:integration_test\/integration_test\.dart/, /\btestWidgets\s*\(/],
  },
  {
    family: "UNITY_TEST",
    label: "Unity Test Framework",
    filePatterns: [/(?:Tests?|Editor)\/.*Tests?\.cs$/i, /Tests?\.cs$/],
    contentSignals: [/UnityEngine\.TestTools/, /\[UnityTest\]/, /\bIEnumerator\s+\w+\s*\(/],
  },
  {
    family: "NUNIT",
    label: "NUnit",
    filePatterns: [/Tests?\.cs$/],
    contentSignals: [/NUnit\.Framework/, /\[(?:Test|TestCase|TestFixture)\b/],
  },
  {
    family: "XUNIT_DOTNET",
    label: "xUnit.net",
    filePatterns: [/Tests?\.cs$/],
    contentSignals: [/using\s+Xunit\s*;/, /\[(?:Fact|Theory)\b/],
  },
  {
    family: "MSTEST",
    label: "MSTest",
    filePatterns: [/Tests?\.cs$/],
    contentSignals: [/Microsoft\.VisualStudio\.TestTools\.UnitTesting/, /\[TestMethod\b/],
  },
  {
    family: "UNREAL_AUTOMATION",
    label: "Unreal Automation Test",
    filePatterns: [/(?:Test|Spec).*\.(?:cpp|h)$/i],
    contentSignals: [/IMPLEMENT_(?:SIMPLE|COMPLEX)_AUTOMATION_TEST/, /BEGIN_DEFINE_SPEC\s*\(/, /IMPLEMENT_CUSTOM_SIMPLE_AUTOMATION_TEST/],
  },
  {
    family: "GODOT_TEST",
    label: "Godot GdUnit4 / GUT",
    filePatterns: [/(?:^|[\\/])test_.*\.gd$/i, /_test\.gd$/i],
    contentSignals: [/extends\s+(?:GdUnitTestSuite|GutTest)/, /\bfunc\s+test_\w+\s*\(/],
  },
  {
    family: "JEST",
    label: "Jest",
    filePatterns: [/\.test\.(t|j)sx?$/, /\.spec\.(t|j)sx?$/],
    contentSignals: [/from ["']@jest\/globals["']/, /\bjest\.(mock|fn|spyOn)\(/],
  },
  {
    family: "VITEST",
    label: "Vitest",
    filePatterns: [/\.test\.(t|j)sx?$/],
    contentSignals: [/from ["']vitest["']/],
  },
  {
    family: "MOCHA",
    label: "Mocha / Chai",
    filePatterns: [/\.spec\.js$/, /\.test\.js$/],
    contentSignals: [/require\(["']mocha["']\)/, /\bdescribe\(.*function/, /(?:from\s+|require\()["']chai["']/],
  },
  {
    family: "PYTEST",
    label: "pytest",
    filePatterns: [/^test_.*\.py$/, /_test\.py$/],
    contentSignals: [/^import pytest/m, /^def test_/m],
  },
  {
    family: "JUNIT",
    label: "JUnit",
    filePatterns: [/Test\.java$/],
    contentSignals: [/@Test\b/, /org\.junit/],
  },
  {
    family: "TESTNG",
    label: "TestNG",
    filePatterns: [/Test\.java$/],
    contentSignals: [/org\.testng/],
  },
  {
    family: "RSPEC",
    label: "RSpec",
    filePatterns: [/_spec\.rb$/],
    contentSignals: [/\bdescribe\s+["'].*["']\s+do/, /require ["']rails_helper["']/],
  },
  {
    family: "GO_TEST",
    label: "Go testing",
    filePatterns: [/_test\.go$/],
    contentSignals: [/func Test\w+\(t \*testing\.T\)/],
  },
  {
    family: "CYPRESS",
    label: "Cypress",
    filePatterns: [/\.cy\.(t|j)s$/],
    contentSignals: [/\bcy\.(visit|get|click)\(/],
  },
  {
    family: "PLAYWRIGHT",
    label: "Playwright",
    filePatterns: [/\.spec\.(t|j)s$/],
    contentSignals: [/from ["']@playwright\/test["']/],
  },
  {
    family: "SELENIUM",
    label: "Selenium",
    filePatterns: [],
    contentSignals: [/from selenium/, /WebDriver/],
  },
  {
    family: "APPIUM",
    label: "Appium",
    filePatterns: [],
    contentSignals: [/appium/i],
  },
  {
    family: "POSTMAN",
    label: "Postman/Newman collection",
    filePatterns: [/\.postman_collection\.json$/],
    contentSignals: [/"_postman_id"/],
  },
  {
    family: "PACT",
    label: "Pact contract test",
    filePatterns: [/pact\.(t|j)s$/],
    contentSignals: [/from ["']@pact-foundation\/pact["']/],
  },
  {
    family: "ROBOT_FRAMEWORK",
    label: "Robot Framework",
    filePatterns: [/\.robot$/],
    contentSignals: [/\*\*\* Test Cases \*\*\*/],
  },
];

// A generic fallback for repo scanning: files that look like tests by
// naming convention even when no KNOWN_FRAMEWORKS entry's filePatterns
// match (e.g. a framework not in the table yet). Kept separate from
// detectFramework, which needs file+content together and is used per-file
// once content is already in hand -- this only needs a path, so the repo
// walker can filter file listings before reading any content.
const GENERIC_TEST_FILE_PATTERNS = [/\.test\.[tj]sx?$/, /\.spec\.[tj]sx?$/, /\.e2e\.[tj]sx?$/, /^test_.*\.py$/, /_test\.py$/, /_test\.go$/, /_test\.dart$/, /Test\.(?:java|kt)$/, /Tests?\.swift$/, /Tests?\.cs$/, /(?:Test|Spec).*\.(?:cpp|h)$/i, /(?:^|[\\/])test_.*\.gd$/i, /_test\.gd$/i, /(?:^|[\\/])\.maestro[\\/].*\.ya?ml$/i, /_spec\.rb$/];

export function isLikelyTestFile(filePath: string): boolean {
  return (
    KNOWN_FRAMEWORKS.some((sig) => sig.filePatterns.some((p) => p.test(filePath))) ||
    GENERIC_TEST_FILE_PATTERNS.some((p) => p.test(filePath))
  );
}

export function detectFramework(filePath: string, content: string): FrameworkSignature {
  for (const sig of KNOWN_FRAMEWORKS) {
    const fileMatch = sig.filePatterns.some((p) => p.test(filePath));
    const contentMatch = sig.contentSignals.some((p) => p.test(content));
    if (fileMatch && contentMatch) return sig;
  }
  // Weaker match: content signal alone.
  for (const sig of KNOWN_FRAMEWORKS) {
    if (sig.contentSignals.some((p) => p.test(content))) return sig;
  }
  return {
    family: "CUSTOM",
    label: "Unknown / custom framework",
    filePatterns: [],
    contentSignals: [],
  };
}
