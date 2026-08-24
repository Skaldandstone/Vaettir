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
    label: "Mocha",
    filePatterns: [/\.spec\.js$/, /\.test\.js$/],
    contentSignals: [/require\(["']mocha["']\)/, /\bdescribe\(.*function/],
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
const GENERIC_TEST_FILE_PATTERNS = [/\.test\.[tj]sx?$/, /\.spec\.[tj]sx?$/, /^test_.*\.py$/, /_test\.py$/, /_test\.go$/, /Test\.java$/, /_spec\.rb$/];

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
