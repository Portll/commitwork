// The signed baseline pin of the config surface, with who and why defaulted (monitor/config-integrity.mjs acceptBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptBaseline } from '../config-integrity.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const MSG = 'repin requires who and why \u2014 a pin nobody signed is the laundering this journal exists to refuse';
const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };

function run(user, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'acceptBaseline-'));
  const saved = { USER: process.env.USER, CW_CONFINT_BASELINE: process.env.CW_CONFINT_BASELINE, CW_CONFINT_JOURNAL: process.env.CW_CONFINT_JOURNAL };
  try {
    process.env.CW_CONFINT_BASELINE = join(dir, 'baseline.json');
    process.env.CW_CONFINT_JOURNAL = join(dir, 'journal.jsonl');
    restore('USER', user);
    return fn(dir);
  } finally {
    for (const [k, v] of Object.entries(saved)) restore(k, v);
    rmSync(dir, { recursive: true, force: true });
  }
}

const cfg = (dir, name, content) => {
  const id = join(dir, name);
  writeFileSync(id, content);
  return { id, kind: 'config', size: Buffer.byteLength(content), sha256: sha(content) };
};
const target = (item) => ({ path: item.id, kind: item.kind });
const result = (dir, pinned) => ({ path: join(dir, 'baseline.json'), journal: join(dir, 'journal.jsonl'), pinned, unknowns: [] });

function check(dir, who, why, items) {
  const baselineRaw = readFileSync(join(dir, 'baseline.json'), 'utf8');
  const journalRaw = readFileSync(join(dir, 'journal.jsonl'), 'utf8');
  const { at } = JSON.parse(baselineRaw);
  const line = JSON.stringify({ at, who, why, items: items.length, surface: sha(JSON.stringify(items)) });
  assert.equal(journalRaw, `${line}\n`);
  assert.equal(baselineRaw, `${JSON.stringify({ at, items, journal: { sha256: sha(line), who, why } }, null, 2)}\n`);
}

test('An explicit who and why sign the pin and USER is ignored', () => run('bob', (dir) => {
  const item = cfg(dir, 'config.json', 'x'.repeat(5));
  const r = acceptBaseline({ who: 'alice', why: 'manual', targets: [target(item)] });
  assert.deepEqual(r, result(dir, 1));
  check(dir, 'alice', 'manual', [item]);
}));

test('Without who the USER environment variable signs the pin', () => run('bob', (dir) => {
  const item = cfg(dir, 'config.json', 'y');
  const r = acceptBaseline({ why: 'auto', targets: [target(item)] });
  assert.deepEqual(r, result(dir, 1));
  check(dir, 'bob', 'auto', [item]);
}));

test('Without who, USER or why the pin is signed by operator for --accept', () => run(undefined, (dir) => {
  const item = cfg(dir, 'config.json', 'z');
  const r = acceptBaseline({ targets: [target(item)] });
  assert.deepEqual(r, result(dir, 1));
  check(dir, 'operator', '--accept', [item]);
}));

test('Without why the reason defaults to --accept while the given who is kept', () => run('bob', (dir) => {
  const item = cfg(dir, 'config.json', 'b');
  const r = acceptBaseline({ who: 'dave', targets: [target(item)] });
  assert.deepEqual(r, result(dir, 1));
  check(dir, 'dave', '--accept', [item]);
}));

test('Surrounding whitespace in who and why is trimmed before signing', () => run('bob', (dir) => {
  const item = cfg(dir, 'config.json', 'w');
  const r = acceptBaseline({ who: '  alice  ', why: ' ok ', targets: [target(item)] });
  assert.deepEqual(r, result(dir, 1));
  check(dir, 'alice', 'ok', [item]);
}));

test('A who of only spaces is rejected and nothing is written', () => run('bob', (dir) => {
  const item = cfg(dir, 'config.json', 'q');
  assert.throws(() => acceptBaseline({ who: '   ', why: 'x', targets: [target(item)] }), { name: 'Error', message: MSG });
  assert.equal(existsSync(join(dir, 'journal.jsonl')), false);
  assert.equal(existsSync(join(dir, 'baseline.json')), false);
}));

test('A why of only spaces is rejected and nothing is written', () => run('bob', (dir) => {
  const item = cfg(dir, 'config.json', 'q');
  assert.throws(() => acceptBaseline({ who: 'alice', why: '  ', targets: [target(item)] }), { name: 'Error', message: MSG });
  assert.equal(existsSync(join(dir, 'journal.jsonl')), false);
  assert.equal(existsSync(join(dir, 'baseline.json')), false);
}));

test('Missing targets are skipped and the rest are pinned in path order', () => run('bob', (dir) => {
  const a = cfg(dir, 'a.json', '{}');
  const b = cfg(dir, 'b.json', '\u00e9'.repeat(3));
  writeFileSync(join(dir, 'c.link'), 'plain');
  symlinkSync('a.json', join(dir, 'd.link'));
  mkdirSync(join(dir, 'e.dir'));
  const link = (name, value) => ({ id: join(dir, name), kind: 'symlink', value, sha256: sha(value) });
  const c = link('c.link', 'not-a-link:file');
  const d = link('d.link', 'link:a.json');
  const e = link('e.dir', 'not-a-link:directory');
  const targets = [target(d), target(b), { path: join(dir, 'gone.json'), kind: 'config' }, target(e), { path: join(dir, 'gone.link'), kind: 'symlink' }, target(c), target(a)];
  const r = acceptBaseline({ who: 'erin', why: 'sweep', targets });
  assert.deepEqual(r, result(dir, 5));
  check(dir, 'erin', 'sweep', [a, b, c, d, e]);
}));

test('An empty target list pins zero items', () => run('bob', (dir) => {
  const r = acceptBaseline({ who: 'gina', why: 'empty', targets: [] });
  assert.deepEqual(r, result(dir, 0));
  check(dir, 'gina', 'empty', []);
}));
