import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'pm-handoff.mjs');

const REVIEW = {
  generatedAt: '2026-11-08T00:00:00.000Z', backend: 'claude', lens: false,
  counts: { total: 3, confirmed: 1, dismissed: 1, undetermined: 1 },
  remediationOrder: ['crit1'],
  confirmed: [{ id: 'crit1', axes: { severity: 'crit', urgency: 'crit', size: 'M' }, fix: 'drop shell' }],
  dismissed: [{ id: 'fp', verdict: 'false-positive', citations: ['a.js:1'] }],
  undetermined: [{ id: 'broke', claimedSeverity: 'high', error: 'no answer within 180s', demotedToOpinion: false, verdict: null }],
};

test('pm-handoff emits a compact, reload-ready handoff that preserves undetermined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-pmh-'));
  try {
    const rp = join(dir, 'review.json');
    writeFileSync(rp, JSON.stringify(REVIEW));
    const out = execFileSync(process.execPath, [CLI, '--review', rp], { env: { ...process.env, CW_NOW: '2026-11-08T01:00:00Z' }, encoding: 'utf8' });
    assert.match(out, /1 confirmed/);
    assert.match(out, /crit1.*crit\/crit\/M.*drop shell/);
    assert.match(out, /undetermined.*own bucket/i);
    assert.match(out, /broke.*judge error: no answer within 180s/);
    assert.match(out, /How to resume/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('pm-handoff rejects a non-JSON review', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-pmh-'));
  try {
    const rp = join(dir, 'bad.json');
    writeFileSync(rp, 'not json');
    assert.throws(() => execFileSync(process.execPath, [CLI, '--review', rp], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
