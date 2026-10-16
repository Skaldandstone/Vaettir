import { describe, expect, it } from "vitest";
import { readArchitectureDocument } from "./architectureDocument.js";

describe("read-only architecture documents", () => {
  it("extracts aliases, real interactions and source line evidence without a PlantUML runtime", () => {
    const doc = readArchitectureDocument("payments.puml", '@startuml\ncomponent "Payments" as pay\ndatabase Ledger\npay --> Ledger : reserve coins\n@enduml');
    expect(doc.elements).toHaveLength(3);
    expect(doc.elements[2]).toMatchObject({ kind: "INTERACTION", label: "reserve coins", from: doc.elements[0]!.id, to: doc.elements[1]!.id, line: 4, quote: "pay --> Ledger : reserve coins" });
    expect(doc.elements[0]!.label).toBe("Payments");
    expect(doc.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("keeps includes inert and reads literal C4 declarations without downloading dependencies", () => {
    const doc = readArchitectureDocument("architecture.plantuml", '@startuml\n!include https://invalid.example/C4.puml\nContainer(api, "API", "Node")\nContainerDb(db, "Orders")\nRel(api, db, "Persists")\n@enduml');
    expect(doc.elements.map(e => e.label)).toEqual(["API", "Orders", "Persists"]);
    expect(doc.warnings.join(" ")).toContain("not executed");
  });
  it("reads sequence messages, left arrows, inline components and activity labels", () => {
    const doc = readArchitectureDocument("flow.pu", '@startuml\nClient <- API : response\n[Client] --> [Cache]\n:Validate request;\n@enduml');
    expect(doc.elements.find(e => e.label === "response")).toMatchObject({ from: doc.elements.find(e => e.label === "API")!.id, to: doc.elements.find(e => e.label === "Client")!.id });
    expect(doc.elements.some(e => e.label === "Validate request")).toBe(true);
  });
  it("does not turn commented-out design elements into architecture facts", () => {
    const doc = readArchitectureDocument("comments.puml", "@startuml\n/'\ncomponent Retired\nRetired --> Ghost\n'/\n' component Hidden\ncomponent Current\n@enduml");
    expect(doc.elements.map(e => e.label)).toEqual(["Current"]);
  });
  it("extracts SVG text and only explicit semantic connections", () => {
    const doc = readArchitectureDocument("system.svg", '<svg xmlns="http://www.w3.org/2000/svg"><g data-entity="api"><text>Orders <tspan>API</tspan></text></g><g data-entity="db"><text>Ledger</text></g><g data-entity-1="api" data-entity-2="db"><path d="M0 0L10 10"/></g><path d="M20 20L30 30"/></svg>');
    expect(doc.elements.map(e => e.kind)).toEqual(["COMPONENT", "COMPONENT", "INTERACTION"]);
    expect(doc.elements[0]!.label).toBe("Orders API");
    expect(doc.warnings.join(" ")).toContain("not interpreted");
  });
  it("decodes builtin XML escapes, ignores resources and does not render uploaded SVG", () => {
    const doc = readArchitectureDocument("static.svg", '<svg><defs><text>Not a diagram label</text></defs><text>Read &amp; write</text><image href="https://invalid.example/private"/></svg>');
    expect(doc.elements).toHaveLength(1);expect(doc.elements[0]!.label).toBe("Read & write");
  });
  it.each(['<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg><text>&x;</text></svg>', '<svg><script>alert(1)</script></svg>', '<svg onload="fetch(1)"><text>API</text></svg>', '<svg><foreignObject><p>HTML</p></foreignObject></svg>', '<svg><g></svg>', '<html><text>API</text></html>', '<svg><path d="M0 0L2 2"/></svg>'])("rejects unsafe, malformed or unreadable SVG: %s", source => {
    expect(() => readArchitectureDocument("bad.svg", source)).toThrow();
  });
  it("refuses binary, incomplete and over-capacity inputs instead of truncating", () => {
    expect(() => readArchitectureDocument("bad.puml", "@startuml\ncomponent A")).toThrow();
    expect(() => readArchitectureDocument("bad.txt", "@startuml\ncomponent A\n@enduml")).toThrow();
    expect(() => readArchitectureDocument("bad.svg", "\0<svg/>" )).toThrow();
    expect(() => readArchitectureDocument("bad.svg", `<svg>${"<g>".repeat(130)}<text>API</text>${"</g>".repeat(130)}</svg>`)).toThrow("nesting");
  });
});
