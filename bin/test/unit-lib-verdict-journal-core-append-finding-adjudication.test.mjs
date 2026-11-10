// Appends a write-time-redacted finding-adjudication record to adjudications.jsonl (bin/lib/verdict-journal-core.mjs appendFindingAdjudication).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFindingAdjudication } from '../lib/verdict-journal-core.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'appendFindingAdjudication-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ledger = (dir) => join(dir, 'adjudications.jsonl');
const readLines = (dir) => readFileSync(ledger(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const shape = (r) => ({ ...r, archive: dirname(r.archive) });

test('a null or undefined record is rejected as not an object and nothing is written', () => {
  withDir((dir) => {
    assert.deepEqual(appendFindingAdjudication(null, { dir }), { ok: false, error: 'record is not an object' });
    assert.deepEqual(appendFindingAdjudication(undefined, { dir }), { ok: false, error: 'record is not an object' });
    assert.equal(existsSync(ledger(dir)), false);
  });
});

test('a truthy non-object record such as a string or number is rejected as not an object', () => {
  withDir((dir) => {
    assert.deepEqual(appendFindingAdjudication('not-an-object', { dir }), { ok: false, error: 'record is not an object' });
    assert.deepEqual(appendFindingAdjudication(42, { dir }), { ok: false, error: 'record is not an object' });
    assert.equal(existsSync(ledger(dir)), false);
  });
});

test('a record with an absent or empty findingKey is rejected as missing findingKey', () => {
  withDir((dir) => {
    assert.deepEqual(appendFindingAdjudication({ category: 'c', repo: 'r' }, { dir }), { ok: false, error: 'missing findingKey' });
    assert.deepEqual(appendFindingAdjudication({ findingKey: '', category: 'c', repo: 'r' }, { dir }), { ok: false, error: 'missing findingKey' });
    assert.deepEqual(appendFindingAdjudication([], { dir }), { ok: false, error: 'missing findingKey' });
    assert.equal(existsSync(ledger(dir)), false);
  });
});

test('a record with a findingKey but no category is rejected as missing category', () => {
  withDir((dir) => {
    assert.deepEqual(appendFindingAdjudication({ findingKey: 'k', repo: 'r' }, { dir }), { ok: false, error: 'missing category' });
    assert.deepEqual(appendFindingAdjudication({ findingKey: 'k', category: '', repo: 'r' }, { dir }), { ok: false, error: 'missing category' });
    assert.equal(existsSync(ledger(dir)), false);
  });
});

test('a record with findingKey and category but no repo is rejected as missing repo', () => {
  withDir((dir) => {
    assert.deepEqual(appendFindingAdjudication({ findingKey: 'k', category: 'c' }, { dir }), { ok: false, error: 'missing repo' });
    assert.deepEqual(appendFindingAdjudication({ findingKey: 'k', category: 'c', repo: 0 }, { dir }), { ok: false, error: 'missing repo' });
    assert.equal(existsSync(ledger(dir)), false);
  });
});

test('a valid record with evidence and basis is appended with both replaced by place, artifact and sha256', () => {
  withDir((dir) => {
    const evidence = 'secret '.repeat(5);
    const r = appendFindingAdjudication(
      { findingKey: 'fk1', category: 'cat1', repo: 'repo1', evidence, basis: 'reason text' },
      { dir, place: 'p1', artifact: 'a1' },
    );
    assert.deepEqual(shape(r), { ok: true, path: ledger(dir), archive: join(dir, 'judgements') });
    const lines = readLines(dir);
    assert.deepEqual(lines, [{
      v: 1,
      kind: 'finding-adjudication',
      at: lines[0].at,
      findingKey: 'fk1',
      category: 'cat1',
      repo: 'repo1',
      evidence: { place: 'p1', artifact: 'a1', sha256: sha(evidence) },
      basis: { place: 'p1', artifact: 'a1', sha256: sha('reason text') },
      prev: 'genesis',
    }]);
  });
});

test('a valid record without free-text fields is appended as a version 1 envelope starting at genesis', () => {
  withDir((dir) => {
    const r = appendFindingAdjudication({ findingKey: 'fk2', category: 'cat2', repo: 'repo2' }, { dir });
    assert.deepEqual(shape(r), { ok: true, path: ledger(dir), archive: join(dir, 'judgements') });
    const lines = readLines(dir);
    assert.deepEqual(lines, [{
      v: 1,
      kind: 'finding-adjudication',
      at: lines[0].at,
      findingKey: 'fk2',
      category: 'cat2',
      repo: 'repo2',
      prev: 'genesis',
    }]);
  });
});

test('free text is redacted with null place and artifact when none are given', () => {
  withDir((dir) => {
    const r = appendFindingAdjudication({ findingKey: 'fk4', category: 'cat4', repo: 'repo4', evidence: 'e' }, { dir });
    assert.deepEqual(shape(r), { ok: true, path: ledger(dir), archive: join(dir, 'judgements') });
    const lines = readLines(dir);
    assert.deepEqual(lines[0].evidence, { place: null, artifact: null, sha256: sha('e') });
    assert.equal(lines[0].v, 1);
  });
});

test('empty-string and non-string free-text fields are written unchanged', () => {
  withDir((dir) => {
    const r = appendFindingAdjudication(
      { findingKey: 'fk3', category: 'cat3', repo: 'repo3', evidence: '', basis: 7 },
      { dir, place: 'p3', artifact: 'a3' },
    );
    assert.deepEqual(shape(r), { ok: true, path: ledger(dir), archive: join(dir, 'judgements') });
    const lines = readLines(dir);
    assert.deepEqual(lines, [{
      v: 1,
      kind: 'finding-adjudication',
      at: lines[0].at,
      findingKey: 'fk3',
      category: 'cat3',
      repo: 'repo3',
      evidence: '',
      basis: 7,
      prev: 'genesis',
    }]);
  });
});
