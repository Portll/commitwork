// A7 · an attribution claim sent to a peer must carry what it rests on.
//
// THE CONSTRAINT THAT SHAPES THIS. A7 is explicit: scope on the CLAIM, not the name. "Any message
// naming another session" would fire on nearly all mesh traffic, and a gate that always fires is
// furniture — the same argument gate-spine's own banner makes about its ~55 unactioned firings.
//
// The cost being prevented is measured, not imagined: this cycle recorded nine sessions polled about
// a hunk none of them wrote, and a correct change left unlanded because no author could be shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimsAttribution, pathsNamed, receiptFor } from '../lib/gate-message-core.mjs';

test('THE CONSTRAINT: ordinary mesh traffic does not trigger a receipt', () => {
  const ordinary = [
    'I landed 3e9c0a1, pushed. Please rebase before you commit.',
    'Disk is at 89% with 48GB free — your earlier warning is stale.',
    'commitwork-xa: the panel is live on :7878, HTTP 401.',
    'bin/gate-tests.mjs is failing for me under parallel load.',
    'Heads up: I am about to touch monitor/settings.mjs.',
    'Nothing else requested.',
  ];
  for (const m of ordinary) {
    assert.equal(claimsAttribution(m), false, `must stay silent on: ${m}`);
    assert.equal(receiptFor(m), '', 'and must produce no receipt');
  }
});

test('an assertion about ANOTHER party does trigger it', () => {
  const claims = [
    'You touched bin/gate-tests.mjs — please carry those hunks.',
    'Your hunks are in bin/touch-ledger.mjs alongside mine.',
    'Is bin/adjudication-sampler.mjs yours?',
    'Another session touched admin/serve.mjs.',
  ];
  for (const m of claims) assert.equal(claimsAttribution(m), true, `must fire on: ${m}`);
});

test('a self-report is not an attribution claim, even when it names files', () => {
  assert.equal(claimsAttribution('I wrote bin/commit-phase.mjs and I hold bin/gate-tests.mjs.'), false,
    '"I wrote x" carries its own evidence — the speaker is the subject');
});

test('the receipt names the unproven claims FIRST — that is the case it exists for', () => {
  const r = receiptFor('You touched bin/a.mjs and bin/b.mjs.', () => ({ basis: 'unknown' }));
  assert.match(r, /2 of 2 claim\(s\) below rest on NO write evidence/);
  assert.match(r, /Asking is fine; telling is not/);
  assert.match(r, /bin\/a\.mjs — NO WRITE EVIDENCE/);
});

test('a well-evidenced claim is confirmed rather than warned about', () => {
  const r = receiptFor('You touched bin/a.mjs.', () => ({ basis: 'write', session: 'aaaaaaaa' }));
  assert.match(r, /all 1 claim\(s\) below rest on write evidence/);
  assert.match(r, /bin\/a\.mjs — write evidence: aaaaaaaa/);
  assert.doesNotMatch(r, /NO WRITE EVIDENCE/);
});

test('contested authorship is reported as contested, not resolved to one name', () => {
  const r = receiptFor('You touched bin/a.mjs.', () => ({ basis: 'contested', sessions: ['aa', 'bb'] }));
  assert.match(r, /CONTESTED: aa, bb/);
});

test('a claim naming no path says so — an unfalsifiable claim is the worst kind', () => {
  const r = receiptFor('You touched some files earlier.', () => ({ basis: 'write', session: 'x' }));
  assert.match(r, /names no path, so nothing here can be checked/);
});

test('pathsNamed is deduped and bounded — a receipt must not grow without limit', () => {
  assert.deepEqual(pathsNamed('see bin/a.mjs and bin/a.mjs and lib/b.json'), ['bin/a.mjs', 'lib/b.json']);
  const many = Array.from({ length: 40 }, (_, i) => `bin/f${i}.mjs`).join(' ');
  assert.equal(pathsNamed(many).length, 12);
});

test('bare words are not paths — "yours" and prose must not be mistaken for files', () => {
  assert.deepEqual(pathsNamed('is that yours? check the gate please'), []);
});

test('empty and nullish input are safe', () => {
  for (const v of ['', null, undefined]) {
    assert.equal(claimsAttribution(v), false);
    assert.equal(receiptFor(v), '');
  }
});
