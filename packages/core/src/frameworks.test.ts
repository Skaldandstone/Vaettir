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

  it("does not mislabel XCTest or Swift Testing as XCUITest", () => {
    expect(detectFramework("ios/ModelTests.swift", `import XCTest\nfinal class ModelTests: XCTestCase { func testValue() { XCTAssertTrue(true) } }`).family).toBe("XCTEST");
    expect(detectFramework("ios/ModelTests.swift", `import Testing\n@Test("loads") func loads() { #expect(true) }`).family).toBe("SWIFT_TESTING");
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

  it.each([
    ["android/ComposeLoginTest.kt", `import androidx.compose.ui.test.onNodeWithTag\n@Test fun login() { onNodeWithTag("login") }`, "COMPOSE_UI"],
    ["e2e/login.e2e.ts", `import { device, element, by } from "detox"; test("login", async () => device.launchApp())`, "DETOX"],
    ["integration_test/login_test.dart", `import 'package:integration_test/integration_test.dart';\ntestWidgets('login', (tester) async {})`, "FLUTTER_TEST"],
    ["Assets/Tests/LoginTests.cs", `using UnityEngine.TestTools; [UnityTest] public IEnumerator Login() { yield return null; }`, "UNITY_TEST"],
    ["Source/LoginSpec.cpp", `IMPLEMENT_SIMPLE_AUTOMATION_TEST(FLoginTest, "Vaettir.Login", EAutomationTestFlags::EditorContext)`, "UNREAL_AUTOMATION"],
    ["test/test_login.gd", `extends GdUnitTestSuite\nfunc test_login():\n  assert_bool(true).is_true()`, "GODOT_TEST"],
  ])("detects %s as %s", (file, source, family) => {
    expect(detectFramework(file, source).family).toBe(family);
    expect(isLikelyTestFile(file)).toBe(true);
  });
});
