import { describe, expect, it } from "vitest";
import {
  extractDotNetTestStructure,
  extractFlutterTestStructure,
  extractGodotTestStructure,
  extractUnrealTestStructure,
} from "./extendedNativeEvaluator.js";

describe("extended native automation extraction", () => {
  it("extracts NUnit and Unity-style C# methods", () => {
    const result = extractDotNetTestStructure(`
      [UnityTest]
      public IEnumerator LoadsScene() {
        Assert.IsTrue(ready);
        yield return null;
      }
    `);
    expect(result?.testBlocks[0]?.title).toBe("LoadsScene");
    expect(result?.testBlocks[0]?.assertions[0]).toContain("Assert.IsTrue");
  });

  it("extracts Flutter widget tests", () => {
    const result = extractFlutterTestStructure(`testWidgets('signs in', (tester) async {
      expect(find.text('Dashboard'), findsOneWidget);
    });`);
    expect(result?.testBlocks[0]?.title).toBe("signs in");
    expect(result?.testBlocks[0]?.assertions[0]).toContain("expect");
  });

  it("extracts Unreal automation names and assertions", () => {
    const result = extractUnrealTestStructure(`
      IMPLEMENT_SIMPLE_AUTOMATION_TEST(FLogin, "Vaettir.Login", EAutomationTestFlags::EditorContext)
      bool FLogin::RunTest(const FString&) { TestTrue("ready", true); return true; }
    `);
    expect(result?.testBlocks[0]?.title).toBe("Vaettir.Login");
    expect(result?.testBlocks[0]?.assertions[0]).toContain("TestTrue");
  });

  it("extracts GdUnit4 test functions", () => {
    const result = extractGodotTestStructure(`extends GdUnitTestSuite
func test_login():
  assert_bool(true).is_true()
`);
    expect(result?.testBlocks[0]?.title).toBe("test_login");
    expect(result?.testBlocks[0]?.assertions[0]).toContain("assert_bool");
  });
});
