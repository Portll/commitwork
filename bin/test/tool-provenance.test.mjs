// lib/tool-provenance.mjs: the store setup writes and doctor reads. The path is read at call time,
// ENOENT is the empty store, anything else is an error, a write is atomic, and a tool with no
// record is unrecorded rather than unranked or trusted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provenancePath, readProvenance, recordProvenance, channelKey, tierFor, CHANNEL_TIERS } from '../../lib/tool-provenance.mjs';

function scratch(t) {
  const d = mkdtempSync(join(tmpdir(), 'cw-provenance-'));
  t.after(() => { rmSync(d, { recursive: true, force: true }); delete process.env.CW_TOOL_PROVENANCE; });
  return d;
}

test('the path honours CW_TOOL_PROVENANCE at call time', (t) => {
  const d = scratch(t);
  const before = provenancePath();
  process.env.CW_TOOL_PROVENANCE = join(d, 'p.json');
  assert.equal(provenancePath(), join(d, 'p.json'));
  assert.notEqual(before, provenancePath());
});

test('an absent store is empty; a corrupt one throws; a wrong shape throws', (t) => {
  const d = scratch(t);
  assert.deepEqual(readProvenance(join(d, 'absent.json')), { tools: {} });
  writeFileSync(join(d, 'bad.json'), '{');
  assert.throws(() => readProvenance(join(d, 'bad.json')), SyntaxError);
  writeFileSync(join(d, 'shape.json'), '[]');
  assert.throws(() => readProvenance(join(d, 'shape.json')), /not a provenance store/);
});

test('recording writes atomically, keeps other tools, and honours CW_NOW', (t) => {
  const d = scratch(t);
  const p = join(d, 'nested', 'p.json');
  recordProvenance('a', { via: 'brew', now: '2026-10-08T00:00:00.000Z' }, p);
  const rec = recordProvenance('b', { via: 'release', signatureTier: 'cosign', detail: 'x', now: '2026-10-08T00:00:01.000Z' }, p);
  assert.deepEqual(rec, { channel: 'release/cosign', via: 'release', signatureTier: 'cosign', detail: 'x', at: '2026-10-08T00:00:01.000Z' });
  const data = JSON.parse(readFileSync(p, 'utf8'));
  assert.deepEqual(Object.keys(data.tools), ['a', 'b']);
  assert.equal(data.tools.a.channel, 'brew');
  assert.deepEqual(readdirSync(join(d, 'nested')), ['p.json'], 'no tmp file left behind');
});

test('channel keys and tiers: release splits on signature, every channel setup drives is ranked, unknown is unrecorded', () => {
  assert.equal(channelKey('release', 'cosign'), 'release/cosign');
  assert.equal(channelKey('release', 'sha256'), 'release/sha256');
  assert.equal(channelKey('release', null), 'release/sha256');
  assert.equal(channelKey('brew', null), 'brew');
  for (const m of ['brew', 'winget', 'scoop', 'pipx', 'npm', 'cargo', 'gem', 'composer', 'go', 'apt', 'dnf']) assert.ok(CHANNEL_TIERS[m], `${m} ranked`);
  assert.ok(CHANNEL_TIERS['release/cosign'].rank < CHANNEL_TIERS['release/sha256'].rank);
  assert.ok(CHANNEL_TIERS['release/sha256'].rank < CHANNEL_TIERS.brew.rank);
  assert.ok(CHANNEL_TIERS.brew.rank < CHANNEL_TIERS.winget.rank);
  assert.ok(CHANNEL_TIERS.winget.rank < CHANNEL_TIERS.pipx.rank);
  assert.ok(CHANNEL_TIERS.pipx.rank < CHANNEL_TIERS.scoop.rank);
  assert.deepEqual(tierFor(undefined), { rank: null, label: 'unrecorded (not installed by setup)' });
  assert.equal(tierFor({ channel: 'brew' }).label, CHANNEL_TIERS.brew.label);
  assert.match(tierFor({ channel: 'mystery' }).label, /unranked channel mystery/);
});
