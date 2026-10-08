// The second witness must not quietly become the first one wearing two hats.
//
// "Shares no extraction code" is a property that decays one convenience import at a time, and the
// decay is invisible: the suite stays green, the two passes agree more and more, and the agreement
// is the code being the same code. So it is checked rather than remembered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FLOW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(FLOW, f), 'utf8');

// Any specifier, however written: static, dynamic, or require.
function localImports(src) {
  const out = new Set();
  for (const m of src.matchAll(/(?:from|import|require)\s*\(?\s*['"](\.[^'"]*)['"]/g)) out.add(m[1]);
  return [...out];
}

test('C2 imports NOTHING from flow/ — not the lexer, not the graph, not the store', () => {
  assert.deepEqual(localImports(read('runtime.mjs')), [],
    'flow/runtime.mjs must share no code with flow/static.mjs, directly or through a helper');
});

test('the trace hook imports nothing local either', () => {
  assert.deepEqual(localImports(read('trace-hook.cjs')), [],
    'the observation mechanism must be able to be wrong on its own');
});

test('C2 never reaches the static pass by name', () => {
  for (const f of ['runtime.mjs', 'trace-hook.cjs']) {
    const src = read(f);
    for (const forbidden of ['static.mjs', 'lexer.mjs', 'verify.mjs', 'graph.mjs', 'store.mjs']) {
      assert.ok(!src.includes(`./${forbidden}`), `${f} references ${forbidden}`);
    }
  }
});

test('C1 does not import C2 either — the dependency must not close into a cycle', () => {
  assert.ok(!localImports(read('static.mjs')).some((s) => s.includes('runtime')),
    'if C1 could call C2, one failure could silence both');
});

test('no flow source carries a raw NUL byte', () => {
  // Not hypothetical here: authoring flow/graph.mjs turned a six-character escape into a real 0x00,
  // and docs/TRAPS.md records that eleven tracked sources already carry one — grep answers "not
  // found" on them and git grep answers "Binary file … matches" with exit 0. Neither is gateable,
  // so it is gated here.
  for (const f of ['static.mjs', 'lexer.mjs', 'verify.mjs', 'graph.mjs', 'store.mjs', 'runtime.mjs',
    'reconcile.mjs', 'orphans.mjs', 'liveness.mjs', 'trace-hook.cjs']) {
    assert.equal(readFileSync(join(FLOW, f)).indexOf(0), -1, `${f} carries a raw NUL byte`);
  }
});

test('every flow module is reachable — nothing here is its own orphan', () => {
  // A dataflow tool that ships an artifact nothing reads would be a joke with a cost.
  const entry = ['static.mjs', 'runtime.mjs', 'reconcile.mjs', 'orphans.mjs', 'liveness.mjs'];
  const referenced = new Set(entry);
  for (const f of entry) for (const s of localImports(read(f))) referenced.add(s.replace(/^\.\//, ''));
  for (const f of ['lexer.mjs', 'verify.mjs', 'graph.mjs', 'store.mjs']) {
    assert.ok(referenced.has(f), `${f} is imported by nothing`);
  }
});
