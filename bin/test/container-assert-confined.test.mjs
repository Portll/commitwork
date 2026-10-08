// node --test bin/test/container-assert-confined.test.mjs
//
// container/assert-confined.mjs, the verdict the container CI job reaches on its scan: a lane that ran
// unconfined fails, a refused lane does not, and a scan where too few lanes ran is not a pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confinement, EXIT } from '../../container/assert-confined.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'container', 'assert-confined.mjs');
const dir = mkdtempSync(join(tmpdir(), 'cw-assert-confined-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const scan = (cells) => ({ version: 1, baseline: 'x', repos: [{ repo: '/repo', slug: 'repo', cells }] });
const run = (doc, ...args) => {
  const f = join(dir, `${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, typeof doc === 'string' ? doc : JSON.stringify(doc));
  const r = spawnSync(process.execPath, [SCRIPT, f, ...args], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const confined = {
  gitleaks: { sev: 'ok', isolation: 'full' },
  semgrep: { sev: 'med', isolation: 'fs-only' },
  'deps-osv': { sev: 'noscan', isolation: 'none', summary: 'CW_SANDBOX=require and the host sandbox is unavailable' },
  a11y: { sev: 'skip', summary: 'n/a' },
};

test('every lane that ran was confined: a pass, and the refused lane is not counted as a breach', () => {
  const r = run(scan(confined));
  assert.equal(r.status, EXIT.OK, r.out);
  assert.match(r.out, /2 lane\(s\) ran \{"full":1,"fs-only":1\}; 2 did not run/);
});

test('a lane that ran with isolation none, or with none recorded, fails', () => {
  const none = run(scan({ ...confined, ruff: { sev: 'low', isolation: 'none', isolationReason: 'host sandbox unavailable' } }));
  assert.equal(none.status, EXIT.UNCONFINED, none.out);
  assert.match(none.out, /UNCONFINED repo ruff: isolation none/);
  const missing = run(scan({ ...confined, ruff: { sev: 'ok' } }));
  assert.equal(missing.status, EXIT.UNCONFINED, missing.out);
  assert.match(missing.out, /UNCONFINED repo ruff: isolation not recorded/);
});

test('a scan where nothing, or too little, ran is not a pass', () => {
  const nothing = run(scan({ 'deps-osv': confined['deps-osv'], a11y: confined.a11y }));
  assert.equal(nothing.status, EXIT.TOO_FEW, nothing.out);
  assert.equal(run(scan(confined), '--min', '3').status, EXIT.TOO_FEW);
  assert.equal(run(scan(confined), '--min', '2').status, EXIT.OK);
});

test('an unreadable or empty scan.json fails closed', () => {
  assert.equal(spawnSync(process.execPath, [SCRIPT, join(dir, 'absent.json')]).status, EXIT.UNREADABLE);
  assert.equal(run('{ "repos": [').status, EXIT.UNREADABLE);
  assert.equal(run({ version: 1, repos: [] }).status, EXIT.UNREADABLE);
  assert.throws(() => confinement({}), /no repository/);
});

test('usage errors are exit 2', () => {
  assert.equal(spawnSync(process.execPath, [SCRIPT]).status, EXIT.USAGE);
  assert.equal(run(scan(confined), '--min', 'many').status, EXIT.USAGE);
  assert.equal(run(scan(confined), '--bogus').status, EXIT.USAGE);
});
