import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { convertDenoLock, splitNpmKey, osvInput, OSV_INPUT, RECORD } from '../deno-lock-osv.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = resolve(HERE, '..', 'deno-lock-osv.mjs');
const FIXTURE = readFileSync(join(HERE, 'fixtures', 'deno-lock', 'deno.lock'), 'utf8');
const T = mkdtempSync(join(tmpdir(), 'cw-denolock-'));
test.after(() => rmSync(T, { recursive: true, force: true }));
let n = 0;

function run(lockText) {
  const repo = join(T, `r${n++}`); mkdirSync(repo, { recursive: true });
  if (lockText !== null) writeFileSync(join(repo, 'deno.lock'), lockText);
  const out = join(repo, 'out');
  const r = spawnSync(process.execPath, [TOOL, repo, out], { encoding: 'utf8', env: { ...process.env, CW_NOW: '2026-10-21T00:00:00Z' } });
  const read = (f) => (existsSync(join(out, f)) ? JSON.parse(readFileSync(join(out, f), 'utf8')) : null);
  return { status: r.status, stderr: r.stderr, out, record: read(RECORD), input: read(OSV_INPUT) };
}

describe('convertDenoLock', () => {
  test('v5 fixture: two npm packages, one jsr package, version read', () => {
    const c = convertDenoLock(FIXTURE);
    assert.equal(c.lockVersion, '5');
    assert.deepEqual(c.npm, [{ name: 'lodash', version: '4.17.20' }, { name: 'minimist', version: '1.2.5' }]);
    assert.deepEqual(c.jsr, ['@std/path@1.0.8']);
    assert.equal(c.remote, 0);
  });

  test('v3 nests the maps under packages', () => {
    const c = convertDenoLock(JSON.stringify({ version: '3', packages: { specifiers: { 'npm:chalk@5': 'npm:chalk@5.3.0' }, npm: { 'chalk@5.3.0': { integrity: 'x' } }, jsr: { '@std/fs@0.1.0': { integrity: 'y' } } }, remote: { 'https://deno.land/x/a@1/mod.ts': 'h' } }));
    assert.equal(c.lockVersion, '3');
    assert.deepEqual(c.npm, [{ name: 'chalk', version: '5.3.0' }]);
    assert.deepEqual(c.jsr, ['@std/fs@0.1.0']);
    assert.equal(c.remote, 1);
  });

  test('peer suffixes are stripped, scoped names keep their scope, duplicates collapse', () => {
    assert.deepEqual(splitNpmKey('@types/react@18.2.0_react@18.0.0'), { name: '@types/react', version: '18.2.0' });
    assert.deepEqual(splitNpmKey('lodash@4.17.20'), { name: 'lodash', version: '4.17.20' });
    assert.equal(splitNpmKey('@scope/no-version'), null);
    const c = convertDenoLock(JSON.stringify({ version: '4', npm: { 'a@1.0.0_b@2.0.0': {}, 'a@1.0.0_c@3.0.0': {}, '@s/x@0.1.0': {} } }));
    assert.deepEqual(c.npm, [{ name: '@s/x', version: '0.1.0' }, { name: 'a', version: '1.0.0' }]);
  });

  test('an unknown version is refused, not guessed', () => {
    assert.throws(() => convertDenoLock(JSON.stringify({ version: '9', npm: { 'a@1.0.0': {} } })), /version "9" is not supported/);
    assert.throws(() => convertDenoLock(JSON.stringify({ npm: {} })), /not supported/);
    assert.throws(() => convertDenoLock('{'), /not JSON/);
  });

  test('osv-scanner input names deno.lock as the source and npm as the ecosystem', () => {
    const i = osvInput([{ name: 'lodash', version: '4.17.20' }]);
    assert.deepEqual(i, { results: [{ source: { path: 'deno.lock', type: 'lockfile' }, packages: [{ package: { name: 'lodash', version: '4.17.20', ecosystem: 'npm' } }] }] });
  });
});

