import { describe, expect, it } from "vitest";
import { parseJUnitXml } from "./junitParse.js";

describe("JUnit automation identity", () => {
  it("prefers an explicit stable Vaettir id in the reported test name", () => {
    const [result] = parseJUnitXml(`<testsuite><testcase classname="LoginTests" name="VAE-cm123_signs_in" /></testsuite>`);
    expect(result?.externalTestId).toBe("VAE-cm123_signs_in");
  });

  it("keeps conventional framework identity when no stable id is present", () => {
    const [result] = parseJUnitXml(`<testsuite><testcase classname="LoginTests" name="signs in" /></testsuite>`);
    expect(result?.externalTestId).toBe("LoginTests::signs in");
  });

  it("reads a stable id from a reporter property", () => {
    const [result] = parseJUnitXml(`<testsuite><testcase classname="LoginTests" name="signs in"><properties><property name="vaettir_id" value="VAE-cm_property" /></properties></testcase></testsuite>`);
    expect(result?.externalTestId).toBe("VAE-cm_property");
  });
});
