// The exporter's contract is "any failure logs and exits 0". A torn rollup used to throw at the
// top-level JSON.parse and exit 1, which is the one outcome the sweep must never see from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../export-overwatch.mjs', import.meta.url).pathname;

test('a torn rollup exits 0 and says it could not be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-export-torn-'));
  try {
    const p = join(dir, 'rollup.json');
    writeFileSync(p, '{"generated": "2026-09-23T00:00:00Z", "repos": [');
    const r = spawnSync(process.execPath, [SCRIPT, p, '--dry-run'], { encoding: 'utf8' });
    assert.equal(r.error, undefined);
    assert.equal(r.signal, null);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /NOT exporting: .*could not be read/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
