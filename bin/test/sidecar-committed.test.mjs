// The sidecar holds the records that must survive; a record written there and never committed has
// no history, which is the condition the sidecar exists to end. Measured 2026-10-13: 228 uncommitted
// changes, the oldest from the previous week. Runs where the suite runs; skips where there is no
// sidecar, and says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.CW_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIDECAR = process.env.CW_SIDECAR || resolve(REPO, '..', 'commitwork-sidecar');
const MAX_AGE_DAYS = Number(process.env.CW_SIDECAR_UNCOMMITTED_DAYS) || 7;

const sidecarState = () => {
  try { lstatSync(SIDECAR); } catch (e) {
    if (e.code === 'ENOENT') return { skip: `no sidecar at ${SIDECAR} (ENOENT)` };
    throw e;
  }
  if (!existsSync(join(SIDECAR, '.git'))) return { skip: `${SIDECAR} is not a git repository` };
  return {};
};

test('no sidecar record has waited more than a week to be committed', (t) => {
  const s = sidecarState();
  if (s.skip) { t.skip(s.skip); return; }
  const r = spawnSync('git', ['-C', SIDECAR, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `git status failed in the sidecar: ${r.stderr}`);
  const now = Date.now();
  const rows = r.stdout.split('\n').filter(Boolean).map((l) => ({ code: l.slice(0, 2), path: l.slice(3) }));
  const aged = [];
  for (const { code, path } of rows) {
    if (code.includes('D')) continue;
    let st;
    try { st = statSync(join(SIDECAR, path)); } catch { continue; }
    const days = (now - st.mtimeMs) / 86_400_000;
    if (days > MAX_AGE_DAYS) aged.push(`${path} (${days.toFixed(0)}d)`);
  }
  t.diagnostic(`${rows.length} uncommitted change(s) in the sidecar, ${aged.length} older than ${MAX_AGE_DAYS} days`);
  assert.deepEqual(aged, [], `records written more than ${MAX_AGE_DAYS} days ago and never committed — commit the sidecar`);
});
