# Vaettir - Brand & Style Guide

## Application UI direction, August 31, 2026

James requested a distinct B2B product interface rather than the decorative styles of the other studio products. The web application now uses a graphite navigation rail, light neutral working canvas, compact sans-serif hierarchy, and restrained green action color. This application-specific direction supersedes the marketing color, heading, grain, and control treatments below **inside `apps/web` only**. The lowercase wordmark and canonical five-line rune are unchanged; the serif remains in the brand mark rather than operational headings. Marketing reference material and mobile are not restyled by this change.

- Default application theme: light, with a matching graphite dark theme. Previously stored `warm` preferences resolve to light; stored dark preferences remain dark. Theme persistence is optional if storage is blocked.
- Working surfaces: white/light or graphite/dark panels, subtle one-pixel borders, five-to-seven-pixel control/panel corners, compact readable rows, explicit focus outlines, and text labels accompanying status colors.
- Semantic colors: green for passing/ready, amber for risk/pending, red for blocked/failed, violet for AI suggestions, neutral for not evaluated. Brand accents are not a substitute for semantic status.
- Layout: persistent desktop navigation; horizontally scrollable navigation on narrow screens; local scrolling inside wide tables rather than expanding the page. Display counts come from their actual source, not fabricated health signals.
- Shared implementation: `components/ui/Workspace.tsx`, `app/globals.css`. Page headings, metric cards, status pills, functional icons and empty states are reused by the example workspace and connected screens.
- The root example workspace is explicitly synthetic. Its cases, execution outcomes, AI review actions and release gates do not read or write customer data. Real projects and the organization dashboard retain their authenticated APIs and permission controls. It is not a sign-off bypass or live release-health claim.

See [B2B interface implementation and review](docs/private-beta/b2b-interface.md) for the slice delivered and verification boundaries. The rest of this document remains the historical marketing identity reference, not an instruction to restore grain/serif headings throughout the B2B app.

Reference implementation: `vaettir-landing.html` (single-file HTML/CSS/JS prototype).
Everything below is extracted directly from that file - treat it as the source of truth
if the two ever drift.

---

## 1. Name & voice

**Product name / wordmark / URLs:** always lowercase, no diacritic - `vaettir`
(e.g. nav logo, footer, domain, all-caps stylized label `VAETTIR`).

**Mythological reference in running prose or quotes:** capitalized, with the diacritic -
`Vættir` (e.g. "warn the Vættir before disturbing the ground").

Rule of thumb: if it's functioning as the brand mark, it's `vaettir`. If it's a sentence
talking *about* the old word/concept, it's `Vættir`.

**Pronunciation:** `/VAY-tir/` - surface this near the wordmark on first mention (nav
eyebrow, footer strip) since it's not a guessable pronunciation for most readers.

### Tagline
Primary (in use): **"Every place has its guardians. So does your codebase."**

Reserve variants (approved, not yet used - swap in later if needed):
- "Every place has its guardians. So does your code."
- "The old stories say every place has its guardians. Yours does too."
- "Every place has its guardians. Vaettir is yours."

### Signature line
This exact line is locked and should not be reworded:

> "The old custom was to warn the Vættir before disturbing the ground. We think your
> code deserves the same respect."

### Feature framing: WARD / WITNESS / WARN
Three-part structure mapping real product functionality onto guardian language.
Keep the verbs in this order - they read as an escalating sequence (protect → observe →
alert):

| Label | Real function | Copy in use |
|---|---|---|
| **WARD** | Organize test cases / suites / coverage | "Organize what matters" |
| **WITNESS** | Execution history & results | "See every run clearly" |
| **WARN** | Traceability & alerting | "Know before it ships" |

### Tone
Quiet confidence, not hype. Short declarative sentences. The folklore is a texture, not
a gimmick - never write copy that requires the reader to already know Norse mythology to
follow it. Every mythic reference should be legible on its own (the tagline and the
signature line both work without prior knowledge of what a vættr is).

