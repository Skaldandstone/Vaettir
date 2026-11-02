// External, read-only native fixture for a new EMPTY synthetic NSS store only.
// Never installed in an application runtime or pointed at a user certificate DB.
"use strict";
// The isolated loader-fixture protocol executes this file as CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs"), crypto = require("node:crypto"), child = require("node:child_process"), path = require("node:path"), assert = require("node:assert/strict");
const OUTPUT = "/vaettir-sqlite-observation-v1", TOOL = "/run/vaettir-nss/certutil";
const TOOL_SHA = "815d8be06440a4dea3735ac102c7fedbcdb3b72d6ec32349431ac2cba55c19da";
const EXPECTED = Object.freeze({
  "/usr/lib/x86_64-linux-gnu/libnss3.so": "b13e6eedabfe3d1cc2aa6d3d75da9cbfe894902d22a8012fff7f1ada25b7d0ed",
  "/usr/lib/x86_64-linux-gnu/libsoftokn3.so": "7262de7206f68b41c52202bbf6281c42d64453b4c1e17ab41271400965b57896",
  "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6": "222a0487f6d62ff522bcf69663c64685fb00bd4434953e30be73126d57b5c43d",
});
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function requireLoadedLibraries(text, resolve, hash) {
  assert.equal(typeof text, "string"); assert.ok(Buffer.byteLength(text) <= 1024 * 1024);
  const seen = new Map();
  for (const match of text.matchAll(/calling init:\s+(\/[^\s]+)\s*$/gm)) {
    const name = path.posix.basename(match[1]);
    if (!["libnss3.so", "libsoftokn3.so", "libsqlite3.so.0", "libsqlite3.so.0.8.6"].includes(name)) continue;
    assert.match(match[1], /^\/(?:usr\/)?lib\/x86_64-linux-gnu\/[A-Za-z0-9._-]+$/);
    const canonical = resolve(match[1]); assert.ok(Object.hasOwn(EXPECTED, canonical), "Unexpected loaded library");
    const digest = hash(canonical); assert.equal(digest, EXPECTED[canonical], "Loaded native bytes changed");
    if (seen.has(canonical)) assert.equal(seen.get(canonical), digest);
    seen.set(canonical, digest);
  }
  assert.deepEqual([...seen.keys()].sort(), Object.keys(EXPECTED).sort(), "Actual loader initialization evidence missing");
  return [...seen].sort(([a], [b]) => a.localeCompare(b)).map(([library, sha256]) => ({ library, sha256 }));
}
function sqliteHeader(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 16 && bytes.subarray(0,15).toString() === "SQLite format 3" && bytes[15] === 0, "Real SQLite store header required");
}
function requireChild(result) {
  assert.equal(result.status, 0, "Native command did not complete successfully");
  assert.equal(result.signal, null); assert.equal(result.error, null);
}
function run(output) {
  assert.equal(process.platform, "linux"); assert.equal(output, OUTPUT); assert.equal(fs.realpathSync(output), output);
  assert.ok(fs.lstatSync(output).isDirectory() && !fs.lstatSync(output).isSymbolicLink());
  assert.equal(sha(fs.readFileSync(TOOL)), TOOL_SHA);
  for (const [file, digest] of Object.entries(EXPECTED)) assert.equal(sha(fs.readFileSync(file)), digest);
  const observationPath = output + "/nss-observation.json";
  assert.ok(!fs.existsSync(observationPath));
  fs.writeFileSync(output + "/nss-fixture-intent.json", JSON.stringify({ protocol:"empty-store-loader-proof/v1", toolSha256:TOOL_SHA }) + String.fromCharCode(10), {flag:"wx",mode:0o600});
  const home = fs.mkdtempSync(output + "/empty-nss-"), store = home + "/store"; fs.mkdirSync(store, {mode:0o700});
  const env = {PATH:"/usr/bin:/bin",LANG:"C",LC_ALL:"C",HOME:home,LD_DEBUG:"libs,files"};
  const records = [];
  const invoke = (label, executable, args, debug = true) => {
    const actualEnv = debug ? env : {PATH:"/usr/bin:/bin",LANG:"C",LC_ALL:"C",HOME:home};
    const r = child.spawnSync(executable, args, {env:actualEnv,cwd:home,encoding:"utf8",timeout:25000,maxBuffer:1024*1024,stdio:["ignore","pipe","pipe"]});
    const record = {executable,args,status:r.status,signal:r.signal ?? null,error:r.error?.message ?? null,errorCode:r.error?.code ?? null,errorErrno:r.error?.errno ?? null,errorSyscall:r.error?.syscall ?? null,stdout:r.stdout ?? "",stderr:r.stderr ?? ""};
    fs.writeFileSync(output + "/nss-" + label + "-command.json", JSON.stringify(record,null,2) + String.fromCharCode(10), {flag:"wx",mode:0o600});
    fs.writeFileSync(output + "/nss-" + label + ".stdout", record.stdout, {flag:"wx",mode:0o600});
    fs.writeFileSync(output + "/nss-" + label + ".stderr", record.stderr, {flag:"wx",mode:0o600});
    records.push(record); requireChild(record); return record;
  };
  const version = invoke("package", "/usr/bin/dpkg-query", ["-W","-f=${Version}","libnss3"], false);
  assert.equal(version.stdout, "2:3.110-1+deb13u4");
  const create = invoke("create", TOOL, ["-N","-d","sql:"+store,"--empty-password"]);
  const createLoaded = requireLoadedLibraries(create.stderr, fs.realpathSync, file=>sha(fs.readFileSync(file)));
  const list = invoke("list", TOOL, ["-L","-d","sql:"+store]); assert.ok(list.stdout.includes("Certificate Nickname"));
  const listLoaded = requireLoadedLibraries(list.stderr, fs.realpathSync, file=>sha(fs.readFileSync(file)));
  const stores = ["cert9.db","key4.db"].map(name=>{
    const file=store+"/"+name;assert.ok(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink());const bytes=fs.readFileSync(file);assert.ok(bytes.length<1024*1024);sqliteHeader(bytes);return {name,bytes:bytes.length,sha256:sha(bytes)};
  });
  const result = {protocol:"empty-store-loader-proof/v1",runtimePackage:version.stdout,actualNewEmptyStore:true,
    toolInstalled:false,toolShipped:false,readOnlyExternalTool:true,toolSha256:TOOL_SHA,
    loadedSQLiteSha256:EXPECTED["/usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6"],loadedSoftoknSha256:EXPECTED["/usr/lib/x86_64-linux-gnu/libsoftokn3.so"],
    createLoaded,listLoaded,stores,exitCode:0,customerData:false,independentReviewRequired:true,releaseAccepted:false};
  fs.writeFileSync(observationPath,JSON.stringify(result,null,2)+String.fromCharCode(10),{flag:"wx",mode:0o600});
  console.log(JSON.stringify({protocol:result.protocol,emptyStoreInitialized:true,actualLoaderEvidence:true,releaseAccepted:false}));
  return result;
}
module.exports = {requireLoadedLibraries,sqliteHeader,requireChild,EXPECTED,run};
if (require.main === module) {assert.equal(process.argv.length,3);run(process.argv[2]);}
