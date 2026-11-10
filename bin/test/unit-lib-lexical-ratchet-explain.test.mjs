// Human-readable diff summary of ratchet changes (bin/lib/lexical-ratchet.mjs explain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../lib/lexical-ratchet.mjs';

test('returns empty string when there are no added or stale offenders', () => {
  const r = explain('lint', { added: [], stale: [] }, { fixHint: 'run linter' });
  assert.equal(r, "");
});

test('reports new offenders with the fix hint when only added is non-empty', () => {
  const r = explain('lint', { added: ['a.js', 'b.js'], stale: [] }, { fixHint: 'run linter' });
  assert.equal(r, "lint: 2 NEW offender(s) \u2014 run linter\n  a.js\n  b.js");
});

test('reports a single stale baseline entry using singular form', () => {
  const r = explain('lint', { added: [], stale: ['old.js'] }, { fixHint: 'run linter' });
  assert.equal(r, "lint: 1 baseline entry no longer offend \u2014 remove them from the baseline so the ratchet only tightens\n  old.js");
});

test('reports multiple stale baseline entries using plural form', () => {
  const r = explain('lint', { added: [], stale: ['old1.js', 'old2.js'] }, { fixHint: 'run linter' });
  assert.equal(r, "lint: 2 baseline entries no longer offend \u2014 remove them from the baseline so the ratchet only tightens\n  old1.js\n  old2.js");
});

test('reports both new offenders and stale baseline entries together', () => {
  const r = explain('lint', { added: ['new.js'], stale: ['old1.js', 'old2.js'] }, { fixHint: 'run linter' });
  assert.equal(r, "lint: 1 NEW offender(s) \u2014 run linter\n  new.js\nlint: 2 baseline entries no longer offend \u2014 remove them from the baseline so the ratchet only tightens\n  old1.js\n  old2.js");
});

test('uses singular form for exactly one stale entry and plural for two', () => {
  const one = explain('check', { added: [], stale: ['x.js'] }, { fixHint: 'fix it' });
  const two = explain('check', { added: [], stale: ['x.js', 'y.js'] }, { fixHint: 'fix it' });
  assert.deepEqual([one, two], ["check: 1 baseline entry no longer offend \u2014 remove them from the baseline so the ratchet only tightens\n  x.js", "check: 2 baseline entries no longer offend \u2014 remove them from the baseline so the ratchet only tightens\n  x.js\n  y.js"]);
});
