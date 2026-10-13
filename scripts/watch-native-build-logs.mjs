// Stream exact owned vendor build logs during the unchanged fail-hard build.
// No file rewriting, source downloads, log normalization or test admission.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {openSync,closeSync,readSync,fstatSync,lstatSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root='/build/runtime-security';
export const logs=Object.freeze(['glibc/extract.log','glibc/package-build.log','glibc/upstream-check.log','glibc/upstream-abi.log','freetype/extract.log','freetype/package-build.log','freetype/meson-setup.log','freetype/meson-compile.log','freetype/meson-test.log']);
export function requireLogState(before,next){
 assert.ok(next.regular&&!next.symlink);assert.ok(Number.isSafeInteger(next.bytes)&&next.bytes>=0&&next.bytes<=64*1024**2);
 if(before){assert.equal(next.dev,before.dev);assert.equal(next.ino,before.ino);assert.ok(next.bytes>=before.bytes,'Vendor log truncated/replaced');}
 return next;
}
export function streamLogRange(fd,start,end,write){
 assert.ok(Number.isSafeInteger(start)&&start>=0);
 assert.ok(Number.isSafeInteger(end)&&end>=start&&end<=64*1024**2);
 const buffer=Buffer.alloc(65536);let position=start;
 while(position<end){
  const n=readSync(fd,buffer,0,Math.min(buffer.length,end-position),position);
  assert.ok(n>0,'Vendor log ended before its observed size');position+=n;
  // A pipe may retain a chunk after write returns. Never enqueue a view of
  // the reusable read buffer: later reads would replace the queued evidence.
  write(Buffer.from(buffer.subarray(0,n)));
 }
 return position-start;
}
async function main(){
 assert.equal(process.platform,'linux');assert.notEqual(process.getuid(),0);
 const args=process.argv.slice(2);assert.deepEqual(args,['/build/scripts/build-maintained-runtime.sh','/build/scripts/runtime-security-sources.json','/build/glibc-sources','/build/freetype-sources',root,'/build/scripts/runtime-build-proof.mjs','/build/freetype-standard-corpus']);
 const states=new Map();let total=0,finished=false,fault,child;
 const stop=()=>{if(child?.pid&&!finished){try{process.kill(-child.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}}};
 const drain=()=>{
  for(const name of logs){const path=root+'/'+name;let stat;try{stat=lstatSync(path);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   const before=states.get(name),next=requireLogState(before,{regular:stat.isFile(),symlink:stat.isSymbolicLink(),bytes:stat.size,dev:stat.dev,ino:stat.ino});
   if(next.bytes>(before?.bytes??0)){const fd=openSync(path,'r');try{const actual=fstatSync(fd);assert.equal(actual.dev,next.dev);assert.equal(actual.ino,next.ino);const position=before?.bytes??0;assert.ok(total+next.bytes-position<=64*1024**2,'Aggregate vendor log bound exceeded');process.stdout.write('\nNATIVE_VENDOR_LOG '+name+' '+position+'..'+next.bytes+'\n');total+=streamLogRange(fd,position,next.bytes,chunk=>process.stdout.write(chunk));}finally{closeSync(fd);}}
   states.set(name,next);
  }
 };
 child=spawn('/bin/sh',args,{detached:true,stdio:['ignore','inherit','inherit']});
 const timer=setInterval(()=>{try{drain();}catch(error){fault=error;stop();}},5000);
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,stop);
 const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 finished=true;clearInterval(timer);drain();if(fault)throw fault;
 if(result.code!==0||result.signal){console.error('Native build failed; original streamed vendor evidence retained.');process.exitCode=result.code??1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
