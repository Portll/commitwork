// Per-field confirmed/contradicted/unverifiable verdicts on an adapter's declared capabilities (lib/memory-port.mjs verifyCapabilities).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyCapabilities } from '../memory-port.mjs';

const TAG = 'commitwork-memory-port-probe';
const v = (verdict, declared, observed, reason = null) => ({ verdict, declared, observed, reason });
const SEMANTIC = v('unverifiable', false, null, 'the port exposes no semantic-recall operation, so nothing here can check this field \u2014 it describes the backend, not the surface. Advisory until an operation gates it.');
const OPS_OK = v('confirmed', 'upsert,getById,forget', 'upsert,getById,forget');
const NO_PROBE = 'probeWrites:false \u2014 no probe was written, so no behaviour was observed. This is an absence of evidence, not a pass.';
const PROBE_MSG = 'verifyCapabilities: probeWrites must be stated explicitly (true|false). A verification that writes nothing verifies nothing, and one that writes by default touches a production store on a call that reads as harmless.';

function make(capOver = {}, { impl, write, read, receipt = {}, forget } = {}) {
  const capabilities = { name: 'a', operations: ['upsert', 'getById', 'forget'], reachability: 'library', storedFormGuarantee: 'full', tagsAuthoritative: true, supportsReadback: true, supportsSemanticRecall: false, previewBytes: 100, ...capOver };
  const calls = { upsert: 0 };
  let saved = null;
  const all = {
    upsert: async (rec) => { calls.upsert += 1; if (write) return write(rec); saved = rec.content; return { state: 'verified', storedForm: 'full', ...receipt }; },
    getById: async () => (read ? read(saved) : { content: saved, tags: [TAG] }),
    forget: async () => (forget ? forget() : true),
  };
  const ops = Object.fromEntries((impl || capabilities.operations).map((k) => [k, all[k]]));
  return { capabilities, ops, calls };
}
const run = (capOver, opts, probeBytes) => verifyCapabilities(make(capOver, opts), { probeWrites: true, probeBytes });
const summary = (r) => [r.confirmed, r.contradicted, r.unverifiable, r.ok, r.trustworthy];

test('rejects an adapter without capabilities and a probeWrites that is not a boolean', async () => {
  const missing = { name: 'Error', message: 'verifyCapabilities: adapter.capabilities is required' };
  await assert.rejects(verifyCapabilities(null, { probeWrites: false }), missing);
  await assert.rejects(verifyCapabilities({ ops: {} }, { probeWrites: false }), missing);
  await assert.rejects(verifyCapabilities(make()), { name: 'Error', message: PROBE_MSG });
  await assert.rejects(verifyCapabilities(make(), { probeWrites: 1 }), { name: 'Error', message: PROBE_MSG });
});

test('a store that keeps the probe byte for byte with its tags confirms every measurable field', async () => {
  const r = await run();
  assert.deepEqual(r.fields, {
    operations: OPS_OK,
    supportsSemanticRecall: SEMANTIC,
    reachability: v('confirmed', 'library', 'reached', "a probe write succeeded from a 'headless' caller. This confirms reachability FROM HERE only."),
    supportsReadback: v('confirmed', true, true),
    storedFormGuarantee: v('confirmed', 'full', 'full'),
    tagsAuthoritative: v('confirmed', true, true),
  });
  assert.deepEqual([r.adapter, r.caller, ...summary(r)], ['a', 'headless', 5, 0, 1, true, false]);
});

test('without probe writes a stale operations table is contradicted and every behaviour stays grey', async () => {
  const a = make({ operations: ['upsert', 'getById'] }, { impl: ['upsert', 'forget'] });
  const r = await verifyCapabilities(a, { probeWrites: false });
  assert.deepEqual(r.fields, {
    operations: v('contradicted', 'upsert,getById', 'upsert,forget', 'declared but not implemented: getById; implemented but not declared (refused at every call site despite working): forget'),
    supportsSemanticRecall: SEMANTIC,
    storedFormGuarantee: v('unverifiable', 'full', null, NO_PROBE),
    tagsAuthoritative: v('unverifiable', true, null, NO_PROBE),
    supportsReadback: v('unverifiable', true, null, NO_PROBE),
    reachability: v('unverifiable', 'library', null, 'no call was made'),
  });
  assert.deepEqual(summary(r), [0, 1, 5, false, false]);
  assert.equal(a.calls.upsert, 0);
});