---

## 2. Color system

Implemented as CSS custom properties, swapped via `[data-theme="warm"]` /
`[data-theme="dark"]` on `<html>`. **`warm` is the default theme** - it should load
first on every page unless the user has an explicit stored preference.

### Warm (default)
```css
--ink:        #26211B;  /* page background */
--panel:      #2E2820;  /* section background (principles grid) */
--panel-2:    #332C23;  /* secondary section background (pron strip) */
--line:       #443B2F;  /* hairline borders/dividers */
--fg:         #F3ECDF;  /* primary text */
--muted:      #B8A88D;  /* secondary text */
--muted-dim:  #7C7059;  /* tertiary/caption text, citations */
--frost:      #8FA37A;  /* primary accent - moss green (buttons, links, rune mark) */
--frost-dim:  rgba(143, 163, 122, 0.12);
--ember:      #BE6A3E;  /* secondary accent - rust/ember (used sparingly, e.g. the
                            "warn the Vættir" highlight in the signature line) */
--ember-dim:  rgba(190, 106, 62, 0.12);
```

### Dark (toggle alt)
```css
--ink:        #121110;
--panel:      #1A1815;
--panel-2:    #1F1C18;
--line:       #322D26;
--fg:         #F0EAE0;
--muted:      #A79A85;
--muted-dim:  #675E4E;
--frost:      #9DB588;  /* brightened vs. warm theme for contrast on near-black */
--frost-dim:  rgba(157, 181, 136, 0.12);
--ember:      #D07A46;  /* brightened vs. warm theme for contrast on near-black */
--ember-dim:  rgba(208, 122, 70, 0.12);
```

**Usage rules:**
- `--frost` (moss) is the primary interactive/accent color - CTAs, links, the rune
  mark, numbered labels (WARD/WITNESS/WARN).
- `--ember` (rust) is a highlight color used sparingly - currently only inside the
  signature quote line. Don't promote it to a second primary color; it should stay rare
  enough to carry weight when it appears.
- All color transitions on theme swap are `0.25s ease` on `background`, `color`, and
  `stroke`. Keep new components consistent with this.
- Never hardcode hex values in new markup - always reference the CSS variables so theme
  swapping keeps working.

---

## 3. Typography

Loaded via Google Fonts:
```
Fraunces (weights 300, 500, 600 + italic 400) - display
Inter (weights 400, 500, 600) - body/UI
JetBrains Mono (weights 400, 500) - labels, eyebrows, captions, numbered markers
```

| Role | Face | Notes |
|---|---|---|
| Wordmark / H1 / H3 headings | Fraunces, weight 500 | Italic + weight 300 used for the softened second line of the hero H1 |
| Body copy, nav, buttons | Inter | 400–600 weight range |
| Eyebrows, pronunciation strip, WARD/WITNESS/WARN labels, citations | JetBrains Mono | Always uppercase, letter-spacing 0.06–0.09em |
| Lore/signature quote | Fraunces italic, weight 400, 28px | The one place italic serif is used at body-copy size - reserve this treatment for lore-style quotes only |

**Scale reference (desktop):** H1 58px / H3 23px / body 17px / nav & buttons 14–14.5px /
mono labels 12–12.5px. Mobile H1 drops to 38px (see `@media (max-width: 760px)`).

---

## 4. Signature mark (the rune)

A custom line-drawn glyph inspired by *Algiz* (ᛉ), the Elder Futhark protection rune -
intentionally redrawn as a simple 5-line mark rather than using the literal Unicode
character, so it reads as a designed logomark, not a font glyph.

