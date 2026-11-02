# Android app exploration

APP-NAV-01 extends SSE-181 with the owner-requested flow: connect an app,
explore normal navigation, review proposed tests, then add selected cases.
The initial pilot uses Skald's sandbox and the owner-selected aTwist QA app.
aTwist directory activation remains pending review.

## Source behavior

The single-file connector exposes a separate `/exploration/v1` protocol.
Existing v2 paired health and capture endpoints retain their existing meaning.
The exploration launcher uses local port 4775; it does not stop, replace or
extract pairing information from an existing port 4774 capture helper.

An explicit target check reads one authorized device's current package without
reading its hierarchy. A single-use target ticket is bound to that device,
observed package, browser origin and original project/account/session pins.
The ticket expires after two minutes. Starting requires separate explicit local
observation/navigation/test-account consent and exact allowed navigation labels.
Those local pins and pairing do not attest a hosted account or source permission.

The page checks current, locked, full-editor access before and after each local
operation using an independently authenticated Clerk subject. Native account
mapping is pinned after the first current read. A denial hides retained source
and stops further local dispatch. Explicit restoration checks the same original
scope. This metadata read still grants no processing permission: local consent
is a separate operation admission, and hosted disclosure is another review.

One step performs at most one navigation action. It reobserves the complete
supported target screen and refuses a stale navigation/content digest. Passive
animation may change bounds, index or drawing order without ending exploration.
All other passive attributes (including labels, object identifiers, class and
state) remain part of screen identity. Every attribute on clickable, long-clickable,
scrollable, checkable or focusable objects stays exact, even when unnamed or
disabled. Search/filter exclusion geometry also stays exact. A moving navigation
target, new overlay/control, changed content or protected screen still stops;
there is no fuzzy matching, automatic retry or broader navigation authority.
Individual object observation hashes retain their full native attributes,
separately from this stable screen comparison, so identical decoration at two
positions does not collapse to one observation identifier.
Accessible named navigation controls must match the approved labels exactly; duplicates and
known sensitive action labels are excluded. Passwords, recognized authentication
or payment screens, unrecognized forms, embedded web content and foreign package
hierarchies stop traversal. Back and scrolling are
bounded and retain their observed path. The default UI budget is 12 actions,
8 screens and 180 seconds, below protocol maxima of 24/12/300.

The Android adapter reads the display's exact `mCurrentFocus` package before
and after hierarchy collection. This supports current Pixel Android output;
the older `dumpsys window windows` command does not expose that field on the
pilot device. This is an explicit reader choice, not an activity-name fallback.
Hierarchy package, serial and complete text/count/byte admissions remain strict.
Before/after focus observations are not atomic isolation. Navigation labels
cannot guarantee an app's behavior, so a test account is required.

There is no autonomous helper loop. The browser requests one bounded step at a
time; Pause/Stop prevent the next request after an in-flight command completes.
Sequence is consumed before an action, so uncertain outcomes are never replayed.
A read can recover the retained local session without issuing another device
command. Navigation authority expires; observations remain in helper memory until
the process exits. This slice does not provide reload or helper-restart recovery.
Keep an uncertain add request mounted for its exact retry.

## Suggestions and addition

Navigation proposals are deterministic and local, with no model call or AI
credit charge. Every proposal contains its observed start, actions, destination
and timestamps. Expected assertions need human review. Observations are not a
test pass, business-rule verification or comprehensive coverage analysis.

The reviewer sees the exact selected journey payload and separately approves
its disclosure to the current project. Only selected paths are sent. The server
validates their complete bounded continuity and digest, then rechecks and locks
the original organization, membership, project and authenticated native account.
It saves pending-review `IMPORTED` cases with source provenance, ordered steps,
a version snapshot and an audit receipt in one transaction. A retry uses the
same request and durable receipt. A new request for the same retained journey
reuses the original case without replacing later human edits. Existing inventory
matching across separate exploration sessions is not implemented.

Client-reported observations are stored as local-reported provenance, not
independently verified physical execution. No new schema migration, provider
credential, directory activation, consent bypass or AI-sharing grant is added.

## Validation and release boundary

