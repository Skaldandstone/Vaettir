import assert from "node:assert/strict";
import test from "node:test";
import {
  loadInvitationTemplate,
  validateInvitationTemplate,
} from "./clerk-invitation-template.mjs";

test("private-beta invitation has valid Clerk variables and beta terms", async () => {
  const template = await loadInvitationTemplate();
  assert.deepEqual(validateInvitationTemplate(template), []);
  assert.equal(
    template.subject,
    "Your Vaettir private beta workspace is ready",
  );
  assert.match(template.body, /Create your workspace/);
  assert.match(template.body, /5 full seats/);
  assert.match(template.body, /2 read-only seats/);
  assert.match(template.body, /500/);
  assert.match(template.body, /No automatic overage/);
});

test("HTML and plain-text copies share the safety and support contract", async () => {
  const template = await loadInvitationTemplate();
  for (const content of [template.body, template.plainText]) {
    assert.match(content, /non-regulated project data and test code only/i);
    assert.match(content, /AI provider/i);
    assert.match(content, /secrets, credentials/i);
    assert.match(content, /passwords, API keys/i);
    assert.match(content, /Questions or feedback\?/i);
  }
});

test("invitation copy avoids unsupported promises and stale pricing language", async () => {
  const template = await loadInvitationTemplate();
  const combined = `${template.subject}\n${template.body}\n${template.plainText}`;
  assert.doesNotMatch(
    combined,
    /dedicated (instance|database|infrastructure)/i,
  );
  assert.doesNotMatch(combined, /unlimited/i);
  assert.doesNotMatch(combined, /free forever/i);
  assert.doesNotMatch(combined, /—/);
});
