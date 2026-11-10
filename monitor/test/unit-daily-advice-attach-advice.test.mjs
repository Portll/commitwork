// Attaches a cobolwork advice section to each digest repo whose advice lane ran (monitor/daily-advice.mjs attachAdvice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachAdvice } from '../daily-advice.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LANE = 'sast-cobol-cobolwork';
const repo = (name, lanes, head = 'abcdef1234567890ff') => ({ name, head, lanes, items: [], dataPaths: [] });
const emptyDoc = (extra = {}) => ({ items: [], summary: { ordered: [] }, unmeasured: [], generatedBy: { toolVersion: '1.2.3' }, ...extra });

test('a digest with no ran advice lane comes back untouched without asking for support', async () => {
  const digest = { repos: [repo('a', [{ lane: 'other', state: 'ran' }]), repo('b', [{ lane: LANE, state: 'pending' }])] };
  let asked = 0;
  const bridge = { adviceSupport: async () => { asked++; return { ok: false, reason: 'off' }; } };
  const r = await attachAdvice(digest, { repoPathOf: () => '/nowhere', bridge, env: {} });
  assert.equal(r, digest);
  assert.equal(asked, 0);
  assert.deepEqual(r, { repos: [repo('a', [{ lane: 'other', state: 'ran' }]), repo('b', [{ lane: LANE, state: 'pending' }])] });
});

test('only a repo whose advice lane ran gets the unavailable reason from support', async () => {
  const digest = { repos: [repo('a', [{ lane: 'other', state: 'ran' }, { lane: LANE, state: 'ran' }]), repo('b', [{ lane: 'other', state: 'ran' }])] };
  let advised = 0;
  const bridge = { adviceSupport: async () => ({ ok: false, reason: 'ironwork missing' }), advise: async () => { advised++; return { ok: true, doc: emptyDoc() }; } };
  const r = await attachAdvice(digest, { repoPathOf: () => '/nowhere', bridge, materialise: async () => { throw new Error('unused'); }, env: {} });
  assert.deepEqual(r.repos[0].advice, { state: 'unavailable', reason: 'ironwork missing' });
  assert.equal('advice' in r.repos[1], false);
  assert.equal(advised, 0);
});

test('the ironwork binary comes from CW_IRONWORK_BIN and is null when unset or empty', async () => {
  const run = async (env) => {
    const digest = { repos: [repo('a', [{ lane: LANE, state: 'ran' }])] };
    const bridge = { adviceSupport: async ({ ironwork }) => ({ ok: false, reason: `iw=${ironwork}` }) };
    return (await attachAdvice(digest, { repoPathOf: () => '/nowhere', bridge, env })).repos[0].advice;
  };
  assert.deepEqual(await run({ CW_IRONWORK_BIN: '/opt/iw' }), { state: 'unavailable', reason: 'iw=/opt/iw' });
  assert.deepEqual(await run({ CW_IRONWORK_BIN: '' }), { state: 'unavailable', reason: 'iw=null' });
  assert.deepEqual(await run({}), { state: 'unavailable', reason: 'iw=null' });
});

test('an unavailable support falls back to its unavailable text, then a default, and caps at 600 characters', async () => {
  const run = async (support) => {
    const digest = { repos: [repo('a', [{ lane: LANE, state: 'ran' }])] };
    const bridge = { adviceSupport: async () => support };
    return (await attachAdvice(digest, { repoPathOf: () => '/nowhere', bridge, env: {} })).repos[0].advice;
  };
  assert.deepEqual(await run({ ok: false, unavailable: 'no binary' }), { state: 'unavailable', reason: 'no binary' });
  assert.deepEqual(await run({ ok: false }), { state: 'unavailable', reason: 'no advice was asked for' });
  assert.deepEqual(await run({ ok: false, reason: 'r'.repeat(700) }), { state: 'unavailable', reason: 'r'.repeat(600) });
});

