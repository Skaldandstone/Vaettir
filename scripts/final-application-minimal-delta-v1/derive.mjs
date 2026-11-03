// Pure deterministic derivation; no application build or operator execution.
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
    "normalize.derived.mjs",
    "normalizer-regression.test.mjs",
    "release-admission.derived.mjs",
    "release-context.derived.mjs",
    "native-probe-context.derived.mjs",
    "seal-runtime.derived.mjs",
    "operator-contracts.derived.py",
    "derive-operators.derived.py",
    "output-producer.mjs",
    "produce.mjs",
  ]) {
    const original =
      name === "normalize.derived.mjs"
        ? "final-application-producers-v1/normalize.mjs"
        : name === "normalizer-regression.test.mjs"
          ? "final-application-producers-v1/producers.test.mjs"
          : "final-application-package-dependency-v1/" + name;
    const raw = readFileSync(resolve(successorRoot, "..", original));
    let s = raw.toString();
    const edit = (a, b) => {
      s = replaceExact(s, a, b);
    };
    if (name === "normalize.derived.mjs") {
      edit(
        "// Root supplies actual ownership observed in the immutable stage, never guessed IDs.",
        `// Ignore artifact-only inode grouping only when no runtime inode write is needed.
// The complete original row, including cross-root alias identity, is retained.
export function sameRuntimeNode(previous, target) {
  if (!previous || previous.type !== target.type || previous.path !== target.path) return false;
  const fields = ["mode", "uid", "gid"];
  if (!fields.every(k => Number.isSafeInteger(previous[k]) && Number.isSafeInteger(target[k]) && previous[k] === target[k])) return false;
  if (target.type === "directory") return true;
  if (target.type === "symlink") return typeof target.target === "string" && previous.target === target.target;
  if (target.type !== "file") return false;
  return Number.isSafeInteger(target.bytes) && target.bytes >= 0 && previous.bytes === target.bytes && hex(target.sha256) && previous.sha256 === target.sha256 && [previous, target].every(r => Number.isSafeInteger(r.links) && r.links >= 1 && (r.links === 1 ? !r.hardlinkGroup : typeof r.hardlinkGroup === "string"));
}
// Root supplies actual ownership observed in the immutable stage, never guessed IDs.`,
      );
      edit(
        "const by = new Map(before.map((r) => [r.path, r])),",
        "const originalBy = new Map(before.map((r) => [r.path, r])),\n    by = new Map(originalBy),",
      );
      edit(
        '      by.set(path, row);\n      if (row.type === "file") payloadSources.set(path, r.path);',
        `      const previous = originalBy.get(path);
      if (sameRuntimeNode(previous, row)) {
        by.set(path, previous);
        payloadSources.delete(path);
      } else {
        by.set(path, row);
        if (row.type === "file") payloadSources.set(path, r.path);
      }`,
      );
    }
    if (name === "normalizer-regression.test.mjs") {
      edit('from "./normalize.mjs"', 'from "./normalize.derived.mjs"');
      for (const dep of [
        "adapters.mjs",
        "derive-probes.mjs",
        "probe-guard.mjs",
        "admission.mjs",
      ])
        edit(
          `from "./${dep}"`,
          `from "../final-application-producers-v1/${dep}"`,
        );
    }
    if (name === "release-admission.derived.mjs") {
      edit(
        'from "./admission.mjs"',
        'from "../final-application-package-dependency-v1/admission.mjs"',
      );
      for (const dep of [
        "package-transition.mjs",
        "native-release-gates.derived.mjs",
        "transaction-inventory.derived.mjs",
      ])
        edit(
          `from "./${dep}"`,
          `from "../final-application-package-dependency-v1/${dep}"`,
        );
      s = 'import {admitMinimalDeltaSource} from "./admission.mjs";\n' + s;
      edit(
        "  admitDependencySource(b.packageDependency, io.read);",
        "  admitDependencySource(b.packageDependency, io.read);\n  admitMinimalDeltaSource(b.minimalDelta, io.read);",
      );
    }
    if (name === "output-producer.mjs")
      edit(
        'from "../final-application-producers-v1/normalize.mjs"',
        'from "./normalize.derived.mjs"',
      );
    if (name === "produce.mjs") {
      edit(
        'import { here, policy, admit } from "./admission.mjs";',
        'import { here, policy, admit, successorRoot } from "./admission.mjs";',
      );
      edit(
        'join(here, "normalize.mjs")',
        'join(successorRoot, "normalize.derived.mjs")',
      );
    }
    if (name === "operator-contracts.derived.py") {
      edit(
        "DEPENDENCY_PACKAGE=Path(CONFIG['packageDependencyPackage']).resolve()",
        "DEPENDENCY_PACKAGE=Path(CONFIG['packageDependencyPackage']).resolve()\nMINIMAL_PACKAGE=Path(CONFIG['minimalDeltaPackage']).resolve()\nassert MINIMAL_PACKAGE not in (O,SOURCE_PACKAGE,PRODUCER_PACKAGE,WEB_LEAF_PACKAGE,DEPENDENCY_PACKAGE)",
      );
      edit(
        "'webLeaf','packageDependency')",
        "'webLeaf','packageDependency','minimalDelta')",
      );
      edit(
        "    input_path=ref(CONFIG['bindings']) if phase=='source' else D/(phase+'-bindings.json')",
        `    minimal_review=read(ref(b['minimalDelta']['approval']))
    assert minimal_review['accepted'] is True and minimal_review['independentReview'] is True
    assert minimal_review['scope']=='FINAL_APPLICATION_MINIMAL_DELTA_SOURCE' and minimal_review['manifestSha256']==b['minimalDelta']['manifest']['sha256']
    for row in read(ref(b['minimalDelta']['manifest']))['files']:
        p=MINIMAL_PACKAGE/row['path'];assert p.resolve().is_relative_to(MINIMAL_PACKAGE) and not p.is_symlink()
        assert p.stat().st_size==row['bytes'] and file_sha(p)==row['sha256']
    input_path=ref(CONFIG['bindings']) if phase=='source' else D/(phase+'-bindings.json')`,
      );
      edit(
        "str(DEPENDENCY_PACKAGE/'release-context.derived.mjs')",
        "str(MINIMAL_PACKAGE/'release-context.derived.mjs')",
      );
    }
    if (name === "derive-operators.derived.py") {
      edit(
        "DEPENDENCY_HERE=Path(__file__).resolve().parent",
        "MINIMAL_HERE=Path(__file__).resolve().parent\nDEPENDENCY_HERE=MINIMAL_HERE.parent/'final-application-package-dependency-v1'",
      );
      edit(
        "(DEPENDENCY_HERE/'operator-contracts.derived.py')",
        "(MINIMAL_HERE/'operator-contracts.derived.py')",
      );
      edit(
        "str(DEPENDENCY_HERE/'release-context.derived.mjs')",
        "str(MINIMAL_HERE/'release-context.derived.mjs')",
      );
      edit(
        "def render(config,source):",
        "def render(config,source):\n    assert Path(config['minimalDeltaPackage']).resolve()==MINIMAL_HERE.resolve()",
      );
    }
    files[name] = Buffer.from(s);
    rows.push({
      name,
      original,
      parentSha256: sha(raw),
      candidateSha256: sha(files[name]),
      changed: !raw.equals(files[name]),
    });
  }
  return { files, rows };
}
