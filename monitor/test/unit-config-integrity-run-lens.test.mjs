// Config-surface drift against the pinned baseline plus its journal state (monitor/config-integrity.mjs runLens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLens } from '../config-integrity.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const KEYS = ['CW_CONFINT_BASELINE', 'CW_CONFINT_JOURNAL'];
const why = (s) => `baseline references journal row ${s.slice(0, 12)} which the journal does not contain`;
const configItem = (path, raw) => ({ id: path, kind: 'config', size: Buffer.byteLength(raw), sha256: sha(raw) });

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'runLens-'));
  const saved = KEYS.map((k) => process.env[k]);
  process.env.CW_CONFINT_BASELINE = join(dir, 'baseline.json');
  process.env.CW_CONFINT_JOURNAL = join(dir, 'journal.jsonl');
  const pin = (b) => writeFileSync(join(dir, 'baseline.json'), typeof b === 'string' ? b : JSON.stringify(b));
  try {
    return fn(dir, pin);
  } finally {
    KEYS.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an unjournaled baseline over an unchanged surface reads as findings instead of ok', () => {
  withDir((dir, pin) => {
    const file = join(dir, 'settings.json');
    const raw = JSON.stringify({ a: 1, pad: 'x'.repeat(20) });
    writeFileSync(file, raw);
    const ref = 'a'.repeat(64);
    pin({ at: '2026-01-02T03:04:05.000Z', items: [configItem(file, raw)], journal: { sha256: ref } });
    const r = runLens({ targets: [{ path: file, kind: 'config' }] });
    assert.equal(r.state, 'findings');
    assert.deepEqual(r.journal, { state: 'unjournaled', why: why(ref) });
  });
});

test('without a baseline file the journal reads no-baseline and baselineAt is null', () => {
  withDir(() => {
    const r = runLens({ targets: [] });
    assert.deepEqual(r.journal, { state: 'no-baseline' });
    assert.equal(r.baselineAt, null);
  });
});

test('a changed config file carries its pinned baseline entry as was', () => {
  withDir((dir, pin) => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, 'new');
    const pinned = configItem(file, 'old');
    const ref = 'b'.repeat(64);
    pin({ at: '2026-01-02T03:04:05.000Z', items: [pinned], journal: { sha256: ref } });
    const r = runLens({ targets: [{ path: file, kind: 'config' }] });
    assert.deepEqual(r.changed.map((c) => c.id), [file]);
    assert.deepEqual(r.changed.map((c) => c.was), [pinned]);
    assert.equal(r.baselineAt, '2026-01-02T03:04:05.000Z');
    assert.deepEqual(r.journal, { state: 'unjournaled', why: why(ref) });
  });
});

test('an unjournaled baseline keeps the diff state when the surface already differs', () => {
  withDir((dir, pin) => {
    const file = join(dir, 'settings.json');
    const sub = join(dir, 'not-a-file');
    writeFileSync(file, 'new');
    mkdirSync(sub);
    const targets = [{ path: file, kind: 'config' }, { path: sub, kind: 'config' }];
    const items = [configItem(file, 'old')];
    pin({ at: '2026-01-02T03:04:05.000Z', items });
    const plain = runLens({ targets });
    const ref = 'c'.repeat(64);
    pin({ at: '2026-01-02T03:04:05.000Z', items, journal: { sha256: ref } });
    const flagged = runLens({ targets });
    assert.deepEqual(flagged.journal, { state: 'unjournaled', why: why(ref) });
    assert.equal(flagged.state, plain.state);
  });
});

test('a baseline without an items array throws before any diff is made', () => {
  withDir((dir, pin) => {
    pin({ at: '2026-01-02T03:04:05.000Z' });
    assert.throws(() => runLens({ targets: [] }), { name: 'Error', message: 'baseline has no items[]' });
    pin('null');
    assert.throws(() => runLens({ targets: [] }), { name: 'Error', message: 'baseline has no items[]' });
    pin({ items: { a: 1 } });
    assert.throws(() => runLens({ targets: [] }), { name: 'Error', message: 'baseline has no items[]' });
  });
});
