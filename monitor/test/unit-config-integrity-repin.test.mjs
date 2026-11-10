// A signed pin of the config surface, journaled and written as the baseline (monitor/config-integrity.mjs repin).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repin } from '../config-integrity.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const MSG = 'repin requires who and why \u2014 a pin nobody signed is the laundering this journal exists to refuse';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const KEYS = ['CW_CONFINT_BASELINE', 'CW_CONFINT_JOURNAL'];

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'repin-'));
  const saved = KEYS.map((k) => process.env[k]);
  const baseline = join(dir, 'baseline.json');
  const journal = join(dir, 'journal.jsonl');
  process.env.CW_CONFINT_BASELINE = baseline;
  process.env.CW_CONFINT_JOURNAL = journal;
  try {
    fn({ dir, baseline, journal });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    KEYS.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
}

function pinLine(at, who, why, items) {
  return JSON.stringify({ at, who, why, items: items.length, surface: sha(JSON.stringify(items)) });
}

function assertWritten({ baseline, journal }, count, who, why, items) {
  const rows = readFileSync(journal, 'utf8').split('\n');
  assert.equal(rows.length, count + 1);
  assert.equal(rows[count], '');
  const last = rows[count - 1];
  const at = JSON.parse(last).at;
  const line = pinLine(at, who, why, items);
  assert.equal(last, line);
  const doc = { at, items, journal: { sha256: sha(line), who, why } };
  assert.equal(readFileSync(baseline, 'utf8'), `${JSON.stringify(doc, null, 2)}\n`);
  return rows;
}

test('an empty who with a given why throws and writes nothing', () => {
  withDir((p) => {
    assert.throws(() => repin({ who: '', why: 'reason' }, { targets: [] }), { name: 'Error', message: MSG });
    assert.equal(existsSync(p.journal), false);
    assert.equal(existsSync(p.baseline), false);
  });
});

test('an empty why with a given who throws and writes nothing', () => {
  withDir((p) => {
    assert.throws(() => repin({ who: 'alice', why: '' }, { targets: [] }), { name: 'Error', message: MSG });
    assert.equal(existsSync(p.journal), false);
    assert.equal(existsSync(p.baseline), false);
  });
});

test('whitespace-only names, a zero who, and a missing signature all throw', () => {
  withDir(() => {
    assert.throws(() => repin({ who: '   ', why: 'reason' }, { targets: [] }), { name: 'Error', message: MSG });
    assert.throws(() => repin({ who: 'alice', why: '\t\n ' }, { targets: [] }), { name: 'Error', message: MSG });
    assert.throws(() => repin({ who: 0, why: 'reason' }, { targets: [] }), { name: 'Error', message: MSG });
    assert.throws(() => repin({}, { targets: [] }), { name: 'Error', message: MSG });
  });
});

test('a signed pin of no targets trims who and why and reports zero pinned', () => {
  withDir((p) => {
    const r = repin({ who: '  alice ', why: ' initial pin\t' }, { targets: [] });
    assert.deepEqual(r, { path: p.baseline, journal: p.journal, pinned: 0, unknowns: [] });
    assertWritten(p, 1, 'alice', 'initial pin', []);
  });
});

test('the baseline is written with two-space indentation and a trailing newline', () => {
  withDir((p) => {
    repin({ who: 'bob', why: 'update' }, { targets: [] });
    const text = readFileSync(p.baseline, 'utf8');
    const at = JSON.parse(text).at;
    const sum = sha(pinLine(at, 'bob', 'update', []));
    const expected = [
      '{', `  "at": ${JSON.stringify(at)},`, '  "items": [],', '  "journal": {',
      `    "sha256": "${sum}",`, '    "who": "bob",', '    "why": "update"', '  }', '}', '',
    ].join('\n');
    assert.equal(text, expected);
  });
});

test('a numeric who is stringified and a config file is pinned by byte size and hash', () => {
  withDir((p) => {
    const cfg = join(p.dir, 'settings.json');
    const raw = 'x'.repeat(10) + '\u00e9';
    writeFileSync(cfg, raw);
    const r = repin({ who: 42, why: 'config' }, { targets: [{ path: cfg, kind: 'config' }] });
    assert.deepEqual(r, { path: p.baseline, journal: p.journal, pinned: 1, unknowns: [] });
    assertWritten(p, 1, '42', 'config', [{ id: cfg, kind: 'config', size: 12, sha256: sha(raw) }]);
  });
});

test('missing config and symlink targets are skipped without unknowns', () => {
  withDir((p) => {
    const targets = [
      { path: join(p.dir, 'missing.json'), kind: 'config' },
      { path: join(p.dir, 'gone-link'), kind: 'symlink' },
    ];
    const r = repin({ who: 'dave', why: 'nothing there' }, { targets });
    assert.deepEqual(r, { path: p.baseline, journal: p.journal, pinned: 0, unknowns: [] });
    assertWritten(p, 1, 'dave', 'nothing there', []);
  });
});

test('symlink targets pin the link text or what replaced the link, sorted by path', () => {
  withDir((p) => {
    const a = join(p.dir, 'a-link');
    const b = join(p.dir, 'b-dir');
    const c = join(p.dir, 'c-file');
    symlinkSync('elsewhere', a);
    mkdirSync(b);
    writeFileSync(c, 'plain');
    const targets = [c, b, a].map((path) => ({ path, kind: 'symlink' }));
    const r = repin({ who: 'erin', why: 'links' }, { targets });
    assert.deepEqual(r, { path: p.baseline, journal: p.journal, pinned: 3, unknowns: [] });
    const item = (id, value) => ({ id, kind: 'symlink', value, sha256: sha(value) });
    assertWritten(p, 1, 'erin', 'links', [
      item(a, 'link:elsewhere'), item(b, 'not-a-link:directory'), item(c, 'not-a-link:file'),
    ]);
  });
});

test('a second pin appends a journal row and replaces the baseline', () => {
  withDir((p) => {
    repin({ who: 'frank', why: 'first' }, { targets: [] });
    const first = readFileSync(p.journal, 'utf8').split('\n')[0];
    const r = repin({ who: 'gina', why: 'second' }, { targets: [] });
    assert.deepEqual(r, { path: p.baseline, journal: p.journal, pinned: 0, unknowns: [] });
    const rows = assertWritten(p, 2, 'gina', 'second', []);
    assert.equal(rows[0], first);
    assert.equal(rows[0], pinLine(JSON.parse(first).at, 'frank', 'first', []));
  });
});
