import { chromium, type Browser } from "playwright";
import { assertPublicHttpUrl, UnsafeUrlError } from "./urlGuard.js";

// SSE-181: the crawling half of live-app test generation - discovers what's
// actually on a page (title, interactive elements, same-origin links)
// without inventing anything, mirroring the same "ground truth, not a
// guess" principle the reverse-engineering loop already uses for source
// code. The AI-generation half (turning this into BDD cases) lives in
// @vaettir/ai-agent's generateTestCasesFromLiveApp, kept separate exactly
// like repoScan.ts (file discovery) and reverseEngineer.ts (the AI call)
// already are for the source-code path.
//
// NOT LIVE-VERIFIED: this environment has no Chromium binary installed and
// no way to run one (no display, no `playwright install` network access
// exercised here) - written carefully against Playwright's documented API,
// typechecked, but never actually launched against a real page. Flagged
// the same way this codebase already flags every other capability that
// couldn't be exercised live (Expo/mobile device runs, Docker-less builds).
// The production Dockerfile needs `npx playwright install --with-deps
// chromium` added before this can run in production either - not done in
// this pass, a real follow-up.

export class LiveAppScanError extends Error {}

// Deliberately tiny for a first pass: the crawl is scoped to the starting
// URL plus its own same-origin links, capped hard, so a real crawl session
// (and its real AI-generation cost, see AI_OPERATION_COSTS.generateTestCasesFromLiveApp)
// can't balloon into an unbounded site-wide scan on the very first version.
const MAX_PAGES = 5;
const NAVIGATION_TIMEOUT_MS = 15_000;

export interface ScannedElement {
  role: string; // e.g. "button", "link", "textbox" - from the accessibility tree
  name: string; // the accessible name (label/text), truncated
}

export interface ScannedPage {
  url: string;
  title: string;
  elements: ScannedElement[];
}

export interface LiveAppScanResult {
  startUrl: string;
  pages: ScannedPage[];
}

// Uses getByRole for each role of interest rather than the newer aria-
// snapshot APIs (ariaSnapshot/ariaSnapshotJSON) - getByRole has been
// stable across many Playwright versions and its return shape (a Locator
// you can call .all()/.innerText() on) is simple and well-documented,
// which matters here since none of this can be exercised against a real
// browser in this environment (see the file-level comment) - preferring
// the API least likely to have subtly changed shape under me.
const INTERESTING_ROLES = ["button", "link", "textbox", "checkbox", "radio", "combobox", "menuitem"] as const;

async function extractPageElements(page: import("playwright").Page): Promise<ScannedElement[]> {
  const elements: ScannedElement[] = [];
  for (const role of INTERESTING_ROLES) {
    if (elements.length >= 100) break; // a pathological page shouldn't blow up the prompt this feeds
    const locators = await page.getByRole(role).all();
    for (const locator of locators.slice(0, 100 - elements.length)) {
      let name = "";
      try {
        name = (await locator.innerText({ timeout: 1000 })).trim();
      } catch {
        // no text content (e.g. an icon-only button) - fall back to the
        // accessible name via aria-label, which innerText won't see.
      }
      if (!name) {
        try {
          name = (await locator.getAttribute("aria-label")) ?? "";
        } catch {
          // element detached mid-scan or similarly transient - skip it,
          // don't fail the whole scan over one flaky element.
        }
      }
      if (name) elements.push({ role, name: name.slice(0, 200) });
    }
  }
  return elements;
}

async function extractSameOriginLinks(page: import("playwright").Page, origin: string): Promise<string[]> {
  // Typed loosely (not against DOM lib types) so this compiles the same way
  // regardless of which tsconfig ends up checking it - the callback runs in
  // the browser, never in this process, so it doesn't need to match this
  // package's own lib configuration.
  const hrefs = await page.locator("a[href]").evaluateAll((anchors: unknown[]) => anchors.map((a) => (a as { href: string }).href));
  const seen = new Set<string>();
  const links: string[] = [];
  for (const href of hrefs) {
    try {
      const url = new URL(href);
      if (url.origin !== origin) continue;
      url.hash = "";
      const key = url.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(key);
    } catch {
      // malformed href on the page itself - not our bug, just skip it
    }
  }
  return links;
}

// Crawls startUrl and up to MAX_PAGES-1 same-origin links found on it.
// Every URL (the starting one and every discovered link) goes through the
// same SSRF-hardened public-URL guard every other server-side URL fetch in
// this codebase already uses - a discovered internal-looking link is
// silently skipped, not followed, rather than erroring the whole scan.
export async function scanLiveApp(startUrlRaw: string): Promise<LiveAppScanResult> {
  const startUrl = await assertPublicHttpUrl(startUrlRaw);

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: "VaettirLiveAppScan/1.0" });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);

    const toVisit = [startUrl.toString()];
    const visited = new Set<string>();
    const pages: ScannedPage[] = [];

    while (toVisit.length > 0 && pages.length < MAX_PAGES) {
      const url = toVisit.shift() as string;
      if (visited.has(url)) continue;
      visited.add(url);

      let response;
      try {
        response = await page.goto(url, { waitUntil: "domcontentloaded" });
      } catch (err) {
        // A single unreachable page shouldn't fail the whole scan - the
        // start URL itself failing is different (see below), but a link
        // discovered ON the start page going nowhere is just noise.
        if (url === startUrl.toString()) {
          throw new LiveAppScanError(`Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`);
        }
        continue;
      }
      if (url === startUrl.toString() && (!response || !response.ok())) {
        throw new LiveAppScanError(`${url} responded with ${response?.status() ?? "no response"}.`);
      }

      const [title, elements, links] = await Promise.all([
        page.title(),
        extractPageElements(page),
        extractSameOriginLinks(page, startUrl.origin),
      ]);
      pages.push({ url, title, elements });

      for (const link of links) {
        if (pages.length + toVisit.length >= MAX_PAGES) break;
        try {
          await assertPublicHttpUrl(link);
          if (!visited.has(link)) toVisit.push(link);
        } catch (err) {
          if (err instanceof UnsafeUrlError) continue; // silently skip, don't fail the scan
          throw err;
        }
      }
    }

    return { startUrl: startUrl.toString(), pages };
  } finally {
    await browser?.close();
  }
}
