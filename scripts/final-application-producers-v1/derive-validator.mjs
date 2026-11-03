// Source derivation only: never runs a transaction, validator on live state, or operator.
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { here, checkFrozen } from "./admission.mjs";
import { replaceExact } from "./adapters.mjs";
import { sha } from "../production-native-successor-v1/contracts.mjs";
export function deriveValidatorSources() {
  checkFrozen();
  const root = resolve(here, ".."),
    files = {},
    rows = [];
  const get = (p) => readFileSync(join(root, p), "utf8");
  const emit = (name, origin, value) => {
    files[name] = Buffer.from(value);
    rows.push({
      name,
      origin,
      parentSha256: sha(Buffer.from(get(origin))),
      candidateSha256: sha(files[name]),
    });
  };
  let origin = "production-native-successor-v1/inventory.mjs",
    s = get(origin);
  s = replaceExact(
    s,
    'from "./contracts.mjs"',
    'from "../production-native-successor-v1/contracts.mjs"',
  );
  s = 'import {admitAuxCacheLeaf} from "./aux-cache-review.mjs";\n' + s;
  s = replaceExact(
    s,
    "        ].includes(row.path) ||",
    "        ].includes(row.path) || admitAuxCacheLeaf(row, review) ||",
  );
  emit("transaction-inventory.derived.mjs", origin, s);
  origin = "production-native-successor-v1/release-gates.mjs";
  s = get(origin);
  s = replaceExact(
    s,
    'from "./contracts.mjs"',
    'from "../production-native-successor-v1/contracts.mjs"',
  );
  s = replaceExact(
    s,
    'from "./inventory.mjs"',
    'from "./transaction-inventory.derived.mjs"',
  );
  s = replaceExact(
    s,
    "const observation = jsonRef(ref, read),",
    "const observation = jsonRef(ref, read, 512 * 1024 ** 2),",
  );
  emit("native-release-gates.derived.mjs", origin, s);
  origin = "final-application-release-v1/admission.mjs";
  s = get(origin);
  s = 'import {admitProducerSource} from "./admission.mjs";\n' + s;
  s = replaceExact(
    s,
    'from "../production-native-successor-v1/inventory.mjs"',
    'from "./transaction-inventory.derived.mjs"',
  );
  s = replaceExact(
    s,
    'from "../production-native-successor-v1/release-gates.mjs"',
    'from "./native-release-gates.derived.mjs"',
  );
  s = replaceExact(
    s,
    "export function sourceAdmission(b, policy, io) {",
    "export function sourceAdmission(b, policy, io) {\n  admitProducerSource(b.producers, io.read);",
  );
  emit("release-admission.derived.mjs", origin, s);
  origin = "final-application-release-v1/context.mjs";
  s = get(origin);
  s = replaceExact(
    s,
    'from "./admission.mjs"',
    'from "./release-admission.derived.mjs"',
  );
  s = replaceExact(
    s,
    "export const here = dirname(fileURLToPath(import.meta.url));",
    'export const here = resolve(dirname(fileURLToPath(import.meta.url)), "../final-application-release-v1");',
  );
  emit("release-context.derived.mjs", origin, s);
  for (const [file, name] of [
    ["native-probe-context.mjs", "native-probe-context.derived.mjs"],
    ["seal-runtime.mjs", "seal-runtime.derived.mjs"],
  ]) {
    origin = "final-application-release-v1/" + file;
    s = get(origin);
    s = s
      .replaceAll(
        'from "./context.mjs"',
        'from "./release-context.derived.mjs"',
      )
      .replaceAll(
        'from "./admission.mjs"',
        'from "./release-admission.derived.mjs"',
      );
    emit(name, origin, s);
  }
  origin = "final-application-release-v1/operator_contracts.py";
  s = get(origin);
  s = replaceExact(
    s,
    "SOURCE_PACKAGE=Path(CONFIG['sourcePackage']).resolve()",
    "SOURCE_PACKAGE=Path(CONFIG['sourcePackage']).resolve()\nPRODUCER_PACKAGE=Path(CONFIG['producerPackage']).resolve()\nassert PRODUCER_PACKAGE!=O and PRODUCER_PACKAGE!=SOURCE_PACKAGE",
  );
  s = replaceExact(
    s,
    "('nativeBindings','repairAcceptance','operatorApproval','operatorManifest','purpose')",
    "('nativeBindings','repairAcceptance','operatorApproval','operatorManifest','purpose','producers')",
  );
  s = replaceExact(
    s,
    "    input_path=ref(CONFIG['bindings']) if phase=='source' else D/(phase+'-bindings.json')",
    `    producer_review=read(ref(b['producers']['approval']))
    assert producer_review['accepted'] is True and producer_review['independentReview'] is True
    assert producer_review['scope']=='FINAL_APPLICATION_PRODUCERS_SOURCE' and producer_review['manifestSha256']==b['producers']['manifest']['sha256']
    for row in read(ref(b['producers']['manifest']))['files']:
        p=PRODUCER_PACKAGE/row['path'];assert p.resolve().is_relative_to(PRODUCER_PACKAGE) and not p.is_symlink()
        assert p.stat().st_size==row['bytes'] and file_sha(p)==row['sha256']
    input_path=ref(CONFIG['bindings']) if phase=='source' else D/(phase+'-bindings.json')`,
  );
  s = replaceExact(
    s,
    "str(SOURCE_PACKAGE/'context.mjs')",
    "str(PRODUCER_PACKAGE/'release-context.derived.mjs')",
  );
  emit("operator-contracts.derived.py", origin, s);
  origin = "final-application-release-v1/derive_operators.py";
  s = get(origin);
  s = replaceExact(
    s,
    "HERE=Path(__file__).resolve().parent",
    "PRODUCER_HERE=Path(__file__).resolve().parent\nHERE=PRODUCER_HERE.parent/'final-application-release-v1'",
  );
  s = replaceExact(
    s,
    "emit('contracts.py',(HERE/'operator_contracts.py').read_text())",
    "emit('contracts.py',(PRODUCER_HERE/'operator-contracts.derived.py').read_text())",
  );
  s = replaceExact(
    s,
    "str(HERE/'context.mjs')",
    "str(PRODUCER_HERE/'release-context.derived.mjs')",
  );
  // Source generation only. Its actual configured package is also checked by the emitted contracts.
  s = replaceExact(
    s,
    "def render(config,source):",
    "def render(config,source):\n    assert Path(config['producerPackage']).resolve()==PRODUCER_HERE.resolve()",
  );
  emit("derive-operators.derived.py", origin, s);
  return { files, rows };
}
