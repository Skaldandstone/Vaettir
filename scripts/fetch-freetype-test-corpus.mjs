// Exact corpus referenced by the maintained signed FreeType source's tests.
// Acquires bytes only; never loads/renders a font or runs upstream code.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,open,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const corpus=Object.freeze({
 url:'https://github.com/python-pillow/Pillow/files/6622147/As.I.Lay.Dying.zip',
 archiveBytes:10757,archiveSha256:'09fceee7c335975a454500b000f75ee7f7b5c4f14b2dc241d6416f77967e9d1b',
 archiveName:'As I Lay Dying.ttf',fontName:'As.I.Lay.Dying.ttf',fontBytes:23120,
 fontSha256:'ef146bbc2673b38715afcc70dca484cc64457438da8627a27cf95680e982f0a6',
 signedUpstreamSha256:'686ec73cbf6783b245dd068a09ce807b729ac0f8a46dd70f7867923c32fdf4de',
 originalUpstreamHashPrefix:'ef146bbc2673b387',
});
const hash=b=>createHash('sha256').update(b).digest('hex');
export function requireCorpusBytes(bytes,kind){assert.ok(['archive','font'].includes(kind));assert.ok(Buffer.isBuffer(bytes));assert.equal(bytes.length,kind==='archive'?corpus.archiveBytes:corpus.fontBytes);assert.equal(hash(bytes),kind==='archive'?corpus.archiveSha256:corpus.fontSha256);}
export async function fetchCorpus({fetchImpl=fetch}={}){
 let url=new URL(corpus.url),response;
 for(let count=0;count<4;count++){
  assert.equal(url.protocol,'https:');assert.equal(url.username,'');assert.equal(url.password,'');assert.equal(url.hash,'');
  assert.ok(['github.com','objects.githubusercontent.com','github-production-repository-file-5c1aeb.s3.amazonaws.com'].includes(url.hostname),'Unapproved public corpus transport');
  response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(60000)});
  if(response.status===200)break;
  assert.ok([301,302,303,307,308].includes(response.status));assert.ok(response.headers.get('location'));url=new URL(response.headers.get('location'),url);
 }
 assert.equal(response.status,200);assert.ok(response.body);
 const parts=[];let count=0;
 for await(const b of response.body){count+=b.length;assert.ok(count<=corpus.archiveBytes);parts.push(b);}
 const bytes=Buffer.concat(parts);requireCorpusBytes(bytes,'archive');return bytes;
}
export async function acquireCorpus(destination){
 const base=resolve(destination);assert.ok(base.startsWith('/build/'));await mkdir(base);
 async function save(name,bytes){const f=await open(join(base,name),'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}assert.ok((await readFile(join(base,name))).equals(bytes));}
 await save('corpus-intent.json',Buffer.from(JSON.stringify({...corpus,nativeExecuted:false})+'\n'));
 await save('original-corpus.zip',await fetchCorpus());
 const zip=join(base,'original-corpus.zip');
 const options={timeout:10000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}};
 const names=execFileSync('unzip',['-Z1',zip],options).toString('utf8').trimEnd();assert.equal(names,corpus.archiveName);
 const font=execFileSync('unzip',['-p',zip,corpus.archiveName],options);requireCorpusBytes(font,'font');await save(corpus.fontName,font);
 await save('corpus-custody.json',Buffer.from(JSON.stringify({...corpus,fullHashesMatched:true,nativeExecuted:false,cidAcceptance:false},null,2)+'\n'));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){assert.equal(process.argv.length,3);await acquireCorpus(process.argv[2]);console.log('Exact maintained FreeType standard-test corpus acquired; no native acceptance inferred.');}
