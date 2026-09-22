# Automation framework support

Vaettir supports both directions of an automation workflow:

1. Extract existing automated tests into reviewable, source-linked test cases.
2. Draft framework source from a reviewed Vaettir case for human review.

## Capability matrix

“Native extraction” means Vaettir deterministically separates tests and assertions before AI interpretation. “Detected + AI fallback” means Vaettir identifies the framework, but unusual structure is still interpreted from the scoped source file. Drafts are never represented as compiled or executed.

| Family | Frameworks | Extraction | Source drafts |
| --- | --- | --- | --- |
| Web / JS | Jest, Vitest, Mocha + Chai, Cypress, Playwright | Native nested-suite/test extraction | Yes |
| Apple | XCTest, Swift Testing, XCUITest | Native method and assertion extraction | Yes |
| Android | JUnit/TestNG, Espresso, Jetpack Compose UI, UI Automator, Robolectric | Native annotated-method extraction | Yes |
| Cross-platform mobile | Maestro, Appium/WebdriverIO, Detox, Flutter `integration_test` | Native for Maestro, Appium/Detox JS, and Flutter; fallback remains available | Yes |
| Python / JVM / .NET | pytest, JUnit 5, TestNG, NUnit, xUnit.net, MSTest | Native | Yes |
| API / contract | Postman, Pact, REST Assured | Detected + AI fallback for Postman/Pact; JVM structure for REST Assured | Yes |
| Games | Unity Test Framework, Unreal Automation/Specs, Godot GdUnit4/GUT | Native test-block extraction | Yes |
| Other | RSpec, Go testing, Selenium, Robot Framework, custom frameworks | Existing native or explicit custom-framework fallback, depending on family | Not yet exposed for every family |

Unknown or unusually structured files go through Vaettir’s explicit custom-framework fallback rather than being silently mislabeled.

## Stable automation identity

Every generated draft receives an immutable `VAE-<TestCase.id>` automation ID. The generator must preserve it verbatim in the returned metadata and source. Framework rules place it in a test title, display name, marker, tag, or comment as appropriate.

JUnit ingestion prefers a reported `VAE-*` ID over a fragile `classname::name` key and resolves it directly to the same case inside the selected project. Third-party IDs such as qTest `TC-123` remain supported through `TestCaseSource.externalTestId`, but lookup is project-scoped. Identical external IDs are valid in different projects, and ambiguous mappings inside one project fail closed.

This separates durable Vaettir identity from framework names that teams routinely rename. It also avoids treating a qTest ID as globally unique across every customer tenant.

## Automation draft generation

Editors can open a test case, select **Automation draft**, choose a target framework, and optionally provide grounded project context such as app IDs, accessibility identifiers, Android resource IDs, routes, existing fixtures, module names, maps, scenes, or helper APIs.

The response includes the stable automation ID, source code, suggested filename, assumptions, dependencies, and local validation commands. Missing project details remain conspicuous TODO placeholders. Vaettir does not write to the customer repository or auto-commit generated code.

The current generator uses 10 AI credits per request and requires an editor-capable seat. Read-only users cannot invoke it.

## Acceptance boundary

Static tests prove framework detection, structural parsing, stable-ID propagation, and the generation request/response contract. They do not prove that a generated file compiles or runs in a customer’s app. That acceptance requires the customer’s real dependencies, selectors, signing/runtime environment, and human review.
