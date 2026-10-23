import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readGitArchiveScripts, prepareArchiveScriptIdentity, nativeValidationShell } from "./native-builder-recovery.mjs";

const commit = "a".repeat(40), hash = bytes => createHash("sha256").update(bytes).digest("hex");
function crc(bytes) {
  let value=0xffffffff;
  for(const byte of bytes) { value^=byte; for(let bit=0;bit<8;bit++) value=(value>>>1)^(value&1?0xedb88320:0); }
  return (value^0xffffffff)>>>0;
}
/** Authored binary ZIPs only. No fetching, extraction, provider or Docker calls. */
function zip(entries, comment=commit) {
  const locals=[],centrals=[]; let offset=0;
  for(const item of entries) {
    const name=Buffer.from(item.name),data=Buffer.isBuffer(item.data)?item.data:Buffer.from(item.data??"synthetic\n");
    const method=item.method??8, flags=item.flags??(item.descriptor?8:0), packed=method===0?data:deflateRawSync(data);
    const checksum=crc(data), extra=item.extra??Buffer.alloc(0), localExtra=item.localExtra??extra;
    const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4); local.writeUInt16LE(flags,6); local.writeUInt16LE(method,8);
    if(!(flags&8)) {local.writeUInt32LE(checksum,14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(item.declaredSize??data.length,22);}
    local.writeUInt16LE(name.length,26);local.writeUInt16LE(localExtra.length,28);
    let descriptor=Buffer.alloc(0);
    if(flags&8) { descriptor=Buffer.alloc(item.unsigned?12:16); const begin=item.unsigned?0:4; if(begin)descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(checksum,begin);descriptor.writeUInt32LE(packed.length,begin+4);descriptor.writeUInt32LE(item.declaredSize??data.length,begin+8); }
    const record=Buffer.concat([local,name,localExtra,packed,descriptor]); locals.push(record);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(item.madeBy??0x0314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);
    central.writeUInt32LE(checksum,16);central.writeUInt32LE(packed.length,20);central.writeUInt32LE(item.declaredSize??data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt16LE(extra.length,30);
    central.writeUInt32LE(((item.mode??0x81a4)*65536)>>>0,38);central.writeUInt32LE(offset,42);centrals.push(Buffer.concat([central,name,extra]));offset+=record.length;
  }
  const directory=Buffer.concat(centrals),end=Buffer.alloc(22),tail=Buffer.from(comment);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);end.writeUInt16LE(tail.length,20);
  return Buffer.concat([...locals,directory,end,tail]);
}
const entry = changes => ({name:"scripts/helper.mjs",data:"original\n",...changes});
function offsets(archive) { const end=archive.length-62; return {end,central:archive.readUInt32LE(end+16)}; }
function identity(archive,blob,exported=archive,name="helper.mjs") {
  return prepareArchiveScriptIdentity({archive,archiveSha256:hash(archive),commit,scripts:[name],gitBlob:()=>blob,gitExport:()=>exported});
}

