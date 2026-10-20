# First synthetic project connection in Codex

Use a dedicated synthetic organization and test administrator with an accepted
retention plan. Never copy a customer project, import documents, or label real
test content synthetic. Keep tokens out of chat, command arguments, manifests,
marketplaces, Git, screenshots and result logs.

## Prepare and install

From a clean committed source, build and test, then choose a NEW output path:

```powershell
npm ci --prefix integrations/ai --ignore-scripts --workspaces=false
npm run build --prefix integrations/ai
npm test --prefix integrations/ai
node integrations/ai/scripts/prepare-preview.mjs C:/path/to/new-preview
codex plugin marketplace add C:/path/to/new-preview
codex plugin add vaettir@vaettir-synthetic-preview --json
codex plugin list --marketplace vaettir-synthetic-preview --json
```

Use supported CLI commands; never manually edit Codex caches or session files.
The Codex output contains `.codex-plugin/plugin.json` and `.mcp.json`; root
portable files are excluded. The receipt records `format: "codex-native"`.
When replacing an existing local marketplace source, use supported
`codex plugin marketplace remove vaettir-synthetic-preview --json` before adding
the new immutable output path. Keep the old package and receipt for recovery.
Compare installed files to `package-receipt.json` source/SHA-256 inventory. Start
a fresh conversation after installation. Without configuration, connection
status must say `configured:false` and summary reads must deny without network.

## Release and approve

The deployment must explicitly admit only the reviewed synthetic organization's
project pair using `VAETTIR_AI_DISCLOSURE_PROJECTS`, in addition to the enable
flag. Never enable the flag alone, admit another customer, or use a wildcard.
Verify the sandbox settings report it enabled while an offline negative-scope
test denies other organization/project pairs. Do not make probe reads against
an excluded customer's project to demonstrate isolation.

1. Complete [the release conditions](./RELEASE-REVIEW.md). From the installed
   plugin directory run `node dist/preflight.mjs https://YOUR-VAETTIR-ORIGIN REVIEWED_DEPLOYED_COMMIT`.
   This credential-free check does not establish approval or a successful read.
2. Create a clearly labeled synthetic project through Vaettir's normal UI.
   Zero counts suffice. Optional deterministic fixtures may use 10 cases,
   10 plans and 10 runs; any count 1 through 9 suppresses the whole result.
   Record only the synthetic project ID and expected totals locally.
3. As current test admin, open Project settings > Integrations > External AI
   access. Review disclosure, attest synthetic classification, save, and approve
   Codex aggregate counts for one day. Record non-secret grant ID/scope/expiry.
4. Enter the one-time credential through a hidden prompt into the NEW Codex
   process environment. The Codex native adapter forwards only
   `VAETTIR_AI_BASE_URL` and `VAETTIR_AI_TOKEN`. An already-running desktop app does not inherit terminal
   environment changes. Use a fresh local CLI for this first test; desktop
   credential persistence is separate. Never store the token in config.toml or
   use setx.

Run in a private local PowerShell terminal; never paste a token into a command:

```powershell
$previousOrigin = $env:VAETTIR_AI_BASE_URL
$previousToken = $env:VAETTIR_AI_TOKEN
$secureGrant = Read-Host 'Dedicated one-day synthetic Vaettir grant' -AsSecureString
$grantPointer = [IntPtr]::Zero
try {
  $grantPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureGrant)
  $env:VAETTIR_AI_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($grantPointer)
  if ($env:VAETTIR_AI_TOKEN -notmatch '^vai_[a-f0-9]{64}$') { throw 'Dedicated grant required' }
  $env:VAETTIR_AI_BASE_URL = Read-Host 'Reviewed HTTPS Vaettir origin'
  codex
} finally {
  $env:VAETTIR_AI_TOKEN = $previousToken
  $env:VAETTIR_AI_BASE_URL = $previousOrigin
  if ($grantPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($grantPointer) }
  $secureGrant.Dispose()
  Remove-Variable previousToken,secureGrant,grantPointer -ErrorAction SilentlyContinue
}
```

## Test the installed plugin

In the fresh Codex conversation, enable Vaettir and ask:

> Use Vaettir. Check connection status, then read the approved synthetic
> aggregate summary for project SYNTHETIC_PROJECT_ID. Use only the plugin's
> summary tool, with no browser, shell HTTP, exports or alternate identity.

Pass requires an actual installed `vaettir_project_summary` tool call and exact
expected counts (or intended whole-result suppression), without customer
content. `configured:true` alone is insufficient. Inspect Vaettir's recent
decisions for the corresponding ALLOW or SUPPRESS.

Keep the same Codex process/credential. Revoke in Vaettir, wait for successful
receipt, and repeat the summary tool call ONCE. It must deny, with a matching
DENY/POLICY_DENIED in admin audit. A timeout/outage without that denial is
inconclusive. Do not bypass it. Restoring admin authority or configuration must
not revive the revoked credential. Rotation testing requires a separate explicit
approval; the old credential must deny while only the new one reads.

Exit Codex, dismiss the credential view, and confirm no active test grants remain.
Retain synthetic project/history under the agreed plan; do not force-delete it.
Save source, installed file hashes, deployed release/digest, synthetic project
ID, grant ID/expiry, expected/observed counts, actual tool-call evidence, audit
codes and revoke result locally without tokens. An automated MCP harness or
package install does not substitute for authenticated installed-host acceptance.


An official Codex app-server ephemeral thread may validate installed-host MCP
discovery and direct `mcpServer/tool/call` without invoking a model. Record this
as app-server transport acceptance. It does not prove desktop chat tool selection
or model behavior. Both paths must use the installed plugin identity and bundle;
a separately registered native server is not an installed-plugin substitute.