Focused engine/native-adapter/HTTP tests cover original scope, exact origins,
bounded decoding, target observation, stale views, excluded controls, traversal,
Pause/Stop, expiry and replay refusal. Real PostgreSQL tests cover selected case
creation, version/provenance, concurrent retries, human edits, current access,
tenant isolation, suspension and independent authentication. Browser fixtures
mount the actual component and engine, exercise explicit disclosure, uncertain
save recovery and account/access changes, and render both themes at 1280/390.
Their native and hosted-save adapters are synthetic; those tests are not a
physical-device or production acceptance claim.

Physical and authenticated sandbox acceptance remain distinct release gates.
The first actual pilot found a different foreground app and stopped before
hierarchy collection or navigation. No customer content from that app was read.
The second pilot admitted `com.atwist` on the authorized Pixel 9 Pro XL, observed
four distinct screens and performed four bounded scrolling actions. It exhausted
the approved starter labels with zero tap journeys; this is native observation
and scrolling evidence, not successful automatic test suggestion acceptance.
Further native source stays local until its exact selected disclosure is reviewed.

After the owner reviewed five detected controls, a separate single-use pilot
performed one actual tap and stopped at a manual-interaction boundary, without
creating a journey or uploading content. Its private evidence binds the earlier
helper hash; it does not establish proposal generation in the owner app. The
subsequent collector correction refuses protected/unrecognized screens before
retaining labels, field values or native attribute digests. Engine/native tests
verify that boundary. The later owner-approved ordinary-field run used the exact
updated helper SHA `037429cca3b72952f5add72fda5905d125177c2d40b23f9c72f81c002a2c3633`,
performed one tap and produced one schema/digest-validated journey and local test
proposal. It then stopped at a changed screen before its next action. No input
control was retained and nothing was uploaded. This establishes bounded actual
navigation/proposal preparation, with no claim of exhaustive exploration,
authentication/payment negative testing on the phone, hosted addition or release.

When starter labels do not match, the retained review lists detected controls for
explicit selection. Preparing another exploration checks the same open package
with a new target ticket, clears local and disclosure consent, and requires a new
bounded start. It does not silently broaden the previous session's authority.
An uncertain add request must be recovered before replacing its page review.

## Owner-approved ordinary field handling

The owner approved navigation around ordinary search/filter fields on October 22.
Only stable accessibility/identifier metadata can identify these fields; their
current text cannot authorize that classification. Password, authentication and
payment markers take precedence. Focused or unrecognized inputs still stop the
session. Known authentication/payment headings also stop it; this is conservative
metadata recognition, not a guarantee that every app's business behavior is known.

Ordinary inputs and their descendants are excluded from retained controls,
labels, values and attribute digests. Only a constant geometry marker contributes
to view identity. Input-value changes alone therefore do not change that digest;
navigation controls and other supported source still do. Taps cannot land in an
excluded input rectangle, and scroll paths crossing one are not dispatched.
No typing, field focus or submission command is added. Hidden subtrees are also
excluded after complete hierarchy/package admission, without weakening that
original admission. Input-boundary tests cover these cases explicitly.

## Technical evidence and automation suggestions

Each newly observed forward step retains the real Android resource id (when
available), class, selector type/value and original bounds, separately from
its hashed observation id. Ambiguous ids fall back to a unique observed
accessibility or text/class selector; otherwise they remain bounds-only.
The action receipt contains the actual dispatched ADB argument array and
connector request id. The engine refuses mismatched geometry before acting;
a mismatched command receipt after acting is uncertain and is never replayed.

The exact selected evidence is visible before hosted disclosure and retained in
the pending-review case's steps and provenance. The backend column explicitly
records missing app traffic. The original exploration slice has no app network adapter:
`NOT_CAPTURED` cannot be represented as a captured endpoint or response.
The earlier physical pilot predates this schema and does not prove collection
of these additional technical fields. A fresh bounded native test is required.

The `android-exploration` source family suggests UI Automator in the existing
automation-draft picker. This is a compatible draft target, not proof that the
case is replayable or its assertions were verified. Draft instructions retain
missing traffic as TODO, reject bounds-only as a durable locator and preserve
the expected behavior. Generation still follows the existing disclosed AI
operation; this change does not invoke it or spend credits automatically.

