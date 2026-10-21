// bin/vuln-profile.mjs over the synthetic sweep batch that ships with the repository: rolled into a
// scratch output directory with no network, then rendered. The profile must be self-contained, keep
// "not proven" as its own band, and refuse a carried rollup whose totals arrived without their rows.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VULN_PROFILE = join(CW, 'bin', 'vuln-profile.mjs');
const BATCH = join(CW, 'monitor', 'test', 'fixtures', 'sweep-batch', 'sweep-20260101000000-fixture');
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';
let DIR, ROLLUP;

before(() => {
  DIR = mkdtempSync(join(tmpdir(), 'cw-vuln-profile-'));
  execFileSync(process.execPath, ['--import', NO_FETCH, join(CW, 'monitor', 'rollup.mjs'), BATCH],
    { cwd: CW, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CW_MONITOR_OUT: join(DIR, 'out'), CW_SELF_SWEEP: '0' } });
  ROLLUP = join(DIR, 'out', 'rollup.json');
});
after(() => rmSync(DIR, { recursive: true, force: true }));

const render = (args) => spawnSync(process.execPath, [VULN_PROFILE, ...args], { cwd: CW, encoding: 'utf8' });

test('vuln-profile.mjs renders the fixture batch as one self-contained page with a not-proven band', () => {
  const out = join(DIR, 'profile.html');
  const r = render([ROLLUP, out, BATCH]);
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(out, 'utf8');
  assert.equal((html.match(/(?:src|href)="https?:\/\//g) || []).length, 0, 'the profile loads something over the network');
  assert.match(html, /example-fixture-repo/);
  assert.match(html, /not proven/i, 'the unproven band was folded into clean or affected');
  assert.match(r.stdout, /clean\s+\d+\s+unproven\s+\d+\s+affected\s+\d+/);
});

test('vuln-profile.mjs refuses a carried rollup that holds no finding rows, and writes nothing', () => {
  const roll = JSON.parse(readFileSync(ROLLUP, 'utf8'));
  roll.totals = { ...roll.totals, carried: { categories: ['secrets'], oldestCarriedFrom: 'sweep-20251231000000' } };
  for (const repo of roll.repos || []) repo.findings = [];
  const carried = join(DIR, 'carried.json');
  writeFileSync(carried, JSON.stringify(roll));
  const out = join(DIR, 'carried.html');
  const r = render([carried, out]);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /REFUSING to render/);
  assert.equal(existsSync(out), false, 'a refused render still wrote a page');
});

test('vuln-profile.mjs names its usage when an input is missing', () => {
  const r = render([ROLLUP]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: vuln-profile\.mjs <rollup\.json> <out\.html>/);
});
