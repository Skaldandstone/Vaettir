import { describe, expect, it } from "vitest";
import { extractJavaTestStructure } from "./javaEvaluator.js";

describe("Espresso structure extraction", () => {
  it("extracts Kotlin @Test methods and Espresso checks", () => {
    const result = extractJavaTestStructure(`
      class LoginTest {
        @Test
        fun opensDashboard() {
          onView(withId(R.id.login)).perform(click())
          onView(withText("Dashboard")).check(matches(isDisplayed()))
        }
      }
    `);

    expect(result?.testBlocks[0]?.title).toBe("LoginTest > opensDashboard");
    expect(result?.testBlocks[0]?.assertions[0]).toContain(
      "check(matches(isDisplayed()))",
    );
  });
});
