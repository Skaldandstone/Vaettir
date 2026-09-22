# Automation framework support

Vaettir supports both directions of an automation workflow:

1. Extract existing automated tests into reviewable, source-linked test cases.
2. Draft executable-framework source from a reviewed Vaettir test case.

## First-class mobile framework extraction

| Framework | Detection | Native structure extraction |
| --- | --- | --- |
| Maestro | `.maestro/*.yaml`, `appId`, and Maestro commands | Flow title, full flow source, `assertVisible`, and `assertNotVisible` |
| XCUITest | Swift XCTest files using `XCTest` and `XCUIApplication` | Individual `func test*` bodies and `XCTAssert*`/`XCTFail` calls |
| Espresso | Kotlin/Java test files using `androidx.test.espresso` or `onView` | Individual `@Test` methods and `check(...)` assertions |
| Mocha + Chai | JavaScript test/spec files with Mocha or Chai signals | Nested suites, test bodies, and Chai assertions through the existing JS/TS evaluator |

The native extractors determine file and test structure. The existing AI reverse-engineering stage converts that grounded structure into readable Given/When/Then cases for human review. Unknown or unusually structured files continue through Vaettir's explicit custom-framework fallback rather than being mislabeled as one of these frameworks.

## Automation draft generation

Editors can open a test case and select **Automation draft** to request one source file for:

- Maestro YAML
- XCUITest in Swift
- Espresso in Kotlin
- Mocha with Chai in JavaScript or TypeScript

The request includes the reviewed case's BDD content, structured steps, project name, and source path. Reviewers can optionally add project-specific app IDs, accessibility identifiers, Android resource IDs, routes, or existing helper names. The generator must leave unknown integration details as conspicuous TODO placeholders instead of inventing plausible selectors or APIs.

The response includes source code, a suggested file name, assumptions, dependencies, and suggested local validation commands. It can be copied or downloaded. It is not persisted as repository source and is never auto-committed.

## Acceptance boundary

Static extraction tests prove framework detection and structural parsing. Schema and prompt tests prove the generator's request/response contract. They do not prove that a generated file compiles or runs in a customer's app. That requires the customer's real project, dependencies, identifiers, signing/runtime environment, and human review.

The current generator uses 10 AI credits per request and requires an editor-capable seat. Read-only users cannot invoke it.
