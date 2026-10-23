import { describe, expect, it } from "vitest";
import { documentRequirements } from "./documentRequirements.js";
describe("literal requirement candidates", () => {
  it("cites exact lines, deduplicates normalized text and excludes code", () => {
    const rows = documentRequirements(
      "# Scope\n- Playback must resume.\nPlayback MUST resume.\n```js\nsoftware must not be executed\n```\n1. Voltage shall stay below 5 V.\nA background note.",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "Playback must resume.",
      line: 2,
      quote: "- Playback must resume.",
    });
    expect(rows[1]?.line).toBe(7);
    expect(documentRequirements("\nPlayback must resume.")[0]?.key).toBe(
      rows[0]?.key,
    );
  });
  it("bounds output and does not infer requirements from prose", () => {
    expect(documentRequirements("The application supports video.")).toEqual([]);
    expect(
      documentRequirements(
        Array.from({ length: 200 }, (_, i) => `System ${i} must work.`).join(
          "\n",
        ),
      ),
    ).toHaveLength(100);
    expect(documentRequirements("must " + "x".repeat(500))).toEqual([]);
  });
});
