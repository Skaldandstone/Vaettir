import { requireThat, index, same, hex } from "./contracts.mjs";
const validPath = (p) =>
  typeof p === "string" &&
  p.startsWith("/") &&
  !p.includes("\\") &&
  !p.includes("//") &&
  !p.split("/").some((s) => s === "." || s === "..");
function entries(rows) {
  const result = index(rows);
  for (const row of rows) {
    requireThat(
      validPath(row.path) &&
        ["file", "directory", "symlink"].includes(row.type) &&
        Number.isInteger(row.mode) &&
        row.mode >= 0 &&
        row.mode <= 0o7777 &&
        Number.isSafeInteger(row.uid) &&
        row.uid >= 0 &&
        Number.isSafeInteger(row.gid) &&
        row.gid >= 0,
      "Invalid filesystem observation",
    );
    if (row.type === "file")
      requireThat(
        hex(row.sha256) && Number.isSafeInteger(row.bytes) && row.bytes >= 0,
        "Missing file content",
      );
    if (row.type === "symlink")
      requireThat(typeof row.target === "string", "Missing link target");
  }
  return result;
}
export function exactDelta(before, after) {
  const a = entries(before),
    b = entries(after),
    rows = [];
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort())
    if (!same(a.get(path), b.get(path)))
      rows.push({
        path,
        before: a.get(path) ?? null,
        after: b.get(path) ?? null,
      });
  return rows;
}
export function verifyOverlay(before, after, review, policy) {
  requireThat(
    review.accepted === true &&
      review.independentReview === true &&
      review.scope === "SQLITE_TRANSACTION_ONLY" &&
      hex(review.observedTransactionSha256),
    "An independently reviewed actual transaction is required",
  );
  const actual = exactDelta(before, after);
  requireThat(
    same(actual, review.changes),
    "Unexpected filesystem change; collect a new observation, never expand exceptions automatically",
  );
  requireThat(actual.length > 0, "Missing genuine SQLite delta");
  for (const row of actual) {
    requireThat(
      !row.path.includes("*") && !row.path.endsWith("/"),
      "Exact leaf paths only",
    );
    const category = review.categories[row.path];
    if (category === "sqlite-payload")
      requireThat(
        policy.sqlitePayloadPaths.includes(row.path),
        "Unapproved SQLite payload path",
      );
    else if (category === "verification")
      requireThat(
        policy.sqliteProofPaths.includes(row.path),
        "Unapproved verification path",
      );
    else if (category === "package-document-removal")
      requireThat(
        row.before &&
          !row.after &&
          row.path.startsWith("/usr/share/doc/libsqlite3-0/") &&
          review.packageOwnedRemovalPaths.includes(row.path),
        "Unproven package document removal",
      );
    else if (category === "dpkg-transaction")
      requireThat(
        [
          "/var/lib/dpkg/status",
          "/var/lib/dpkg/status-old",
          "/etc/ld.so.cache",
          "/var/log/dpkg.log",
          "/var/lib/dpkg/triggers/ldconfig",
        ].includes(row.path) ||
          /^\/var\/lib\/dpkg\/info\/libsqlite3-0:amd64\.(list|md5sums|shlibs|symbols|triggers|postinst|postrm)$/.test(
            row.path,
          ),
        "Unapproved package transaction leaf",
      );
    else requireThat(false, "Unclassified change");
    if (row.path === "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0")
      requireThat(
        row.after?.type === "symlink" &&
          row.after.target === "libsqlite3.so.0.8.6",
        "SQLite SONAME link changed",
      );
  }
  requireThat(
    Object.keys(review.categories).length === actual.length,
    "Unused ledger exceptions forbidden",
  );
  const library = after.find(
    (r) => r.path === "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6",
  );
  requireThat(
    library?.sha256 === policy.sqliteAccepted.librarySha256,
    "Overlay did not retain the accepted library bytes",
  );
  return actual;
}
export function verifyPackageState(before, after, librarySha256) {
  const a = index(before.packages, "name"),
    b = index(after.packages, "name");
  requireThat(
    a.size === b.size && a.has("libsqlite3-0:amd64"),
    "Package inventory changed",
  );
  for (const [name, row] of a)
    if (name !== "libsqlite3-0:amd64")
      requireThat(same(row, b.get(name)), "Unrelated package metadata changed");
  const old = a.get("libsqlite3-0:amd64"),
    next = b.get("libsqlite3-0:amd64");
  requireThat(
    next &&
      next.status === "install ok installed" &&
      next.version === "3.54.1-0+vaettir1" &&
      same(old.dependencies, next.dependencies),
    "SQLite ownership/dependency state invalid",
  );
  requireThat(
    after.audit === "" &&
      after.pendingTriggers.length === 0 &&
      after.updates.length === 0 &&
      after.transactionLockHeld === false,
    "Package transaction is not clean",
  );
  const loaderA = index(before.loader, "key"),
    loaderB = index(after.loader, "key");
  requireThat(loaderA.size === loaderB.size, "Loader cache inventory changed");
  for (const [key, row] of loaderA) {
    if (row.soname !== "libsqlite3.so.0")
      requireThat(
        same(row, loaderB.get(key)),
        "Unrelated loader mapping changed",
      );
    else {
      const next = loaderB.get(key);
      requireThat(
        next &&
          next.path === row.path &&
          next.soname === row.soname &&
          next.sha256 === librarySha256 &&
          hex(librarySha256),
        "SQLite loader destination/content changed",
      );
    }
  }
  requireThat(
    [...loaderB.values()].some((row) => row.soname === "libsqlite3.so.0"),
    "Missing SQLite loader mapping",
  );
  return true;
}
export function verifyConsumers(actual, expected) {
  const a = index(actual),
    b = index(expected);
  requireThat(a.size === b.size, "Missing or new SQLite consumer");
  for (const [path, row] of b)
    requireThat(
      same(a.get(path), row),
      "Consumer bytes/imports/dynamic lookups changed",
    );
  for (const row of actual)
    requireThat(
      hex(row.sha256) &&
        Array.isArray(row.undefinedSQLiteSymbols) &&
        Array.isArray(row.dynamicSQLiteSymbols),
      "Incomplete static/dynamic consumer observation",
    );
  return true;
}
