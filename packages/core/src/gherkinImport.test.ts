import { describe, it, expect } from "vitest";
import { parseGherkin, gherkinToReverseEngineerResult } from "./gherkinImport.js";

describe("parseGherkin", () => {
  it("parses a basic scenario's Feature title and Given/When/Then steps", () => {
    const { featureTitle, scenarios } = parseGherkin(`
Feature: Login
  Scenario: Successful login
    Given a registered user
    When they submit valid credentials
    Then they land on the dashboard
`);
    expect(featureTitle).toBe("Login");
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]).toMatchObject({
      title: "Successful login",
      given: ["a registered user"],
      when: ["they submit valid credentials"],
      then: ["they land on the dashboard"],
    });
  });

  it("folds And/But into whichever step section came before them", () => {
    const { scenarios } = parseGherkin(`
Feature: Checkout
  Scenario: Multi-step checkout
    Given a cart with items
    And a valid payment method
    When checkout is submitted
    Then an order confirmation is shown
    But no email is sent yet
`);
    expect(scenarios[0]!.given).toEqual(["a cart with items", "a valid payment method"]);
    expect(scenarios[0]!.then).toEqual(["an order confirmation is shown", "no email is sent yet"]);
  });

  it("prepends Background steps onto every scenario in the file", () => {
    const { scenarios } = parseGherkin(`
Feature: Account
  Background:
    Given the user is signed in

  Scenario: View profile
    When they open settings
    Then their profile is shown

  Scenario: Log out
    When they click log out
    Then they are signed out
`);
    expect(scenarios).toHaveLength(2);
    expect(scenarios[0]!.given).toEqual(["the user is signed in"]);
    expect(scenarios[1]!.given).toEqual(["the user is signed in"]);
  });

  it("collects scenario-level tags separately from feature-level tags", () => {
    const { scenarios } = parseGherkin(`
@smoke
Feature: Search
  @slow @flaky
  Scenario: Fuzzy search
    Given a large dataset
    When a typo-laden query is submitted
    Then close matches are still returned
`);
    expect(scenarios[0]!.tags).toEqual(["slow", "flaky"]);
  });

  it("strips trailing comments from lines", () => {
    const { scenarios } = parseGherkin(`
Feature: Comments
  Scenario: With a comment
    Given a user # this is a comment
    When they act
    Then it works
`);
    expect(scenarios[0]!.given).toEqual(["a user"]);
  });

  it("parses a Scenario Outline's Examples table", () => {
    const { scenarios } = parseGherkin(`
Feature: Discounts
  Scenario Outline: Apply discount code
    Given a cart worth <amount>
    When code <code> is applied
    Then the total is <total>

    Examples:
      | amount | code   | total |
      | 100    | SAVE10 | 90    |
      | 200    | SAVE10 | 180   |
`);
    expect(scenarios[0]!.isOutline).toBe(true);
    expect(scenarios[0]!.exampleHeader).toEqual(["amount", "code", "total"]);
    expect(scenarios[0]!.exampleRows).toEqual([
      ["100", "SAVE10", "90"],
      ["200", "SAVE10", "180"],
    ]);
  });

  it("still trims a keyword line with multiple internal spaces", () => {
    const { featureTitle, scenarios } = parseGherkin(`
Feature:    Extra spaces
  Scenario:    Also extra spaces
    Given    a condition with leading spaces
`);
    expect(featureTitle).toBe("Extra spaces");
    expect(scenarios[0]!.title).toBe("Also extra spaces");
    expect(scenarios[0]!.given).toEqual(["a condition with leading spaces"]);
  });

  it("does not hang on adversarial input (ReDoS regression)", () => {
    // Feature:/Scenario:/step lines used to have \s*(.*) or \s+(.*), where
    // the whitespace-matcher and the capture overlapped on the same
    // characters - a polynomial-ReDoS shape CodeQL flagged. A line with a
    // long run of spaces after the keyword is the adversarial case.
    const adversarial = `Feature:${" ".repeat(5000)}x`;
    const start = performance.now();
    parseGherkin(adversarial);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe("gherkinToReverseEngineerResult", () => {
  it("expands a Scenario Outline into one test case per Examples row with placeholders substituted", () => {
    const result = gherkinToReverseEngineerResult(`
Feature: Discounts
  Scenario Outline: Apply discount code
    Given a cart worth <amount>
    When code <code> is applied
    Then the total is <total>

    Examples:
      | amount | code   | total |
      | 100    | SAVE10 | 90    |
      | 200    | SAVE10 | 180   |
`);
    expect(result.testCases).toHaveLength(2);
    expect(result.testCases[0]!.given).toEqual(["a cart worth 100"]);
    expect(result.testCases[0]!.then).toEqual(["the total is 90"]);
    expect(result.testCases[1]!.given).toEqual(["a cart worth 200"]);
    expect(result.detectedFrameworkFamily).toBe("CUSTOM");
  });

  it("skips a scenario missing any of given/when/then as not usable", () => {
    const result = gherkinToReverseEngineerResult(`
Feature: Incomplete
  Scenario: Missing a when
    Given something
    Then something else
`);
    expect(result.testCases).toHaveLength(0);
  });

  it("produces one usable case per ordinary scenario", () => {
    const result = gherkinToReverseEngineerResult(`
Feature: Two scenarios
  Scenario: First
    Given a
    When b
    Then c

  Scenario: Second
    Given x
    When y
    Then z
`);
    expect(result.testCases.map((tc) => tc.title)).toEqual(["First", "Second"]);
  });
});
