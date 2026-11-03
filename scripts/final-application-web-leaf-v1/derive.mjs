// Pure deterministic source derivation; no operator or native execution.
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
      resolve(successorRoot, "../final-application-producers-v1", name),
    );
    let s = raw.toString();
    if (name === "release-admission.derived.mjs") {
      s = replaceExact(
        s,
        'from "./admission.mjs"',
        'from "../final-application-producers-v1/admission.mjs"',
      );
      s = 'import {admitWebLeafSource} from "./admission.mjs";\n' + s;
      s = replaceExact(
        s,
        "  admitProducerSource(b.producers, io.read);",
        "  admitProducerSource(b.producers, io.read);\n  admitWebLeafSource(b.webLeaf, io.read);",
      );
    }
    if (name === "operator-contracts.derived.py") {
      s = replaceExact(
        s,
        "PRODUCER_PACKAGE=Path(CONFIG['producerPackage']).resolve()",
        "PRODUCER_PACKAGE=Path(CONFIG['producerPackage']).resolve()\nWEB_LEAF_PACKAGE=Path(CONFIG['webLeafPackage']).resolve()\nassert WEB_LEAF_PACKAGE not in (O,SOURCE_PACKAGE,PRODUCER_PACKAGE)",
      );
      s = replaceExact(
        s,
        "'purpose','producers')",
        "'purpose','producers','webLeaf')",
      );
      s = replaceExact(
        s,
        "    input_path=ref(CONFIG['bindings']) if phase=='source' else D/(phase+'-bindings.json')",
        `    web_review=read(ref(b['webLeaf']['approval']))
    assert web_review['accepted'] is True and web_review['independentReview'] is True
    assert web_review['scope']=='FINAL_APPLICATION_WEB_LEAF_SOURCE' and web_review['manifestSha256']==b['webLeaf']['manifest']['sha256']
    for row in read(ref(b['webLeaf']['manifest']))['files']:
        p=WEB_LEAF_PACKAGE/row['path'];assert p.resolve().is_relative_to(WEB_LEAF_PACKAGE) and not p.is_symlink()
        assert p.stat().st_size==row['bytes'] and file_sha(p)==row['sha256']
    input_path=ref(CONFIG['bindings']) if phase=='source' else D/(phase+'-bindings.json')`,
      );
      s = replaceExact(
        s,
        "str(PRODUCER_PACKAGE/'release-context.derived.mjs')",
        "str(WEB_LEAF_PACKAGE/'release-context.derived.mjs')",
      );
    }
    if (name === "derive-operators.derived.py") {
      s = replaceExact(
        s,
        "PRODUCER_HERE=Path(__file__).resolve().parent",
        "WEB_LEAF_HERE=Path(__file__).resolve().parent\nPRODUCER_HERE=WEB_LEAF_HERE.parent/'final-application-producers-v1'",
      );
      s = replaceExact(
        s,
        "(PRODUCER_HERE/'operator-contracts.derived.py')",
        "(WEB_LEAF_HERE/'operator-contracts.derived.py')",
      );
      s = replaceExact(
        s,
        "str(PRODUCER_HERE/'release-context.derived.mjs')",
        "str(WEB_LEAF_HERE/'release-context.derived.mjs')",
      );
      s = replaceExact(
        s,
        "def render(config,source):",
        "def render(config,source):\n    assert Path(config['webLeafPackage']).resolve()==WEB_LEAF_HERE.resolve()",
      );
    }
    if (name === "output-producer.mjs")
      s = replaceExact(
        s,
        'from "./normalize.mjs"',
        'from "../final-application-producers-v1/normalize.mjs"',
      );
    if (name === "produce.mjs")
      for (const dep of [
        "derive-probes.mjs",
        "adapters.mjs",
        "stage-bootstrap.mjs",
      ])
        s = replaceExact(
          s,
          `from "./${dep}"`,
          `from "../final-application-producers-v1/${dep}"`,
        );
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
