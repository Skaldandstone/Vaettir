import type { ReverseEngineerResult, ReverseEngineeredTestCase } from "./bdd.js";

// P2-12: request/assertion pairs, not functions -- structurally different
// from code-based frameworks, so this extracts rather than infers, same
// spirit as gherkinImport.ts. A Postman Collection (v2.0/v2.1 export) is a
// tree of folders and request items; each leaf request becomes one
// TestCase. The collection has no Given/Then of its own to extract --
// "Given" is synthesized (there's nothing more specific to say than "the
// API is available" unless a folder/request name says otherwise), "When"
// is built from the method+URL, and "Then" comes from each pm.test(...)
// call's description string in the request's attached test script. A
// request with no test script assertions has nothing to verify, so it's
// skipped rather than turned into a content-free case.

interface PostmanUrl {
  raw?: string;
}

interface PostmanScript {
  exec?: string[];
}

interface PostmanEvent {
  listen?: string;
  script?: PostmanScript;
}

interface PostmanRequest {
  method?: string;
  url?: PostmanUrl | string;
}

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  event?: PostmanEvent[];
}

interface PostmanCollection {
  info?: { name?: string };
  item?: PostmanItem[];
}

// pm.test("description", function () { ... }) or pm.test("description", () => { ... }) --
// matches either quote style, tolerant of whitespace between the args.
const PM_TEST_RE = /pm\.test\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;

function extractAssertions(item: PostmanItem): string[] {
  const testScripts = (item.event ?? []).filter((e) => e.listen === "test");
  const assertions: string[] = [];
  for (const script of testScripts) {
    const code = (script.script?.exec ?? []).join("\n");
    for (const match of code.matchAll(PM_TEST_RE)) {
      const description = match[2];
      if (description) assertions.push(description.replace(/\\(['"`])/g, "$1"));
    }
  }
  return assertions;
}

function urlToString(url: PostmanUrl | string | undefined): string {
  if (!url) return "the endpoint";
  return typeof url === "string" ? url : (url.raw ?? "the endpoint");
}

export function postmanCollectionToReverseEngineerResult(collectionJson: string): ReverseEngineerResult {
  let collection: PostmanCollection;
  try {
    collection = JSON.parse(collectionJson);
  } catch {
    throw new Error("Not valid JSON");
  }
  if (!Array.isArray(collection.item)) {
    throw new Error("Doesn't look like a Postman collection export (no top-level \"item\" array)");
  }

  const testCases: ReverseEngineeredTestCase[] = [];

  function walk(items: PostmanItem[], folderPath: string[]) {
    for (const item of items) {
      if (Array.isArray(item.item)) {
        walk(item.item, [...folderPath, item.name ?? "Untitled folder"]);
        continue;
      }
      if (!item.request) continue;

      const then = extractAssertions(item);
      if (then.length === 0) continue; // nothing to assert -- not a usable case

      const method = (item.request.method ?? "GET").toUpperCase();
      const url = urlToString(item.request.url);
      const title = [...folderPath, item.name ?? "Untitled request"].join(" / ");

      testCases.push({
        title,
        background: null,
        given: ["the API is available"],
        when: [`a ${method} request is sent to ${url}`],
        then,
        tags: folderPath,
        testType: "CONTRACT",
        confidence: 1,
        sourceFunctionName: title,
        notes: null,
      });
    }
  }
  walk(collection.item, []);

  return { detectedFramework: "postman", detectedFrameworkFamily: "POSTMAN", testCases };
}
