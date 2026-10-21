// monitor/test/extractors-source.test.mjs — the seam text guards read the extractors through.
// See monitor/test/lib/extractors-source.mjs for why it exists: two text tests went blind as the
// module split, one of them silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { extractorFiles, extractorsSource, MONITOR } from './lib/extractors-source.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'cw-exsrc-'));

test('the real source is the barrel first, then every part module under monitor/extractors/', () => {
  const files = extractorFiles().map((p) => p.slice(MONITOR.length + 1).split('\\').join('/'));
  const parts = readdirSync(join(MONITOR, 'extractors')).filter((f) => f.endsWith('.mjs')).sort();
  assert.equal(files[0], 'extractors.mjs');
  assert.deepEqual(files.slice(1), parts.map((f) => `extractors/${f}`));
  assert.ok(parts.length >= 1, 'no part modules found: the directory walk degenerated');
  const src = extractorsSource();
  for (const f of files) assert.ok(src.includes(`// ==== ${f} ====`), `${f} is missing from the source`);
});

test('a part module added later is covered with no list to update', () => {
  const d = scratch();
  try {
    writeFileSync(join(d, 'extractors.mjs'), 'export const barrel = 1;\n');
    mkdirSync(join(d, 'extractors'));
    writeFileSync(join(d, 'extractors', 'a.mjs'), 'export const a = 1;\n');
    assert.ok(!extractorsSource({ base: d }).includes('late'));
    writeFileSync(join(d, 'extractors', 'z-late.mjs'), 'export const late = 1;\n');
    const src = extractorsSource({ base: d });
    assert.ok(src.includes('// ==== extractors/z-late.mjs ===='), src);
    assert.ok(src.includes('export const late = 1;'), 'the new part must be read, not only named');
    writeFileSync(join(d, 'extractors', 'notes.txt'), 'not a module\n');
    assert.ok(!extractorsSource({ base: d }).includes('not a module'), 'only .mjs files are source');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a missing barrel or a missing part directory throws: an absent source is not an empty one', () => {
  const d = scratch();
  try {
    writeFileSync(join(d, 'extractors.mjs'), 'export const barrel = 1;\n');
    assert.throws(() => extractorsSource({ base: d }), /ENOENT/, 'no extractors/ directory must throw');
    rmSync(join(d, 'extractors.mjs'));
    mkdirSync(join(d, 'extractors'));
    assert.throws(() => extractorsSource({ base: d }), /ENOENT/, 'no barrel must throw');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('line endings are normalised, so a line-anchored guard means the same on a CRLF checkout', () => {
  const d = scratch();
  try {
    writeFileSync(join(d, 'extractors.mjs'), 'const x = 1;\r\nconst y = 2;\r\n');
    mkdirSync(join(d, 'extractors'));
    const src = extractorsSource({ base: d });
    assert.ok(!src.includes('\r'), 'a carriage return survived');
    assert.ok(src.split('\n').includes('const x = 1;'));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── the two structural promises the barrel's header makes ─────────────────────────────────────────
test('no part module imports the barrel: that would be a cycle through monitor/extractors.mjs', () => {
  // Resolved, not spelled: `../extractors.mjs` from monitor/extractors/ IS the barrel.
  const barrel = join(MONITOR, 'extractors.mjs').split('\\').join('/');
  const offenders = [];
  for (const p of extractorFiles().slice(1)) {
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)) {
      const target = join(dirname(p), m[1]).split('\\').join('/');
      if (target === barrel) offenders.push(`${p.slice(MONITOR.length + 1)} imports '${m[1]}'`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('every part module is named in the barrel header map, so the map cannot quietly omit one', () => {
  const head = readFileSync(join(MONITOR, 'extractors.mjs'), 'utf8').split(/\r?\n/).filter((l) => l.startsWith('//')).join('\n');
  const missing = readdirSync(join(MONITOR, 'extractors')).filter((f) => f.endsWith('.mjs'))
    .filter((f) => !head.includes(`./extractors/${f}`));
  assert.deepEqual(missing, [], `part modules the barrel's map does not name: ${missing.join(', ')}`);
});
