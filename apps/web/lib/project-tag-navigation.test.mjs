import assert from "node:assert/strict";
import { test } from "node:test";
import { projectTagHref, projectTagLabel, selectedProjectTag, projectTagPageMatches, projectTagItemHref, matchesExactTag } from "./project-tag-navigation.ts";

test("tag navigation preserves exact empty, whitespace, Unicode and punctuation identity", () => {
  for (const tag of ["", " ", " leading and trailing ", "one,two", "a+b&x=#?", "北欧 🧪", "line\nnext", "__proto__"]) {
    const url = new URL(projectTagHref("native/project", tag), "https://example.invalid");
    assert.equal(url.pathname, "/projects/native%2Fproject/tags");
    assert.deepEqual(selectedProjectTag(url.searchParams), { selected: true, tag });
    assert.equal(url.searchParams.getAll("tag").length, 1);
  }
});

test("a missing tag is not the native empty tag and duplicate parameters are refused", () => {
  assert.deepEqual(selectedProjectTag(new URLSearchParams()), { selected: false });
  assert.deepEqual(selectedProjectTag(new URLSearchParams("tag=")), { selected: true, tag: "" });
  assert.throws(() => selectedProjectTag(new URLSearchParams("tag=one&tag=two")), /Choose one exact tag/);
  assert.throws(() => selectedProjectTag(new URLSearchParams("tag=&tag=")), /Choose one exact tag/);
});

test("display explanations never replace the selected raw identity", () => {
  assert.equal(projectTagLabel(""), "Empty retained tag");
  assert.equal(projectTagLabel(" \t"), "Whitespace-only tag (2 characters)");
  assert.equal(projectTagLabel(" spaced "), " spaced ");
  assert.equal(projectTagLabel("ordinary"), "ordinary");
});

test("fresh page admission pins exact scope, request and native reader without trimming tags", () => {
  const input = { projectId: "project", originalOrganizationId: "org", expectedClerkActorId: "actor", requestId: "new-read", tag: " spaced ", section: "CASES", archive: "ACTIVE", review: "APPROVED" };
  const data = { projectId: "project", organizationId: "org", clerkActorId: "actor", requestId: "new-read", tag: input.tag, section: "CASES", archive: "ACTIVE", review: "APPROVED", scopeHash: "a".repeat(64), readScope: { projectId: "project", organizationId: "org", actorId: "native", actorClerkUserId: "actor" } };
  assert.equal(projectTagPageMatches(data, input, "native"), true);
  for (const patch of [{ projectId: "other" }, { organizationId: "other" }, { clerkActorId: "other" }, { requestId: "old-read" }, { tag: "spaced" }, { section: "PLANS" }, { archive: "ALL" }, { review: "ALL" }, { scopeHash: "" }, { readScope: undefined }, { readScope: { ...data.readScope, actorId: "replaced-native" } }, { readScope: { ...data.readScope, organizationId: "other" } }, { readScope: { ...data.readScope, actorClerkUserId: "other" } }]) assert.equal(projectTagPageMatches({ ...data, ...patch }, input, "native"), false);
  assert.equal(projectTagPageMatches(data, { ...input, cursor: { scopeHash: "b".repeat(64) } }, "native"), false);
  assert.equal(projectTagPageMatches(data, input, ""), false);
});

test("supported entity navigation uses real native routes, not invented requirement details", () => {
  assert.equal(projectTagItemHref("p", "CASES", "id"), "/projects/p/test-cases/id");
  assert.equal(projectTagItemHref("p", "PLANS", "id"), "/projects/p/test-plans/id");
  assert.equal(projectTagItemHref("p", "RELEASES", "id"), "/projects/p/releases/id");
  assert.equal(projectTagItemHref("p", "REQUIREMENTS", "id"), "/projects/p/requirements#requirement-id");
});

test("main repository exact-tag filter distinguishes no filter from retained empty text", () => {
  assert.equal(matchesExactTag([], null), true);
  assert.equal(matchesExactTag([], ""), false);
  assert.equal(matchesExactTag(["", " spaced "], ""), true);
  assert.equal(matchesExactTag([" spaced "], "spaced"), false);
  assert.equal(matchesExactTag([" spaced "], " spaced "), true);
});
