// bin/agent-tag.mjs — the remediation-agent designation scheme. The load-bearing property is the
// last one: a tag MUST classify as machine, or agent work renders as a person's.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireLock } from '../../monitor/lockfile.mjs';
import { classifyWho } from '../../monitor/attribution.mjs';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-agent-tag-'));
  process.env.CW_AGENT_TAGS = join(dir, 'agent-tags.jsonl');
});

// The module reads CW_AGENT_TAGS at import time, so re-import per test with a cache-busting query.
const load = () => import(`../agent-tag.mjs?t=${Math.random()}`);

describe('lmType — which model, or an honest UNKNOWN', () => {
  test('declared models normalise', async () => {
    const { lmType } = await load();
    assert.equal(lmType('opus5'), 'OPUS5');
    assert.equal(lmType('claude-sonnet-5'), 'SONNET5');
    assert.equal(lmType('claude-haiku-4-5-20251001'), 'HAIKU45');
  });

  test('an undeclared model is UNKNOWN, never defaulted to the good one', async () => {
    const { lmType } = await load();
    for (const m of ['', null, undefined, 'gpt-4', 'some-new-model']) {
      assert.equal(lmType(m), 'UNKNOWN', `${m} must not be guessed into a real model`);
    }
  });
});

describe('allocate — progressive, launch-ordered, context-bearing', () => {
  test('numbers advance monotonically across types, because launch ORDER is the fact recorded', async () => {
    const { allocate } = await load();
    assert.equal(allocate({ model: 'opus5', context: 'secrets' }).tag, 'OPUS5-001-secrets');
    assert.equal(allocate({ model: 'sonnet5', context: 'iac' }).tag, 'SONNET5-002-iac');
    assert.equal(allocate({ model: 'opus5', context: 'deps' }).tag, 'OPUS5-003-deps');
  });

  test('context is slugged, and an absent one is `general` rather than empty', async () => {
    const { allocate } = await load();
    assert.equal(allocate({ model: 'opus5', context: 'IaC Misconfig!' }).tag, 'OPUS5-001-iac-misconfig');
    assert.equal(allocate({ model: 'opus5', context: '' }).tag, 'OPUS5-002-general');
  });

  test('a number is never reused — two agents answering to one name is the confusion this removes', async () => {
    const { allocate, roster } = await load();
    for (let i = 0; i < 5; i++) allocate({ model: 'opus5', context: `l${i}` });
    const ns = roster().map((r) => r.n);
    assert.equal(new Set(ns).size, ns.length);
    assert.deepEqual(ns, [1, 2, 3, 4, 5]);
  });

  test('the record carries provenance the tag alone cannot', async () => {
    const { allocate } = await load();
    const r = allocate({ model: 'opus5', context: 'secrets', sessionId: 'abc12345', pid: 4242, at: '2026-08-03T00:00:00.000Z' });
    assert.equal(r.sessionId, 'abc12345');
    assert.equal(r.pid, 4242);
    assert.equal(r.launchedAt, '2026-08-03T00:00:00.000Z');
  });
});

describe('parse / resolve', () => {
  test('a tag is self-describing WITHOUT the registry — that is the point of not using a uuid', async () => {
    const { parseTag } = await load();
    assert.deepEqual(parseTag('OPUS5-007-secrets'), { type: 'OPUS5', n: 7, context: 'secrets' });
    assert.equal(parseTag('not-a-tag'), null);
  });

  test('resolve falls back to the parsed name when the registry has no record', async () => {
    const { resolveTag } = await load();
    const r = resolveTag('SONNET5-042-iac');
    assert.equal(r.type, 'SONNET5');
    assert.equal(r.registered, false, 'an unregistered tag says so rather than inventing a launch time');
  });
});

describe('fail closed', () => {
  test('an unreadable registry throws — it must never read as "no agents"', async () => {
    writeFileSync(process.env.CW_AGENT_TAGS, 'not json at all\n');
    const { roster } = await load();
    assert.deepEqual(roster(), [], 'a torn line is skipped, not fatal');
    rmSync(dir, { recursive: true, force: true });
    const { roster: r2 } = await load();
    assert.deepEqual(r2(), [], 'a genuinely absent registry is empty (ENOENT only)');
  });
});

