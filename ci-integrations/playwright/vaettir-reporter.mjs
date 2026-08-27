// P5-15: a Playwright reporter that captures failure evidence without ever
// uploading a passing run's screenshot/video -- Playwright's own
// screenshot/video config (`screenshot: 'only-on-failure'`,
// `video: 'retain-on-failure'`) already handles "capture always, discard
// unless failed" natively, so this reporter's job is just relaying
// whatever Playwright already attached to a FAILED result, not
// reimplementing capture itself.
//
// Deliberately does NOT rely on Playwright's own built-in JUnit reporter's
// classname/name format (which varies by version and isn't documented as a
// stable contract) -- this reporter builds its own JUnit XML from the same
// test data it uses to build the artifact manifest, so the two are
// guaranteed consistent with each other rather than depending on two
// separate tools deriving matching identifiers independently.
//
// Writes two files at the end of the run (paths configurable via reporter
// options): a JUnit XML for testRuns.ingestJUnit, and a manifest listing
// failed tests' attachment files for report.mjs to upload afterward.
import { writeFileSync } from "node:fs";
import { relative } from "node:path";

function xmlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Matches the "<classname>::<name>" shape testRuns.ingestJUnit's parser
// reads off a real <testcase file="..." classname="..." name="...">
// element -- classname is the file path (stable, not testRunId), name is
// the full describe/it title path (so two tests in the same file/describe
// with different names still produce distinct externalTestIds).
function externalTestId(test) {
  const classname = relative(process.cwd(), test.location.file).replace(/\\/g, "/");
  // test.titlePath() includes a leading project-name entry (and sometimes
  // an extra empty segment depending on Playwright version) before the
  // describe/title segments -- filtering blanks rather than slicing a
  // fixed count is what keeps this stable across versions instead of
  // guessing how many leading entries to skip.
  const name = test.titlePath().filter(Boolean).join(" > ").trim();
  // Trimmed to match exactly how testRuns.ingestJUnit's parser reads the
  // `name` XML attribute (also trimmed) -- report.mjs's manifest lookup
  // and the server's own externalTestId construction must agree on
  // whitespace or a real match silently misses.
  return { classname, name, externalTestId: `${classname}::${name}` };
}

export default class VaettirReporter {
  constructor(options = {}) {
    this.junitPath = options.junitPath ?? "vaettir-junit.xml";
    this.manifestPath = options.manifestPath ?? "vaettir-artifacts-manifest.json";
    this.cases = [];
    this.manifest = [];
  }

  onTestEnd(test, result) {
    const { classname, name, externalTestId: id } = externalTestId(test);
    const status = result.status === "passed" ? "PASS" : result.status === "skipped" ? "SKIP" : "FAIL";

    this.cases.push({ classname, name, status, durationMs: result.duration, error: result.error?.message });

    if (status === "FAIL") {
      const files = result.attachments
        .filter((a) => a.path && (a.contentType?.startsWith("image/") || a.contentType?.startsWith("video/")))
        .map((a) => ({ path: a.path, type: a.contentType.startsWith("video/") ? "VIDEO" : "SCREENSHOT" }));
      if (files.length > 0) this.manifest.push({ externalTestId: id, files });
    }
  }

  onEnd() {
    const testcases = this.cases
      .map((c) => {
        const attrs = `classname="${xmlEscape(c.classname)}" name="${xmlEscape(c.name)}" time="${(c.durationMs / 1000).toFixed(3)}"`;
        if (c.status === "PASS") return `<testcase ${attrs}/>`;
        if (c.status === "SKIP") return `<testcase ${attrs}><skipped/></testcase>`;
        return `<testcase ${attrs}><failure message="${xmlEscape(c.error ?? "Test failed")}"/></testcase>`;
      })
      .join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n<testsuite name="playwright">\n${testcases}\n</testsuite>\n</testsuites>\n`;

    writeFileSync(this.junitPath, xml, "utf8");
    writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2), "utf8");
  }
}
