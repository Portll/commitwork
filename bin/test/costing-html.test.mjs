// bin/costing-html.mjs: drive the CLI through CW_COSTING_SRC / CW_COSTING_OUT / CW_NOW on temp paths
// and assert the artifact: markdown is rendered and escaped, the page is self-contained, output is
// byte-identical under a pinned CW_NOW, and a missing source is a refusal that writes nothing.
//
// A spawned CLI cannot tell a module-load env read from a call-time one, because the child reads a
// fresh environment either way. The in-process block at the bottom is the witness for that, and it
// is why these tests do not stand alone.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = join(dirname(fileURLToPath(import.meta.url)), '..', 'costing-html.mjs');
let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'cw-costing-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

const MD = [
  '# Scale <tiers> & costs', '', 'Intro with `a<b` code and **bold** and [link](https://example.com/x).', '',
  '## First section', '', '| Item | Cost |', '|:--|--:|', '| a<script> | 1<br>2 |', '| | |', '',
  '- one', '- two', '', '```', 'x < y && z', '```', '', '> quoted', '', '## Second section', '', '1. first', '2. second', '',
].join('\n');

const run = (src, out, env = {}) => spawnSync(process.execPath, [SELF], {
  encoding: 'utf8', timeout: 20000, cwd: dir,
  env: { ...process.env, CW_SELF_SWEEP: '0', CW_COSTING_SRC: src, CW_COSTING_OUT: out, ...env },
});

