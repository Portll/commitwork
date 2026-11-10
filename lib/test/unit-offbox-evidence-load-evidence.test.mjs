// The parsed off-box evidence for a file path, or an absent or unreadable marker (lib/offbox-evidence.mjs loadEvidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEvidence } from '../offbox-evidence.mjs';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = 1767225600000;
const GENERATED = '2025-12-31T23:00:00.000Z';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadEvidence-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function messageOf(fn) {
  try {
    fn();
  } catch (e) {
    return e.message;
  }
  return null;
}

test('an empty or null path is reported as absent without reading anything', () => {
  assert.deepEqual(loadEvidence('', { now: NOW }), { byHost: new Map(), rejected: [], error: null, absent: true });
  assert.deepEqual(loadEvidence(null, { now: NOW }), { byHost: new Map(), rejected: [], error: null, absent: true });
});

test('a path to a file that does not exist is reported as absent with no error', () => {
  withDir((dir) => {
    const r = loadEvidence(join(dir, 'missing.json'), { now: NOW });
    assert.deepEqual(r, { byHost: new Map(), rejected: [], error: null, absent: true });
  });
});

test('a path that is a directory is unreadable and not absent', () => {
  withDir((dir) => {
    const p = join(dir, 'evidence.json');
    mkdirSync(p);
    const msg = messageOf(() => readFileSync(p, 'utf8'));
    assert.equal(msg.slice(0, 6), 'EISDIR');
    const r = loadEvidence(p, { now: NOW });
    assert.deepEqual(r, { byHost: new Map(), rejected: [], error: `evidence unreadable: ${msg}`, absent: false });
  });
});

test('a path below a regular file is unreadable rather than absent', () => {
  withDir((dir) => {
    const f = join(dir, 'plain');
    writeFileSync(f, 'x');
    const p = join(f, 'evidence.json');
    const msg = messageOf(() => readFileSync(p, 'utf8'));
    assert.equal(msg.slice(0, 7), 'ENOTDIR');
    const r = loadEvidence(p, { now: NOW });
    assert.deepEqual(r, { byHost: new Map(), rejected: [], error: `evidence unreadable: ${msg}`, absent: false });
  });
});

test('a readable file that is not JSON carries the parse error and is not absent', () => {
  withDir((dir) => {
    const p = join(dir, 'evidence.json');
    writeFileSync(p, '{broken');
    const msg = messageOf(() => JSON.parse('{broken'));
    const r = loadEvidence(p, { now: NOW });
    assert.deepEqual(r, { byHost: new Map(), rejected: [], error: `evidence is not parseable JSON (${msg})`, absent: false });
  });
});

test('a document whose results is not an array is refused and not absent', () => {
  withDir((dir) => {
    const p = join(dir, 'evidence.json');
    writeFileSync(p, JSON.stringify({ vantage: 'github-actions', generated: GENERATED, results: 'none' }));
    const r = loadEvidence(p, { now: NOW });
    assert.deepEqual(r, { byHost: new Map(), rejected: [], error: 'evidence has no results[] array', absent: false });
  });
});

test('a document from a vantage that is not off-box is refused and not absent', () => {
  withDir((dir) => {
    const p = join(dir, 'evidence.json');
    writeFileSync(p, JSON.stringify({ vantage: 'laptop', generated: GENERATED, results: [] }));
    const r = loadEvidence(p, { now: NOW });
    assert.deepEqual(r, {
      byHost: new Map(),
      rejected: [],
      error: 'vantage "laptop" is not off-box \u2014 this cannot attest a layer in front of the origin',
      absent: false,
    });
  });
});

test('a readable off-box document is parsed per host and marked as present', () => {
  withDir((dir) => {
    const p = join(dir, 'evidence.json');
    writeFileSync(p, JSON.stringify({
      vantage: 'github-actions',
      generated: GENERATED,
      results: [{ hostname: 'a.example', verdict: 'EDGE_AUTH' }, { hostname: 'b.example' }],
    }));
    const { liveness, ...rest } = loadEvidence(p, { now: NOW });
    assert.deepEqual(rest, {
      byHost: new Map([['a.example', {
        hostname: 'a.example', verdict: 'EDGE_AUTH', kind: 'protected', outcome: 'pass', ageMs: 3600000, vantage: 'github-actions',
      }]]),
      rejected: [{ hostname: 'b.example', why: 'record is missing hostname or verdict' }],
      error: null,
      absent: false,
    });
    assert.deepEqual([liveness.ageMs, liveness.cadenceMs, liveness.why], [
      3600000, null, 'the evidence declares no cadence, so "late" has no definition here \u2014 recorded rather than assumed',
    ]);
  });
});
