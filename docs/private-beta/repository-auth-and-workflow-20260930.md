# Repository authorization and workflow usability

## Implemented slice

- GitLab chip opens a modal flow: hosted or public-HTTPS self-hosted instance, account authorization popup, verified identity, explicit metadata listing, paginated/searchable repository selection and approval. The population wizard opens the same flow without navigating away or discarding its draft. Recent actor-owned authorization attempts can be resumed.
- Each organization configures its own GitLab OAuth application. State is random, hashed, actor/project-bound, single-use and short-lived; PKCE uses S256. App secrets, verifiers and access tokens are encrypted. The callback requires the Vaettir session, scrubs query parameters, disables referrers and is not cacheable. Popup status polling does not depend on an opener surviving provider isolation headers.
- Provider network intake requires public HTTPS, validates all resolved IPv4 addresses and pins the chosen address to the TLS socket. No redirects; one 15-second DNS/request/body deadline; 1 MiB response bound. Imported code is never executed. This flow does not fetch source files or invoke AI.
- After provider I/O, organization lock plus current membership/seat/suspension checks precede persistence. Disconnect or configuration removal cannot be undone by a late callback/list result. Foreign keys remove orphaned credentials. Expired connections never claim current access. Repository verification is derived from the current connection, not a historical timestamp.
- Repository selections are tied to canonical catalog content. This deliberately handles PostgreSQL JSONB key reordering. Identical reruns do not duplicate repository records or overwrite manual revision references. Another member's connection cannot be silently replaced. Default branch metadata does not claim deployment or active work.
- Filtered/selected CSV export follows visible case identities/order, counts and archive scope; missing rows fail explicitly. Spreadsheet formula-like cells are exported as text. Stable IDs avoid collisions between identical titles.
- Creation wizard sizes against the dialog rather than the viewport. Inputs, choice labels and actions shrink/wrap; objective textarea has usable height and vertical resizing.
- BDD items and structured test steps have keyboard-accessible Move up/down controls and announcements. Whole structured rows retain every field; stable editor keys keep controls attached to the moved item. Existing backend saves order but recreates database step IDs. Durable per-step media identities and suite drag ordering are not implemented by this change.

## Configuration and acceptance boundaries

- Production provider authorization is gated until encrypted credential storage and a registered instance OAuth application are configured. No secret, identity policy or provider app was changed for this source validation. The owner was asked separately about enabling encrypted storage.
- A GitLab instance administrator registers an OAuth application with `read_api` and the exact callback shown in setup, then a Vaettir organization admin saves its app credentials. Users explicitly approve account/repository-metadata access before authorizing. Source processing and AI require later, separate permission.
- Private-network/IPv6-only GitLab hosts, automatic token refresh and other native repository providers are not implemented. Other provider chips disclose unavailable authorization and offer an explicitly unverified reference fallback. No live-provider authorization, customer repository access or paid model call is claimed.
- Disconnect removes Vaettir-held credentials, not the authorization at GitLab itself. Revoke the application in GitLab when that broader action is needed. Admin configuration removal retains registered references but invalidates associated access verification; reconfiguration requires fresh authorization.

## Validation

- Fresh disposable PostgreSQL database, additive migration and seed: passed. API suite passed 439 tests across 73 files, including configuration-removal and callback race regressions (`.local/ux-validation/vaettir_ux_test_1790753061529`).
- Web contracts, filtered-export, wizard-layout and step-order checks passed 57 tests. API/web typechecks and focused provider/UI lint passed with no errors; two previously existing unescaped-quote warnings in `TestCaseForm.tsx` remain. Immutable release identity remains to be appended after rollout acceptance.
- Rendered actual modal/creation components in synthetic frames: 690x700 and 1280x900 dialog client/scroll widths both478px; 375x812 both326px. No horizontal overflow. Continue remained inside the dialog at Purpose and System; mobile objective width278px/height84px. Back/forward remained on the same page.
- Rendered actual GitLab components with mocked metadata: resume verified identity, load two repositories, toggle both chips, review, approve and retain saved connection display with explicit source-not-read labeling. Review dialog client/scroll width both478px. This is UI fixture evidence, not real OAuth/provider acceptance.
- Rendered the actual test-case form with two complete structured rows and three items per BDD section. Moved the second Given item and structured row to first position; the locally captured save payload preserved all four fields of both rows and the requested BDD order. No backend record was written by this fixture.
- Competitive benchmark and next work: `competitive-parity-20260930.md`. Nine official-document sources do not prove exhaustive parity or comparative usability superiority. Saved query/report center, bulk credit approval, suite ordering/dependencies and remaining adapters remain outstanding.

## Deployment

Source validation only at this checkpoint. Do not conflate this slice with the already deployed access-prevention commit29352e2 (API27/web21).
