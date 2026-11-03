// Deterministic source derivation only; never execute generated operators.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { successorRoot, checkParent } from "./admission.mjs";
import { replaceExact } from "../final-application-producers-v1/adapters.mjs";
import { sha } from "../production-native-successor-v1/contracts.mjs";
export function derive() {
  checkParent();
  const files = {}, rows = [];
  for (const name of [
    "normalize.derived.mjs", "normalizer-regression.test.mjs", "minimal.test.mjs",
    "release-admission.derived.mjs", "release-context.derived.mjs",
    "native-probe-context.derived.mjs", "seal-runtime.derived.mjs",
    "operator-contracts.derived.py", "derive-operators.derived.py",
    "output-producer.mjs", "produce.mjs",
  ]) {
    const original = "final-application-minimal-delta-v1/" + name;
    const raw = readFileSync(resolve(successorRoot, "..", original));
    let s = raw.toString();
    const edit = (a, b) => { s = replaceExact(s, a, b); };
    if (name === "normalize.derived.mjs") {
      edit("export function normalizeInventory(raw) {", `// Linux inventory names are data, never host/artifact/source references.
// Reject drive-like components even below a prefix; never decode or rewrite names.
export function posixInventoryName(path) {
  return typeof path === "string" && path.length < 1024 &&
    !path.includes("\\0") && !path.includes("\\\\") && !path.startsWith("/") &&
    path.split("/").every(x => x && x !== "." && x !== ".." && !/^[A-Za-z]:/.test(x));
}
export function normalizeInventory(raw) {`);
      edit('ok(relative(r.path) && !by.has(r.path), "Unsafe/duplicate raw path");',
        'ok(posixInventoryName(r.path) && !by.has(r.path), "Unsafe/duplicate raw path");');
      edit('ok(relative(r.link), "Unsafe hardlink target");',
        'ok(posixInventoryName(r.link), "Unsafe hardlink target");');
    }
    if (name === "minimal.test.mjs") {
      edit("successorRoot, admitMinimalDeltaSource", "successorRoot, admitPosixInventorySource");
      edit("Object.keys(r.files).length, 10", "Object.keys(r.files).length, 11");
      edit("admitMinimalDeltaSource(null", "admitPosixInventorySource(null");
    }
    if (name === "release-admission.derived.mjs") {
      edit('import {admitMinimalDeltaSource} from "./admission.mjs";',
        'import {admitMinimalDeltaSource} from "../final-application-minimal-delta-v1/admission.mjs";\nimport {admitPosixInventorySource} from "./admission.mjs";');
      edit("  admitMinimalDeltaSource(b.minimalDelta, io.read);",
        "  admitMinimalDeltaSource(b.minimalDelta, io.read);\n  admitPosixInventorySource(b.posixInventory, io.read);");
    }
    if (name === "operator-contracts.derived.py") {
      edit("assert MINIMAL_PACKAGE not in (O,SOURCE_PACKAGE,PRODUCER_PACKAGE,WEB_LEAF_PACKAGE,DEPENDENCY_PACKAGE)",
        "assert MINIMAL_PACKAGE not in (O,SOURCE_PACKAGE,PRODUCER_PACKAGE,WEB_LEAF_PACKAGE,DEPENDENCY_PACKAGE)\nPOSIX_PACKAGE=Path(CONFIG['posixInventoryPackage']).resolve()\nassert POSIX_PACKAGE not in (O,SOURCE_PACKAGE,PRODUCER_PACKAGE,WEB_LEAF_PACKAGE,DEPENDENCY_PACKAGE,MINIMAL_PACKAGE)");
      edit("'packageDependency','minimalDelta')", "'packageDependency','minimalDelta','posixInventory')");
      edit("    input_path=ref(CONFIG['bindings']) if phase=='source' else D/(phase+'-bindings.json')", `    posix_review=read(ref(b['posixInventory']['approval']))
    assert posix_review['accepted'] is True and posix_review['independentReview'] is True
    assert posix_review['scope']=='FINAL_APPLICATION_POSIX_INVENTORY_SOURCE' and posix_review['manifestSha256']==b['posixInventory']['manifest']['sha256']
    for row in read(ref(b['posixInventory']['manifest']))['files']:
        p=POSIX_PACKAGE/row['path'];assert p.resolve().is_relative_to(POSIX_PACKAGE) and not p.is_symlink()
        assert p.stat().st_size==row['bytes'] and file_sha(p)==row['sha256']
    input_path=ref(CONFIG['bindings']) if phase=='source' else D/(phase+'-bindings.json')`);
      edit("str(MINIMAL_PACKAGE/'release-context.derived.mjs')", "str(POSIX_PACKAGE/'release-context.derived.mjs')");
    }
    if (name === "derive-operators.derived.py") {
      edit("MINIMAL_HERE=Path(__file__).resolve().parent", "POSIX_HERE=Path(__file__).resolve().parent\nMINIMAL_HERE=POSIX_HERE.parent/'final-application-minimal-delta-v1'");
      edit("(MINIMAL_HERE/'operator-contracts.derived.py')", "(POSIX_HERE/'operator-contracts.derived.py')");
      edit("str(MINIMAL_HERE/'release-context.derived.mjs')", "str(POSIX_HERE/'release-context.derived.mjs')");
      edit("def render(config,source):", "def render(config,source):\n    assert Path(config['posixInventoryPackage']).resolve()==POSIX_HERE.resolve()");
    }
    files[name] = Buffer.from(s);
    rows.push({name, original, parentSha256: sha(raw), candidateSha256: sha(files[name]), changed: !raw.equals(files[name])});
  }
  return {files, rows};
}
