import {
  registerFrameworkEvaluator,
  type ExtractedTestBlock,
  type ExtractedTestStructure,
} from "@vaettir/core";

function findBalancedBody(content: string, openBrace: number): number | null {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let i = openBrace; i < content.length; i += 1) {
    const char = content[i]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return null;
}

export function extractXcuiTestStructure(
  content: string,
): ExtractedTestStructure | null {
  const className = content.match(/\bclass\s+(\w+)\s*:\s*XCTestCase\b/)?.[1];
  const testBlocks: ExtractedTestBlock[] = [];
  const methodPattern = /\bfunc\s+(test\w*)\s*\([^)]*\)[^{]*\{/g;
  for (const match of content.matchAll(methodPattern)) {
    const openBrace = (match.index ?? 0) + match[0].lastIndexOf("{");
    const bodyEnd = findBalancedBody(content, openBrace);
    if (bodyEnd === null) continue;
    const bodySnippet = content.slice(openBrace + 1, bodyEnd - 1).trim();
    const assertions = [
      ...bodySnippet.matchAll(/\b(?:XCTAssert\w*|XCTFail)\s*\([^\n]*/g),
    ].map((item) => item[0]);
    testBlocks.push({
      title: className ? `${className} > ${match[1]}` : match[1]!,
      assertions,
      bodySnippet,
    });
  }
  return testBlocks.length > 0 ? { testBlocks } : null;
}

export function extractMaestroStructure(
  content: string,
  filePath: string,
): ExtractedTestStructure | null {
  if (!/^appId:\s*\S+/m.test(content)) return null;
  const explicitName = content
    .match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]
    ?.trim();
  const fileName =
    filePath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.ya?ml$/i, "") ?? "Maestro flow";
  const assertions = [
    ...content.matchAll(/^\s*-\s+(assertVisible|assertNotVisible):\s*(.+)$/gm),
  ].map((item) => `${item[1]}: ${item[2]}`);
  return {
    testBlocks: [
      {
        title: explicitName || fileName,
        assertions,
        bodySnippet: content,
      },
    ],
  };
}

export function registerMobileEvaluators(): void {
  registerFrameworkEvaluator({
    family: "XCUITEST",
    extract: (content) => extractXcuiTestStructure(content),
  });
  registerFrameworkEvaluator({
    family: "MAESTRO",
    extract: (content, filePath) => extractMaestroStructure(content, filePath),
  });
}