test('a tree that cannot be materialised records the first 12 characters of head and the error', async () => {
  const digest = { repos: [repo('a', [{ lane: LANE, state: 'ran' }], '0123456789abc'), repo('b', [{ lane: LANE, state: 'ran' }], '0123456789ab')] };
  const seen = [];
  const bridge = { adviceSupport: async () => ({ ok: true }), advise: async () => ({ ok: true, doc: emptyDoc() }) };
  const materialise = async (p, head) => { seen.push([p, head]); throw new Error('no tree'); };
  const r = await attachAdvice(digest, { repoPathOf: (n) => `/repos/${n}`, bridge, materialise, env: {} });
  assert.deepEqual(seen, [['/repos/a', '0123456789abc'], ['/repos/b', '0123456789ab']]);
  assert.deepEqual(r.repos[0].advice, { state: 'unavailable', reason: 'the tree at 0123456789ab could not be read for advise: no tree' });
  assert.deepEqual(r.repos[1].advice, { state: 'unavailable', reason: 'the tree at 0123456789ab could not be read for advise: no tree' });
});

test('a successful advise yields a read section and the materialised tree is removed', async () => {
  const base = mkdtempSync(join(tmpdir(), 'attachAdvice-'));
  try {
    const tree = join(base, 'tree');
    const calls = [];
    const materialise = async (p, head) => {
      mkdirSync(join(tree, 'src'), { recursive: true });
      writeFileSync(join(tree, 'src', 'A.cbl'), 'X');
      calls.push(['m', p, head]);
      return tree;
    };
    const bridge = {
      adviceSupport: async () => ({ ok: true }),
      advise: async (dir, { ironwork }) => {
        calls.push(['a', dir, ironwork, existsSync(join(dir, 'src', 'A.cbl'))]);
        return { ok: true, doc: emptyDoc({ unmeasured: ['u1', 'x'.repeat(310)], generatedBy: { toolVersion: 'v'.repeat(50) } }) };
      },
    };
    const digest = { repos: [repo('a', [{ lane: LANE, state: 'ran' }])] };
    const r = await attachAdvice(digest, { repoPathOf: (n) => join(base, n), bridge, materialise, env: { CW_IRONWORK_BIN: '/opt/iw' } });
    assert.deepEqual(calls, [['m', join(base, 'a'), 'abcdef1234567890ff'], ['a', tree, '/opt/iw', true]]);
    assert.deepEqual(r.repos[0].advice, { state: 'read', toolVersion: 'v'.repeat(40), unmeasured: ['u1', 'x'.repeat(300)], ordered: [], omitted: 0, dataPathItems: 0 });
    assert.equal(existsSync(tree), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a materialised tree that is already gone at cleanup still yields a read section', async () => {
  const base = mkdtempSync(join(tmpdir(), 'attachAdvice-'));
  try {
    const gone = join(base, 'gone');
    const bridge = { adviceSupport: async () => ({ ok: true }), advise: async () => ({ ok: true, doc: emptyDoc({ generatedBy: undefined }) }) };
    const digest = { repos: [repo('a', [{ lane: LANE, state: 'ran' }])] };
    const r = await attachAdvice(digest, { repoPathOf: () => base, bridge, materialise: async () => gone, env: {} });
    assert.deepEqual(r.repos[0].advice, { state: 'read', toolVersion: '', unmeasured: [], ordered: [], omitted: 0, dataPathItems: 0 });
    assert.equal(existsSync(gone), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('an advise failure still removes the tree and keeps a head shorter than 12 whole', async () => {
  const base = mkdtempSync(join(tmpdir(), 'attachAdvice-'));
  try {
    const tree = join(base, 't');
    const materialise = async () => { mkdirSync(tree); writeFileSync(join(tree, 'f'), 'y'); return tree; };
    const bridge = { adviceSupport: async () => ({ ok: true }), advise: async () => { throw new Error('bad advise'); } };
    const digest = { repos: [repo('a', [{ lane: LANE, state: 'ran' }], 'abc')] };
    const r = await attachAdvice(digest, { repoPathOf: () => base, bridge, materialise, env: {} });
    assert.deepEqual(r.repos[0].advice, { state: 'unavailable', reason: 'the tree at abc could not be read for advise: bad advise' });
    assert.equal(existsSync(tree), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
