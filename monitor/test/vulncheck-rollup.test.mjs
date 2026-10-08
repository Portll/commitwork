// The rollup applies VulnCheck's KEV catalogue from its cache, and never fetches it. Rolled over the
// shipped synthetic batch with fetch disabled: a cache that lists the batch's CVE marks that row
// exploited and the other row not; no cache, or one that cannot be read, leaves every row null, and
// the totals say which of those happened.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..', '..');
const BATCH = join(HERE, 'fixtures', 'sweep-batch', 'sweep-20260101000000-fixture');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';

function rollWith(t, cache) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-vulncheck-rollup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cachePath = join(dir, 'vulncheck-kev-cache.json');
  if (cache !== undefined) writeFileSync(cachePath, typeof cache === 'string' ? cache : JSON.stringify(cache));
  const r = spawnSync(process.execPath, ['--import', NO_FETCH, join(CW, 'monitor', 'rollup.mjs'), BATCH], {
    cwd: CW, encoding: 'utf8',
    env: { ...process.env, CW_MONITOR_OUT: join(dir, 'out'), CW_VULNCHECK_KEV_CACHE: cachePath, CW_SELF_SWEEP: '0' },
  });
  assert.equal(r.status, 0, r.stderr);
  const roll = JSON.parse(readFileSync(join(dir, 'out', 'rollup.json'), 'utf8'));
  const rows = roll.repos.flatMap((repo) => repo.findings);
  assert.ok(rows.some((f) => f.id === 'CVE-2000-00001'), 'the fixture batch no longer yields its CVE row');
  return { totals: roll.totals, rows, stderr: r.stderr };
}

test('with no cache, every row is null and the totals say the catalogue was not consulted', (t) => {
  const { totals, rows } = rollWith(t, undefined);
  assert.ok(rows.every((f) => f.activelyExploited === null));
  assert.equal(totals.activelyExploited, 0);
  assert.equal(totals.vulncheck.consulted, false);
  assert.match(totals.vulncheck.reason, /no cache/);
});

test('a cached catalogue marks the listed CVE exploited and the unlisted row not', (t) => {
  const { totals, rows } = rollWith(t, {
    fetchedAt: '2026-10-01T00:00:00.000Z',
    entries: [{ cve: ['CVE-2000-00001'], dateAdded: '2026-01-02', knownRansomwareCampaignUse: 'Known' }],
  });
  const listed = rows.find((f) => f.id === 'CVE-2000-00001');
  assert.equal(listed.activelyExploited, true);
  assert.equal(listed.kevDateAdded, '2026-01-02');
  assert.equal(listed.kevRansomware, true);
  assert.ok(rows.filter((f) => f.id !== 'CVE-2000-00001').every((f) => f.activelyExploited === false));
  assert.equal(totals.activelyExploited, 1);
  assert.equal(totals.activelyExploitedClaimed, 1);
  assert.deepEqual(totals.vulncheck, { consulted: true, fetchedAt: '2026-10-01T00:00:00.000Z', reason: null });
});

test('a cache that cannot be read leaves every row null and records why, without failing the rollup', (t) => {
  const { totals, rows, stderr } = rollWith(t, '{"entries": "not a list"}');
  assert.ok(rows.every((f) => f.activelyExploited === null), 'an unreadable cache was read as "not exploited"');
  assert.equal(totals.vulncheck.consulted, false);
  assert.match(totals.vulncheck.reason, /cache unreadable/);
  assert.match(stderr, /VulnCheck KEV cache unreadable/);
});
