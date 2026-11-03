// Deterministic source transformation, with no operator invocation.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { successorRoot, checkParent } from "./admission.mjs";
import { replaceExact } from "../final-application-producers-v1/adapters.mjs";
import { sha } from "../production-native-successor-v1/contracts.mjs";
export function derive() {
  checkParent();
  const files = {},
    rows = [];
  for (const name of [
    "transaction-inventory.derived.mjs",
    "native-release-gates.derived.mjs",
    "release-admission.derived.mjs",
    "release-context.derived.mjs",
    "native-probe-context.derived.mjs",
    "seal-runtime.derived.mjs",
    "operator-contracts.derived.py",
    "derive-operators.derived.py",
    "output-producer.mjs",
    "produce.mjs",
  ]) {
    const raw = readFileSync(
      resolve(successorRoot, "../final-application-web-leaf-v1", name),
    );
    let s = raw.toString();
    const edit = (a, b) => {
      s = replaceExact(s, a, b);
    };
    if (name === "transaction-inventory.derived.mjs") {
      edit(
        'from "./aux-cache-review.mjs"',
        'from "../final-application-web-leaf-v1/aux-cache-review.mjs"',
      );
      s =
        'import {verifyDependencyChange} from "./package-transition.mjs";\n' +
        s;
      edit(
        "verifyPackageState(before, after, librarySha256)",
        "verifyPackageState(before, after, librarySha256, dependencyEvidence)",
      );
      edit(
        "same(old.dependencies, next.dependencies)",
        "verifyDependencyChange(before, after, dependencyEvidence)",
      );
      edit('const old = a.get("libsqlite3-0:amd64"),\n    next', 'const next');
    }
    if (name === "release-admission.derived.mjs") {
      edit(
        'from "./admission.mjs"',
        'from "../final-application-web-leaf-v1/admission.mjs"',
      );
      s = 'import {admitDependencySource} from "./admission.mjs";\n' + s;
      edit(
        "  admitWebLeafSource(b.webLeaf, io.read);",
        "  admitWebLeafSource(b.webLeaf, io.read);\n  admitDependencySource(b.packageDependency, io.read);",
      );
    }
    if (
      [
        "native-release-gates.derived.mjs",
        "release-admission.derived.mjs",
      ].includes(name)
    ) {
      s = 'import {readPackageEvidence} from "./package-transition.mjs";\n' + s;
      const native = name === "native-release-gates.derived.mjs";
      const lib = native
        ? "policy.sqliteAccepted.librarySha256"
        : "io.nativePolicy.sqliteAccepted.librarySha256";
      const read = native ? "read" : "io.read";
      edit(
        `    ${lib},\n  );\n  ${native ? "// The auditor" : "ok("}`,
        `    ${lib},\n    readPackageEvidence(refs.packageTransition, role, audit.imageDigest, refs, ${read}),\n  );\n  ${native ? "// The auditor" : "ok("}`,
      );
    }
    if (name === "release-context.derived.mjs")
      edit(
        'from "./apply-application.mjs"',
        'from "../final-application-release-v1/apply-application.mjs"',
      );
    if (name === "produce.mjs")
      edit(
        'from "../final-application-producers-v1/stage-bootstrap.mjs"',
        'from "../final-application-stage-labels-v1/stage-bootstrap.derived.mjs"',
      );
    if (name === "operator-contracts.derived.py") {
      edit(
        "WEB_LEAF_PACKAGE=Path(CONFIG['webLeafPackage']).resolve()",
        "WEB_LEAF_PACKAGE=Path(CONFIG['webLeafPackage']).resolve()\nDEPENDENCY_PACKAGE=Path(CONFIG['packageDependencyPackage']).resolve()\nassert DEPENDENCY_PACKAGE not in (O,SOURCE_PACKAGE,PRODUCER_PACKAGE,WEB_LEAF_PACKAGE)",
      );
      edit(
        "'purpose','producers','webLeaf')",
        "'purpose','producers','webLeaf','packageDependency')",
      );
      edit(
        "    input_path=ref(CONFIG['bindings']) if phase=='source' else D/(phase+'-bindings.json')",
        `    dependency_review=read(ref(b['packageDependency']['approval']))
    assert dependency_review['accepted'] is True and dependency_review['independentReview'] is True
    assert dependency_review['scope']=='FINAL_APPLICATION_PACKAGE_DEPENDENCY_SOURCE' and dependency_review['manifestSha256']==b['packageDependency']['manifest']['sha256']
    for row in read(ref(b['packageDependency']['manifest']))['files']:
        p=DEPENDENCY_PACKAGE/row['path'];assert p.resolve().is_relative_to(DEPENDENCY_PACKAGE) and not p.is_symlink()
        assert p.stat().st_size==row['bytes'] and file_sha(p)==row['sha256']
    input_path=ref(CONFIG['bindings']) if phase=='source' else D/(phase+'-bindings.json')`,
      );
      edit(
        "str(WEB_LEAF_PACKAGE/'release-context.derived.mjs')",
        "str(DEPENDENCY_PACKAGE/'release-context.derived.mjs')",
      );
    }
    if (name === "derive-operators.derived.py") {
      edit(
        "WEB_LEAF_HERE=Path(__file__).resolve().parent",
        "DEPENDENCY_HERE=Path(__file__).resolve().parent\nWEB_LEAF_HERE=DEPENDENCY_HERE.parent/'final-application-web-leaf-v1'",
      );
      edit(
        "(WEB_LEAF_HERE/'operator-contracts.derived.py')",
        "(DEPENDENCY_HERE/'operator-contracts.derived.py')",
      );
      edit(
        "str(WEB_LEAF_HERE/'release-context.derived.mjs')",
        "str(DEPENDENCY_HERE/'release-context.derived.mjs')",
      );
      edit(
        "def render(config,source):",
        "def render(config,source):\n    assert Path(config['packageDependencyPackage']).resolve()==DEPENDENCY_HERE.resolve()",
      );
    }
    files[name] = Buffer.from(s);
    rows.push({
      name,
      parentSha256: sha(raw),
      candidateSha256: sha(files[name]),
      changed: !raw.equals(files[name]),
    });
  }
  return { files, rows };
}
