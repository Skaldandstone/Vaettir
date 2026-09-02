# B2B interface, first implemented slice

August 31, 2026. Owner: Vaettir integration. Status: **local implementation and sample-workspace review complete; James's design acceptance pending**. Source is the uncommitted UI change set on `codex/private-beta-readiness`, based on `2955d6d`. Earlier release evidence must not be attributed to this change set. No deployment or new release acceptance.

## Direction

James asked for real product UI elements and a B2B identity distinct from the studio's other styles. The web application uses a graphite navigation rail, light working canvas, compact sans-serif typography, restrained green actions, and separate success/warning/error/AI status colors. The canonical rune and lowercase serif wordmark remain. Grain and large serif operational headings no longer compete with data. Dark mode uses the same component hierarchy, not the old brown marketing palette.

This remains the existing Next.js application and package stack. No Sites migration, hosting change, UI-framework replacement, new dependency, manifest/lockfile edit, native redesign or new social image was introduced. Existing icons and social assets remain unchanged.

## Implemented surfaces

- Public `/`: explicitly labeled interactive example workspace. Overview cards, release execution bar with text counts, attention queue, searchable/filterable case table, a focused Given/When/Then details drawer, example AI review decisions, and illustrative release gates. Review decisions can be reset and never create cases, consume credits or grant sign-off. Example records are isolated in `apps/web/lib/workspace-example.ts`; there is no customer/API fallback.
- Shared app shell: navigation icons, active-page semantics, sidebar groups, skip link, light/dark tokens, focus outlines and responsive layout. Project overview no longer appears active on every project child route.
- `/dashboard`: shared heading and metric components, readable project/release table, explicit loading/empty/error states and retry. Counts still come from `releases.orgOverview`; no synthetic release data is inserted. Its existing first-organization selection is unchanged.
- `/projects`: searchable project cards, repository context, existing case/plan/requirement links, loading and empty states. Create/edit/delete controls still use the existing role and seat capability checks. Deletion now requires the exact project name, remains single-submit while busy, and returns server failures in the confirmation. Editing cannot save until the existing project settings load successfully. No CRUD endpoint or authorization change.
- Shared primitives: `components/ui/Workspace.tsx` contains functional icons, page headings, metric cards, status pills and empty states. Existing readiness badges use the new semantic palette.

## Verification actually performed

- Web and E2E TypeScript compilation passed after the implementation.
- Focused ESLint passed on all changed UI TypeScript and the two adjusted E2E selectors. A preexisting unescaped apostrophe in the touched projects page was corrected; final focused lint has no warnings.
- `node --experimental-strip-types --test apps/web/lib/beta-ui.test.mjs apps/web/lib/workspace-example.test.mjs apps/web/lib/usability.test.mjs`: **45 passed**, comprising 30 existing capability/environment contracts, eight example-data/filter contracts, and seven usability/recovery contracts. Node emits its existing module-type detection warning; package settings were not changed to silence it.
- Local existing development server at `http://localhost:3000/` returned HTTP 200 and rendered the updated UI.
- Actual in-app browser checks: no-match search and clear, failed-only filter (one of six cases), case scenario details and close, example accept/dismiss decisions, review empty state/reset, gate-to-failing-case navigation and no sign-off affordance. The usability follow-up also verified initial dialog focus, modal background blocking, Tab staying inside the modal, Escape/cancel closure and opener-focus restoration. No database, paid model, invitation, deletion or customer mutation was performed.
- Screenshots in the task conversation were visually reviewed at the browser's normal desktop viewport in light and dark themes, and with a temporary 390x844 narrow viewport. A first narrow-screen check found page overflow (592px against a 375px content viewport). Setting the mobile main region to full width corrected it: page and viewport both 375px; the wider 562px case table scrolls inside its container. Case details also opened at that size. The viewport override was reset.
- Shared modals and drawers now use the native modal dialog layer with an accessible name, contained focus, initial focus, Escape/backdrop closure where allowed and opener-focus restoration. The shared error state distinguishes a service connection failure from application errors and exposes retry/help actions. Project search scopes responses to the current project and query, ignores late responses, and presents an actionable failure/retry state. This is not a complete screen-reader or accessibility conformance audit.

## Remaining gates and next work

The signed-in shell and project recovery state were browser-reviewed, but the local API on port 4000 was not running, so connected dashboard/project-card workflows were not accepted against an organization. The screen now reports this as `Unable to reach Vaettir` instead of exposing `Failed to fetch`. Existing dashboard/onboarding E2E selectors and a non-mutating deletion-confirmation regression were updated, but the authenticated suite was not run. A running isolated API/database plus the dedicated test identity are still needed. The Clerk prebuilt component variables and surrounding sign-in/sign-up layout were aligned to the B2B tokens, but a fresh signed-out visual review was not possible after the current browser became signed in. Deeper case editors and organization settings have not received a complete interaction review.

James should review the local example's layout, information density, typography and light/dark direction before this visual language is expanded through the deeper workflows. Follow with authenticated/role-specific visual regression and keyboard/screen-reader review, not just screenshots of sample data. Phone browser emulation is not native Android/iOS acceptance.

No production build, Linux/native packaging, cloud configuration, deployment, parser candidate adoption, advisory exception, spending or release/security approval was performed. The private-beta register remains HOLD.
