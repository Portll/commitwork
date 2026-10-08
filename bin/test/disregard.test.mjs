// bin/test/disregard.test.mjs — the CLI over the disregarded-warning register, run on fixtures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { docsDoctorWarnings } from '../disregard.mjs';

const CLI = fileURLToPath(new URL('../disregard.mjs', import.meta.url));

function sandbox(t) {
  const d = mkdtempSync(join(tmpdir(), 'cw-disregard-cli-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const env = { ...process.env, CW_DISREGARDED_WARNINGS: join(d, 'register.json'), CW_VERDICT_DIR: join(d, 'verdicts'), CW_NOW: '2026-03-01T00:00:00.000Z' };
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
  return { d, env, run };
}

const recordArgs = ['record', '--source', 'docs-doctor', '--code', 'orange', '--subject', 'example/README.md:4',
  '--why', 'synthetic: re-verified when the rewrite lands', '--who', 'operator (test)'];

test('record writes the register and a disregard suppression-label keyed on the same identity', (t) => {
  const { d, run } = sandbox(t);
  const r = run(...recordArgs);
  assert.equal(r.status, 0, r.stderr);
  const reg = JSON.parse(readFileSync(join(d, 'register.json'), 'utf8'));
  assert.deepEqual(reg.disregarded.map((x) => [x.subject, x.at]), [['example/README.md', '2026-03-01T00:00:00.000Z']]);
  const labels = readFileSync(join(d, 'verdicts', 'adjudications.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(labels.length, 1);
  assert.equal(labels[0].kind, 'suppression-label');
  assert.equal(labels[0].action, 'disregard');
  assert.equal(labels[0].target, 'docs-doctor:orange|example/README.md');
  // Re-running is idempotent: no second record, no second label.
  assert.equal(run(...recordArgs).status, 0);
  assert.equal(JSON.parse(readFileSync(join(d, 'register.json'), 'utf8')).disregarded.length, 1);
  assert.equal(readFileSync(join(d, 'verdicts', 'adjudications.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('check reports the recurrence as RETURNED, a new warning as fresh, deterministically', (t) => {
  const { d, run } = sandbox(t);
  assert.equal(run(...recordArgs).status, 0);
  const w = join(d, 'warnings.json');
  writeFileSync(w, JSON.stringify([
    { source: 'docs-doctor', code: 'orange', subject: 'example/README.md:90', message: 'stale stamp' },
    { source: 'docs-doctor', code: 'grey', subject: 'example/NEW.md' },
  ]));
  const a = run('check', '--warnings', w, '--json');
  assert.equal(a.status, 0, a.stderr);
  const out = JSON.parse(a.stdout);
  assert.deepEqual(out.rows.map((r) => r.disposition), ['returned', 'fresh']);
  assert.equal(out.rows[0].disregarded.why, 'synthetic: re-verified when the rewrite lands');
  assert.equal(run('check', '--warnings', w, '--json').stdout, a.stdout);
  const text = run('check', '--warnings', w).stdout;
  assert.match(text, /^RETURNED\s+docs-doctor:orange\|example\/README\.md/m);
  assert.match(text, /set aside 2026-03-01T00:00:00.000Z by operator \(test\)/);
});

test('a corrupt register refuses (exit 20) and classifies nothing — never an empty register', (t) => {
  const { d, run } = sandbox(t);
  writeFileSync(join(d, 'register.json'), '{corrupt');
  writeFileSync(join(d, 'w.json'), '[]');
  const r = run('check', '--warnings', join(d, 'w.json'));
  assert.equal(r.status, 20);
  assert.equal(r.stdout, '');
  assert.equal(run(...recordArgs).status, 20);
  assert.equal(readFileSync(join(d, 'register.json'), 'utf8'), '{corrupt');
});

test('an absent register is "nothing set aside": every identified warning is fresh', (t) => {
  const { d, run } = sandbox(t);
  writeFileSync(join(d, 'w.json'), JSON.stringify({ warnings: [{ source: 's', code: 'c', subject: 'x' }] }));
  const out = JSON.parse(run('check', '--warnings', join(d, 'w.json'), '--json').stdout);
  assert.equal(out.absent, true);
  assert.deepEqual(out.counts, { fresh: 1, returned: 0, unidentified: 0 });
});

test('record without why is refused and writes nothing; bad input and usage have their own exits', (t) => {
  const { d, run } = sandbox(t);
  const r = run('record', '--source', 's', '--code', 'c', '--subject', 'x', '--who', 'me');
  assert.equal(r.status, 20);
  assert.ok(!existsSync(join(d, 'register.json')));
  assert.equal(run('check', '--warnings', join(d, 'missing.json')).status, 21);
  assert.equal(run('check').status, 22);
  assert.equal(run('nonsense').status, 22);
});

test('docs-doctor orange, grey and index findings become warnings; green and living do not', () => {
  const ws = docsDoctorWarnings({
    docs: [
      { path: 'a.md', status: 'orange', reasons: ['r1', 'r2'] },
      { path: 'b.md', status: 'grey', reasons: [] },
      { path: 'c.md', status: 'green', reasons: [] },
      { path: 'd.md', status: 'living', reasons: [] },
    ],
    indexFindings: [{ path: 'gone.md', reason: 'index links a missing file' }],
  });
  assert.deepEqual(ws.map((w) => `${w.code}:${w.subject}`), ['orange:a.md', 'grey:b.md', 'index:gone.md']);
  assert.equal(ws[0].message, 'r1; r2');
});
