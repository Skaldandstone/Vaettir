import test from 'node:test';
import assert from 'node:assert/strict';
import {createRepositoryAuthorization,authorizeRepositoryAccount} from './repository-authorization.ts';
function popup(){const calls=[];return {calls,closed:false,opener:{},location:{replace:url=>calls.push(['navigate',url])},close(){this.closed=true;calls.push(['close']);}};}
test('browser click receipt can be consumed exactly once, even across component remounts',()=>{
  const opened=popup();const intent=createRepositoryAuthorization(opened);
  assert.equal(intent.claim(),true);assert.equal(intent.claim(),false);
  assert.equal(intent.window(),opened);intent.cancel();intent.cancel();
  assert.equal(intent.isCancelled(),true);assert.equal(intent.claim(),false);assert.equal(opened.calls.length,1);
});
test('cancelled receipt never starts, closed popup never sends begin',async()=>{
  const opened=popup();const intent=createRepositoryAuthorization(opened);intent.cancel();assert.equal(intent.claim(),false);
  const events=[];await authorizeRepositoryAccount({providerName:'GitLab',preopened:opened,begin:()=>{throw Error('Must not call');},onStarted:()=>assert.fail('Must not start'),onError:message=>events.push(message),onPopup:()=>assert.fail('Must not retain')});
  assert.match(events[0],/window was closed/);
});
test('preopened Connect popup is reused, isolated before begin and navigated only after server approval',async()=>{
  const opened=popup();const events=[];
  await authorizeRepositoryAccount({providerName:'GitLab',preopened:opened,begin:async()=>{assert.equal(opened.opener,null);events.push('begin');return {id:'attempt-1',url:'https://provider.synthetic.example/authorize'};},onStarted:id=>events.push(id),onError:()=>assert.fail('No error expected'),onPopup:window=>assert.equal(window,opened)});
  assert.deepEqual(events,['begin','attempt-1']);assert.deepEqual(opened.calls,[['navigate','https://provider.synthetic.example/authorize']]);
});
test('failed begin closes popup and does not claim an authorized account',async()=>{
  const opened=popup();const events=[];
  await authorizeRepositoryAccount({providerName:'GitLab',preopened:opened,begin:async()=>{throw Error('Synthetic denial');},onStarted:()=>assert.fail('Must not start'),onError:message=>events.push(message),onPopup:()=>{}});
  assert.equal(opened.closed,true);assert.match(events[0],/could not start/);assert.deepEqual(opened.calls,[['close']]);
});
test('closing popup while begin is pending preserves attempt identity for reviewed recovery',async()=>{
  const opened=popup();const events=[];
  await authorizeRepositoryAccount({providerName:'GitLab',preopened:opened,begin:async()=>{opened.closed=true;return {id:'pending-attempt',url:'https://provider.synthetic.example/authorize'};},onStarted:id=>events.push(id),onError:message=>events.push(message),onPopup:()=>{}});
  assert.equal(events[0],'pending-attempt');assert.match(events[1],/Cancel this attempt/);assert.equal(opened.calls.length,0);
});
test('blocked native popup does not call provider begin',async()=>{
  const previous=globalThis.window;globalThis.window={open:()=>null};
  try{const errors=[];await authorizeRepositoryAccount({providerName:'GitLab',begin:()=>assert.fail('Must not begin'),onStarted:()=>assert.fail('Must not start'),onError:message=>errors.push(message),onPopup:()=>assert.fail('No popup')});assert.match(errors[0],/Allow popups/);}finally{globalThis.window=previous;}
});
