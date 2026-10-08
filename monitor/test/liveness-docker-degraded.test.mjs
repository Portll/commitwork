// node --test monitor/test/ — a FRESH slice swept with the docker daemon DOWN is 'degraded',
// never 'fresh': its container lanes (deps-osv among them) are structurally void, so its zeros
// are voids, not clean results. Measured 2026-08-28 on shodh-memory, where exactly such a slice
// replaced one carrying real dependency rows and nothing above the per-check noscans said so —
// the batch manifest knew (images.docker: "down") and the knowledge stopped there.
// Scratch rollup.json fixtures only, never the real reports/ tree.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkOne, RANK } from '../liveness.mjs';
import { appendRecord } from '../../bin/lib/verdict-journal-core.mjs';

let root;
before(() => { root = mkdtempSync(join(tmpdir(), 'cw-liveness-docker-')); });
after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function makeArea(name, { ageHours, capabilities = undefined }) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'history'), { recursive: true });
  const generated = new Date(Date.now() - ageHours * 3600_000).toISOString();
  const rollupPath = join(dir, 'rollup.json');
  const sliceId = `sweep-${generated.replace(/[-:T]/g, '').slice(0, 14)}`;
  writeFileSync(rollupPath, JSON.stringify({ sliceId, generated, freshness: { generated },
    ...(capabilities !== undefined ? { capabilities } : {}) }));
  appendRecord(join(dir, 'sweep-journal.jsonl'), { v: 1, kind: 'sweep-verdict', at: generated, sliceId, area: name });
  return rollupPath;
}

test('a FRESH slice swept docker-down reads degraded — rank 1, and the line says what its zeros mean', () => {
  const p = makeArea('docker-down', { ageHours: 1,
    capabilities: { docker: 'down', dockerReason: 'docker info failed (exit 1) — nothing pulled' } });
  const r = checkOne(p, 'docker-down', { scheduled: true });
  assert.equal(r.state, 'degraded');
  assert.equal(RANK[r.state], 1, 'warn like stale, never trip like expired');
  assert.match(r.line, /docker daemon DOWN/);
  assert.match(r.line, /voids, not clean results/);
});

test('a docker-ok slice stays fresh', () => {
  const p = makeArea('docker-ok', { ageHours: 1, capabilities: { docker: 'ok' } });
  const r = checkOne(p, 'docker-ok', { scheduled: true });
  assert.equal(r.state, 'fresh');
});

test('a pre-field slice (no capabilities at all) must NOT read as docker-down — explicit uncertainty', () => {
  const p = makeArea('vintage', { ageHours: 1 });
  const r = checkOne(p, 'vintage', { scheduled: true });
  assert.equal(r.state, 'fresh', 'an old rollup that never recorded capabilities is unrecorded, not degraded');
});

test('docker-down on an already-non-fresh slice appends the note rather than masking the worse state', () => {
  const p = makeArea('stale-and-down', { ageHours: 40, capabilities: { docker: 'down' } });
  const r = checkOne(p, 'stale-and-down', { scheduled: true });
  assert.notEqual(r.state, 'fresh');
  assert.match(r.line, /docker daemon DOWN/, 'the capability fact still travels on the line');
});
