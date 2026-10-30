import assert from "node:assert/strict";
import { it } from "vitest";
import { viewComplianceDraft } from "./services/complianceReview.js";

it("returns retained background and tags used to explain matches without rereading or changing the snapshot", () => {
  const base = {
    given: [],
    when: [],
    then: [],
    steps: [],
    sharedStepGroup: null,
    complianceControls: [],
    reviewStatus: "PENDING_REVIEW",
  };
  const draft: Parameters<typeof viewComplianceDraft>[0] = {
    id: "retained",
    digest: "a".repeat(64),
    state: "DRAFT",
    authorityGeneration: 0,
    selection: [],
    receipt: null,
    snapshot: {
      fields: { schema: { version: 1, fields: [] }, version: 0 },
      scope: {
        scanned: 2,
        total: 2,
        archived: 0,
        omitted: 0,
        limit: 2000,
        fields: "Retained title, background and tags",
      },
      controls: [
        {
          id: "control",
          code: "SYNC",
          title: "Synchronization permission",
          description: "Review territory",
        },
      ],
      cases: [
        {
          ...base,
          id: "background-only",
          title: "Trailer check",
          background: "Synchronization permission required before release.",
          tags: [],
        },
        {
          ...base,
          id: "tag-only",
          title: "Distribution check",
          background: null,
          tags: ["territory"],
        },
      ],
    },
  };
  const original = JSON.stringify(draft);
  const view = viewComplianceDraft(draft);
  assert.equal(
    view.cases[0]!.background,
    "Synchronization permission required before release.",
  );
  assert.equal(view.cases[1]!.background, null);
  assert.deepEqual(view.cases[1]!.tags, ["territory"]);
  for (const [caseId, term] of [
    ["background-only", "synchronization"],
    ["tag-only", "territory"],
  ]) {
    const match = view.proposals[0]!.matches.find((m) => m.caseId === caseId)!;
    assert.deepEqual(match.titleTerms, []);
    assert.ok(match.procedureTerms.includes(term!));
    assert.match(match.explanation, /not verified coverage/);
  }
  assert.equal(JSON.stringify(draft), original);
});
