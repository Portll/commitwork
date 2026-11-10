// Hash-chained ledger record of one run, diffed against the repo's previous run (monitor/resolution-chain.mjs recordRun).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordRun } from '../resolution-chain.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const NOW = '2025-01-01T00:00:00.000Z';
const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const prevOf = (r) => h(JSON.stringify({ ...r, hash: undefined }));

function expected({ reached, refused = [], distribution = null, pinnedArtifacts = null, runOrdinal, firstSighting, changed, newHosts, goneHosts, prev }) {
  const rec = { at: NOW, repo: 'r1', chainId: h(reached.join('>')), reached, refused, distribution, pinnedArtifacts, runOrdinal, firstSighting, changed, newHosts, goneHosts, prev };
  return { ...rec, hash: h(JSON.stringify(rec)) };
}

function withLedger(lines, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'recordRun-'));
  const saved = process.env.CW_NOW;
  process.env.CW_NOW = NOW;
  try {
    const path = join(dir, 'chains.jsonl');
    writeFileSync(path, lines.map((l) => `${typeof l === 'string' ? l : JSON.stringify(l)}\n`).join(''));
    fn(path);
  } finally {
    if (saved === undefined) delete process.env.CW_NOW;
    else process.env.CW_NOW = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('A first run in an empty ledger is run one, not a change, and chains from genesis', () => {
  withLedger([], (path) => {
    const input = { repo: 'r1', reached: ['a', 'b'], refused: ['c'], path };
    const result = recordRun(input);
    assert.deepEqual(result, expected({ reached: ['a', 'b'], refused: ['c'], runOrdinal: 1, firstSighting: true, changed: false, newHosts: [], goneHosts: [], prev: 'genesis' }));
  });
});

test('Repeating the same chain is run two and not a change, with prev hashing the last line without its hash', () => {
  const p = { repo: 'r1', chainId: h('a'), reached: ['a'], hash: 'f'.repeat(32) };
  withLedger([p], (path) => {
    const input = { repo: 'r1', reached: ['a'], refused: [], path };
    const result = recordRun(input);
    assert.deepEqual(result, expected({ reached: ['a'], runOrdinal: 2, firstSighting: false, changed: false, newHosts: [], goneHosts: [], prev: prevOf(p) }));
  });
});

test('A host added since the last run is a change listed only in newHosts', () => {
  const p = { repo: 'r1', chainId: h('a'), reached: ['a'] };
  withLedger([p], (path) => {
    const input = { repo: 'r1', reached: ['a', 'b'], refused: [], path };
    const result = recordRun(input);
    assert.deepEqual(result, expected({ reached: ['a', 'b'], runOrdinal: 2, firstSighting: false, changed: true, newHosts: ['b'], goneHosts: [], prev: prevOf(p) }));
  });
});

test('A host dropped since the last run is a change listed only in goneHosts', () => {
  const p = { repo: 'r1', chainId: h('a>b'), reached: ['a', 'b'] };
  withLedger([p], (path) => {
    const input = { repo: 'r1', reached: ['b'], refused: [], path };
    const result = recordRun(input);
    assert.deepEqual(result, expected({ reached: ['b'], runOrdinal: 2, firstSighting: false, changed: true, newHosts: [], goneHosts: ['a'], prev: prevOf(p) }));
  });
});

test('Only the latest run of the repo is compared, all its runs are counted, and prev is the last ledger line', () => {
  const p1 = { repo: 'r1', chainId: h('a'), reached: ['a'] };
  const p2 = { repo: 'r1', chainId: h('b'), reached: ['b'] };
  const o = { repo: 'other', chainId: h('z'), reached: ['z'] };
  withLedger([p1, p2, o], (path) => {
    const input = { repo: 'r1', reached: ['b'], refused: [], path };
    const result = recordRun(input);
    assert.deepEqual(result, expected({ reached: ['b'], runOrdinal: 3, firstSighting: false, changed: false, newHosts: [], goneHosts: [], prev: prevOf(o) }));
  });
});

test('A prior run with no reached list makes every current host new and none gone', () => {
  const p = { repo: 'r1', chainId: 'old' };
  withLedger([p], (path) => {
    const input = { repo: 'r1', reached: ['a'], refused: [], path };
    const result = recordRun(input);
    assert.deepEqual(result, expected({ reached: ['a'], runOrdinal: 2, firstSighting: false, changed: true, newHosts: ['a'], goneHosts: [], prev: prevOf(p) }));
  });
});

test('Runs of another repo leave this repo at a first sighting but still set prev', () => {
  const o = { repo: 'other', chainId: h('z'), reached: ['z'] };
  withLedger([o], (path) => {
    const input = { repo: 'r1', reached: ['a'], refused: [], path };
    const result = recordRun(input);
    assert.deepEqual(result, expected({ reached: ['a'], runOrdinal: 1, firstSighting: true, changed: false, newHosts: [], goneHosts: [], prev: prevOf(o) }));
  });
});

test('A malformed trailing line is ignored when finding the prior run and prev', () => {
  const p = { repo: 'r1', chainId: h('a'), reached: ['a'] };
  withLedger([p, 'not json'], (path) => {
    const input = { repo: 'r1', reached: ['a', 'c'], refused: [], path };
    const result = recordRun(input);
    assert.deepEqual(result, expected({ reached: ['a', 'c'], runOrdinal: 2, firstSighting: false, changed: true, newHosts: ['c'], goneHosts: [], prev: prevOf(p) }));
  });
});

test('The record is appended as one JSON line after the existing ledger with distribution and pins kept', () => {
  const o = { repo: 'other', chainId: h('z'), reached: ['z'] };
  withLedger([o], (path) => {
    const input = { repo: 'r1', reached: ['a'], refused: ['x'], distribution: { direct: 2 }, pinnedArtifacts: ['p@1'], path };
    const result = recordRun(input);
    const exp = expected({ reached: ['a'], refused: ['x'], distribution: { direct: 2 }, pinnedArtifacts: ['p@1'], runOrdinal: 1, firstSighting: true, changed: false, newHosts: [], goneHosts: [], prev: prevOf(o) });
    assert.deepEqual(result, exp);
    assert.equal(readFileSync(path, 'utf8'), `${JSON.stringify(o)}\n${JSON.stringify(exp)}\n`);
  });
});