test('an agent-tool adapter is unverifiable from a headless caller and reachable from an agent session', async () => {
  const a = make({ reachability: 'agent-tool' });
  const r = await verifyCapabilities(a, { probeWrites: true });
  const why = "unreachable from a 'headless' caller";
  assert.deepEqual(r.fields, {
    operations: OPS_OK,
    reachability: v('unverifiable', 'agent-tool', null, "a is reachable only through an attached MCP client (reachability: agent-tool) and the caller is 'headless', which has none. This is a design fact, not an outage \u2014 retrying will never succeed. Nothing about this adapter's behaviour can be measured from a 'headless' caller."),
    supportsSemanticRecall: SEMANTIC,
    storedFormGuarantee: v('unverifiable', 'full', null, why),
    tagsAuthoritative: v('unverifiable', true, null, why),
    supportsReadback: v('unverifiable', true, null, why),
  });
  assert.deepEqual(summary(r), [1, 0, 5, true, false]);
  assert.equal(a.calls.upsert, 0);
  const s = await verifyCapabilities(make({ reachability: 'agent-tool' }), { caller: 'agent-session', probeWrites: true });
  assert.deepEqual(s.fields.reachability, v('confirmed', 'agent-tool', 'reached', "a probe write succeeded from a 'agent-session' caller. This confirms reachability FROM HERE only."));
});

test('a failed probe write contradicts reachability and a failed cleanup is reported', async () => {
  const r = await run({}, { write: () => { throw new Error('boom'); }, forget: () => ({ ok: false, reason: 'locked' }) });
  const why = 'the probe write did not succeed (failed), so nothing downstream was observed';
  assert.deepEqual(r.fields, {
    operations: OPS_OK,
    supportsSemanticRecall: SEMANTIC,
    reachability: v('contradicted', 'library', null, "declared reachable from 'headless' but the probe write did not succeed: upsert threw: boom"),
    storedFormGuarantee: v('unverifiable', 'full', null, why),
    tagsAuthoritative: v('unverifiable', true, null, why),
    supportsReadback: v('unverifiable', true, null, why),
    probeCleanup: v('unverifiable', null, null, 'the probe record commitwork:memory-port:capability-probe could not be removed: locked'),
  });
  assert.deepEqual(summary(r), [1, 1, 5, false, false]);
});

test('a declared-absent readback is contradicted when the probe reads back and confirmed when it does not', async () => {
  const r = await run({ supportsReadback: false });
  assert.deepEqual(r.fields.supportsReadback, v('contradicted', false, true, 'declared no readback, but the probe read back fine \u2014 the declaration forces every receipt to `unknown` for nothing'));
  assert.deepEqual(summary(r), [4, 1, 1, false, false]);
  const n = await run({ supportsReadback: false }, { read: () => null });
  assert.deepEqual(n.fields.supportsReadback, v('confirmed', false, false));
  const x = await run({ supportsReadback: false, operations: ['upsert'] });
  assert.deepEqual(x.fields.supportsReadback, v('unverifiable', false, null, 'no read operation exists, so a negative readback claim cannot be tested \u2014 a negative is not provable by absence of a means to test it'));
  assert.deepEqual(x.fields.probeCleanup, v('unverifiable', null, null, 'a declares no forget operation, so the probe record commitwork:memory-port:capability-probe remains in the store'));
});

