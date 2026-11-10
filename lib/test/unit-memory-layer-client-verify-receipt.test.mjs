// Readback verdict for a memory-layer write receipt (lib/memory-layer-client.mjs verifyReceipt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyReceipt } from '../memory-layer-client.mjs';

const h = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');
const words = (p, a, b) => Array.from({ length: b - a }, (_, i) => p + String(a + i).padStart(2, '0'));
const SRC = words('w', 0, 32).join(' ');
const DASH = '\u2014';

function fake(json, status = 200) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  f.calls = calls;
  return f;
}
const run = (receipt, fetchImpl, extra = {}) => verifyReceipt(receipt, { env: {}, key: 'k', fetchImpl, ...extra });

test('a nested readback whose hash and tags match is verified and is read from the default endpoint', async () => {
  const receipt = { id: 'a/b', contentSha256: h('hello'), tagsSent: ['a', 'b'] };
  const f = fake({ experience: { content: 'hello', tags: ['a', 'b'] } });
  const r = await run(receipt, f);
  assert.deepEqual(r, { ...receipt, storedSha256: h('hello'), tagsStoredCount: 2, state: 'verified', storedForm: 'full', storedCoverage: 1, reason: null });
  assert.deepEqual(f.calls, [{ url: 'http://127.0.0.1:3030/api/memory/a%2Fb?user_id=portll', method: 'GET', headers: { 'X-API-Key': 'k' }, body: undefined }]);
});

test('a supplied cfg sets the readback URL and a flat readback missing tags is accepted but unverified', async () => {
  const receipt = { id: 'm#6', contentSha256: h('hello'), tagsSent: ['a', 'b', 'c'] };
  const f = fake({ content: 'hello', tags: ['a'] });
  const cfg = { url: 'http://mem.test', userId: 'u 1', timeoutMs: 1000, maxRetries: 0 };
  const r = await run(receipt, f, { cfg });
  assert.deepEqual(r, { ...receipt, storedSha256: h('hello'), tagsStoredCount: 1, state: 'accepted-unverified', storedForm: 'full', storedCoverage: 1, reason: 'memory-layer did not retain tag(s): b, c' });
  assert.deepEqual(f.calls.map((c) => c.url), ['http://mem.test/api/memory/m%236?user_id=u%201']);
});

test('tags on the outer readback body are used when the experience carries none', async () => {
  const receipt = { id: 'm3', contentSha256: h('hello'), tagsSent: ['a'] };
  const r = await run(receipt, fake({ experience: { content: 'hello' }, tags: ['a'] }));
  assert.deepEqual(r, { ...receipt, storedSha256: h('hello'), tagsStoredCount: 1, state: 'verified', storedForm: 'full', storedCoverage: 1, reason: null });
});

test('a non-ok readback status is accepted but unverified with the status in the reason', async () => {
  const receipt = { id: 'm4', contentSha256: 'x', tagsSent: [] };
  const r = await run(receipt, fake({ error: 'nope' }, 404));
  assert.deepEqual(r, { ...receipt, state: 'accepted-unverified', reason: 'readback HTTP 404' });
});

test('a fetch that throws is accepted but unverified with the error message in the reason', async () => {
  const receipt = { id: 'm5', contentSha256: 'x', tagsSent: [] };
  const r = await run(receipt, async () => { throw new Error('boom'); });
  assert.deepEqual(r, { ...receipt, state: 'accepted-unverified', reason: 'readback failed: boom' });
});

test('a readback whose content is not a string cannot be compared and is accepted but unverified', async () => {
  const receipt = { id: 'm6', contentSha256: 'x', tagsSent: [] };
  const r = await run(receipt, fake({ experience: { content: 123, tags: ['a'] } }));
  assert.deepEqual(r, { ...receipt, state: 'accepted-unverified', reason: `readback carried no experience.content ${DASH} cannot compare, which is not the same as a mismatch` });
});

test('a hash mismatch with no sent text fails with an unknown stored form', async () => {
  const receipt = { id: 'm7', contentSha256: h('sent'), tagsSent: [] };
  const r = await run(receipt, fake({ experience: { content: 'different', tags: [] } }));
  assert.deepEqual(r, { ...receipt, storedSha256: h('different'), tagsStoredCount: 0, state: 'failed', storedForm: 'unknown', storedCoverage: null, reason: 'no sentText supplied to compare against' });
});

test('stored text with exactly half its shingles from the source is a preview, not corruption', async () => {
  const stored = words('w', 0, 8).concat(words('z', 0, 8)).join(' ');
  const receipt = { id: 'm8', contentSha256: h(SRC), tagsSent: [] };
  const r = await run(receipt, fake({ experience: { content: stored, tags: [] } }), { sentText: SRC });
  assert.deepEqual(r, {
    ...receipt, storedSha256: h(stored), tagsStoredCount: 0, state: 'accepted-unverified', storedForm: 'preview', storedCoverage: 0.25,
    reason: `memory-layer stored a preview, not the document ${DASH} server holds 25.0% of the source ${DASH} the rest was discarded on store. The write succeeded; the record is not a durable copy.`,
  });
});

test('stored text with a third of its shingles from the source fails as divergent', async () => {
  const stored = words('w', 0, 8).concat(words('z', 0, 16)).join(' ');
  const receipt = { id: 'm9', contentSha256: h(SRC), tagsSent: [] };
  const r = await run(receipt, fake({ experience: { content: stored, tags: [] } }), { sentText: SRC });
  assert.deepEqual(r, { ...receipt, storedSha256: h(stored), tagsStoredCount: 0, state: 'failed', storedForm: 'divergent', storedCoverage: 0.25, reason: 'stored text is not derived from the source (33.3% of it appears in the source)' });
});

test('stored text differing from the source only in whitespace is verified as full', async () => {
  const stored = words('w', 0, 32).join('  ');
  const receipt = { id: 'm10', contentSha256: h(SRC), tagsSent: [] };
  const r = await run(receipt, fake({ experience: { content: stored, tags: [] } }), { sentText: SRC });
  assert.deepEqual(r, { ...receipt, storedSha256: h(stored), tagsStoredCount: 0, state: 'verified', storedForm: 'full', storedCoverage: 1, reason: null });
});
