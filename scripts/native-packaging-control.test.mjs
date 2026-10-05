// Actual current recipe contract. Never adapt historical bytes here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const recipe=readFileSync(new URL('./build-llvm-runtime.sh',import.meta.url));
test('current native packaging uses calculated dependencies and keeps output outside protected source',()=>{
  const text=recipe.toString('utf8');
  assert.equal(text.includes('\r'),false);
  assert.equal(createHash('sha256').update(recipe).digest('hex'),'0a35a384df5974dab2163484566a7abe2f65b62cce8061340089a7837e98aa87');
  const commands=text.split('\n').filter(line=>line.startsWith('dpkg-gencontrol '));
  assert.deepEqual(commands,[`dpkg-gencontrol -plibllvm19 -v'1:19.1.7-3+vaettir1' -Tdebian/libllvm19.substvars -f/build/libllvm19.files -P"$root" -O"$root/DEBIAN/control"`]);
  assert.ok(text.includes('> debian/libllvm19.substvars'));
  assert.ok(text.includes('finish final'));
  assert.equal(text.includes('rm -f debian/files'),false);
});
