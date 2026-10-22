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
supported target screen and refuses a stale screen digest. Accessible named
navigation controls must match the approved labels exactly; duplicates and
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
records missing app traffic. There is no app network adapter in this slice:
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

The pure recommendation module and draft guidance are implemented foundations.
The existing-case selection/replay UI, assertion evaluator, native retry admission
and durable reviewed patch operation are not implemented in this slice. No
hosted endpoint exposes the module and it grants neither execution nor update
authority. No existing case has been replayed, healed or updated by this work.
App-request capture, a fresh technical native run and authenticated sandbox
addition/replay remain acceptance gates. aTwist activation stays pending review.
