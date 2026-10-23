# Custom case-author browser verification

Run from the identity worktree root:

```powershell
node apps/web/e2e/identity-case-authoring/run.mjs --output-dir .local/identity-case-authoring-review-01
node --test apps/web/e2e/identity-case-authoring/output.test.mjs
```

The fixture bundles the actual New/Edit routes, `TestCaseForm`, custom-field
controls, manual/custom/native permission hooks and project/actor-bound field
hooks. Only Clerk, tRPC transport and Next navigation/link boundaries are
synthetic. It does not install dependencies or load environment files. Chromium
runs against an ephemeral IPv4 loopback server; off-origin requests are blocked
and make the run fail. Browser and server close in `finally`. The explicit output
directory must not exist, and its parent must already exist. Admission uses
exclusive directory creation before bundling or launching; even an empty existing
directory is refused. Each reviewer/run must choose a new directory. Existing
receipts/screenshots are never replaced. Original 97b proof remains at
`.local/identity-case-authoring-ui/` and must not be reused as output.

## Covered behavior

- A native full-seat viewer with a server-returned `cases.write` action can use
  the manual authoring form, including required custom metadata.
- Revoked or fetching action responses, mismatched project/organization/subject,
  field-read failures or fetching, revoked field editing and changed field
  organization prevent any synthetic save attempt.
- A mismatching live session blocks the custom-action path. Switching actors
  withholds original custom metadata and blocks saving. Returning to the original
  actor restores the retained draft. Project navigation remounts the editor
  without copying the original project's authored draft.
- Native editor access works without custom actions. A synthetic server denial
  for a light-seat viewer exposes no authoring form. This exercises the UI's
  consumption of that denial, not server seat enforcement.
- Access retry and save work from the keyboard. A failed synthetic save retains
  title, steps and metadata, does not navigate, and permits retry of the same
  payload. Schema/value and edit case/step revisions are asserted using distinct
  synthetic 64-hex values matching the current input field formats. This does
  not prove full router input validation or real server revision acceptance.
- Real help tooltips open on focus and dismiss with Escape. Collapsed procedure
  rows retain action titles and populated values. Both themes are checked at
  1280 and 390 pixels for horizontal overflow; eight screenshots are retained.

The runner records 64 named checks across New/Edit and both themes, browser
errors, blocked requests, bundled source SHA-256 hashes and screenshot hashes in
`<output-dir>/result.json`. A failed run writes a new result with `passed: false`
only within its newly admitted directory. Source identity is the current HEAD;
working-file hashes identify any uncommitted fixture changes precisely.

## Acceptance boundary

This is local actual-component interaction evidence, not real Clerk login,
Google SSO, provisioning, revocation, server authorization or hosted custom-role
acceptance. No customer records, provider requests, credentials, AI processing,
media uploads or test execution are used. Screenshots use the actual styles with
system font fallbacks and omit the hosted application shell; they do not prove
hosted font/layout parity. Native media/admin/import/bulk capabilities are not
expanded or covered by this fixture. Production components and permissions are
unchanged.

Zero forbidden save mutations means no synthetic mutation invocation occurred
in the tested denied UI states. Query observations record hook inputs and
`enabled`, including disabled hooks; they are not actual network reads, cache
behavior, transport suppression or read-authorization evidence.

Isolated Google execution remains gated on the operator's approved scope and
provider contract verification. aTwist activation remains pending review.
