// Read-only evidence linkage. This never installs a package or executes a probe.
import { accepted } from "../final-application-release-v1/admission.mjs";
import {
  jsonRef,
  readRef,
  same,
  requireThat as ok,
} from "../production-native-successor-v1/contracts.mjs";
export const pins = Object.freeze({
  packageSha256:
    "e8621e3109bd33ee9f454ecb97d05c758c201b2adc5da4d69c856a1ea112b67f",
  controlSha256:
    "e792872ca42a4771f90d2a4f9f0c6eaed4f3a3bbbe6e6c086d41be9f36bdb17c",
  controlReviewSha256:
    "bf679ab40926481d594cc0bae91649ac22e65cf98b9b5b9f4444b4d87eb6fb56",
  api: {
    observation:
      "47f5247cbc51085e4fcfad17a05ada98e5d04313760235795e690770db2c94e9",
    review: "26991e19750946269e84a499a8dea5bb3847ea11c80dc1d84db4b70d386e2bd3",
  },
  web: {
    observation:
      "4a48afd17da7f449b8a6de0fcc70e37edc4e8ed8933f4d5de10a6e76364b9575",
    review: "16622ada3362c2aaeb6253ae23cb0622dbdfa9842cd788941dc26fc73dc62b5b",
  },
});
const issued = new WeakSet();
const keys = [
  "name",
  "status",
  "version",
  "architecture",
  "dependencies",
  "preDepends",
  "triggersAwaited",
  "triggersPending",
];
export function parseStatus(text) {
  ok(
    typeof text === "string" && text.endsWith("\n"),
    "Complete dpkg status capture required",
  );
  const seen = new Set();
  return text
    .slice(0, -1)
    .split("\n")
    .map((line) => {
      const fields = line.split("\t");
      ok(
        fields.length === keys.length && fields[0] && !seen.has(fields[0]),
        "Malformed or duplicate package status",
      );
      seen.add(fields[0]);
      return Object.fromEntries(keys.map((key, i) => [key, fields[i]]));
    });
}
export function checkDependencyRows(before, after) {
  for (const rows of [before, after]) {
    ok(
      Array.isArray(rows) &&
        rows.length > 0 &&
        new Set(rows.map((r) => r.name)).size === rows.length,
      "Missing or duplicate packages",
    );
    for (const row of rows)
      ok(
        same(Object.keys(row).sort(), [...keys].sort()) &&
          row.status === "install ok installed" &&
          row.triggersAwaited === "" &&
          row.triggersPending === "",
        "Incomplete or unresolved package state",
      );
  }
  const a = new Map(before.map((r) => [r.name, r])),
    b = new Map(after.map((r) => [r.name, r]));
  ok(a.size === b.size, "Added or removed package");
  for (const [name, row] of a)
    if (name !== "libsqlite3-0:amd64")
      ok(same(row, b.get(name)), "Unrelated package changed");
  const old = a.get("libsqlite3-0:amd64"),
    next = b.get("libsqlite3-0:amd64"),
    libc = a.get("libc6:amd64");
  ok(
    old &&
      next &&
      libc &&
      libc.version === "2.41-12+deb13u4+vaettir1" &&
      libc.architecture === "amd64" &&
      same(libc, b.get("libc6:amd64")),
    "Exact unchanged installed libc required",
  );
  // Exact version pin supplies the reviewed >=2.41 requirement; no general
  // version comparator, alternative dependency or future version admission.
  ok(
    old.version === "3.46.1-7+deb13u2" &&
      old.dependencies === "libc6 (>= 2.38)" &&
      old.architecture === "amd64" &&
      old.preDepends === "" &&
      next.version === "3.54.1-0+vaettir1" &&
      next.dependencies === "libc6 (>= 2.41)",
    "Unknown SQLite package transition",
  );
  ok(
    same(
      { ...old, version: next.version, dependencies: next.dependencies },
      next,
    ),
    "Other SQLite control field changed",
  );
  return true;
}
export function validateRetainedObservation(o, role) {
  ok(
    o.role === role &&
      o.observationComplete === true &&
      o.nativeCommandsPassed === true &&
      o.installAttempted === true &&
      o.error === null,
    "Incomplete actual transaction",
  );
  const commands = o.commands;
  ok(
    Array.isArray(commands) &&
      commands.length === 13 &&
      commands.every(
        (c) => c.status === 0 && c.signal === null && c.error === null,
      ),
    "Failed or incomplete native commands",
  );
  const install = commands.filter(
    (c) =>
      c.exe === "/usr/bin/dpkg" &&
      same(c.args, ["--install", "/tmp/vaettir-sqlite-overlay-v1/sqlite.deb"]),
  );
  ok(
    install.length === 1 &&
      commands.filter(
        (c) => c.exe === "/usr/bin/dpkg" && c.args[0] !== "--audit",
      ).length === 1,
    "Missing, forced or repeated install",
  );
  const before = parseStatus(o.beforeState.status),
    after = parseStatus(o.afterState.status);
  checkDependencyRows(before, after);
  for (const state of [o.beforeState, o.afterState])
    ok(
      state.audit === "" && same(state.updates, []),
      "Unresolved raw dpkg state",
    );
  ok(
    o.beforeState.loader === o.afterState.loader &&
      typeof o.beforeState.loader === "string" &&
      o.beforeState.loader.length > 0,
    "Raw loader mappings changed",
  );
  return { before, after };
}
export function readPackageEvidence(ref, role, imageDigest, refs, read) {
  ok(
    Object.hasOwn(pins, role) && ["api", "web"].includes(role),
    "Unknown package role",
  );
  const v = accepted(ref, read, "FINAL_PACKAGE_TRANSITION");
  ok(
    v.role === role &&
      v.imageDigest === imageDigest &&
      v.packagesBeforeSha256 === refs.packagesBefore.sha256 &&
      v.packagesAfterSha256 === refs.packagesAfter.sha256,
    "Unbound final package transition",
  );
  ok(
    v.package.sha256 === pins.packageSha256 &&
      v.package.bytes === 758036 &&
      v.control.sha256 === pins.controlSha256 &&
      v.control.bytes === 409 &&
      v.controlReview.sha256 === pins.controlReviewSha256,
    "Different accepted package/control",
  );
  readRef(v.package, read);
  readRef(v.control, read);
  const control = jsonRef(v.controlReview, read);
  ok(
    control.accepted === true &&
      control.independentReview === true &&
      control.scope === "EXACT_ACCEPTED_PACKAGE_CONTROL_DEPENDENCY_REVIEW" &&
      control.package.sha256 === pins.packageSha256 &&
      control.controlSha256 === pins.controlSha256 &&
      control.fields.Depends === "libc6 (>= 2.41)" &&
      !Object.hasOwn(control.fields, "Pre-Depends") &&
      control.noCustomMaintainerScripts === true,
    "Unreviewed package control",
  );
  ok(
    v.observation.sha256 === pins[role].observation &&
      v.transactionReview.sha256 === pins[role].review,
    "Different actual transaction",
  );
  const review = accepted(v.transactionReview, read, "SQLITE_TRANSACTION_ONLY");
  ok(
    review.role === role &&
      review.observedTransactionSha256 === v.observation.sha256,
    "Wrong transaction review binding",
  );
  const o = jsonRef(v.observation, read, 512 * 1024 ** 2),
    rows = validateRetainedObservation(o, role);
  for (const values of Object.values(rows)) {
    values.forEach(Object.freeze);
    Object.freeze(values);
  }
  const evidence = Object.freeze({ ...rows, role, imageDigest });
  issued.add(evidence);
  return evidence;
}
export function verifyDependencyChange(before, after, evidence) {
  ok(
    evidence && issued.has(evidence),
    "Read and independently reviewed package evidence required",
  );
  ok(
    same(before.packages, evidence.before) &&
      same(after.packages, evidence.after),
    "Final package state differs from reviewed raw transaction",
  );
  return checkDependencyRows(before.packages, after.packages);
}