```svg
<svg viewBox="0 0 40 40">
  <line x1="20" y1="4"  x2="20" y2="36"/>
  <line x1="20" y1="14" x2="34" y2="4"/>
  <line x1="20" y1="14" x2="6"  y2="4"/>
  <line x1="20" y1="24" x2="34" y2="34"/>
  <line x1="20" y1="24" x2="6"  y2="34"/>
</svg>
```
Stroke: `var(--frost)`, `stroke-width: 6` at small (nav, 20px) sizes,
`stroke-width: 0.6` at large decorative sizes, always `stroke-linecap: round`,
`fill: none`.

**Two approved uses:**
1. **Nav mark** - small, full opacity, next to the wordmark.
2. **Hero background mark** - huge (640px), opacity 0.05, centered behind the hero copy
   as ambient texture. Never render it at full opacity at large scale - it should stay
   subliminal, not decorative-obvious.

Don't introduce a second logo variant without checking with design first - the mark is
meant to stay singular and consistent (see: one signature element, not scattered
motifs).

---

## 5. Components

- **Buttons:** `border-radius: 3px` everywhere (not fully rounded, not sharp) - primary
  fills with `--frost`, secondary is outline-only with `--line` border.
- **Dividers/borders:** always `1px solid var(--line)`, never a heavier weight.
- **Grain texture:** a fixed, full-viewport SVG turbulence overlay at `opacity: 0.05`,
  `z-index: 1`, `pointer-events: none`. This is a deliberate texture choice (evokes
  stone/parchment) - keep it subtle; if it ever needs to scale up for a different
  background, don't exceed ~0.08 opacity or it starts reading as noise/bug rather than
  texture.
- **Theme toggle:** lives in the nav, right-aligned next to the primary CTA. Shows the
  current theme name in lowercase mono text plus a small colored dot (ember when warm
  is active, moss when dark is active - i.e., the dot always shows the *accent color of
  the theme you'd switch away from*, a small piece of intentional misdirection worth
  preserving or deliberately changing, not accidentally flipping).
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` disables all
  transitions/animations - keep this in any expanded component set.

---

## 6. What's already ruled out (naming)

For context if Claude Code (or anyone) revisits naming: dozens of alternative names were
checked and rejected for trademark/product collisions before landing on Vaettir,
including Anneal, Mettle, Temper, Whetstone, Crucible, Thresh, Waypoint, Datum, Sounding,
Warden, Picket, Ward, Herald, Vigil, Seidr, Runa, Vala, Heimdall, Bifrost, Yggdrasil,
Wyrd, and Völva. Billet, Swage, and Escapement also cleared checks but were not chosen.
Don't suggest reverting to any of the rejected names without re-running a real
trademark/domain search - the checks that ruled them out were web-search-based, not
authoritative, but were concrete enough conflicts (active competing products, registered
trademarks) to be treated as settled for now.

---

## 7. Open items / not yet decided

- Formal USPTO TESS trademark search and domain registration for "vaettir" have **not**
  been run yet - this styling work should not be read as confirmation the name is fully
  clear.
- No decision yet on whether the diacritic (`Vættir`) will cause problems in contexts
  that can't render it cleanly (some email clients, plain-text contexts, ASCII-only
  systems). Flag this if it comes up.
- ~~Logo has only been designed as an inline SVG within the page - no standalone
  favicon/app-icon/social-card export has been produced yet.~~ Closed: the app
  (`apps/web`) now ships `app/icon.svg` (browser-tab favicon), `app/apple-icon.tsx`
  (180x180 apple-touch-icon, generated via `next/og`'s `ImageResponse`),
  `app/opengraph-image.tsx` (1200x630 social card, same technique), and
  `app/manifest.ts` (web app manifest referencing the icon routes) - all built
  from the exact same rune mark and coordinates as `components/RuneMark.tsx`,
  not a redrawn variant. The social card's wordmark uses a generic serif
  fallback rather than fetching Fraunces at build time, to keep the Docker
  build free of an external network dependency - vendor a local Fraunces
  file and pass it to `ImageResponse`'s `fonts` option later if exact-face
  fidelity is wanted.
