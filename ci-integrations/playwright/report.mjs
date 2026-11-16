#!/usr/bin/env node
// Preserve the defaults used by the Playwright reporter.
process.env.VAETTIR_CI_PROVIDER ??= "playwright";
await import("../report-junit-evidence.mjs");
