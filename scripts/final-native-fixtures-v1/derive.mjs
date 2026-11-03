import { hash, need } from "./core.mjs";
const replace = (s, a, b) => {
  need(s.split(a).length === 2, "Unique derivation anchor required");
  return s.replace(a, b);
};
export function derive(policy, read) {
  const parent = {};
  for (const row of policy.parents) {
    const b = read(row.path); need(b.length === row.bytes && hash(b) === row.sha256, "Frozen derivation parent changed");
    parent[row.path] = b.toString("utf8");
  }
  const native = "scripts/final-application-package-dependency-v1/native-release-gates.derived.mjs", posix = "scripts/final-application-posix-inventory-v1/";
  let s = parent[native];
  s = replace(s, 'from "./package-transition.mjs"', 'from "../final-application-package-dependency-v1/package-transition.mjs"');
  s = replace(s, 'from "./transaction-inventory.derived.mjs"', 'from "../final-application-package-dependency-v1/transaction-inventory.derived.mjs"');
  const original = '  requireThat(\n    audit.browser.actual === true &&\n      audit.browser.exitCode === 0 &&\n      audit.prisma.actual === true &&\n      audit.prisma.exitCode === 0,\n    "Actual browser and Prisma proof required",\n  );';
  s = replace(s, original, '  if (role === "api") {\n' + original + '\n    apiRuntimeEvidence(audit, refs, read);\n  } else {\n    webApplicability(audit, refs, read, after);\n  }');
  const files = { "native-release-gates.derived.mjs": 'import { webApplicability, apiRuntimeEvidence } from "./applicability.mjs";\n' + s };
  s = parent[posix + "release-admission.derived.mjs"];
  s = replace(s, 'from "./admission.mjs"', 'from "../final-application-posix-inventory-v1/admission.mjs"');
  s = replace(s, 'from "../final-application-package-dependency-v1/native-release-gates.derived.mjs"', 'from "./native-release-gates.derived.mjs"');
  s = replace(s, 'export function sourceAdmission(b, policy, io) {', 'export function sourceAdmission(b, policy, io) {\n  admitFixtureSource(b.nativeFixtureSource, io.read);');
  files["release-admission.derived.mjs"] = 'import { admitFixtureSource } from "./source-admission.mjs";\n' + s;
  files["release-context.derived.mjs"] = parent[posix + "release-context.derived.mjs"];
  files["native-probe-context.derived.mjs"] = parent[posix + "native-probe-context.derived.mjs"];
  s = parent[posix + "seal-runtime.derived.mjs"];
  s = replace(s, '  const webLog = readRef(refs.webLog, io.read);', '  companionRuntime(b, source, api.component.imageDigest, web.component.imageDigest, io.read);\n  const webLog = readRef(refs.webLog, io.read);');
  files["seal-runtime.derived.mjs"] = 'import { companionRuntime } from "./applicability.mjs";\n' + s;
  s = parent[posix + "operator-contracts.derived.py"];
  s = replace(s, "POSIX_PACKAGE=Path(CONFIG['posixInventoryPackage']).resolve()", "FIXTURE_PACKAGE=Path(CONFIG['nativeFixturePackage']).resolve()\nPOSIX_PACKAGE=Path(CONFIG['posixInventoryPackage']).resolve()\nassert FIXTURE_PACKAGE not in (O,SOURCE_PACKAGE,PRODUCER_PACKAGE,WEB_LEAF_PACKAGE,DEPENDENCY_PACKAGE,MINIMAL_PACKAGE,POSIX_PACKAGE)");
  s = replace(s, "'minimalDelta','posixInventory')", "'minimalDelta','posixInventory','nativeFixtureSource')");
  s = replace(s, "    input_path=ref(CONFIG['bindings']) if phase=='source' else D/(phase+'-bindings.json')", `    fixture_review=read(ref(b['nativeFixtureSource']['approval']))
    assert fixture_review['accepted'] is True and fixture_review['independentReview'] is True
    assert fixture_review['scope']=='FINAL_NATIVE_FIXTURE_SOURCE' and fixture_review['manifestSha256']==b['nativeFixtureSource']['manifest']['sha256']
    for row in read(ref(b['nativeFixtureSource']['manifest']))['files']:
        p=FIXTURE_PACKAGE/row['path'];assert p.resolve().is_relative_to(FIXTURE_PACKAGE) and p.is_file() and not p.is_symlink()
        assert p.stat().st_size==row['bytes'] and file_sha(p)==row['sha256']
    input_path=ref(CONFIG['bindings']) if phase=='source' else D/(phase+'-bindings.json')`);
  s = replace(s, "str(POSIX_PACKAGE/'release-context.derived.mjs')", "str(FIXTURE_PACKAGE/'release-context.derived.mjs')");
  files["operator-contracts.derived.py"] = s;
  s = parent[posix + "derive-operators.derived.py"];
  s = replace(s, "POSIX_HERE=Path(__file__).resolve().parent", "FIXTURE_HERE=Path(__file__).resolve().parent\nPOSIX_HERE=FIXTURE_HERE.parent/'final-application-posix-inventory-v1'");
  s = replace(s, "def render(config,source):", "def render(config,source):\n    assert Path(config['nativeFixturePackage']).resolve()==FIXTURE_HERE.resolve()");
  s = replace(s, "(POSIX_HERE/'operator-contracts.derived.py')", "(FIXTURE_HERE/'operator-contracts.derived.py')");
  s = replace(s, "str(POSIX_HERE/'release-context.derived.mjs')", "str(FIXTURE_HERE/'release-context.derived.mjs')");
  files["derive-operators.derived.py"] = s;
  return Object.fromEntries(Object.entries(files).map(([n, text]) => [n, Buffer.from(text)]));
}
