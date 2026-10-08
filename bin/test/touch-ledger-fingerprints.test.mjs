// The floor under the fingerprints. The 2026-08-29 audit of registry R2 mutation-proved that
// dropping `if (h) out.h = h; if (n) out.n = n;` from editFingerprints left every test green:
// the hook was writing hunk fingerprints that nothing asserted. This drives bin/touch-ledger.mjs the
// way the harness does — a PostToolUse payload on stdin — and reads the row back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(HERE, '..', 'touch-ledger.mjs');
const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

// The hook ignores a path outside ITS OWN repository (relative(REPO, file) starting with `..`), so
// the probe path is inside this checkout. It never has to exist: the hook records the payload, not
// the filesystem. Only the ledger is redirected.
const PROBE = resolve(HERE, '..', '..', 'zz-fingerprint-probe.mjs');
function fx(t) {
  const d = mkdtempSync(join(tmpdir(), 'cw-touch-fp-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return { ledger: join(d, 'touches.jsonl') };
}
const run = (f, ev) => execFileSync(process.execPath, [HOOK], { input: JSON.stringify(ev), encoding: 'utf8', env: { ...process.env, CW_TOUCH_LEDGER: f.ledger } });
const rows = (f) => readFileSync(f.ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('an Edit writes h = fingerprint(old_string) and n = fingerprint(new_string) on its row', (t) => {
  const f = fx(t);
  const ev = { session_id: 'aaaaaaaa-1111', tool_name: 'Edit', tool_input: { file_path: PROBE, old_string: 'export const a = 1;', new_string: 'export const a = 2;\nexport const b = 3;' }, tool_response: {} };
  run(f, ev);
  const r = rows(f).find((x) => x.f && x.f.endsWith('zz-fingerprint-probe.mjs'));
  assert.ok(r, `no row for a.mjs in ${JSON.stringify(rows(f))}`);
  assert.equal(r.h, fp('export const a = 1;'));
  assert.equal(r.n, fp('export const a = 2;\nexport const b = 3;'));
  assert.equal(r.t, 'edit');
  assert.equal(r.s, 'aaaaaaaa');
});

test('a Write has no old_string: n is the whole content and h is ABSENT, not null', (t) => {
  const f = fx(t);
  run(f, { session_id: 'bbbbbbbb-2222', tool_name: 'Write', tool_input: { file_path: PROBE, content: 'whole\nfile\n' }, tool_response: {} });
  const r = rows(f).find((x) => x.f && x.f.endsWith('zz-fingerprint-probe.mjs'));
  assert.ok(r);
  assert.equal(r.n, fp('whole\nfile\n'));
  assert.ok(!('h' in r), 'a fingerprint for absent content would be invented');
  assert.equal(r.t, 'write');
});