test('a declared readback that returns nothing is contradicted and leaves stored form and tags grey', async () => {
  const r = await run({}, { read: () => null });
  const lead = 'declared readback but the probe did not come back readable: ';
  assert.deepEqual(r.fields.supportsReadback, v('contradicted', true, false, `${lead}absent immediately after a successful write`));
  assert.deepEqual(r.fields.storedFormGuarantee, v('unverifiable', 'full', null, 'nothing read back, so what the store kept is not established. Not a pass and not a finding.'));
  assert.deepEqual(r.fields.tagsAuthoritative, v('unverifiable', true, null, 'the readback carried no tag list, so tag behaviour is not established'));
  assert.deepEqual(summary(r), [2, 1, 3, false, false]);
  const t = await run({}, { read: () => { throw new Error('locked'); } });
  assert.deepEqual(t.fields.supportsReadback, v('contradicted', true, false, `${lead}getById threw: locked`));
  const e = await run({}, { read: () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); } });
  assert.deepEqual(e.fields.supportsReadback, v('contradicted', true, false, `${lead}store file does not exist (ENOENT) \u2014 legitimately absent`));
});

test('a full round-trip on a preview store is grey at the budget and contradicted one byte over it', async () => {
  const cap = { storedFormGuarantee: 'preview', previewBytes: 500 };
  const at = await run(cap, {}, 500);
  assert.deepEqual(at.fields.storedFormGuarantee, v('unverifiable', 'preview', 'full', 'the probe (500 bytes) is within the declared 500-byte budget, so a full round-trip proves nothing about larger documents. Re-run with a bigger probeBytes.'));
  const over = await run(cap, {}, 501);
  assert.deepEqual(over.fields.storedFormGuarantee, v('contradicted', 'preview', 'full', "declared 'preview', a 501-byte probe measured 'full' (501 of 501 chars back)"));
  const kept = await run(cap, { read: (c) => ({ content: c.slice(0, 500), tags: [TAG] }) });
  assert.deepEqual(kept.fields.storedFormGuarantee, v('confirmed', 'preview', 'preview'));
});

test('a same-length whitespace rewrite is divergent while a one-char-short prefix is a preview', async () => {
  const d = await run({}, { read: (c) => ({ content: c.replace(' ', '\t'), tags: [TAG] }) });
  assert.deepEqual(d.fields.storedFormGuarantee, v('contradicted', 'full', 'divergent', 'stored text is not derived from the probe at all \u2014 corruption, and no guarantee covers it'));
  const p = await run({}, { read: (c) => ({ content: c.slice(0, 2047), tags: [TAG] }) });
  assert.deepEqual(p.fields.storedFormGuarantee, v('contradicted', 'full', 'preview', "declared 'full', a 2048-byte probe measured 'preview' (2047 of 2048 chars back)"));
});

test('tagsAuthoritative is judged by exact set equality against the tags actually sent', async () => {
  const tags = async (capOver, opts) => (await run(capOver, opts)).fields.tagsAuthoritative;
  const extra = { read: (c) => ({ content: c, tags: [TAG, 'auto'] }) };
  assert.deepEqual(await tags({ tagsAuthoritative: false }), v('contradicted', false, true, 'declared non-authoritative, but the store returned exactly the tags it was sent \u2014 subset-assertion is forgoing the strongest check available here'));
  assert.deepEqual(await tags({ tagsAuthoritative: false }, extra), v('confirmed', false, false));
  assert.deepEqual(await tags({ tagsAuthoritative: null }, extra), v('unverifiable', null, false, 'the declaration is null (never established); this probe observed tagsAuthoritative=false (sent 1, stored 2). Record it in the table.'));
  assert.deepEqual(await tags({}, { read: (c) => ({ content: c, tags: [] }) }), v('contradicted', true, false, 'declared authoritative but the store returned 0 tags for 1 sent \u2014 exact-equality assertions against it would fabricate a failure on every healthy write'));
  assert.deepEqual(await tags({}, { receipt: { tagsSent: ['y', 'x'] }, read: (c) => ({ content: c, tags: ['x', 'y'] }) }), v('confirmed', true, true));
  assert.deepEqual(await tags({}, { receipt: { tagsSent: [] } }), v('confirmed', true, true));
  assert.deepEqual(await tags({}, { read: (c) => ({ content: c }) }), v('unverifiable', true, null, 'the readback carried no tag list, so tag behaviour is not established'));
});
