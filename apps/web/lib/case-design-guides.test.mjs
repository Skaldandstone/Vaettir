import assert from "node:assert/strict";
import { test } from "node:test";
import {
  caseDesignGuide,
  caseDesignGuides,
  caseDesignReviewKey,
  caseDesignStages,
} from "./case-design-guides.ts";

// Authored SOURCE ONLY; no execution or qualified domain acceptance.
test("each native workflow has distinct complete design/procedure/evidence prompts", () => {
  assert.equal(new Set(caseDesignGuides.map((item) => item.id)).size, 5);
  for (const guide of caseDesignGuides) {
    assert.equal(caseDesignGuide(guide.id), guide);
    for (const stage of caseDesignStages) {
      assert.equal(guide.stages[stage.id].length, 2);
      assert.ok(
        guide.stages[stage.id].every(
          (prompt) => typeof prompt === "string" && prompt.length > 30,
        ),
      );
    }
  }
});
test("local review identities remain distinct across workflow, stage and prompt", () => {
  const keys = caseDesignGuides.flatMap((guide) =>
    caseDesignStages.flatMap((stage) =>
      guide.stages[stage.id].map((_, index) =>
        caseDesignReviewKey(guide.id, stage.id, index),
      ),
    ),
  );
  assert.equal(keys.length, 30);
  assert.equal(new Set(keys).size, 30);
  assert.ok(keys.every((key) => typeof key === "string"));
});
test("unknown guide/stage/index never produces an approval identity", () => {
  assert.equal(caseDesignGuide("toString"), null);
  assert.equal(caseDesignReviewKey("toString", "design", 0), null);
  for (const index of [-1, 0.5, 2, NaN])
    assert.equal(caseDesignReviewKey("GAME_PLAYER", "design", index), null);
  assert.equal(caseDesignReviewKey("GAME_PLAYER", "toString", 0), null);
});
test("physical and sample guidance never supplies a qualified protocol or platform certification", () => {
  const hardware = caseDesignGuide("HARDWARE_SYSTEM");
  const process = caseDesignGuide("PROCESS_SAMPLE");
  const game = caseDesignGuide("GAME_PLAYER");
  assert.ok(
    hardware.stages.procedure.some((prompt) =>
      prompt.includes("project-approved criteria"),
    ),
  );
  assert.ok(
    hardware.stages.design.some((prompt) =>
      prompt.includes("physical-device acceptance"),
    ),
  );
  assert.ok(
    process.stages.design.some((prompt) =>
      prompt.includes("no clinical or food-safety limits"),
    ),
  );
  assert.ok(
    process.stages.evidence.some((prompt) =>
      prompt.includes("not an executable"),
    ),
  );
  assert.ok(
    game.stages.evidence.some((prompt) =>
      prompt.includes("not proprietary console requirements"),
    ),
  );
});
