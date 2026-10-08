// bin/exempt.mjs — the gate-exemption write path that emits its label: one write, exactly one
// suppression-label; no-expires flagged, not blocked; a duplicate ACTIVE exemption refused; a
// corrupt store refused, never replaced. All paths run on fixtures via the CW_* seams.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function run(dir, extra = [], env = {}) {
  const verdicts = join(dir, 'verdicts');
  mkdirSync(verdicts, { recursive: true });
  const base = ['--gate', 'qg-openapi', '--service', 'svc-a', '--area', 'clientD',
    '--reason', 'edge router owns no REST surface of its own; downstream specs carry truth',
    '--who', 'test (fixture)'];
  try {
    const out = execFileSync(process.execPath, [join(REPO, 'bin', 'exempt.mjs'), ...base, ...extra], {
      cwd: REPO, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, CW_GATE_EXEMPTIONS: join(dir, 'gate-exemptions.json'), CW_VERDICT_DIR: verdicts, ...env },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: `${String(e.stdout || '')}${String(e.stderr || '')}` };
  }
}

const store = (dir) => JSON.parse(readFileSync(join(dir, 'gate-exemptions.json'), 'utf8'));
const labels = (dir) => {
  try {
    return readFileSync(join(dir, 'verdicts', 'adjudications.jsonl'), 'utf8').split('\n').filter(Boolean)
      .map(JSON.parse).filter((r) => r.kind === 'suppression-label');
  } catch { return []; }
};

test('a write appends the entry AND exactly one suppression-label; no expires ⇒ noExpires flagged, not blocked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-exempt-'));
  const r = run(dir);
  assert.equal(r.code, 0, r.out);
  const doc = store(dir);
  assert.equal(doc.exemptions.length, 1);
  assert.equal(doc.exemptions[0].action, 'exempt');
  const ls = labels(dir);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].target, 'qg-openapi:svc-a@clientD');
  assert.equal(ls[0].noExpires, true);
});

test('a duplicate ACTIVE exemption is refused without --force; an expired one does not block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-exempt-'));
  assert.equal(run(dir, ['--expires', '2099-01-01T00:00:00.000Z', '--expires-reason', 'far future for the dup test']).code, 0);
  const dup = run(dir);
  assert.equal(dup.code, 1);
  assert.match(dup.out, /ACTIVE exemption .* already exists/);
  assert.equal(store(dir).exemptions.length, 1, 'refusal must not have appended');
  assert.equal(labels(dir).length, 1, 'refusal must not have labeled');
  // expired predecessor: same tuple, expires in the past — append proceeds
  const dir2 = mkdtempSync(join(tmpdir(), 'cw-exempt-'));
  writeFileSync(join(dir2, 'gate-exemptions.json'), JSON.stringify({ exemptions: [{ gate: 'qg-openapi', service: 'svc-a', area: 'clientD', action: 'exempt', reason: 'old', who: 'x', at: '2025-01-01T00:00:00.000Z', expires: '2025-06-01T00:00:00.000Z' }] }));
  assert.equal(run(dir2).code, 0);
  assert.equal(store(dir2).exemptions.length, 2);
});

test('a corrupt store is refused, never replaced — only ENOENT means fresh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-exempt-'));
  writeFileSync(join(dir, 'gate-exemptions.json'), '{"exemptions": [ TRUNCATED');
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /unreadable .* refusing to overwrite/);
  assert.equal(readFileSync(join(dir, 'gate-exemptions.json'), 'utf8'), '{"exemptions": [ TRUNCATED', 'store bytes must be untouched');
  assert.equal(labels(dir).length, 0);
});

test('an unknown gate id is refused with the roster — a suppression that matches nothing must not be writable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-exempt-'));
  const r = run(dir, ['--gate', 'qg-tpyo']);
  assert.equal(r.code, 1);
  assert.match(r.out, /--gate must be one of/);
});

test('--dry prints the entry and writes nothing anywhere', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-exempt-'));
  const r = run(dir, ['--dry']);
  assert.equal(r.code, 0);
  assert.match(r.out, /\(dry\) would append/);
  assert.throws(() => store(dir), 'dry run must not create the store');
  assert.equal(labels(dir).length, 0);
});
