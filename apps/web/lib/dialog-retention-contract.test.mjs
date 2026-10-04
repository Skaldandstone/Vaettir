import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Narrow source contract, not a substitute for actual rendered focus review.
const source = readFileSync(new URL('../components/ui/DialogFrame.tsx', import.meta.url), 'utf8');
test('retained dialogs publish native inert before focus and preserve opt-in mounting', () => {
  assert.match(source, /keepMounted = false/);
  assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*?dialog\.inert = !open;[\s\S]*?\}, \[open, keepMounted\]\)/);
  assert.match(source, /if \(\(!open && !keepMounted\) \|\| typeof document === "undefined"\) return null/);
  assert.match(source, /style=\{!open \? \{ \.\.\.style, display: "none" \} : style\}/);
  assert.match(source, /hidden=\{!open\}/);
  assert.doesNotMatch(source, /\binert=\{/);
});
test('native open/close, opener restoration and nested Escape boundaries remain', () => {
  assert.match(source, /dialog\.showModal\(\)/);
  assert.match(source, /dialog\.close\(\)/);
  assert.match(source, /if \(opener\?\.isConnected\) opener\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /event\.target\.closest\("dialog"\) !== event\.currentTarget/);
  assert.match(source, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*if \(dismissible\) onClose\(\)/);
});
