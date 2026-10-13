import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync,existsSync}from'node:fs';import{spawnSync}from'node:child_process';
const source=readFileSync(new URL('./prepare-maintained-native-proof-context.py',import.meta.url),'utf8'),host=readFileSync(new URL('./build-maintained-native-host-proof.sh',import.meta.url),'utf8'),workflow=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
const python=process.platform==='win32'&&existsSync('C:/Users/James/AppData/Local/Programs/Python/Python312/python.exe')?'C:/Users/James/AppData/Local/Programs/Python/Python312/python.exe':'python3';
test('syntax and pure finite plan fixtures only; never a root, filesystem, package or font operation',()=>{
 const program=`import ast,hashlib,re,json,sys\nsrc=sys.stdin.read(); ast.parse(src)\nnames={'MAX_TOTAL','MAX_FILES','MANIFEST_SHA','BASE_JSON','FIXED','CORPUS'}\nmodule=ast.Module(body=[node for node in ast.parse(src).body if (isinstance(node,ast.Assign) and isinstance(node.targets[0],ast.Name) and node.targets[0].id in names) or (isinstance(node,ast.FunctionDef) and node.name in ['sha','safe_relative','plan_files'])],type_ignores=[])\nscope={'hashlib':hashlib,'re':re}; exec(compile(module,'pure-owned-proof-plan','exec'),scope)\nmanifest=json.loads(sys.argv[1]); json_names={k:scope['BASE_JSON'][k]+[k+'-abi-example.json'] for k in ['glibc','freetype']}\nplan=scope['plan_files'](manifest,json_names)\nassert len(plan)<1200 and all(p.startswith('build/') for p in plan)\nassert sum(v['expected'] is not None for v in plan.values())==35\nassert sum(p.endswith('.deb') for p in plan)==3\nassert not any('/.old-native-root' in p or '/etc/' in p or '/root/' in p or p.endswith('.out') for p in plan)\nfor component in ['glibc','freetype']:\n for edit in ['unknown.json',component+'-abi-../escape.json',component+'-abi-example.json']:\n  bad={k:list(v) for k,v in json_names.items()};bad[component].append(edit)\n  try: scope['plan_files'](manifest,bad)\n  except AssertionError: pass\n  else: raise AssertionError('Unsafe/duplicate JSON admitted')\n for missing in scope['BASE_JSON'][component]:\n  bad={k:list(v) for k,v in json_names.items()};bad[component].remove(missing)\n  try: scope['plan_files'](manifest,bad)\n  except AssertionError: pass\n  else: raise AssertionError('Mandatory receipt omitted')\nfor path in ['../escape','/absolute','build//x','build/./x','build/a b','build/$(id)']:\n try: scope['safe_relative'](path)\n except AssertionError: pass\n else: raise AssertionError('Unsafe path admitted')\nprint('PURE_PLAN_PASS; operational functions excluded')\n`;
 const manifest=readFileSync(new URL('./runtime-security-sources.json',import.meta.url),'utf8');const result=spawnSync(python,['-I','-c',program,manifest],{input:source,encoding:'utf8',maxBuffer:4096,timeout:10000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/PURE_PLAN_PASS/);
});
test('original permissions and whole root are never relaxed/exposed; protected data read through fixed passive copier only after genuine native exit',()=>{
 assert.ok(host.includes('/usr/bin/python3 -I scripts/prepare-maintained-native-proof-context.py'));
 assert.ok(host.indexOf('bounded /bin/bash --noprofile --norc "$release/host-check.sh"')<host.indexOf('scripts/prepare-maintained-native-proof-context.py'));
 assert.ok(host.includes('--build-context "maintained-native=$release/proof-context"'));
 assert.doesNotMatch(host,/--build-context "maintained-native=\$release\/rootfs"|chmod[^\n]*old-native-root|chmod\s+-R/);
 assert.ok(source.includes('assert not os.path.lexists(destination)'));
 assert.ok(source.includes('os.O_RDONLY | os.O_NOFOLLOW'));
 assert.ok(source.includes('assert copied == data'));
 assert.ok(source.includes('if spec[\'expected\'] is not None:'));
 assert.ok(source.includes('originalFilesAndProtectionsUntouched=True'));
 for(const flag of ['nativeAccepted=False','abiAccepted=False','cidAccepted=False','imageSecurityAccepted=False','deploymentAccepted=False'])assert.ok(source.includes(flag));
 const commands=source.split('\n').filter(l=>!l.trimStart().startsWith('#')).join('\n');assert.doesNotMatch(commands,/subprocess|os\.system|exec\(|eval\(|extractall|shutil\.rmtree|os\.remove|chmod\(root|chown\(root/);
});
test('retention adds only missing original proof data, not duplicate source logs or arbitrary protected rootfs',()=>{
 for(const suffix of ['proof-context/build/runtime-security/*/*.json','proof-context/build/runtime-security/*/*.deb','proof-context/build/runtime-security/*/*.status','proof-context/build/glibc-sources/*','proof-context/build/freetype-sources/*','proof-context/build/freetype-standard-corpus/*'])assert.ok(workflow.includes(suffix));
 assert.doesNotMatch(workflow,/proof-context\/build\/runtime-security\/\*\/\*\.(?:log|sum)|rootfs\/\*\*/);
 assert.ok(workflow.includes('scripts/prepare-maintained-native-proof-context.test.mjs'));
});