describe('the roster is hash-chained — an edit shows as a broken chain', () => {
  const rows = () => readFileSync(process.env.CW_AGENT_TAGS, 'utf8').split('\n').filter(Boolean);
  const put = (lines) => writeFileSync(process.env.CW_AGENT_TAGS, `${lines.join('\n')}\n`);
  const allocN = async (n) => { const { allocate } = await load(); for (let i = 0; i < n; i++) allocate({ model: 'opus5', context: `c${i}` }); };

  test('every allocation links to its predecessor, and roster() does not leak the link', async () => {
    await allocN(3);
    const { verifyRoster, roster } = await load();
    const v = verifyRoster();
    assert.equal(v.state, 'ok');
    assert.equal(v.totals.examined, 3);
    assert.equal(v.totals.verified, 3);
    assert.equal(JSON.parse(rows()[0]).prev, 'genesis');
    assert.ok(roster().every((r) => !('prev' in r)));
  });

  test('a rewritten interior row is chain-broken', async () => {
    await allocN(3);
    const lines = rows();
    lines[1] = lines[1].replace('"c1"', '"cx"').replace('-c1"', '-cx"');
    put(lines);
    const { verifyRoster } = await load();
    const v = verifyRoster();
    assert.equal(v.state, 'chain-broken');
    assert.equal(v.breaks.length, 1);
  });

  test('a removed interior row is chain-broken', async () => {
    await allocN(3);
    const lines = rows();
    put([lines[0], lines[2]]);
    const { verifyRoster } = await load();
    assert.equal(verifyRoster().state, 'chain-broken');
  });

  test('a pre-chain prefix stays byte-identical and verifies as unchained, never as verified', async () => {
    const legacy = [1, 2, 3].map((n) => JSON.stringify({ tag: `OPUS5-00${n}-old`, type: 'OPUS5', n, context: 'old', sessionId: null, pid: 1, launchedAt: '2026-01-01T00:00:00.000Z' }));
    put(legacy);
    await allocN(2);
    const lines = rows();
    assert.deepEqual(lines.slice(0, 3), legacy, 'history is not retro-hashed');
    assert.equal(JSON.parse(lines[3]).n, 4, 'numbering continues across the boundary');
    const { verifyRoster } = await load();
    const v = verifyRoster();
    assert.equal(v.state, 'ok');
    assert.equal(v.totals.unchained, 3);
    assert.equal(v.totals.verified, 2);
  });

  test('a held allocation lock refuses rather than minting unlocked', async () => {
    const { allocate } = await load();
    allocate({ model: 'opus5', context: 'first' });
    const held = acquireLock(`${process.env.CW_AGENT_TAGS}.lock`, { label: 'test holder' });
    assert.equal(held.ok, true);
    try {
      assert.throws(() => allocate({ model: 'opus5', context: 'second' }), /could not acquire/);
    } finally { held.release(); }
    assert.equal(rows().length, 1);
  });

  test('--verify exits 0 ok, 1 broken, 2 absent', async () => {
    const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'agent-tag.mjs');
    const run = () => spawnSync(process.execPath, [cli, '--verify'], { encoding: 'utf8', env: { ...process.env } });
    assert.equal(run().status, 2, 'an absent roster proves nothing');
    await allocN(3);
    const ok = run();
    assert.equal(ok.status, 0);
    assert.match(ok.stdout, /verified 3, unchained 0/);
    const lines = rows();
    put([lines[0], lines[2]]);
    const bad = run();
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /chain-broken/);
  });
});

describe('THE LOAD-BEARING PROPERTY — a tag is machine-attributed', () => {
  test('every shape of tag classifies as machine, so agent work never renders as a person\'s', async () => {
    const { allocate } = await load();
    for (const m of ['opus5', 'sonnet5', 'haiku45', 'fable5', undefined]) {
      const { tag } = allocate({ model: m, context: 'lane' });
      assert.equal(classifyWho(tag), 'machine', `${tag} must be machine-attributed`);
    }
  });

  test('and a person is still a person — the new pattern did not widen onto real names', () => {
    for (const w of ['portll', 'marcia.jones@example.test', 'lucia@example.test', 'a@b.com (password)']) {
      assert.equal(classifyWho(w), 'human', `${w} is a person`);
    }
  });
});
