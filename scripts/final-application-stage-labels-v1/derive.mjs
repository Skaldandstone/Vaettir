import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { successorRoot, checkParents, policy } from "./admission.mjs";
import { replaceExact } from "../final-application-producers-v1/adapters.mjs";
import { sha } from "../production-native-successor-v1/contracts.mjs";
export function derive() {
  checkParents();
  const files = {},
    rows = [];
  const emit = (name, origin, s) => {
    files[name] = Buffer.from(s);
    rows.push({
      name,
      origin,
      parentSha256: sha(
        readFileSync(
          resolve(successorRoot, "../final-application-producers-v1", origin),
        ),
      ),
      candidateSha256: sha(files[name]),
    });
  };
  let s = readFileSync(
    resolve(
      successorRoot,
      "../final-application-producers-v1/stage_support.py",
    ),
    "utf8",
  );
  s = replaceExact(
    s,
    "    assert labels==old,'Stage changed parent labels'\n    # The frozen recipe has no new labels: validation source and target custody\n    # come from the reviewed actual build request/context, never invented labels.",
    `    # Actual reviewed build CLI supplied these exact three labels.
    added={'vaettir.artifact-purpose':'sqlite-transaction-stage','vaettir.runtime-eligible':'false','vaettir.validation-source':c['source']}
    assert not set(added).intersection(old),'Expected exactly three additions to immutable parent labels'
    assert labels=={**old,**added},'Wrong/missing/additional/cross-source stage labels'
    assert c['intentBinding']['stageLabels']==added
    assert c['intentBinding']['buildDriver']['sha256']=='${policy.driver.sha256}'
    assert c['intentBinding']['buildDriver']['bytes']==${policy.driver.bytes}`,
  );
  emit("stage-support.derived.py", "stage_support.py", s);
  s = readFileSync(
    resolve(
      successorRoot,
      "../final-application-producers-v1/stage-bootstrap.mjs",
    ),
    "utf8",
  );
  s = replaceExact(
    s,
    'from "./admission.mjs"',
    'from "../final-application-producers-v1/admission.mjs"',
  );
  s =
    'import {admitStageLabelsSource,successorRoot,checkParents,policy as labelPolicy} from "./admission.mjs";\n' +
    s;
  s = replaceExact(s, "  checkFrozen();", "  checkFrozen();checkParents();");
  s = replaceExact(
    s,
    'bytes(join(here, "stage_support.py"))',
    'bytes(join(successorRoot, "stage-support.derived.py"))',
  );
  s = replaceExact(
    s,
    "export function prepareStage(b, source, role, io) {",
    "export function prepareStage(b, source, role, io) {\n  admitStageLabelsSource(b.stageLabels,io.read);",
  );
  s = replaceExact(
    s,
    "  const nativePolicy = JSON.parse(",
    `  ok(input.buildDriver?.sha256===labelPolicy.driver.sha256 && input.buildDriver?.bytes===labelPolicy.driver.bytes,"Exact actual stage driver required");
  verifyRef(input.buildDriver,io.read);
  const nativePolicy = JSON.parse(`,
  );
  s = replaceExact(
    s,
    "    buildRequest: input.buildRequest,",
    "    buildDriver: input.buildDriver,\n    stageLabels: {'vaettir.artifact-purpose':'sqlite-transaction-stage','vaettir.runtime-eligible':'false','vaettir.validation-source':source.source},\n    buildRequest: input.buildRequest,",
  );
  s = replaceExact(
    s,
    "  collect(b.producers);",
    "  collect(b.producers);\n  collect(b.stageLabels);",
  );
  s = replaceExact(
    s,
    "    b.repairAcceptance,\n  ])",
    "    b.repairAcceptance,\n    b.stageLabels.approval,\n  ])",
  );
  emit("stage-bootstrap.derived.mjs", "stage-bootstrap.mjs", s);
  return { files, rows };
}
