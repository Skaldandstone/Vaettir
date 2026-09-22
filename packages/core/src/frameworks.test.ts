import { describe, expect, it } from "vitest";
import { detectFramework, isLikelyTestFile } from "./frameworks.js";

describe("automation framework detection", () => {
  it("detects Maestro flows", () => {
    const source = `appId: com.example.app\n---\n- launchApp\n- assertVisible: Welcome`;
    expect(detectFramework(".maestro/login.yaml", source).family).toBe(
      "MAESTRO",
    );
    expect(isLikelyTestFile("flows\\.maestro\\login.yaml")).toBe(true);
  });

  it("detects XCUITest source", () => {
    const source = `import XCTest\nfinal class LoginTests: XCTestCase {\n  func testLogin() { XCUIApplication().launch() }\n}`;
    expect(detectFramework("ios/LoginTests.swift", source).family).toBe(
      "XCUITEST",
    );
    expect(isLikelyTestFile("ios/LoginTests.swift")).toBe(true);
  });

  it("detects Espresso before the broader JUnit signature", () => {
    const source = `import androidx.test.espresso.Espresso.onView\n@Test fun opensLogin() { onView(withId(R.id.login)) }`;
    expect(detectFramework("android/LoginTest.kt", source).family).toBe(
      "ESPRESSO",
    );
    expect(isLikelyTestFile("android/LoginTest.kt")).toBe(true);
  });

  it("recognizes Chai as Mocha-compatible source", () => {
    const source = `import { expect } from "chai";\ndescribe("login", function () { it("works", function () { expect(true).to.equal(true); }); });`;
    expect(detectFramework("test/login.spec.js", source).family).toBe("MOCHA");
  });
});