describe('costing-html', () => {
  test('renders the markdown structure and escapes what must be escaped', () => {
    const src = join(dir, 'a.md'); const out = join(dir, 'nested', 'deeper', 'a.html');
    writeFileSync(src, MD);
    const r = run(src, out, { CW_NOW: '2026-01-02' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /a\.html\s+[\d.]+ KB\s+2 sections/);   // creates missing output dirs
    const h = readFileSync(out, 'utf8');
    assert.match(h, /<title>Scale &lt;tiers&gt; &amp; costs<\/title>/);
    assert.match(h, /<h2 id="first-section">First section<\/h2>/);
    assert.match(h, /<a href="#second-section">Second section<\/a>/);
    assert.match(h, /<th style="text-align:left">Item<\/th><th style="text-align:right">Cost<\/th>/);
    assert.match(h, /<td style="text-align:left">a&lt;script&gt;<\/td><td style="text-align:right">1<br>2<\/td>/);
    assert.equal((h.match(/<tr>/g) || []).length, 2, 'header row plus one data row; the blank row is dropped');
    assert.match(h, /<code>a&lt;b<\/code>/);
    assert.match(h, /<strong>bold<\/strong>/);
    assert.match(h, /<pre><code>x &lt; y &amp;&amp; z<\/code><\/pre>/);
    assert.match(h, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
    assert.match(h, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
    assert.match(h, /<blockquote>quoted<\/blockquote>/);
    // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- asserts the rendered page carries no script tag
    assert.ok(!h.includes('<script>'), 'source markup must not reach the page unescaped');
    assert.match(h, /on 2026-01-02\./);
  });

  test('is self-contained: no CDN, no external asset reference, no script', () => {
    const src = join(dir, 'b.md'); const out = join(dir, 'b.html');
    writeFileSync(src, MD);
    assert.equal(run(src, out).status, 0);
    const h = readFileSync(out, 'utf8');
    assert.ok(h.startsWith('<!doctype html>'));
    assert.ok(!/<script\b/i.test(h) && !/<link\b(?![^>]*\bhref="data:)/i.test(h) && !/<img\b/i.test(h) && !/<iframe\b/i.test(h));
    assert.match(h, /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml;base64,/, 'the tab icon is inlined');
    assert.ok(!/\b(src|href)="https?:/i.test(h.replace(/<a href="https:\/\/example\.com\/x">/, '')), 'only the author link may be external');
    assert.ok(!/@import|url\(/i.test(h), 'CSS pulls nothing in');
    assert.match(h, /<style>[\s\S]+<\/style>/);
  });

  test('is byte-identical for the same inputs under a pinned CW_NOW, and the stamp follows CW_NOW', () => {
    const src = join(dir, 'c.md'); const o1 = join(dir, 'c1.html'); const o2 = join(dir, 'c2.html'); const o3 = join(dir, 'c3.html');
    writeFileSync(src, MD);
    run(src, o1, { CW_NOW: '2026-03-04' }); run(src, o2, { CW_NOW: '2026-03-04' }); run(src, o3, { CW_NOW: '2027-05-06' });
    const a = readFileSync(o1), b = readFileSync(o2);
    assert.ok(a.equals(b));
    assert.ok(!a.equals(readFileSync(o3)));
    assert.match(readFileSync(o3, 'utf8'), /on 2027-05-06\./);
  });

  test('re-running over an existing output overwrites it idempotently', () => {
    const src = join(dir, 'd.md'); const out = join(dir, 'd.html');
    writeFileSync(src, MD);
    run(src, out, { CW_NOW: '2026-01-01' });
    const first = readFileSync(out, 'utf8');
    writeFileSync(src, MD.replace('First section', 'Renamed section'));
    assert.equal(run(src, out, { CW_NOW: '2026-01-01' }).status, 0);
    const second = readFileSync(out, 'utf8');
    assert.notEqual(first, second);
    assert.match(second, /Renamed section/);
    assert.ok(!second.includes('First section'));
  });

  test('a missing source is a nonzero refusal naming ENOENT, and no page is written', () => {
    const out = join(dir, 'never.html');
    const r = run(join(dir, 'absent.md'), out);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ENOENT/);
    assert.ok(!existsSync(out), 'a refusal must not leave an empty or partial page');
  });

  test('an unreadable source (a directory) is also a refusal, never an empty page', () => {
    const out = join(dir, 'never2.html');
    const r = run(dir, out);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /EISDIR/);
    assert.ok(!existsSync(out));
  });

  test('a source with no headings still renders, titled by its file name, with zero sections', () => {
    const src = join(dir, 'plain.md'); const out = join(dir, 'plain.html');
    writeFileSync(src, 'just a paragraph\n');
    const r = run(src, out);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /0 sections/);
    assert.match(readFileSync(out, 'utf8'), /<title>plain\.md<\/title>/);
  });
});

describe('costing-html in process', () => {
  // The spawned tests above pass under either resolution. These fail if the env moves back to
  // module load, because the override is set AFTER the module is imported.
  const keep = {};
  const setEnv = (k, v) => { keep[k] = process.env[k]; if (v === null) delete process.env[k]; else process.env[k] = v; };
  after(() => { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  test('srcPath, outPath and stampNow read the env at call time, not at import', async () => {
    const m = await import('../costing-html.mjs');
    setEnv('CW_COSTING_SRC', '/set/after/import.md');
    setEnv('CW_COSTING_OUT', '/set/after/import.html');
    setEnv('CW_NOW', '2030-12-31');
    assert.equal(m.srcPath([]), '/set/after/import.md');
    assert.equal(m.outPath([]), '/set/after/import.html');
    assert.equal(m.stampNow(), '2030-12-31');
    setEnv('CW_COSTING_SRC', null);
    setEnv('CW_COSTING_OUT', null);
    assert.equal(m.srcPath(['node', 'x', 'from-argv.md']), 'from-argv.md');
    assert.equal(m.outPath(['node', 'x', 'a.md', 'from-argv.html']), 'from-argv.html');
  });

  test('tiles are an input: no file means no tile row, and the figures are not in the source', async () => {
    const m = await import('../costing-html.mjs');
    assert.deepEqual(m.loadTiles(null), []);
    const { page } = m.buildPage({ md: '# T\n', title: 'T', stamp: '2026-01-01', src: 't.md' });
    assert.ok(!page.includes('class="tiles"'), 'a run with no tiles file renders no tile row');
    const self = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'costing-html.mjs'), 'utf8');
    assert.ok(!/\$[\d,]{4,}/.test(self), 'costing figures are a record and belong in the private store, not in the renderer');
  });

  test('a named tiles file is read and escaped; a broken one is a refusal, never an empty row', async () => {
    const m = await import('../costing-html.mjs');
    const f = join(dir, 'tiles.json');
    writeFileSync(f, JSON.stringify([{ value: '<1>', label: 'a & b', emphasis: true }, { value: '2', label: 'two' }]));
    const tiles = m.loadTiles(f);
    assert.equal(tiles.length, 2);
    assert.equal(tiles[0].emphasis, true);
    assert.equal(tiles[1].emphasis, false);
    const { page } = m.buildPage({ md: '# T\n', title: 'T', stamp: '2026-01-01', src: 't.md', tiles });
    assert.match(page, /<div class="tile hi"><b>&lt;1&gt;<\/b><span>a &amp; b<\/span><\/div>/);

    writeFileSync(join(dir, 'bad.json'), '{not json');
    assert.throws(() => m.loadTiles(join(dir, 'bad.json')), /does not parse/);
    writeFileSync(join(dir, 'obj.json'), '{"a":1}');
    assert.throws(() => m.loadTiles(join(dir, 'obj.json')), /must hold an array/);
    writeFileSync(join(dir, 'shape.json'), '[{"value":"1"}]');
    assert.throws(() => m.loadTiles(join(dir, 'shape.json')), /string value and label/);
    assert.throws(() => m.loadTiles(join(dir, 'absent.json')), /ENOENT/);
  });
});
