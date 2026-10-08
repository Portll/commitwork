// monitor/test/disregarded-warnings.test.mjs — the disregarded-warning register (roadmap W2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  warningKey, normaliseSubject, validateDisregard, readRegister, appendDisregard, classifyWarnings, DISPOSITIONS,
} from '../disregarded-warnings.mjs';
import { disregardedWarningsPathFor } from '../store-paths.mjs';

const rec = (over = {}) => ({
  source: 'docs-doctor', code: 'orange', subject: 'example/README.md',
  why: 'synthetic: re-verified when the rewrite lands', who: 'operator (test)', at: '2026-01-15T00:00:00.000Z', ...over,
});
const scratch = (t) => { const d = mkdtempSync(join(tmpdir(), 'cw-disregard-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('identity excludes line and column — a moved warning is the same warning', () => {
  const a = warningKey({ source: 'lint', code: 'no-eval', subject: 'src/app.mjs:12' });
  const b = warningKey({ source: 'lint', code: 'no-eval', subject: 'src/app.mjs:527:3', line: 527 });
  assert.equal(a, 'lint:no-eval|src/app.mjs');
  assert.equal(a, b);
});

test('identity excludes the message, whose wording carries dates and counts', () => {
  assert.equal(
    warningKey({ ...rec(), message: 'verified-against 2025-12-01 is older than 30 days' }),
    warningKey({ ...rec(), message: 'verified-against 2025-12-01 is older than 30 days (now 44)' }));
});

test('a host:port subject keeps its port; only a file extension suffix is stripped', () => {
  assert.equal(normaliseSubject('127.0.0.1:7878'), '127.0.0.1:7878');
  assert.equal(normaliseSubject('./a\\b.ts:9'), 'a/b.ts');
});

test('a warning with no usable identity has no key', () => {
  assert.equal(warningKey({ source: 'x', code: 'y' }), null);
  assert.equal(warningKey({ source: 'has space', code: 'y', subject: 'z' }), null);
  assert.equal(warningKey(null), null);
});

test('validation demands why and who, and refuses a line field', () => {
  assert.deepEqual(validateDisregard(rec()), []);
  assert.match(validateDisregard(rec({ why: ' ' })).join(), /why is required/);
  assert.match(validateDisregard(rec({ who: undefined })).join(), /who is required/);
  assert.match(validateDisregard(rec({ line: 3 })).join(), /line is not part/);
  assert.match(validateDisregard(rec({ at: 'yesterday' })).join(), /ISO/);
});

test('a set-aside warning that recurs is RETURNED with the judgment beside it; others are fresh', () => {
  const records = [rec(), rec({ at: '2026-02-01T00:00:00.000Z', why: 'still mid-rewrite' })];
  const res = classifyWarnings([
    { source: 'docs-doctor', code: 'orange', subject: 'example/README.md:4', message: 'stale' },
    { source: 'docs-doctor', code: 'orange', subject: 'example/OTHER.md' },
    { message: 'free text only' },
  ], records, { now: '2026-03-01T00:00:00.000Z' });
  assert.deepEqual(res.rows.map((r) => r.disposition), ['returned', 'fresh', 'unidentified']);
  assert.deepEqual(res.rows[0].disregarded, {
    why: 'still mid-rewrite', who: 'operator (test)', at: '2026-02-01T00:00:00.000Z', firstAt: '2026-01-15T00:00:00.000Z', setAsides: 2,
  });
  assert.equal(res.rows[0].message, 'stale');
  assert.deepEqual(res.counts, { fresh: 1, returned: 1, unidentified: 1 });
  assert.deepEqual(res.quiet, []);
});

test('every disposition is pre-seeded, so "cannot happen" counts 0 rather than going missing', () => {
  const res = classifyWarnings([], [], { now: '2026-03-01T00:00:00.000Z' });
  assert.deepEqual(Object.keys(res.counts), DISPOSITIONS);
  assert.ok(Object.values(res.counts).every((n) => n === 0));
});

test('a set-aside not yet in force as-of now does not apply (CW_NOW replay is deterministic)', () => {
  const res = classifyWarnings([rec()], [rec({ at: '2026-05-01T00:00:00.000Z' })], { now: '2026-03-01T00:00:00.000Z' });
  assert.equal(res.rows[0].disposition, 'fresh');
});

test('set-asides not seen in the batch are named as quiet, never dropped', () => {
  const res = classifyWarnings([], [rec()], { now: '2026-03-01T00:00:00.000Z' });
  assert.deepEqual(res.quiet.map((q) => q.key), ['docs-doctor:orange|example/README.md']);
});

test('an invalid record is reported and NOT applied', () => {
  const res = classifyWarnings([rec()], [rec({ why: '' })], { now: '2026-03-01T00:00:00.000Z' });
  assert.equal(res.rows[0].disposition, 'fresh');
  assert.equal(res.invalid.length, 1);
});

test('register: ENOENT is absent and empty; corrupt or wrong-shape is a failure, never empty', (t) => {
  const d = scratch(t);
  assert.deepEqual(readRegister(join(d, 'none.json')), { ok: true, records: [], absent: true });
  writeFileSync(join(d, 'bad.json'), '{not json');
  assert.equal(readRegister(join(d, 'bad.json')).ok, false);
  writeFileSync(join(d, 'shape.json'), '{"items": []}');
  assert.equal(readRegister(join(d, 'shape.json')).ok, false);
});

test('register: an unreadable file is a failure, not absence', (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('no POSIX modes / root reads anything');
  const d = scratch(t);
  const p = join(d, 'r.json');
  writeFileSync(p, '{"disregarded": []}');
  chmodSync(p, 0o000);
  try { assert.equal(readRegister(p).ok, false); } finally { chmodSync(p, 0o600); }
});

test('append: atomic, append-only, idempotent on an identical record, subject normalised', (t) => {
  const d = scratch(t);
  const p = join(d, 'r.json');
  const first = appendDisregard(p, rec({ subject: 'example/README.md:7' }));
  assert.deepEqual(first, { ok: true, appended: true, key: 'docs-doctor:orange|example/README.md', total: 1 });
  const again = appendDisregard(p, rec());
  assert.equal(again.appended, false);
  assert.equal(appendDisregard(p, rec({ at: '2026-02-01T00:00:00.000Z' })).total, 2);
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(doc.disregarded[0].subject, 'example/README.md');
  assert.equal(doc.disregarded.length, 2);
  assert.ok(!existsSync(join(d, '.r.json.lock')), 'lock released');
});

test('append: refuses to overwrite a corrupt register, and refuses an invalid record', (t) => {
  const d = scratch(t);
  const p = join(d, 'r.json');
  writeFileSync(p, '{corrupt');
  const res = appendDisregard(p, rec());
  assert.equal(res.ok, false);
  assert.equal(readFileSync(p, 'utf8'), '{corrupt');
  assert.equal(appendDisregard(join(d, 'x.json'), rec({ why: '' })).ok, false);
});

test('append: an absent directory is refused, never created in place of the private link', (t) => {
  const d = scratch(t);
  const res = appendDisregard(join(d, 'private', 'r.json'), rec());
  assert.equal(res.ok, false);
  assert.ok(!existsSync(join(d, 'private')));
});

test('store path: private by default, CW_DISREGARDED_WARNINGS read at call time, ambient:false refuses it', () => {
  const prev = process.env.CW_DISREGARDED_WARNINGS;
  try {
    delete process.env.CW_DISREGARDED_WARNINGS;
    assert.equal(disregardedWarningsPathFor('/r'), join('/r', 'monitor', 'private', 'disregarded-warnings.json'));
    process.env.CW_DISREGARDED_WARNINGS = '/tmp/cw-dw.json';
    assert.equal(disregardedWarningsPathFor('/r'), '/tmp/cw-dw.json');
    assert.equal(disregardedWarningsPathFor('/r', { ambient: false }), join('/r', 'monitor', 'private', 'disregarded-warnings.json'));
  } finally {
    if (prev === undefined) delete process.env.CW_DISREGARDED_WARNINGS; else process.env.CW_DISREGARDED_WARNINGS = prev;
  }
});

test('the shipped example is a valid register whose every record validates', () => {
  const p = new URL('../disregarded-warnings.example.json', import.meta.url);
  const reg = readRegister(p);
  assert.equal(reg.ok, true);
  assert.ok(reg.records.length > 0);
  for (const r of reg.records) assert.deepEqual(validateDisregard(r), []);
});
