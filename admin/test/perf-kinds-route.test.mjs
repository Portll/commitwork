// /api/perf rows carry what depth and intensity mean for each scanner, and its one-line description.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { perfState, normalizeTuning } from '../routes/perf.mjs';

test('each row says n/a, binary or graded, with the level, and carries its description', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-perf-kinds-'));
  const prev = process.env.CW_SETTINGS;
  process.env.CW_SETTINGS = join(dir, 'settings.json');
  try {
    const s = await perfState();
    assert.equal(s.ok, true, s.error);
    assert.equal(s.depth, 5, 'the declared default depth runs every lane');
    const rows = new Map(s.tuning.scanners.map((r) => [r.id, r]));
    assert.equal(rows.get('sast').depthKind, 'graded');
    assert.deepEqual(rows.get('sast').depthLevel, { rank: 3, of: 3, label: 'full' });
    assert.deepEqual(rows.get('sast').depthLadder, ['default', 'owasp', 'full']);
    assert.equal(rows.get('secrets-gitleaks').depthKind, 'n/a');
    assert.ok(s.tuning.scanners.some((r) => r.depthKind === 'binary'));
    assert.ok(s.tuning.scanners.every((r) => ['n/a', 'binary', 'graded'].includes(r.depthKind)));
    assert.ok(s.tuning.scanners.every((r) => r.intensityKind), 'every row names an intensity kind');
    assert.match(rows.get('secrets').description, /TruffleHog/);
  } finally {
    if (prev === undefined) delete process.env.CW_SETTINGS; else process.env.CW_SETTINGS = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a model that predates ladders reads as unknown, never as n/a', () => {
  const t = normalizeTuning({ scanners: [{ id: 'x', enabled: true }] });
  assert.equal(t.scanners[0].depthKind, null);
  assert.equal(t.scanners[0].depthLevel, null);
});
