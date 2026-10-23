import { describe, expect, it } from "vitest";
import {
  extractMaestroStructure,
  extractSwiftTestingStructure,
  extractXcuiTestStructure,
} from "./mobileEvaluator.js";

describe("mobile automation extraction", () => {
  it("extracts a Maestro flow and its assertions", () => {
    const result = extractMaestroStructure(
      `appId: com.example.app\nname: Sign in\n---\n- launchApp\n- tapOn: Sign in\n- assertVisible: Dashboard\n- assertNotVisible: Invalid credentials`,
      ".maestro/sign-in.yaml",
    );

    expect(result?.testBlocks).toHaveLength(1);
    expect(result?.testBlocks[0]?.title).toBe("Sign in");
    expect(result?.testBlocks[0]?.assertions).toEqual([
      "assertVisible: Dashboard",
      "assertNotVisible: Invalid credentials",
    ]);
  });

  it("extracts separate XCUITest methods and assertions", () => {
    const result = extractXcuiTestStructure(`
      import XCTest
      final class LoginTests: XCTestCase {
        func testSuccessfulLogin() {
          let app = XCUIApplication()
          app.launch()
          XCTAssertTrue(app.staticTexts["Dashboard"].exists)
        }

        func testInvalidPassword() {
          XCTAssertEqual("Invalid password", "Invalid password")
        }
      }
    `);

    expect(result?.testBlocks.map((block) => block.title)).toEqual([
      "LoginTests > testSuccessfulLogin",
      "LoginTests > testInvalidPassword",
    ]);
    expect(result?.testBlocks[0]?.assertions[0]).toContain("XCTAssertTrue");
    expect(result?.testBlocks[1]?.assertions[0]).toContain("XCTAssertEqual");
  });

  it("extracts Swift Testing display names and expectations", () => {
    const result = extractSwiftTestingStructure(`
      import Testing
      @Test("Loads the dashboard")
      func loadsDashboard() {
        #expect(true)
      }
    `);
    expect(result?.testBlocks[0]?.title).toBe("Loads the dashboard");
    expect(result?.testBlocks[0]?.assertions[0]).toContain("#expect");
  });
});
