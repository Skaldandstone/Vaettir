import { describe, it, expect } from "vitest";
import { parseTestRailXml, mapTestRailPriority } from "./testrailImport.js";

// Fixture constructed from TestRail's documented "Export to XML" shape -
// no live TestRail instance exists in this environment.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<suite>
  <id>S1</id>
  <name>Master</name>
  <description></description>
  <sections>
    <section>
      <name>Checkout</name>
      <description></description>
      <cases>
        <case>
          <id>C101</id>
          <title>Apply a coupon</title>
          <template>Test Case (Steps)</template>
          <type>Functional</type>
          <priority>High</priority>
          <estimate></estimate>
          <references>REQ-7, REQ-9</references>
          <custom>
            <preconds>A cart with one item</preconds>
            <steps_separated>
              <step><index>1</index><content>Open the cart</content><expected>Cart page shows the item</expected></step>
              <step><index>2</index><content>Enter code SAVE10</content><expected>Total drops by 10%</expected></step>
            </steps_separated>
          </custom>
        </case>
        <case>
          <id>C102</id>
          <title>Guest checkout</title>
          <template>Test Case (Text)</template>
          <type>Other</type>
          <priority>Critical</priority>
          <references></references>
          <custom>
            <preconds></preconds>
            <steps>1. Add an item
2. Click checkout as guest
3. Pay</steps>
            <expected>Order confirmation is shown</expected>
          </custom>
        </case>
      </cases>
      <sections>
        <section>
          <name>Payments</name>
          <cases>
            <case>
              <id>C103</id>
              <title>Card declined</title>
              <template>Exploratory Session</template>
              <priority>Low</priority>
              <custom>
                <mission>Try every card failure path</mission>
                <goals>No failure leaves the order half-created</goals>
              </custom>
            </case>
            <case>
              <id>C104</id>
              <title>Empty case</title>
              <template>Test Case (Text)</template>
              <priority>Medium</priority>
              <custom><steps></steps><expected></expected></custom>
            </case>
          </cases>
        </section>
      </sections>
    </section>
  </sections>
</suite>`;

describe("parseTestRailXml", () => {
  const r = parseTestRailXml(XML);

  it("walks the section tree and maps a separated-steps case", () => {
    expect(r.format).toBe("testrail-xml");
    expect(r.suiteName).toBe("Master");
    const c = r.cases.find((x) => x.key === "C101")!;
    expect(c).toMatchObject({
      title: "Apply a coupon",
      testType: "Test Case (Steps)",
      priority: "HIGH",
      tags: ["REQ-7", "REQ-9"],
      suitePath: "Checkout",
      given: ["A cart with one item"],
      when: ["Open the cart", "Enter code SAVE10"],
      then: ["Cart page shows the item", "Total drops by 10%"],
    });
    expect(c.steps).toEqual([
      { action: "Open the cart", expectedActionOrData: null, expectedResult: "Cart page shows the item" },
      { action: "Enter code SAVE10", expectedActionOrData: null, expectedResult: "Total drops by 10%" },
    ]);
  });

  it("splits a numbered free-text steps field into one step per line", () => {
    const c = r.cases.find((x) => x.key === "C102")!;
    expect(c.priority).toBe("CRITICAL");
    expect(c.when).toEqual(["Add an item", "Click checkout as guest", "Pay"]);
    expect(c.then).toEqual(["Order confirmation is shown"]);
    expect(c.steps).toEqual([]);
    expect(c.tags).toEqual([]);
  });

  it("nests sub-section paths and maps an exploratory session's mission/goals", () => {
    const c = r.cases.find((x) => x.key === "C103")!;
    expect(c.suitePath).toBe("Checkout/Payments");
    expect(c.when).toEqual(["Try every card failure path"]);
    expect(c.then).toEqual(["No failure leaves the order half-created"]);
    expect(c.priority).toBe("LOW");
  });

  it("skips a case with nothing to import, with a reason", () => {
    expect(r.cases.some((x) => x.key === "C104")).toBe(false);
    expect(r.skipped).toEqual([{ rowNumber: 4, reason: expect.stringContaining("Empty case") }]);
  });

  it("does not prefix the default 'Master' suite name but does prefix a named suite", () => {
    const named = parseTestRailXml(
      `<suite><name>Mobile app</name><sections><section><name>Login</name><cases><case><id>C1</id><title>t</title><custom><steps>do</steps></custom></case></cases></section></sections></suite>`,
    );
    expect(named.cases[0]!.suitePath).toBe("Mobile app/Login");
  });

  it("rejects XML that is not a TestRail export", () => {
    expect(() => parseTestRailXml("<testsuites><testsuite/></testsuites>")).toThrow(/no <suite> root/);
  });
});

describe("mapTestRailPriority", () => {
  it("maps the default scheme, the legacy numbered scheme, and falls back to MEDIUM", () => {
    expect(mapTestRailPriority("Critical")).toBe("CRITICAL");
    expect(mapTestRailPriority("4 - Must Test")).toBe("CRITICAL");
    expect(mapTestRailPriority("High")).toBe("HIGH");
    expect(mapTestRailPriority("3 - Test If Time")).toBe("HIGH");
    expect(mapTestRailPriority("Low")).toBe("LOW");
    expect(mapTestRailPriority("1 - Don't Test")).toBe("LOW");
    expect(mapTestRailPriority("Medium")).toBe("MEDIUM");
    expect(mapTestRailPriority(null)).toBe("MEDIUM");
  });
});