test("stored and deflated immutable entries, signed/unsigned descriptors, regular files roundtrip bytes without mutation",()=>{
  for(const options of [{method:0},{method:8},{descriptor:true},{descriptor:true,unsigned:true}]) {
    const bytes=zip([entry(options)]),before=Buffer.from(bytes),read=readGitArchiveScripts(bytes,commit,["helper.mjs"]);
    assert.equal(read.get("helper.mjs").toString(),"original\n");assert.deepEqual(bytes,before);
  }
});
test("pinned CRLF archive binds exact archive hashes, independently reproduced Git export and LF blob provenance",()=>{
  const blob=Buffer.from("first\nsecond\n"),archive=zip([entry({data:"first\r\nsecond\r\n"})]);
  const result=identity(archive,blob);
  assert.equal(result.expectedScripts["helper.mjs"],hash(Buffer.from("first\r\nsecond\r\n")));
  assert.equal(result.sourceBindings["helper.mjs"].gitBlobSha256,hash(blob));assert.equal(result.sourceBindings["helper.mjs"].transform,"git-export-lf-to-crlf");
  assert.deepEqual(identity(zip([entry({data:blob})]),blob).sourceBindings["helper.mjs"].transform,"identical");
});
test("CRLF-to-LF export is exact; mutated/export-unreproduced/non-EOL candidate never normalizes into acceptance",()=>{
  const archive=zip([entry({data:"first\n"})]);assert.equal(identity(archive,Buffer.from("first\r\n")).sourceBindings["helper.mjs"].transform,"git-export-crlf-to-lf");
  assert.throws(()=>identity(archive,Buffer.from("different\n")),/Non-EOL/);
  assert.throws(()=>identity(archive,Buffer.from("first\r\n"),zip([entry({data:"other\n"})])),/deterministic Git export/);
  assert.throws(()=>prepareArchiveScriptIdentity({archive,archiveSha256:"b".repeat(64),commit,scripts:["helper.mjs"],gitBlob:()=>Buffer.from("first\n"),gitExport:()=>archive}),/Immutable source ZIP hash/);
});
test("non-UTF8 source cannot gain EOL provenance through replacement decoding",()=>{
  const archive=zip([entry({data:"�\r\n"})]);assert.throws(()=>identity(archive,Buffer.from([255,10])),/encoded data|encoding/i);
});
test("script identity property names cannot mutate output prototypes",()=>{
  const data=Buffer.from("original\n"),archive=zip([entry({name:"scripts/__proto__",data})]);
  const result=identity(archive,data,archive,"__proto__");assert.equal(Object.getPrototypeOf(result.expectedScripts),null);assert.equal(Object.hasOwn(result.expectedScripts,"__proto__"),true);assert.equal(result.expectedScripts.__proto__,hash(data));
});
test("wrong commit, duplicate names/selection, missing entry and unsupported script paths refuse",()=>{
  assert.throws(()=>readGitArchiveScripts(zip([entry()],"b".repeat(40)),commit,["helper.mjs"]));
  assert.throws(()=>readGitArchiveScripts(zip([entry(),entry()]),commit,["helper.mjs"]),/Duplicate ZIP/);
  assert.throws(()=>readGitArchiveScripts(zip([entry()]),commit,["helper.mjs","helper.mjs"]),/Unique scripts/);
  assert.throws(()=>readGitArchiveScripts(zip([entry()]),commit,["missing.mjs"]),/Every selected/);
  assert.throws(()=>readGitArchiveScripts(zip([entry()]),commit,["../helper.mjs"]));
});
test("any unsafe archive path refuses without extraction, including unselected traversal",()=>{
  for(const name of ["../x","scripts/../helper.mjs","/root/x","C:/x","scripts\\x","scripts//x","scripts/./x","scripts/x\0y"]) {
    assert.throws(()=>readGitArchiveScripts(zip([entry(),entry({name})]),commit,["helper.mjs"]),/Unsafe ZIP path/);
  }
});
test("selected symlinks/directories are not executable regular script inputs",()=>{
  for(const mode of [0xa1ff,0x41ed]) assert.throws(()=>readGitArchiveScripts(zip([entry({mode})]),commit,["helper.mjs"]),/regular Git file/);
});
test("actual Windows Git mode-less entries require independent exact Git tree regular mode",()=>{
  const data=Buffer.from("original\n"),archive=zip([entry({mode:0,madeBy:0,data})]),base={archive,archiveSha256:hash(archive),commit,scripts:["helper.mjs"],gitBlob:()=>data,gitExport:()=>archive};
  assert.throws(()=>prepareArchiveScriptIdentity(base),/exact regular Git tree mode/);
  assert.equal(prepareArchiveScriptIdentity({...base,gitMode:()=>"100644"}).sourceBindings["helper.mjs"].gitMode,"100644");
  for(const mode of ["120000","040000","100755",undefined]) assert.throws(()=>prepareArchiveScriptIdentity({...base,gitMode:()=>mode}));
  assert.throws(()=>prepareArchiveScriptIdentity({...base,archive:zip([entry({mode:0,madeBy:3,data})]),archiveSha256:hash(zip([entry({mode:0,madeBy:3,data})])),gitMode:()=>"100644"}),/regular Git file/);
});
test("encrypted/unsupported flags, methods, disks and ZIP64 metadata refuse",()=>{
  for(const changes of [{flags:1},{flags:0x10},{method:9},{method:0,flags:2}]) assert.throws(()=>readGitArchiveScripts(zip([entry(changes)]),commit,["helper.mjs"]));
  const multi=zip([entry()]);multi.writeUInt16LE(1,offsets(multi).end+4);assert.throws(()=>readGitArchiveScripts(multi,commit,["helper.mjs"]),/Multi-disk/);
  assert.throws(()=>readGitArchiveScripts(zip([entry({extra:Buffer.from([1,0,0,0])})]),commit,["helper.mjs"]),/ZIP64/);
  const large=zip([entry()]);large.writeUInt32LE(0xffffffff,offsets(large).central+24);assert.throws(()=>readGitArchiveScripts(large,commit,["helper.mjs"]),/ZIP64/);
});
test("archive, selected script and aggregate decoded bytes stay hard bounded including a compressed bomb",()=>{
  assert.throws(()=>readGitArchiveScripts(Buffer.alloc(30*1024*1024+1),commit,["helper.mjs"]));
  assert.throws(()=>readGitArchiveScripts(zip([entry({data:Buffer.alloc(1024*1024+1)})]),commit,["helper.mjs"]),/Oversized selected/);
  assert.throws(()=>readGitArchiveScripts(zip([entry({data:Buffer.alloc(1024*1024+1),declaredSize:1})]),commit,["helper.mjs"]));
  const entries=Array.from({length:9},(_,n)=>entry({name:`scripts/s${n}`,data:Buffer.alloc(1024*1024)}));
  assert.throws(()=>readGitArchiveScripts(zip(entries),commit,entries.map(x=>x.name.slice(8))));
});
test("corrupted CRC/header/name/extra/offset/descriptor/directory metadata refuses",()=>{
  const crcBad=zip([entry()]);const {central}=offsets(crcBad);crcBad.writeUInt32LE(0,14);crcBad.writeUInt32LE(0,central+16);assert.throws(()=>readGitArchiveScripts(crcBad,commit,["helper.mjs"]),/CRC mismatch/);
  const badName=zip([entry()]);badName[30]=0x58;assert.throws(()=>readGitArchiveScripts(badName,commit,["helper.mjs"]));
  assert.throws(()=>readGitArchiveScripts(zip([entry({extra:Buffer.from([0x55,0x54,4,0,1])})]),commit,["helper.mjs"]),/Truncated ZIP extra/);
  const descriptor=zip([entry({descriptor:true})]);const descriptorStart=offsets(descriptor).central-16;descriptor.writeUInt32LE(0,descriptorStart+4);assert.throws(()=>readGitArchiveScripts(descriptor,commit,["helper.mjs"]),/descriptor CRC/);
  const offsetBad=zip([entry()]);offsetBad.writeUInt32LE(offsets(offsetBad).central,offsets(offsetBad).central+42);assert.throws(()=>readGitArchiveScripts(offsetBad,commit,["helper.mjs"]));
  const localSize=zip([entry({descriptor:true})]);localSize.writeUInt32LE(123,18);assert.throws(()=>readGitArchiveScripts(localSize,commit,["helper.mjs"]),/Local descriptor metadata/);
});
test("valid-looking selected local record embedded in another entry cannot overlap accepted archive intervals",()=>{
  const child=zip([entry({method:0})]),childRecord=child.subarray(0,offsets(child).central),outerName="unselected-container";
  const archive=zip([entry({name:outerName,method:0,data:childRecord}),entry({method:0})]);
  const secondCentral=offsets(archive).central+46+Buffer.byteLength(outerName);
  archive.writeUInt32LE(30+Buffer.byteLength(outerName),secondCentral+42);
  assert.throws(()=>readGitArchiveScripts(archive,commit,["helper.mjs"]),/Overlapping ZIP entries/);
});
test("shell operation and EXIT cleanup are a single safely quoted Bash scope, with bounded commands",()=>{
  const command=nativeValidationShell(["printf '%s' 'synthetic literal'","native_validation_container=''"]);
  assert.match(command,/^bash -eu -o pipefail -c '/);assert.ok(command.includes("cleanup_native_validation()"));assert.ok(command.includes("trap '".replace("'","'\\''")));
  for(const commands of [[],Array(65).fill("true"),["x".repeat(128*1024+1)],["bad\0command"]]) assert.throws(()=>nativeValidationShell(commands));
});

// Execute Bash only with in-shell mock timeout/docker functions. No actual
// Docker process/container, build, AWS, filesystem write or source is executed.
const bash=process.platform==="win32"?"C:/Program Files/Git/bin/bash.exe":"/bin/bash";
test("mocked one-shell trap preserves failure and cleans only a bounded captured container ID",()=>{
  assert.ok(existsSync(bash),"Explicit supported Bash required for owned synthetic shell acceptance");
  const id="c".repeat(64),mocks=["docker() { printf 'MOCK_DELETE:%s\\n' \"$*\" >&2; }","timeout() { shift; \"$@\"; }"];
  function run(extra) { const command=nativeValidationShell([...mocks,...extra]);return spawnSync(bash,["-c",command],{encoding:"utf8",timeout:10000,maxBuffer:16384}); }
  const failed=run([`native_validation_container='${id}'`,"exit 7"]);assert.equal(failed.status,7);assert.match(failed.stderr,new RegExp(`MOCK_DELETE:rm -f ${id}`));
  const success=run([`native_validation_container='${id}'`,"true"]);assert.equal(success.status,0);assert.match(success.stderr,/MOCK_DELETE/);
  const invalid=run(["native_validation_container='not-a-container'","true"]);assert.equal(invalid.status,70);assert.doesNotMatch(invalid.stderr,/MOCK_DELETE/);
  const empty=run(["true"]);assert.equal(empty.status,0);assert.doesNotMatch(empty.stderr,/MOCK_DELETE/);
  const cleanupFailure=run(["docker() { return 9; }",`native_validation_container='${id}'`,"true"]);assert.equal(cleanupFailure.status,70);
  const retainedFailure=run(["docker() { return 9; }",`native_validation_container='${id}'`,"exit 7"]);assert.equal(retainedFailure.status,7);
});
