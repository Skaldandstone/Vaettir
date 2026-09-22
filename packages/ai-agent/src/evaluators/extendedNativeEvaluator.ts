import {
  registerFrameworkEvaluator,
  type ExtractedTestBlock,
  type ExtractedTestStructure,
} from "@vaettir/core";

function balancedBody(content: string, openBrace: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = openBrace; index < content.length; index += 1) {
    const char = content[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return content.slice(openBrace + 1, index).trim();
  }
  return null;
}

function extractAnnotatedBracedTests(
  content: string,
  pattern: RegExp,
  assertionPattern: RegExp,
): ExtractedTestStructure | null {
  const testBlocks: ExtractedTestBlock[] = [];
  for (const match of content.matchAll(pattern)) {
    const openBrace = content.indexOf("{", (match.index ?? 0) + match[0].length);
    if (openBrace < 0) continue;
    const bodySnippet = balancedBody(content, openBrace);
    if (bodySnippet === null) continue;
    testBlocks.push({
      title: match[1]!,
      assertions: [...bodySnippet.matchAll(assertionPattern)].map((item) => item[0]),
      bodySnippet,
    });
  }
  return testBlocks.length ? { testBlocks } : null;
}

export function extractDotNetTestStructure(content: string): ExtractedTestStructure | null {
  return extractAnnotatedBracedTests(
    content,
    /\[(?:Test|TestCase(?:\([^\]]*\))?|UnityTest|Fact|Theory|TestMethod)\][\s\S]*?\b(?:public|internal|private|protected)?\s*(?:async\s+)?(?:void|Task|IEnumerator)\s+(\w+)\s*\([^)]*\)/g,
    /\b(?:Assert\.\w+|CollectionAssert\.\w+|StringAssert\.\w+)\s*\([^;\n]*/g,
  );
}

export function extractFlutterTestStructure(content: string): ExtractedTestStructure | null {
  return extractAnnotatedBracedTests(
    content,
    /\b(?:test|testWidgets)\s*\(\s*["']([^"']+)["'][\s\S]*?\([^)]*\)\s*(?:async\s*)?/g,
    /\bexpect\s*\([^;\n]*/g,
  );
}

export function extractUnrealTestStructure(content: string): ExtractedTestStructure | null {
  const declaration = content.match(/IMPLEMENT_(?:CUSTOM_)?(?:SIMPLE|COMPLEX)_AUTOMATION_TEST\s*\(\s*\w+\s*,\s*["']([^"']+)["']/)
    ?? content.match(/BEGIN_DEFINE_SPEC\s*\(\s*\w+\s*,\s*["']([^"']+)["']/);
  if (!declaration) return null;
  const assertions = [...content.matchAll(/\b(?:TestTrue|TestFalse|TestEqual|TestNotNull|AddError)\s*\([^;\n]*/g)].map((item) => item[0]);
  return { testBlocks: [{ title: declaration[1]!, assertions, bodySnippet: content }] };
}

export function extractGodotTestStructure(content: string): ExtractedTestStructure | null {
  const matches = [...content.matchAll(/^(\s*)func\s+(test_\w+)\s*\([^)]*\)[^:]*:\s*$/gm)];
  const blocks: ExtractedTestBlock[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1]!.index! : content.length;
    const bodySnippet = content.slice(start, end).trim();
    blocks.push({
      title: match[2]!,
      assertions: [...bodySnippet.matchAll(/\bassert_(?:that|bool|str|int|array|object)\s*\([^\n]*/g)].map((item) => item[0]),
      bodySnippet,
    });
  }
  return blocks.length ? { testBlocks: blocks } : null;
}

export function registerExtendedNativeEvaluators(): void {
  for (const family of ["NUNIT", "XUNIT_DOTNET", "MSTEST", "UNITY_TEST"] as const) {
    registerFrameworkEvaluator({ family, extract: extractDotNetTestStructure });
  }
  registerFrameworkEvaluator({ family: "FLUTTER_TEST", extract: extractFlutterTestStructure });
  registerFrameworkEvaluator({ family: "UNREAL_AUTOMATION", extract: extractUnrealTestStructure });
  registerFrameworkEvaluator({ family: "GODOT_TEST", extract: extractGodotTestStructure });
}