The database's closed family enum stores this import as `CUSTOM`; the case page
uses its exact retained framework name to select a supported suggestion. A browser
regression derives the actual picker and its parent prop binding, checks Android,
known-family, unknown and missing metadata, and renders both themes at 1280/390.
Provider/design hooks are synthetic and the test asserts zero paid mutations.

## Reviewed repairs for existing cases (APP-NAV-02)

The owner also requires selected existing-case replay, technical enrichment,
and a recommendation when an old object or path has changed. The pure
`recommendAndroidObjectRepair` module prepares candidate evidence from a current
same-app observation and exact original case/scope pins. It ranks matching labels
and classes for review, retains alternatives, refuses stale/foreign/protected
observations, and excludes ambiguous, bounds-only, disabled and sensitive objects.
Class or proximity alone cannot nominate a replacement. Scores order evidence;
they are not match probabilities. The module performs no I/O or native commands.

The intended sequence is:

1. Read the selected case's exact current revision and attempt supported reviewed
   steps under fresh original project/account/device authority.
2. If an object cannot resolve, stop and show the original selector, current
   candidate selectors, matching evidence and unchanged expected result. Ask
   whether a candidate is the correct new path; never silently select one.
3. After explicit candidate approval, recheck scope, case revision, app, current
   screen and unique selector, then admit a separately bounded retry.
4. Verify the original assertion. An uncertain action must first be reconciled;
   an assertion failure requires app-defect/case review, not locator healing.
5. Review a separate versioned case patch with original evidence and audit trail.
   Feed approved evidence and unresolved blockers into automation suggestions.

The November 2 source adds the existing-case selection, reviewed replay,
assertion evaluation and separate versioned patch flow. It reuses the actual
native observation/tap adapter through `/case-replay/v1`, with its own
single-use device/app/origin/scope ticket and five-minute, twelve-step limit.
Each action is an explicit request. Exploration and replay cannot navigate
concurrently. A missing locator offers same-label or shared-word candidates;
the chosen candidate must still match the freshly observed original screen,
unique selector and complete native target before one approved retry. The
receipt retains the candidate, screen, reasons and explicit retry approval.

Only TAP with resource-id, accessibility-id or text/class locators is supported.
An assertion requires exactly one matching visible label after the action. The
reviewer explicitly relates that assertion to the original expected result;
it does not prove other business rules, response bodies or API correctness.
Uncertain native execution quarantines that device in the connector process,
including after Stop. Reading retained results never issues a native command;
a missing or mismatched command receipt cannot enable another action. Reload
and connector restart recovery are not provided. Do not restart to evade an
uncertain action; reconcile it under a separate operator review.

The case picker exposes a bounded first 100 cases with their own structured
steps. Shared-step and unstructured cases remain manual. The selected case's
complete revision, step IDs, update identity and source provenance are pinned.
Every operation rechecks original current full-editor authority and revision.
Changing account, project, session, device or pairing hides retained evidence
and consumes component authority; restoring access cannot revive that run.
The local connector's scope pins do not independently attest hosted permission.

Completed assertions produce an exact patch preview, followed by separate
project-disclosure and patch approval. The server locks current organization,
membership, project, native actor, case, steps and source, and verifies the
bounded original plan and all receipts. It appends technical evidence to action
text only, creates an existing-model case version and audit receipt, and returns
ordinary review to pending. Expected results, responses, media, other case fields
and original source are preserved. Exact uncertain-write recovery uses the same
request and receipt, preserving later human edits. No automatic write retry or
new request is made. The existing UI Automator draft operation can use the saved
step evidence; generation and AI disclosure remain separate and are not invoked.

### Optional app-owned HTTP metadata

ADB hierarchy and tap receipts are never represented as app network traffic.
`scripts/android-network-evidence-debug.mjs` is an opt-in JavaScript debug-app
integration for an app-owned fetch client, including React Native. It has no
production installation, TLS interception, rooting, global fetch patch, log
reader or automatic transmission. The app developer must exclude it from the
production build and select a permitted test account, source ID and symbolic
route allowlist before capture. The debug flag and package label are assertions
by that app source, not cryptographic proof of its build or identity.

For an authorized debug build, instantiate it with the displayed replay run ID
before pressing **Run next reviewed step**, then explicitly route selected app
calls through it:

