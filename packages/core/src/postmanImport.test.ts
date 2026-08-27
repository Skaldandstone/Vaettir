import { describe, it, expect } from "vitest";
import { postmanCollectionToReverseEngineerResult } from "./postmanImport.js";

function collection(items: unknown[]): string {
  return JSON.stringify({ info: { name: "Test Collection" }, item: items });
}

describe("postmanCollectionToReverseEngineerResult", () => {
  it("throws on invalid JSON", () => {
    expect(() => postmanCollectionToReverseEngineerResult("not json")).toThrow("Not valid JSON");
  });

  it("throws when there's no top-level item array", () => {
    expect(() => postmanCollectionToReverseEngineerResult(JSON.stringify({ info: {} }))).toThrow(
      "Doesn't look like a Postman collection",
    );
  });

  it("extracts a request with pm.test assertions into a test case", () => {
    const json = collection([
      {
        name: "Get user",
        request: { method: "get", url: "https://api.example.com/users/1" },
        event: [
          {
            listen: "test",
            script: { exec: ["pm.test('returns 200', function () { pm.response.to.have.status(200); });"] },
          },
        ],
      },
    ]);
    const result = postmanCollectionToReverseEngineerResult(json);
    expect(result.testCases).toHaveLength(1);
    expect(result.testCases[0]).toMatchObject({
      title: "Get user",
      given: ["the API is available"],
      when: ["a GET request is sent to https://api.example.com/users/1"],
      then: ["returns 200"],
      testType: "CONTRACT",
    });
    expect(result.detectedFrameworkFamily).toBe("POSTMAN");
  });

  it("skips a request with no test script assertions", () => {
    const json = collection([{ name: "No assertions", request: { method: "GET", url: "https://api.example.com/ping" } }]);
    expect(postmanCollectionToReverseEngineerResult(json).testCases).toHaveLength(0);
  });

  it("collects multiple pm.test assertions from the same request into one case's then steps", () => {
    const json = collection([
      {
        name: "Create order",
        request: { method: "post", url: "https://api.example.com/orders" },
        event: [
          {
            listen: "test",
            script: {
              exec: [
                "pm.test(\"status is 201\", () => { pm.response.to.have.status(201); });",
                "pm.test(\"has an order id\", () => { pm.expect(pm.response.json().id).to.exist; });",
              ],
            },
          },
        ],
      },
    ]);
    const result = postmanCollectionToReverseEngineerResult(json);
    expect(result.testCases[0]!.then).toEqual(["status is 201", "has an order id"]);
  });

  it("recurses into nested folders and builds the title from the folder path", () => {
    const json = collection([
      {
        name: "Users",
        item: [
          {
            name: "Admin",
            item: [
              {
                name: "Delete user",
                request: { method: "delete", url: "https://api.example.com/users/1" },
                event: [{ listen: "test", script: { exec: ["pm.test('is deleted', function(){});"] } }],
              },
            ],
          },
        ],
      },
    ]);
    const result = postmanCollectionToReverseEngineerResult(json);
    expect(result.testCases[0]!.title).toBe("Users / Admin / Delete user");
    expect(result.testCases[0]!.tags).toEqual(["Users", "Admin"]);
  });

  it("defaults to GET when no method is given and 'the endpoint' when no URL is given", () => {
    const json = collection([
      {
        name: "Untitled request behavior",
        request: {},
        event: [{ listen: "test", script: { exec: ["pm.test('ok', function(){});"] } }],
      },
    ]);
    const result = postmanCollectionToReverseEngineerResult(json);
    expect(result.testCases[0]!.when).toEqual(["a GET request is sent to the endpoint"]);
  });
});
