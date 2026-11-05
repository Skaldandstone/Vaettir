import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
const form = readFileSync(
  new URL("../components/TestCaseForm.tsx", import.meta.url),
  "utf8",
);
const edit = readFileSync(
  new URL(
    "../app/projects/[projectId]/test-cases/[id]/edit/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const create = readFileSync(
  new URL(
    "../app/projects/[projectId]/test-cases/new/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("draft owns original CAS baseline despite refetched initial props", () => {
  assert.match(form, /const \[baseline\] = useState\(initial\)/);
  for (const field of ["SuitePath", "Priority", "StepRevision"]) {
    assert.match(form, new RegExp(`expected${field}:\\s*baseline\\?\\.`));
    assert.doesNotMatch(form, new RegExp(`expected${field}:\\s*initial\\?\\.`));
  }
});
test("editing session is keyed by project and case and verifies case identity before opening", () => {
  assert.match(edit, /key=\{`\$\{params.projectId\}:\$\{params.id\}`\}/);
  assert.match(
    edit,
    /!tc\s*&&\s*loaded\s*&&\s*canEdit\s*&&\s*!tcQuery.error/,
  );
  assert.match(edit, /tcQuery.data\?\.id === params.id/);
  assert.match(edit, /if \(!tc && pageError\)/);
  assert.match(edit, /locked=\{locked\}/);
  assert.match(edit, /Your unsaved draft is retained/);
});
test("create draft stays mounted after permission refresh failure, but cannot write", () => {
  assert.match(create, /key=\{projectId\}/);
  assert.match(create, /if \(!opened && accessError\)/);
  assert.match(create, /const locked = !loaded \|\| !canEdit/);
  assert.match(create, /locked=\{locked\}/);
  assert.match(create, /retryAccess/);
});
test("native fieldset and handler guards prevent revoked-access writes and save during upload", () => {
  assert.match(
    form,
    /<fieldset[^>]*\s+disabled=\{locked \|\| saving \|\| uploadingStepKey !== null\}/,
  );
  assert.match(
    form,
    /async function submit\(\) \{\s*if \(!active \|\| locked \|\| saving \|\| uploadingStepKey !== null \|\| !value.title.trim\(\) \|\| !caseFieldsDraft\?\.ready\)/,
  );
  assert.match(
    form,
    /async function uploadStepMedia[\s\S]*?if \(locked \|\| saving \|\| uploadingStepKey !== null\) return/,
  );
  assert.match(form, /role="alert"[^>]*>\{error\}/);
});

function previewFixture(fetch) {
  const ast=ts.createSourceFile("TestCaseForm.tsx",form,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let preview;
  function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==="viewStepMedia")preview=node;ts.forEachChild(node,visit);}
  visit(ast);assert.ok(preview);
  let error=null;
  const opened=[];
  const context=vm.createContext({Error,mediaPreviewGeneration:{current:0},setError:value=>{error=value;},window:{open:(...args)=>opened.push(args)},
    utils:{testCaseAttachments:{getViewUrl:{fetch}}}});
  vm.runInContext(ts.transpileModule(preview.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return {preview:context.viewStepMedia,opened,get error(){return error;}};
}

test("an evidence preview retry clears the old failure before a successful read", async () => {
  let refuse=true;const requests=[];
  const h=previewFixture(async input=>{requests.push(input);if(refuse)throw Error("Synthetic preview failure");return {viewUrl:"https://synthetic.invalid/evidence"};});
  await h.preview("media-A");assert.equal(h.error,"Synthetic preview failure");assert.deepEqual(h.opened,[]);
  refuse=false;await h.preview("media-A");
  assert.equal(h.error,null);assert.deepEqual(h.opened,[["https://synthetic.invalid/evidence","_blank","noopener,noreferrer"]]);
  assert.deepEqual(requests.map(request=>request.attachmentId),["media-A","media-A"]);
});

test("an older evidence response cannot open a superseded file or replace the latest preview status",async()=>{
  for(const outcome of ["success","failure"]){
    let resolve,reject;
    const first=new Promise((done,fail)=>{resolve=done;reject=fail;});
    const h=previewFixture(input=>input.attachmentId==="media-A"?first:Promise.resolve({viewUrl:"https://synthetic.invalid/B"}));
    const older=h.preview("media-A");await h.preview("media-B");
    if(outcome==="success")resolve({viewUrl:"https://synthetic.invalid/A"});else reject(Error("Stale failure"));
    await older;
    assert.deepEqual(h.opened,[["https://synthetic.invalid/B","_blank","noopener,noreferrer"]]);
    assert.equal(h.error,null);
  }
});
