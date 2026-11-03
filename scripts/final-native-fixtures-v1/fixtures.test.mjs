import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { elf } from "./elf.mjs";
import { hash, pinned, command, identity, begin } from "./core.mjs";
import { installed, consumers, browser, prisma, schemaRpc, validateSchemaResponse, runFixture } from "./probes.mjs";

// Synthetic ELF bytes, never compiled or loaded. Exercise both word sizes/endians.
function binary({ wide = true, little = true, defined = [], undefined: missing = [], needed = [], sonames = [] } = {}) {
  const b = Buffer.alloc(4096), u16 = (at,n) => little ? b.writeUInt16LE(n,at) : b.writeUInt16BE(n,at), u32 = (at,n) => little ? b.writeUInt32LE(n,at) : b.writeUInt32BE(n,at);
  const word = (at,n) => wide ? (little ? b.writeBigUInt64LE(BigInt(n),at) : b.writeBigUInt64BE(BigInt(n),at)) : u32(at,n);
  b.set([127,69,76,70,wide?2:1,little?1:2]); u16(18,62); word(wide?40:32,64);u16(wide?58:46,wide?64:40);u16(wide?60:48,4);
  let text="\0"; const strings=new Map();for(const s of [...defined,...missing,...needed,...sonames])if(!strings.has(s)){strings.set(s,Buffer.byteLength(text));text+=s+"\0";}
  b.write(text,512);
  const section=(i,type,offset,size,link,entry)=>{const at=64+i*(wide?64:40);u32(at+4,type);word(at+(wide?24:16),offset);word(at+(wide?32:20),size);u32(at+(wide?40:24),link);word(at+(wide?56:36),entry);};
  section(1,3,512,Buffer.byteLength(text),0,0); const sym=wide?24:16, dyn=wide?16:8;
  section(2,11,1024,(defined.length+missing.length+1)*sym,1,sym);
  [...defined,...missing].forEach((name,i)=>{const at=1024+(i+1)*sym;u32(at,strings.get(name));b[at+(wide?4:12)]=16;u16(at+(wide?6:14),i<defined.length?1:0);});
  section(3,6,2048,(needed.length+sonames.length+1)*dyn,1,dyn);
  [...needed.map(n=>[1,n]),...sonames.map(n=>[14,n])].forEach(([tag,n],i)=>{word(2048+i*dyn,tag);word(2048+i*dyn+(wide?8:4),strings.get(n));});
  return b;
}
function memory(entries = {}) {
  const files=new Map(Object.entries(entries)), writes=new Map();
  const io={platform:"linux",read:p=>{if(files.has(p))return files.get(p);if(writes.has(p))return Buffer.from(writes.get(p));throw Error("missing "+p);},
    stat:p=>({isFile:()=>files.has(p),isSymbolicLink:()=>false,isDirectory:()=>p==="/vaettir-sqlite-observation-v1",size:files.get(p)?.length,mode:0o755,uid:0,gid:0}),
    real:p=>p,exists:p=>files.has(p)||writes.has(p),mkdir:()=>{},write:(p,b)=>{assert(!writes.has(p));writes.set(p,b);}};
  const row=p=>({path:p,sha256:hash(files.get(p)),bytes:files.get(p).length,mode:0o755,uid:0,gid:0,nativeKind:"ELF"});
  return {io,files,writes,row};
}
for(const wide of [false,true])for(const little of [false,true])test(`ELF ${wide?64:32} ${little?"LE":"BE"} direct symbols and SONAME`,()=>{
  const x=elf(binary({wide,little,defined:["sqlite3_open"],undefined:["dlopen"],needed:["libc.so.6"],sonames:["libsqlite3.so.0"]}));
  assert.deepEqual(x.defined,["sqlite3_open"]);assert.deepEqual(x.undefined,["dlopen"]);assert.deepEqual(x.needed,["libc.so.6"]);assert.deepEqual(x.sonames,["libsqlite3.so.0"]);
});
test("ELF rejects truncated, unsupported and out-of-range sections",()=>{
  assert.throws(()=>elf(Buffer.alloc(63)),/header/);const b=binary();b[4]=0;assert.throws(()=>elf(b),/class/);
  const c=binary();c.writeBigUInt64LE(2n**63n,40);assert.throws(()=>elf(c),/overflow/);
  const d=binary();d.writeBigUInt64LE(4096n,64+64+24);assert.throws(()=>elf(d),/range|reference/);
});
test("ELF rejects malformed symbol stride and missing dynamic termination",()=>{
  const b=binary();b.writeBigUInt64LE(23n,64+128+56);assert.throws(()=>elf(b),/symbol/);
  const c=binary();c.writeBigUInt64LE(1n,2048);assert.throws(()=>elf(c),/terminator/);
});
test("Pinned native bytes require mode, owner, regular type and hash",()=>{
  const m=memory({"/lib":Buffer.from("real")}),r=m.row("/lib");assert.equal(pinned(m.io,r).toString(),"real");
  for(const change of [{mode:0o777},{uid:1},{sha256:"0".repeat(64)},{bytes:99}])assert.throws(()=>pinned(m.io,{...r,...change}));
  assert.throws(()=>pinned({...m.io,stat:()=>({isFile:()=>false,isSymbolicLink:()=>true})},r),/regular/);
});
test("Child error diagnostics are retained before failure",()=>{
  const m=memory();m.io.spawn=()=>({status:null,signal:"SIGKILL",error:Object.assign(Error("failed"),{code:"EACCES",errno:-13,syscall:"spawn"}),stdout:"out",stderr:"err"});
  assert.throws(()=>command(m.io,"probe","/probe",[],"/out"),/failed/);
  const r=JSON.parse(m.writes.get("/out/probe.json"));assert.equal(r.error.code,"EACCES");assert.equal(r.error.errno,-13);assert.equal(r.signal,"SIGKILL");assert.equal(r.stderr,"err");
});
test("SQLite identity binds loaded library, source and exact unique options",()=>{
  const p={sqlite:{version:"v",sourceId:"s",library:{path:"/lib"},options:["A"]}},text="VERSION=v\nSOURCE_ID=s\nLIBRARY=/lib\nOPTION=A\n";
  assert.equal(identity(text,p,{real:x=>x}).version,"v");for(const bad of [text.replace("SOURCE_ID=s","SOURCE_ID=t"),text+"OPTION=A\n",text.replace("/lib","/other")])assert.throws(()=>identity(bad,p,{real:x=>x}));
});
test("Installed SQLite requires real functional markers and exact package/ABI state",()=>{
  const m=memory({"/libsqlite3":binary({defined:["sqlite3_open"],sonames:["libsqlite3.so.0"]})}),probe=Buffer.from("external reviewed synthetic tool");
  const p={sqlite:{library:m.row("/libsqlite3"),exports:["sqlite3_open"],probeBase64:probe.toString('base64'),probeSha256:hash(probe),probeBytes:probe.length,version:"v",sourceId:"s",options:["A"],packageVersion:"package",depends:"libc6 (>= 2.41)"}};
  let marker=true;
  m.io.spawn=(exe,args)=>({status:0,signal:null,stdout:exe.endsWith('sqlite-runtime-regression')?'VERSION=v\nSOURCE_ID=s\nLIBRARY=/libsqlite3\nOPTION=A\n'+(marker?'COUNT_VALUES_REJECTED:400000\nSQLITE_FUNCTIONAL_OK':'') : args[0]==='-W'?'install ok installed\npackage\npackage\namd64\nlibc6 (>= 2.41)\n':args[0]==='-S'?'libsqlite3-0:amd64: /libsqlite3\n':'',stderr:"actual child capture"});
  assert.equal(installed(p,m.io,"/first").functional,true);assert(m.writes.has('/first/functional.json'));
  marker=false;assert.throws(()=>installed(p,m.io,"/second"),/functional regressions/);
});
function consumerCase() {
  const m=memory({"/libsqlite3":binary({defined:["sqlite3_open"]}),"/consumer":binary({undefined:["sqlite3_open","dlopen"],needed:["libsqlite3.so.0"]})});
  const p={sqlite:{library:m.row("/libsqlite3"),consumers:[{path:"/consumer",sha256:m.row("/consumer").sha256,undefinedSQLiteSymbols:["sqlite3_open"]}]},nativeRows:[m.row("/libsqlite3"),m.row("/consumer")]};return {...m,p};
}
test("Full native consumer scan reports dynamic uncertainty honestly",()=>{
  const m=consumerCase(),r=consumers(m.p,m.io);assert.equal(r.scanned.length,2);assert.equal(r.directConsumers.length,1);assert.equal(r.completeDynamicLookupClosureAccepted,false);assert.equal(r.independentDynamicLookupReviewRequired,true);assert(r.dynamicCandidates.some(x=>x.path==="/consumer"));
});
test("Consumer set omissions and lost ABI symbols refuse",()=>{
  const m=consumerCase();m.p.sqlite.consumers=[];assert.throws(()=>consumers(m.p,m.io),/set differs/);
  const n=consumerCase();n.files.set("/libsqlite3",binary({defined:["sqlite3_other"]}));n.p.sqlite.library=n.row("/libsqlite3");n.p.nativeRows[0]=n.row("/libsqlite3");assert.throws(()=>consumers(n.p,n.io),/ABI symbol/);
});
test("Web records actual=false only after rehashing the complete native set",async()=>{
  const m=memory({"/ordinary":Buffer.from("native")}),p={role:"web",prisma:{applicable:false,engines:[]},browser:null,nativeRows:[m.row("/ordinary")],finalInventorySha256:"a".repeat(64)};
  const r=await prisma(p,m.io,"/out");assert.equal(r.actual,false);assert.equal(r.absenceObserved,true);assert.deepEqual(r.scanned,p.nativeRows);
  await assert.rejects(()=>prisma({...p,finalInventorySha256:null},m.io,"/out"),/binding/);
  await assert.rejects(()=>prisma({...p,nativeRows:[{...p.nativeRows[0],path:"/query-engine"}]},m.io,"/out"),/gained/);
  await assert.rejects(()=>prisma({...p,prisma:{applicable:true,engines:[]}},m.io,"/out"),/changed/);
});
function rpcIO(m, response={jsonrpc:"2.0",id:1,result:{executedSteps:1,warnings:[],unexecutable:[]}},code=0) {
  m.io.spawnAsync=()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();let sent=false;
    c.stdin.write=line=>{const req=JSON.parse(line);if(req.method){assert.equal(req.method,"schemaPush");assert.equal(req.params.force,false);if(!sent){sent=true;queueMicrotask(()=>c.stdout.emit("data",Buffer.from(JSON.stringify(response)+"\n")));}}};
    c.stdin.end=()=>queueMicrotask(()=>c.emit("close",code,null));c.kill=()=>queueMicrotask(()=>c.emit("close",null,"SIGKILL"));return c;};return m;
}
test("Schema RPC validates genuine executed steps and preserves child failures",async()=>{
  const m=rpcIO(memory());assert.equal((await schemaRpc(m.io,"/schema","schema","/out")).executedSteps,1);assert(m.writes.has("/out/schema-command.json"));
  const n=rpcIO(memory(),{jsonrpc:"2.0",id:1,result:{executedSteps:1,warnings:[],unexecutable:[]}},1);await assert.rejects(()=>schemaRpc(n.io,"/schema","schema","/out"),/child/);
  for(const response of [{jsonrpc:"2.0",id:1,error:{}},{jsonrpc:"2.0",id:1,result:{executedSteps:0,warnings:[],unexecutable:[]}},{jsonrpc:"2.0",id:1,result:{executedSteps:1,warnings:["warning"],unexecutable:[]}}])assert.throws(()=>validateSchemaResponse(response));
});
test("API Prisma invokes both native engines and creates/reads a fresh synthetic DB",async()=>{
  const m=rpcIO(memory({"/query":Buffer.from("q"),"/schema":Buffer.from("s")}));let connected=false,disconnected=false;
  m.io.load=p=>{assert.equal(p,"/query");return {QueryEngine:class {constructor(options){assert.equal(options.engineProtocol,"json");assert(options.datamodel.includes('provider = "sqlite"'));}async connect(){connected=true;}async query(raw){const x=JSON.parse(raw);assert(connected);m.files.set("/out/synthetic.db",Buffer.from("SQLite format 3\0"));return JSON.stringify({data:{[x.action+"NativeProbe"]:{id:73,value:"native-probe"}}});}async disconnect(){disconnected=true;}}};};
  const p={role:"api",prisma:{applicable:true,engines:[m.row("/query"),m.row("/schema")],queryPath:"/query",schemaPath:"/schema"}};
  const result=await prisma(p,m.io,"/out");assert.equal(result.actualCreateAndRead,true);assert.equal(result.schemaSteps,1);assert(disconnected);
  await assert.rejects(()=>prisma(p,m.io,"/out"),/Existing database/);
});
test("API Prisma refuses an absent schema engine and cannot use Web absence",async()=>{
  const m=memory(),p={role:"api",prisma:{applicable:false,engines:[]}};await assert.rejects(()=>prisma(p,m.io,"/out"),/cannot be waived/);
  await assert.rejects(()=>prisma({...p,prisma:{applicable:true,engines:[]}},m.io,"/out"),/Exact query/);
});
test("Browser exercises DOM and raster, blocks requests and closes",async()=>{
  const m=memory({"/browser":Buffer.from("b")});let clicked=false,closed=false,route;
  const page={setContent:async html=>assert(html.includes("onclick")),locator:()=>({click:async()=>{clicked=true;},textContent:async()=>clicked?"clicked":"initial"}),title:async()=>"Native probe",screenshot:async()=>Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(101)])};
  m.io.load=()=>({chromium:{launch:async opts=>{assert.equal(opts.executablePath,"/browser");return {newContext:async()=>({route:async(_,r)=>{route=r;},newPage:async()=>page,close:async()=>{}}),version:()=>"test",close:async()=>{closed=true;}};}}});
  const r=await browser({role:"api",browser:{binary:m.row("/browser"),module:"module"}},m.io,"/out");assert(r.actual&&clicked&&closed&&route);assert.equal(r.customerPage,false);
});
test("Fixture cannot execute without exact final image and parent plan",()=>{
  const m=memory({"/run/vaettir-native/native-plan.json":Buffer.from('{}')}),p={source:"94cde34624bcc910c5f8c1a19214302ffa04c2bf",role:"api",kind:"prisma",image:null};
  assert.throws(()=>begin(p,m.io),/final image/);assert.throws(()=>begin({...p,image:'051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api@sha256:'+"a".repeat(64)},m.io),/parent/);
});
test("Fixture failure emits no positive observation",async()=>{
  const p={source:"94cde34624bcc910c5f8c1a19214302ffa04c2bf",role:"api",kind:"prisma",prisma:{applicable:false},image:'051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api@sha256:'+"a".repeat(64)},m=memory({"/run/vaettir-native/native-plan.json":Buffer.from(JSON.stringify(p))});
  await assert.rejects(()=>runFixture(p,m.io),/cannot be waived/);assert(m.writes.has("/vaettir-sqlite-observation-v1/fixture-prisma/failure.json"));assert(!m.writes.has("/vaettir-sqlite-observation-v1/fixture-prisma/observation.json"));
});