describe('the CLI', () => {
  test('converts the fixture, writes both artefacts, honours CW_NOW', () => {
    const r = run(FIXTURE);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.input.results[0].packages.length, 2);
    assert.deepEqual(r.record, { tool: 'deno-lock-osv', generatedAt: '2026-10-21T00:00:00.000Z', lockVersion: '5', npm: 2, jsr: ['@std/path@1.0.8'], jsrUnscanned: true, remote: 0, written: OSV_INPUT, error: null });
  });

  test('absent deno.lock: nothing written, exit 0, silent', () => {
    const r = run(null);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.ok(!existsSync(r.out), 'no output directory is created for a non-Deno repo');
  });

  test('malformed JSON: record carries the error, no osv-scanner input, non-zero exit', () => {
    const r = run('{ not json');
    assert.equal(r.status, 1);
    assert.equal(r.input, null, 'an empty or absent package list must not reach osv-scanner as this lock');
    assert.match(r.record.error, /not JSON/);
    assert.equal(r.record.written, null);
    assert.equal(r.record.lockVersion, null);
  });

  test('a lock with only jsr packages writes the record but no osv-scanner input', () => {
    const r = run(JSON.stringify({ version: '5', jsr: { '@std/path@1.0.8': {} } }));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.input, null);
    assert.equal(r.record.npm, 0);
    assert.deepEqual(r.record.jsr, ['@std/path@1.0.8']);
    assert.equal(r.record.written, null);
  });

  test('a stale osv-scanner input from an earlier run is removed when the lock is gone or unreadable', () => {
    const repo = join(T, `r${n++}`); mkdirSync(join(repo, 'out'), { recursive: true });
    writeFileSync(join(repo, 'out', OSV_INPUT), '{"results":[]}');
    let r = spawnSync(process.execPath, [TOOL, repo, join(repo, 'out')], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.ok(!existsSync(join(repo, 'out', OSV_INPUT)), 'removed for a non-Deno repo');
    writeFileSync(join(repo, 'out', OSV_INPUT), '{"results":[]}');
    writeFileSync(join(repo, 'deno.lock'), '{"version":"9"}');
    r = spawnSync(process.execPath, [TOOL, repo, join(repo, 'out')], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.ok(!existsSync(join(repo, 'out', OSV_INPUT)), 'removed for an unsupported lock');
    assert.deepEqual(readdirSync(join(repo, 'out')), [RECORD]);
  });

  test('usage error exits 2', () => {
    assert.equal(spawnSync(process.execPath, [TOOL], { encoding: 'utf8' }).status, 2);
  });
});

describe('the deps-osv lane wires the converter in', () => {
  const MANIFEST = JSON.parse(readFileSync(resolve(HERE, '..', '..', 'manifests', 'security-baseline.json'), 'utf8'));
  const SCAN = MANIFEST.checks.find((c) => c.id === 'deps-osv').local[0];
  test('converter runs before the sandbox flags are computed, and its output is mounted and listed only when present', () => {
    const conv = SCAN.indexOf('bin/deno-lock-osv.mjs" . "$CW_REPORT_DIR/deno-osv"');
    const sbx = SCAN.indexOf('SBX=$(node');
    assert.ok(conv > 0 && conv < sbx, 'conversion precedes the sandbox call');
    assert.match(SCAN, /if \[ -f "\$CW_REPORT_DIR\/deno-osv\/deno-osv-scanner\.json" \]; then LOCKM="\$LOCKM --mount \$CW_REPORT_DIR\/deno-osv:\/deno-locks:ro"; LOCKL="\$LOCKL -L osv-scanner:\/deno-locks\/deno-osv-scanner\.json"; fi/);
    assert.match(SCAN, /deno-lock-osv exited \$\? -- deno\.lock npm packages NOT scanned/, 'a converter failure is logged, never silently passed');
  });
  test('only the converter subdirectory is mounted, never the whole report dir', () => {
    assert.ok(!SCAN.includes('$CW_REPORT_DIR:/'), 'the report dir itself is not a mount source');
  });
  test('the worktree exclude survives the wiring', () => {
    assert.ok(SCAN.includes("--experimental-exclude 'g:**/.claude/worktrees/**'"));
    assert.ok(SCAN.includes("--experimental-exclude 'g:**/.git/**'"));
  });
  test('the deno-check description no longer claims the lock is rejected outright', () => {
    const d = MANIFEST.checks.find((c) => c.id === 'deno-check').description;
    assert.ok(!/rejects deno\.lock outright/.test(d));
    assert.match(d, /bin\/deno-lock-osv\.mjs/);
  });
});
