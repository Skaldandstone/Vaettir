import test from 'node:test';import assert from 'node:assert/strict';
import {corpus,fetchCorpus,requireCorpusBytes} from './fetch-freetype-test-corpus.mjs';
test('original signed upstream font prefix expands to an exact bounded full hash without claimed CID acceptance',()=>{
 assert.equal(corpus.fontSha256.slice(0,16),corpus.originalUpstreamHashPrefix);assert.equal(corpus.archiveBytes,10757);assert.equal(corpus.fontBytes,23120);
 assert.throws(()=>requireCorpusBytes(Buffer.alloc(corpus.fontBytes),'font'));assert.throws(()=>requireCorpusBytes(Buffer.alloc(corpus.archiveBytes+1),'archive'));assert.throws(()=>requireCorpusBytes(Buffer.alloc(1),'unknown'));
});
test('public corpus transport refuses altered bytes, arbitrary redirects, redirect loops and excess responses',async()=>{
 for(const response of [()=>new Response('short'),()=>new Response(Buffer.alloc(corpus.archiveBytes)),()=>new Response(Buffer.alloc(corpus.archiveBytes+1)),()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}),()=>new Response(null,{status:302,headers:{location:corpus.url}})]){
  await assert.rejects(fetchCorpus({fetchImpl:async(url,options)=>{assert.equal(url.protocol,'https:');assert.equal(options.redirect,'manual');assert.equal(options.headers,undefined);return response();}}));
 }
});
