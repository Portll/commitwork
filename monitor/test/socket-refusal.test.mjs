// node --test monitor/test/socket-refusal.test.mjs — a Socket REFUSAL is not an absence, and it
// is a subtype of VOID (status:'noscan' carrying a `refusal`), never a sibling status — a sibling
// would leave every void counter blind to it. Both halves pinned: distinguishable, still a void.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { socketRefusal, _socketCounts } from '../extractors.mjs';

const withDir = (fn) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-sockref-'));
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
};
const write = (d, obj) => writeFileSync(join(d, 'socket.json'), typeof obj === 'string' ? obj : JSON.stringify(obj));

// the shape every refusal in the corpus actually carries — a made-up shape proves the test's imagination
test('the historical refusal shape is recognised as a refusal', () => {
  withDir((d) => {
    write(d, { ok: false, message: 'Input error', data: {} });
    const r = socketRefusal(d);
    assert.ok(r, 'the shape every socket.json refusal in reports/ carries must be detected');
    assert.equal(r.refused, true);
    assert.equal(r.message, 'Input error');
    assert.equal(r.quota, false, 'an input error is NOT a quota refusal and must never be labelled one');
  });
});

// quota is claimed only when the provider's own words say so — never inferred
test('quota is read from the provider`s words, never inferred', () => {
  for (const [msg, expected] of [
    ['Monthly quota exceeded', true],
    ['429 Too Many Requests', true],
    ['rate limit reached for this organization', true],
    ['Payment Required — upgrade your plan', true],
    ['Input error', false],
    ['organization not found', false],
    ['', false],
  ]) {
    withDir((d) => {
      write(d, { ok: false, message: msg });
      assert.equal(socketRefusal(d).quota, expected, `message ${JSON.stringify(msg)} misclassified`);
    });
  }
});

test('a refusal with no message still refuses, and says the message was absent', () => {
  withDir((d) => {
    write(d, { ok: false });
    const r = socketRefusal(d);
    assert.equal(r.refused, true);
    assert.match(r.message, /no message field/, 'an empty string would read as a refusal with no reason given');
    assert.equal(r.quota, false);
  });
});

// states that are NOT refusals — each is already handled elsewhere
test('absence, husk and a completed scan are not refusals', () => {
  withDir((d) => assert.equal(socketRefusal(d), null, 'no artifact: a void, but nobody refused anything'));
  withDir((d) => { write(d, '   '); assert.equal(socketRefusal(d), null, 'a zero-byte husk refuses nothing'); });
  withDir((d) => { write(d, '{"ok":false, TRUNCATED'); assert.equal(socketRefusal(d), null, 'unparseable has its own state already'); });
  withDir((d) => { write(d, { ok: true, data: { alerts: {} } }); assert.equal(socketRefusal(d), null, 'it ran'); });
  withDir((d) => { write(d, { issues: [] }); assert.equal(socketRefusal(d), null, 'legacy completed shape'); });
});

// the other half: _socketCounts must still answer null (void), or the fix trades one blind spot for another
test('a refusal still counts as a VOID, not as zero findings', () => {
  withDir((d) => {
    write(d, { ok: false, message: 'Monthly quota exceeded' });
    assert.equal(_socketCounts(d, 'socket.json'), null,
      'a refusal must remain null to the counter: ran:true/total:0 is byte-identical to a clean scan, which is the defect this lane already had');
    assert.equal(socketRefusal(d).quota, true, 'and it must simultaneously be distinguishable as a refusal');
  });
});

// same bytes, same answer
test('the classifier is deterministic on identical bytes', () => {
  withDir((d) => {
    write(d, { ok: false, message: 'rate limit reached' });
    assert.deepEqual(socketRefusal(d), socketRefusal(d));
  });
});
