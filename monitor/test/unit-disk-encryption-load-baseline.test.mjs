// The validated FDE baseline, or an unknown saying why there is none (monitor/disk-encryption.mjs loadBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBaseline } from '../disk-encryption.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SCHEMA = join(TEST_DIR, '..', '..', 'schema', 'disk-encryption.schema.json');
const REAL = readFileSync(join(TEST_DIR, '..', 'disk-encryption.json'), 'utf8');

const leaves = (v, d = 0) => (v !== null && typeof v === 'object' && d < 4
  ? Reflect.ownKeys(v).flatMap((k) => leaves(v[k], d + 1))
  : [v]);
const strs = (r) => leaves(r).filter((v) => typeof v === 'string');
const mentions = (r, word) => strs(r).some((s) => s.includes(word));
const endsWithDetail = (r, detail) => strs(r).some((s) => s.endsWith(detail));
const parseMessage = (text) => {
  try { JSON.parse(text); } catch (e) { return e.message; }
  return null;
};

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const load = (p) => {
  const prev = process.env.CW_FDE_BASELINE;
  process.env.CW_FDE_BASELINE = p;
  try { return loadBaseline(); } finally {
    if (prev === undefined) delete process.env.CW_FDE_BASELINE;
    else process.env.CW_FDE_BASELINE = prev;
  }
};

test('a baseline path that does not exist reports no-reference naming that path', () => withDir((dir) => {
  const p = join(dir, 'disk-encryption.json');
  const r = load(p);
  assert.deepEqual(
    [mentions(r, 'no-reference'), mentions(r, 'not-permitted'),
      endsWithDetail(r, `no FDE baseline at ${p} \u2014 nothing declares what this fleet requires`)],
    [true, false, true],
  );
}));

test('a baseline path whose parent directory is missing still reports no-reference', () => withDir((dir) => {
  const p = join(dir, 'absent', 'baseline.json');
  const r = load(p);
  assert.deepEqual(
    [mentions(r, 'no-reference'), mentions(r, 'not-permitted'),
      endsWithDetail(r, `no FDE baseline at ${p} \u2014 nothing declares what this fleet requires`)],
    [true, false, true],
  );
}));

test('a baseline path that is a directory reports not-permitted with the EISDIR code', () => withDir((dir) => {
  const p = join(dir, 'disk-encryption.json');
  mkdirSync(p);
  const r = load(p);
  assert.deepEqual(
    [mentions(r, 'not-permitted'), mentions(r, 'no-reference'), endsWithDetail(r, `cannot read ${p}: EISDIR`)],
    [true, false, true],
  );
}));

test('a baseline path that runs through a regular file reports not-permitted with the ENOTDIR code', () => withDir((dir) => {
  const file = join(dir, 'plain.json');
  writeFileSync(file, '{}');
  const p = join(file, 'baseline.json');
  const r = load(p);
  assert.deepEqual(
    [mentions(r, 'not-permitted'), mentions(r, 'no-reference'), endsWithDetail(r, `cannot read ${p}: ENOTDIR`)],
    [true, false, true],
  );
}));

test('a baseline that is not valid JSON reports unparseable with the parser message', () => withDir((dir) => {
  const p = join(dir, 'baseline.json');
  writeFileSync(p, '{bad');
  const r = load(p);
  assert.deepEqual(
    [mentions(r, 'unparseable'), endsWithDetail(r, `baseline did not parse: ${parseMessage('{bad')}`)],
    [true, true],
  );
}));

test('an empty baseline file reports unparseable with the parser message', () => withDir((dir) => {
  const p = join(dir, 'baseline.json');
  writeFileSync(p, '');
  const r = load(p);
  assert.deepEqual(
    [mentions(r, 'unparseable'), mentions(r, 'no-reference'), endsWithDetail(r, `baseline did not parse: ${parseMessage('')}`)],
    [true, false, true],
  );
}));

test('a valid baseline followed by trailing junk reports unparseable with the parser message', () => withDir((dir) => {
  const p = join(dir, 'baseline.json');
  const text = `${REAL}x`;
  writeFileSync(p, text);
  const r = load(p);
  assert.deepEqual(
    [mentions(r, 'unparseable'), endsWithDetail(r, `baseline did not parse: ${parseMessage(text)}`)],
    [true, true],
  );
}));

test('a JSON object that violates the schema reports unparseable naming the schema path', () => withDir((dir) => {
  const p = join(dir, 'baseline.json');
  writeFileSync(p, '{}');
  const r = load(p);
  assert.deepEqual(
    [mentions(r, 'unparseable'), mentions(r, `baseline violates ${SCHEMA}: `), mentions(r, 'did not parse')],
    [true, true, false],
  );
}));

test('a baseline that parses and passes the schema is returned as the parsed object', () => withDir((dir) => {
  const p = join(dir, 'baseline.json');
  writeFileSync(p, REAL);
  assert.equal(readFileSync(p, 'utf8'), REAL);
  const r = load(p);
  assert.deepEqual(r, JSON.parse(REAL));
}));