```js
const evidence = createDebugAppNetworkEvidence({
  debugBuild: __DEV__,
  packageName: approvedPackageName,
  runId: displayedReplayRunId,
  sourceId: "qa_catalog",
  approvedRouteKeys: ["catalog_list"],
  fetchImpl: appOwnedFetch,
});
const response = await evidence.request("catalog_list", catalogUrl, {
  method: "GET",
  headers: existingAppHeaders,
});
// Export locally only after those requests have settled.
const metadata = evidence.exportMetadata();
```

Only the symbolic route, actual response status or transport-error outcome,
method and timings are retained, up to 100 events. Raw URLs, headers, request
and response bodies, credentials and exception text are not exported. Request
objects are refused because their implicit method could differ from the
recorded method. The wrapper refuses unapproved routes and exhausted budgets
before dispatch; use it only for those explicitly selected debug calls.

After a completed replay, the reviewer selects that source and exact route
allowlist, imports its bounded metadata file, and reviews the combined disclosure.
Strict schemas reject extra raw-data fields and wrong app/run/source/routes or
out-of-run timestamps. Changing the selection invalidates the previous evidence
and disclosure approvals. Without this explicit import the patch says
`NOT_CAPTURED`. Even admitted metadata is app-reported, not independently
verified traffic or an API assertion. An installed app with no approved debug
integration remains unsupported for request capture.

### APP-NAV-03 correlated debug HTTP producer

Version 1 imports remain valid, explicitly uncorrelated run-level metadata.
Version 2 adds a reviewed static operation catalog, a local app clock identity,
pending-request count and actual challenge/response clock observations. A clock
ID identifies one capture instance; matching IDs or wall-clock epochs do not
establish synchronization. The server derives an offset interval from the real
host send/receive observations. It assigns an event only when its complete
uncertainty envelope falls strictly inside exactly one step's original
dispatch-to-observation window and inside the calibration span. Overlapping,
boundary, missing-clock and inconsistent observations remain unassigned in the
audit. This assumes compatible reported clocks between samples and is temporal
association only, never causality, network attestation or API correctness.

For version 2, `selection.startedAt/endedAt` are explicitly app-clock bounds:
`selection.correlation.captureClock` must be `{domain:"APP_REPORTED",clockId}`
with the exact metadata clock ID. Calibration separately retains host
send/receive times and `connectorClockId`; each native receipt separately
retains that clock ID and its host command window. The initial capture has
`clockCalibration:null` because one sample cannot calibrate a span. Never fill
in missing times or replace them with host wall-clock values.

The connector now contains a bounded adapter for an explicitly integrated debug
app. Download, pairing, ordinary navigation and retained-state reads perform no
HTTP-metadata file I/O. The replay start request must separately include:

```js
networkApproval: {
  sourceId: "qa_catalog",
  catalog: {
    id: "catalog_api", revision: 1,
    routes: [{routeKey: "catalog_item", method: "GET", template: "/v1/catalog/{item_id}"}]
  },
  debugMetadata: true,
  sourceReviewed: true,
  catalogReviewed: true,
  temporalOnlyReviewed: true
}
```

Review the source, catalog and debug-build integration independently. Templates
are static lowercase path vocabulary and named placeholders, with an optional
version prefix. They contain no host, query, fragment, escaped bytes, concrete
IDs or personal values. Syntax cannot prove a static word is non-private; the
catalog reviewer must exclude private names and identifiers. The wrapper checks
the actual requested method/path against this catalog and exports only symbolic
operations, actual status/outcome and timing. URLs and app headers remain within
the app's own fetch call and are never copied to evidence.

App developer integration uses `createDebugAppNetworkFileBridge` from
`scripts/android-network-evidence-debug.mjs`. The developer creates these two
files inside the selected debuggable application's private data directory and
supplies synchronous bounded native file methods. Vaettir neither installs nor
creates the app integration or its directories:

