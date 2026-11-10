// Writes the projected commitwork graph to an SQLite file and summarises it (bin/graph.mjs build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../graph.mjs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SQLITE = 'SQLite format 3\u0000';
const header = (file) => readFileSync(file).subarray(0, 16).toString('latin1');
const absent = { issues: 'no issues', taxonomy: 'no taxonomy', registry: 'no registry' };
const inputs = (extra = {}) => ({ issues: null, taxonomy: null, registry: null, rollups: [], absent, fingerprint: 'fp-1', ...extra });
const fixed = 'the issue store records no weakness class per finding; a finding reaches the classes its lane covers through found-by then covers';
const notBuilt = (reason) => ({ status: 'not-built', reason });
const baseStatus = {
  'finding-classified-as-class': notBuilt(fixed),
  'finding-found-by-lane': notBuilt('no issues'),
  'finding-in-repo': notBuilt('no issues'),
  'lane-covers-class': notBuilt('no taxonomy'),
  'lane-ran-on-repo': notBuilt('no registry'),
  'repo-in-area': notBuilt('no registry'),
  'session-claimed-finding': notBuilt('no issues'),
};
const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'build-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const withEnv = (key, value, fn) => {
  const old = process.env[key];
  process.env[key] = value;
  try { return fn(); } finally { if (old === undefined) delete process.env[key]; else process.env[key] = old; }
};
const lanes = (dir) => build({ file: join(dir, 'base.db'), inputs: inputs() }).nodes;
const jsonError = (s) => { try { JSON.parse(s); } catch (e) { return e.message; } return null; };

test('build with no inputs writes an SQLite file and reports every relation as not built', () => withDir((dir) => {
  const file = join(dir, 'graph.db');
  const { nodes, ...rest } = build({ file, inputs: inputs() });
  assert.deepEqual(rest, { file, fingerprint: 'fp-1', edges: 0, status: baseStatus });
  assert.equal(header(file), SQLITE);
}));

test('build creates the missing parent directories of the output file', () => withDir((dir) => {
  const file = join(dir, 'a', 'b', 'graph.db');
  const r = build({ file, inputs: inputs() });
  assert.equal(r.file, file);
  assert.equal(existsSync(join(dir, 'a', 'b')), true);
  assert.equal(header(file), SQLITE);
}));

test('build removes its scratch directory even when the temp path holds a quote', () => withDir((dir) => {
  const tmp = join(dir, "t'mp");
  mkdirSync(tmp);
  const file = join(dir, 'graph.db');
  const r = withEnv('TMPDIR', tmp, () => build({ file, inputs: inputs() }));
  assert.equal(r.file, file);
  assert.deepEqual(readdirSync(tmp), []);
  assert.equal(header(file), SQLITE);
}));

test('build with an unparseable CW_NOW throws Invalid time value and leaves no file or scratch', () => withDir((dir) => {
  const tmp = join(dir, 'tmp');
  mkdirSync(tmp);
  const file = join(dir, 'graph.db');
  withEnv('TMPDIR', tmp, () => withEnv('CW_NOW', 'not a date', () => {
    assert.throws(() => build({ file, inputs: inputs() }), { name: 'RangeError', message: 'Invalid time value' });
  }));
  assert.deepEqual(readdirSync(tmp), []);
  assert.equal(existsSync(file), false);
}));

test('build counts findings, repos, tools and claimed sessions from the issue store', () => withDir((dir) => {
  const base = lanes(dir);
  const file = join(dir, 'graph.db');
  const issues = {
    issues: {
      a: { id: 'a', severity: 'high', state: 'open', title: 'T', repo: 'r1', source: { tool: 'zz-tool' } },
      b: { id: 'b', severity: 'low', state: 'closed' },
    },
    events: [
      { type: 'issue-claimed', issueId: 'a', data: { sessionId: 's1' } },
      { type: 'issue-claimed', issueId: 'a', data: { sessionId: 's1' } },
      { type: 'issue-claimed', issueId: 'b', data: { sessionId: '' } },
      { type: 'issue-claimed', issueId: 'zz', data: { sessionId: 's2' } },
      { type: 'issue-opened', issueId: 'b', data: { sessionId: 's3' } },
      null,
    ],
  };
  const r = build({ file, inputs: inputs({ issues, fingerprint: 'fp-2' }) });
  assert.deepEqual(r, {
    file, fingerprint: 'fp-2', nodes: base + 5, edges: 3,
    status: {
      ...baseStatus,
      'finding-found-by-lane': { status: 'built', edges: 1 },
      'finding-in-repo': { status: 'built', edges: 1 },
      'session-claimed-finding': { status: 'built', edges: 1, note: 'claims that recorded a session id; no other issue event records one' },
    },
  });
}));

test('build adds one class node per vocabulary entry and counts every lane as unmapped without approaches', () => withDir((dir) => {
  const base = lanes(dir);
  const file = join(dir, 'graph.db');
  const taxonomy = { weaknessClassVocab: { x: { label: 'X' }, y: null }, approaches: [] };
  const r = build({ file, inputs: inputs({ taxonomy }) });
  assert.deepEqual(r, {
    file, fingerprint: 'fp-1', nodes: base + 2, edges: 0,
    status: { ...baseStatus, 'lane-covers-class': { status: 'built', edges: 0, lanesWithoutTaxonomyEntry: base } },
  });
}));

test('build adds declared areas and counts the rollup that is missing on disk', () => withDir((dir) => {
  const base = lanes(dir);
  const file = join(dir, 'graph.db');
  const doc = { repos: [{ scanners: { zz: { ran: true } } }, { name: 'r1', scanners: { zz: { ran: 'yes' } } }] };
  writeFileSync(join(dir, 'b.json'), JSON.stringify(doc));
  const registry = { areas: [{ slug: 'b', label: 'B' }, { slug: 'a' }] };
  const rollups = [{ area: 'a', file: join(dir, 'missing.json') }, { area: 'b', file: join(dir, 'b.json') }];
  const r = build({ file, inputs: inputs({ registry, rollups }) });
  assert.deepEqual(r, {
    file, fingerprint: 'fp-1', nodes: base + 2, edges: 0,
    status: {
      ...baseStatus,
      'lane-ran-on-repo': { status: 'built', edges: 0, areasWithoutRollup: 1 },
      'repo-in-area': { status: 'built', edges: 0, reposOutsideDeclaredAreas: 0 },
    },
  });
}));

test('build refuses a rollup file that is not valid JSON and writes nothing', () => withDir((dir) => {
  const file = join(dir, 'graph.db');
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{');
  const rollups = [{ area: 'a', file: bad }];
  assert.throws(() => build({ file, inputs: inputs({ registry: { areas: [] }, rollups }) }), {
    name: 'Error', message: `the rollup at ${bad} is not valid JSON (${jsonError('{')})`,
  });
  assert.equal(existsSync(file), false);
}));
