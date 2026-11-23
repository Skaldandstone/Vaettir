import test from "node:test";
import assert from "node:assert/strict";
import {pins,fetchOpenSSLInput} from "./fetch-openssl-runtime-sources.mjs";

test("unapproved or mutated input identities fail before network access",async()=>{
  assert.throws(()=>{pins.patches[0].commit="0".repeat(40);},TypeError);
  let requests=0;
  await assert.rejects(fetchOpenSSLInput({...pins.files[0]},{fetchImpl:()=>{requests++;}}));
  assert.equal(requests,0);
});
test("transport rejects failed, compressed, truncated and modified public inputs",async()=>{
  for(const pin of [pins.files[0],pins.patches[0]])for(const response of [new Response("unavailable",{status:503}),new Response("encoded",{headers:{"content-encoding":"br"}}),new Response(Buffer.alloc(pin.bytes-1)),new Response(Buffer.alloc(pin.bytes))]){
    await assert.rejects(fetchOpenSSLInput(pin,{fetchImpl:async(url,options)=>{
      assert.equal(url,pin.commit?"https://api.github.com/repos/openssl/openssl/commits/"+pin.commit:"https://deb.debian.org/debian/pool/main/o/openssl/"+pin.name);
      assert.equal(options.redirect,"error");assert.equal(options.headers["Accept-Encoding"],"identity");
      if(pin.commit)assert.equal(options.headers.Accept,"application/vnd.github.patch");
      return response;
    }}));
  }
});
