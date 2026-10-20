# Application UI

Approved implementation direction, 2026-10-19. This is an application workbench, not a replacement brand or marketing site. Preserve the existing rune asset and wordmark.

## Visual assets and tokens

Source assets live in `apps/web/components/ui/Workspace.tsx` (functional SVG icons), `apps/web/components/RuneMark.tsx` (unchanged product rune), `apps/web/app/globals.css` (theme tokens), and `apps/web/app/workbench.css` (application layout and components). Do not substitute generated raster icons for these assets.

| Role | Default dark | Light |
| --- | --- | --- |
| Canvas | `#131d29` | `#f4f7fa` |
| Surface | `#192431` | `#ffffff` |
| Raised surface | `#202f3e` | `#eaf0f5` |
| Text | `#e5ebf1` | `#182636` |
| Secondary text | `#a5b4c5` | `#52677b` |
| Action accent | `#d5a17f` | `#965339` |
| Links | `#a9c8e5` | `#315f84` |
| Selected surface | `#293e52` | `#e0ebf4` |

Success, failure and warning retain semantic green, red and amber. Copper is an action accent, never a success result. Theme changes must not animate into mixed unreadable foreground/background states. Previously saved light/warm preferences remain light; new users default to dark.

Use Inter with system sans-serif fallbacks for working text, restrained Fraunces headings, and monospace only for identifiers. Tables and navigation are compact; primary choices, errors and cost approvals remain explicit. Icons need accessible names, hover/focus tooltips and keyboard focus states. Do not remove text from irreversible or chargeable confirmations just to reduce density.

## Layout and behavior

- Application sidebar: 184px expanded, 48px functional icon rail. Mobile uses the existing menu. No changes to permission-derived navigation.
- Suite sidebar: resizable 152–320px, collapsible, resettable and keyboard operable. Browser preferences are actor/project scoped and contain presentation only.
- Test editor: compact metadata disclosure; title-only collapsed procedure steps, expand/collapse all, new steps open immediately. Collapsing preserves mounted drafts and media state. Gherkin remains optional. Desktop save footer is sticky; mobile footer stays in normal flow so it cannot cover actions.
- Activity: comments and history nest under Activity. No fictional work-log feature. Hidden panels remain mounted; existing authority/refresh guards remain active.
- Project overview: reorderable, collapsible modules with half/full-width choices and reset. Explicit layout-edit mode and keyboard controls; no drag-only interaction. Preferences do not alter project configuration.
- Integrations: repository, Jira/Confluence and AI-sharing tabs retain their controllers, disabled fieldset and access checks. Existing `#atlassian-quality` deep links select the correct tab.
- Plans and requirements: compact records and functional action icons. Manual plan creation, source provenance and generation approvals remain intact.
- Report wizard: compact progress track, full-width aligned fields and an actual local notes preview. The preview is labelled not captured and does not imply saved metrics or sharing approval.
- Architecture: an explicit-relationship focus diagram above the retained source table. Render extracted labels as text, never uploaded SVG markup. Show only resolvable explicit edges and confirmed test-link counts. Traceability is not passing execution or coverage.
- Controls: generally 32–38px desktop with 44px coarse-pointer targets. Long select values use the existing ReadableSelect behavior. Tooltips stay within the viewport and escape sidebar clipping.

## Verification and release boundary

Local browser verification: `node apps/web/e2e/ui-workbench/run.mjs`.

This bundles genuine UI components with explicit synthetic authentication/transport boundaries, serves loopback only, blocks external requests, and writes ignored screenshots/evidence under `.local/ui-refresh-20261019/`. It cannot import cases, call a provider or spend credits. It checks theme switching, draft retention, keyboard tabs, tooltip dismissal, icon navigation, actor-scoped sidebar persistence, modular layout, explicit graph relations, 390px overflow, touch targets and token contrast. Library rows and overview contents are synthetic fixtures, not authenticated end-to-end pages. Fonts use local fallbacks in this offline evidence.

At the implementation checkpoint: 2,437 typed web tests and 891 Node web tests pass. The additional architecture-renderer tests cover escaping, unresolved-edge rejection and honest empty states. Existing form/settings fixtures were extended for new presentation components without dropping payload, authority, retention or mutation assertions.

The Windows Next build compiled, type-checked and generated all 25 pages, then failed standalone packaging on Windows symlink `EPERM`. That is not a successful deployable artifact. Linux CI/build, integration with the final primary-domain baseline, signed-in pages and native Jira/Confluence rendering remain release gates owned by the deployment lane. No production or customer data changed in this UI implementation.

Do not deploy the ticket-foundation branch wholesale: it contains a separate unfinished ticket-matching foundation. Integrate the UI-only commit onto the deployment owner's final verified baseline, preserving domain/auth changes in the root layout and existing native JSON routes. Earlier uncommitted discovery-consent edits are not part of this UI release.

## Primary-domain release integration

The October 20 candidate composes the three reviewed UI commits onto the deployed primary-auth baseline `812f33d`. The sidebar retains the persistent example-workspace dismissal store alongside the new compact navigation. Its rendered regression fixture loads the actual layout preference, icon action and tooltip components; dismissal, reload, cross-tab updates and storage-denied recovery remain asserted. The complete workbench interaction harness also runs in the normal CI browser step.

Primary sign-in configuration now applies when CloudFront replaces the viewer Host before forwarding a legacy setup request. Signed customer returns still require ingress verification. Unverified browser setup returns use the constant new application origin and retain their full path and opaque query. Public startup pages, pending authentication tasks, bearer requests and native JSON authorization retain their existing behavior.

Local component checks cover both themes, mobile overflow, touch targets, keyboard navigation, draft retention, tooltip travel and dialog dismissal. Actual hosted UI acceptance and the configured immutable image remain separate release requirements.

October 20 bounded UX correction: a real coarse-pointer browser check reproduced undersized collapsed navigation links. Touch links/actions now retain 44px targets inside the 48px navigation rail; the collapsed suite column reserves 52px on touch devices (44px on desktop), avoiding overlap with the case workspace. The browser regression checks actual target bounds and overlap at 1024px in addition to the 390px screen checks. This is local rendered verification, not hosted acceptance.

October 20 tooltip correction: moving from an icon to its portalled help previously dismissed the text, particularly when the viewport placed it above the icon. Tooltips now retain a pointer bridge plus a short leave grace period for diagonal travel; scrolling is confined to the content rather than clipping the bridge. Hovered help can be dismissed with Escape without closing a native dialog. The real-component browser check covers both placements, pointer exit, first/second Escape behavior, retained dialog input and restored opener focus. Focused-button callbacks retain their original handling. This does not make help text an approval or change any mutation.
