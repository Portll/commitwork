// One sha256, size and finding-count sample per chosen repo batch and roster artifact (monitor/artifact-anomaly.mjs collectSamples).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSamples } from '../artifact-anomaly.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const CAT = 'zz-not-a-scanner-category';

function withDir(body) {
  const dir = mkdtempSync(join(tmpdir(), 'collectSamples-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function put(dir, rel, content) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

function sample(repo, file, content, artifactTotal, category = CAT) {
  return {
    category,
    repo,
    file,
    hash: createHash('sha256').update(content).digest('hex'),
    bytes: content.length,
    total: null,
    artifactTotal,
  };
}

const roster = (...files) => files.map((filename) => ({ category: CAT, checkId: 'check', filename }));

test('a bare repo directory with one roster artifact gives one sample with its hash, size and array length', () => withDir((dir) => {
  put(dir, 'alpha/out.json', '[1,2,3]');
  assert.deepEqual(collectSamples(dir, roster('out.json')), [sample('alpha', 'out.json', '[1,2,3]', 3)]);
}));

test('rank 0 picks the newest sweep batch, rank 1 the older one, rank 2 the bare dir and rank 3 nothing', () => withDir((dir) => {
  put(dir, 'beta/out.json', '  \n');
  put(dir, 'sweep-2026-01-01/beta/out.json', '[1]');
  put(dir, 'sweep-2026-02-01/beta/out.json', '[1,2]');
  const r = roster('out.json');
  assert.deepEqual(collectSamples(dir, r), [sample('beta', 'out.json', '[1,2]', 2)]);
  assert.deepEqual(collectSamples(dir, r, { rank: 1 }), [sample('beta', 'out.json', '[1]', 1)]);
  assert.deepEqual(collectSamples(dir, r, { rank: 2 }), [sample('beta', 'out.json', '  \n', 0)]);
  assert.deepEqual(collectSamples(dir, r, { rank: 3 }), []);
}));

test('each repo uses its own newest batch, in the order repos are first discovered', () => withDir((dir) => {
  put(dir, 'sweep-2026-01-01/iota/out.json', '[9]');
  put(dir, 'sweep-2026-01-01/theta/out.json', '[]');
  put(dir, 'sweep-2026-02-01/theta/out.json', '[7,8]');
  assert.deepEqual(collectSamples(dir, roster('out.json')), [
    sample('iota', 'out.json', '[9]', 1),
    sample('theta', 'out.json', '[7,8]', 2),
  ]);
}));

test('roster files missing from a repo are skipped and the rest keep roster order with JSONL and SARIF counts', () => withDir((dir) => {
  const sarif = JSON.stringify({ runs: [{ results: [1, 2] }, null, { results: [3] }, {}] });
  const jsonl = '{"a":1}\n{"b":2}\n';
  put(dir, 'gamma/scan.sarif', sarif);
  put(dir, 'gamma/scan.jsonl', jsonl);
  assert.deepEqual(collectSamples(dir, roster('scan.jsonl', 'absent.json', 'scan.sarif')), [
    sample('gamma', 'scan.jsonl', jsonl, 2),
    sample('gamma', 'scan.sarif', sarif, 3),
  ]);
}));

test('a JSON object without runs and a file with a non-JSON line both give a null artifact count', () => withDir((dir) => {
  put(dir, 'delta/x.json', '{"a":1}');
  put(dir, 'epsilon/x.json', '{"a":1}\nnope\n');
  assert.deepEqual(collectSamples(dir, roster('x.json')), [
    sample('delta', 'x.json', '{"a":1}', null),
    sample('epsilon', 'x.json', '{"a":1}\nnope\n', null),
  ]);
}));

test('dot dirs, loose files, history and dot entries inside a sweep are not treated as repos', () => withDir((dir) => {
  put(dir, '.hidden/out.json', '[1]');
  put(dir, 'loose.txt', 'x');
  put(dir, 'sweep-2026-03-01/history/out.json', '[1]');
  put(dir, 'sweep-2026-03-01/.cache/out.json', '[1]');
  put(dir, 'sweep-2026-03-01/notes.txt', 'x');
  put(dir, 'sweep-2026-03-01/zeta/out.json', '[0]');
  assert.deepEqual(collectSamples(dir, roster('out.json')), [sample('zeta', 'out.json', '[0]', 1)]);
}));

test('a roster name that is a directory cannot be read and is skipped, and category comes from the roster entry', () => withDir((dir) => {
  put(dir, 'eta/sub/inner.json', '[]');
  put(dir, 'eta/ok.json', '[]');
  const r = [
    { category: 'zz-first', checkId: 'a', filename: 'sub' },
    { category: 'zz-second', checkId: 'b', filename: 'ok.json' },
  ];
  assert.deepEqual(collectSamples(dir, r), [sample('eta', 'ok.json', '[]', 0, 'zz-second')]);
}));

test('a missing reports dir or an empty one gives no samples', () => withDir((dir) => {
  assert.deepEqual(collectSamples(join(dir, 'missing')), []);
  assert.deepEqual(collectSamples(dir), []);
}));