```js
const bridge = createDebugAppNetworkFileBridge({
  debugBuild: __DEV__, packageName: approvedPackageName,
  sourceId: "qa_catalog", catalog: reviewedCatalog,
  fetchImpl: appOwnedFetch,
  // Each callback must restrict access to its exact path below.
  readControl: path => appDebugFiles.readUtf8Sync(path, 16384),
  writeResponse: (path, text) => appDebugFiles.atomicReplaceUtf8Sync(path, text, 65536),
  // Consult CURRENT app-local approval for this exact run/origin/source/catalog.
  // Never implement this as unconditional true or as a production capability.
  approveRun: request => debugApproval.matchesCurrent(request),
  nonce: () => appCrypto.randomBytesHex(24),
});
// The app's existing debug lifecycle calls bridge.poll(), on its own thread.
// Route ONLY explicitly selected calls through this wrapper while approved.
const response = await bridge.request("catalog_item", itemUrl, {method: "GET", headers: appHeaders});
```

`appDebugFiles`, `debugApproval` and `appCrypto` above are developer-supplied
native app adapters, not installed libraries or simulated capture results. The
app must build and verify them on its target runtime. Start with empty files,
create a fresh bridge for each expressly approved run, poll within the bounded
host deadline, and stop polling when that run expires or is refused. The SDK
has no background timer, global interception or automatic permission grant.
App approval is rechecked on every challenge and selected request; refusal is
terminal for that bridge instance. A pending request may finish after the last
snapshot, so `pendingRequests` is retained and is not treated as a successful
or failed response. No extra navigation or private-file read is issued to wait
for such a request.

The only host file operations are `adb -s <original serial> exec-out run-as
<original package> tee files/vaettir-debug-http/control.json` and the corresponding
`cat files/vaettir-debug-http/response.json`. There is no shell expansion, mkdir,
path discovery, rooting, device-wide logs or TLS interception. Each control is a
canonical JSON frame terminated by a newline; empty/incomplete frames cause no
app response, handling the tee truncation window. The app atomically replaces
its response. Each exchange writes once, reads at most four times, admits at
most 16 KiB control/64 KiB response and requires a round trip at most one second.
At most 32 unique challenges, 100 requests and five minutes are allowed. Focus,
original device/package, origin, scope, source, catalog, approval, nonce and
clock are rechecked. Failed or ambiguous writes are never retried automatically.
After uncertain native execution the connector issues no metadata cleanup
command. App-side expiry remains in force; restoring focus/access cannot revive
a refused capture.

Requested replay state contains `networkCapture` with `status: "CAPTURED"`,
`metadata` and `selection`, or `status: "UNAVAILABLE"` and both values null. The
UI forwards the exact captured pair through the existing disclosure/patch
review. Failure to start capture prevents the first tap. Capture failure after
a complete native receipt preserves that receipt but stops further navigation.
It does not falsely label the known action as uncertain. Source-only tests use
the actual producer, adapter, engine, strict downloaded-connector parser and
service with synthetic I/O. Physical app integration, device traffic, root UI
wiring and hosted acceptance remain separate Main-owned release gates.

### APP-NAV-02 validation boundary

Focused tests execute the actual replay engine, native adapter and helper HTTP
admission with synthetic native runners; actual service transactions with
synthetic delegates; and the actual React component event handlers and SSR with
synthetic hooks/RPC. They cover scope/revision changes, denied access, exact
single-action receipts, missing/stale/ambiguous targets, explicit repair,
assertion failures, uncertain-command refusal, bounded HTTP metadata, reviewed
patches, version/audit rollback behavior and exact receipt recovery. They do not
establish PostgreSQL locking/concurrency, browser geometry, physical-device,
app-provider, hosted or production acceptance. Those Main-owned checks remain
required before release acceptance. No real existing case has been replayed,
healed or changed by this source work; the prior eight-case import is untouched.
aTwist activation remains pending review.

### Reviewing app-request capture in Vaettir

Before Run, open App requests and choose the developer-provided request setup:
`{"sourceId":"qa_debug","catalog":{"id":"qa_routes","revision":1,"routes":[{"routeKey":"catalog","method":"GET","template":"/catalog"}]}}`.
Vaettir lists the methods and templates for approval. This approval is separate
from navigation and is consumed by one run. Loading or changing setup clears
previous approval. The developer must first integrate the debug file responder
and request wrapper described above; selecting a file does not instrument an app.
The current connector advertises APP_PRIVATE_FILES version 2. A missing,
unsolicited or changed source is refused before further navigation. Returned
clock observations are forwarded as observed; there is no timestamp editor.
Completed evidence and exact proposed case changes are reviewed before saving.
Legacy exports stay available separately and remain uncorrelated.
