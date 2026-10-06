import assert from "node:assert/strict";
import test from "node:test";
import { sourceCodeIncludes } from "./source-contract-tokens.mjs";

test("format-neutral source contracts retain operators, identifiers, quoted values and template identities", () => {
  assert.equal(sourceCodeIncludes('const scope = { enabled: access.ready,\n staleTime: 0,\n retry: false };', "enabled: access.ready, staleTime: 0, retry: false"), true);
  assert.equal(sourceCodeIncludes('const scope = { enabled: true, staleTime: 0, retry: false };', "enabled: access.ready, staleTime: 0, retry: false"), false);
  assert.equal(sourceCodeIncludes('<History\n key={`${projectId}:${testRunId}:${testCase.testCaseId}`}\n active={readable && expanded && !stepMode} />', 'key={`${projectId}:${testRunId}:${testCase.testCaseId}`}'), true);
  assert.equal(sourceCodeIncludes('<History key={`${projectId}:${testCase.testCaseId}`} active={true} />', 'key={`${projectId}:${testRunId}:${testCase.testCaseId}`}'), false);
  assert.equal(sourceCodeIncludes('<History active={readable || expanded || !stepMode} />', "active={readable && expanded && !stepMode}"), false);
  assert.equal(sourceCodeIncludes('searchParams.getAll("other")', 'searchParams.getAll("caseId")'), false);
  assert.equal(sourceCodeIncludes('const caption = "Private cached procedures are visible";', '"Private cached procedures are hidden"'), false);
  assert.equal(sourceCodeIncludes('// enabled: access.ready\n const enabled = true;', "enabled: access.ready"), false);
});
test("JSX text whitespace formatting is tolerated without accepting joined or changed words", () => {
  assert.equal(sourceCodeIncludes('<p>Private cached procedures and\n observations are hidden.</p>', "Private cached procedures and observations are hidden"), true);
  assert.equal(sourceCodeIncludes('<p>Privatecached procedures and observations are hidden.</p>', "Private cached procedures and observations are hidden"), false);
});
