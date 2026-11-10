// Exit code and report of a memory-directory dry run, coverage check or apply (bin/memory-sync.mjs main).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../memory-sync.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fm = (n, d) => `---\nname: ${n}\ndescription: ${d}\ntype: reference\n---\nbody of ${n}\n`;
const IDX = '## Core Notes\n- [Alpha](alpha.md) first note\n';
const HIT = { ok: true, memories: [{ id: 'm1' }] };
const CANARY_TAG = 'memory:__memory-sync-canary__';
const deps = (map = {}, calls = []) => ({
  recallImpl: async ([tag]) => map[tag.startsWith('memory:__absent-control-') ? 'control' : tag] || { ok: true, memories: [] },
  upsertImpl: async (rec) => { calls.push(rec.tags[0]); return { state: 'stub-state', id: 'r1', version: 2 }; },
});
const run = (argv, d, lines) => main(argv, { out: (s) => lines.push(s), deps: d });

async function withDir(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'main-'));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('help returns 0 and a missing mode returns 20, both printing the usage text', async () => {
  const lines = [];
  assert.equal(await run(['--help'], deps(), lines), 0);
  assert.equal(await run([], deps(), lines), 20);
  const head = 'memory-sync \u2014 sync the harness memory directory to the memory layer, by name';
  assert.deepEqual(lines.map((s) => s.split('\n')[0]), [head, head]);
});

test('with no argv it parses process.argv after the script path, and an unknown flag rejects', async () => {
  const saved = process.argv;
  const lines = [];
  process.argv = ['node', 'memory-sync.mjs', '--help'];
  try {
    assert.equal(await main(undefined, { out: (s) => lines.push(s), deps: deps() }), 0);
  } finally {
    process.argv = saved;
  }
  await assert.rejects(run(['--bogus'], deps(), lines), { name: 'Error', message: 'unknown argument: --bogus' });
});

test('dry run counts the records it would write and returns 21 only when a file is unreadable', async () => {
  await withDir({ 'MEMORY.md': IDX, 'alpha.md': fm('alpha', 'first'), 'beta.md': fm('beta', 'second') }, async (dir) => {
    const lines = [];
    assert.equal(await run(['--dry', '--dir', dir, '--limit', '1'], deps(), lines), 0);
    writeFileSync(join(dir, 'bad.md'), 'no frontmatter here');
    assert.equal(await run(['--dry', '--dir', dir], deps(), lines), 21);
    assert.deepEqual(lines, [
      `1 record(s) would be written to ${dir}'s layer copy; 0 unreadable`,
      `2 record(s) would be written to ${dir}'s layer copy; 1 unreadable`,
    ]);
  });
});

test('dry run with --json reports each record with its tags and byte size, indented by two', async () => {
  await withDir({ 'MEMORY.md': IDX, 'alpha.md': fm('alpha', 'first'), 'bad.md': 'no frontmatter here' }, async (dir) => {
    const lines = [];
    assert.equal(await run(['--dry', '--json', '--dir', dir], deps(), lines), 21);
    const r = JSON.parse(lines[0]);
    assert.equal(lines[0], JSON.stringify(r, null, 2));
    assert.match(r.records[0].external_id, /^claude-memory\/.+\/alpha$/);
    delete r.records[0].external_id;
    assert.deepEqual(r, {
      dir, files: 2, parsed: 1, unreadable: [{ file: 'bad.md', reason: 'no frontmatter block' }], indexedByMemoryMd: 1, mode: 'dry',
      records: [{ slug: 'alpha', tags: ['memory:alpha', 'harness-memory', 'memory-type:reference', 'memory-group:core-notes'], bytes: 20 }],
    });
  });
});

test('coverage sorts slugs into present, absent and unmeasured and returns 21 when any is unmeasured', async () => {
  await withDir({ 'alpha.md': fm('alpha', 'first'), 'beta.md': fm('beta', 'second'), 'gamma.md': fm('gamma', 'third') }, async (dir) => {
    const lines = [];
    const d = deps({ 'memory:alpha': HIT, 'memory:gamma': { ok: false, reason: 'down' } });
    assert.equal(await run(['--coverage', '--dir', dir], d, lines), 21);
    assert.deepEqual(lines, ['1/3 retrievable by name \u00b7 1 absent \u00b7 1 unmeasured\n  absent beta']);
  });
});

test('coverage with --json skips the canary write and returns 0 when every slug is present', async () => {
  await withDir({ 'alpha.md': fm('alpha', 'first') }, async (dir) => {
    const lines = [];
    const calls = [];
    assert.equal(await run(['--coverage', '--json', '--dir', dir], deps({ 'memory:alpha': HIT }, calls), lines), 0);
    assert.deepEqual(calls, []);
    assert.deepEqual(lines, [JSON.stringify({
      dir, files: 1, parsed: 1, unreadable: [], indexedByMemoryMd: 0, mode: 'coverage',
      canary: { ok: true, reason: null, positive: 'skipped \u2014 read-only run' },
      coverage: { total: 1, present: ['alpha'], absent: [], unknown: [] },
    }, null, 2)]);
  });
});

test('a negative control that returns rows refuses the run with 20', async () => {
  await withDir({ 'alpha.md': fm('alpha', 'first') }, async (dir) => {
    const lines = [];
    const d = deps({ control: HIT });
    assert.equal(await run(['--apply', '--json', '--dir', dir], d, lines), 20);
    assert.equal(await run(['--coverage', '--dir', dir], d, lines), 20);
    const reason = 'negative control returned 1 row(s) for a tag minted nowhere \u2014 enumeration does not filter, so coverage would be meaningless';
    assert.deepEqual(lines, [
      JSON.stringify({ dir, files: 1, parsed: 1, unreadable: [], indexedByMemoryMd: 0, mode: 'apply', canary: { ok: false, reason } }, null, 2),
      `REFUSED \u2014 ${reason}`,
    ]);
  });
});

test('apply with receipts in an unlisted state counts none verified or broken and returns 21 only for an unreadable file', async () => {
  await withDir({ 'alpha.md': fm('alpha', 'first'), 'beta.md': fm('beta', 'second') }, async (dir) => {
    const lines = [];
    const d = deps({ [CANARY_TAG]: HIT });
    assert.equal(await run(['--apply', '--dir', dir], d, lines), 0);
    writeFileSync(join(dir, 'bad.md'), 'no frontmatter here');
    assert.equal(await run(['--apply', '--dir', dir], d, lines), 21);
    assert.deepEqual(lines, [
      '0/2 verified \u00b7 0 failed or divergent \u00b7 0 unreadable',
      '0/2 verified \u00b7 0 failed or divergent \u00b7 1 unreadable',
    ]);
  });
});

test('apply with --json writes the canary before each record and reports receipts with an empty broken list', async () => {
  await withDir({ 'alpha.md': fm('alpha', 'first') }, async (dir) => {
    const lines = [];
    const calls = [];
    assert.equal(await run(['--apply', '--json', '--dir', dir], deps({ [CANARY_TAG]: HIT }, calls), lines), 0);
    assert.deepEqual(calls, [CANARY_TAG, 'memory:alpha']);
    const r = JSON.parse(lines[0]);
    assert.equal(lines[0], JSON.stringify(r, null, 2));
    delete r.tally;
    assert.deepEqual(r, {
      dir, files: 1, parsed: 1, unreadable: [], indexedByMemoryMd: 0, mode: 'apply',
      canary: { ok: true, reason: null, positive: 'stub-state', id: 'r1', version: 2 },
      receipts: [{ slug: 'alpha', state: 'stub-state', id: 'r1', version: 2 }],
      broken: [],
    });
  });
});
