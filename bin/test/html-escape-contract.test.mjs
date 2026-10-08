// Tests for the shared HTML escaper contract (positive and negative)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from '../../flow/lexer.mjs';
import { esc, escText } from '../../lib/html-escape.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANONICAL = 'lib/html-escape.mjs';
const DECL = /(?:\bconst|\blet|\bvar|\bfunction)\s+([A-Za-z_$][\w$]*)\s*(?:=|\()/g;
const ESCAPES_LT = /['"]&lt;['"]/;
const ESCAPES_AMP = /['"]&amp;['"]/;
const ESCAPES_DQ = /&quot;|&#34;|&#x22;/i;
const ESCAPES_SQ = /&#39;|&#x27;|&apos;/i;

function statementFrom(src, at) {
  const lines = src.slice(at).split('\n');
  const out = [];
  for (const line of lines.slice(0, 6)) {
    out.push(line);
    if (/[;}]\s*$/.test(line.trim())) break;
  }
  return out.join('\n');
}

function escapersIn(src) {
  const lexed = classify(src);
  if (!lexed.ok) return { ok: false, reason: lexed.reason, found: [] };
  const spanAt = (i) => lexed.spans.find((s) => i >= s.start && i < s.end)?.kind ?? null;
  const canImport = /^import\s/m.test(src);
  const found = [];
  for (const m of src.matchAll(DECL)) {
    const where = spanAt(m.index);
    if (where !== null && where !== 'template') continue;
    const stmt = statementFrom(src, m.index);
    if (!ESCAPES_AMP.test(stmt)) continue;
    const lt = ESCAPES_LT.exec(stmt);
    if (!lt || spanAt(m.index + lt.index + 1) !== (where === 'template' ? 'template' : 'string')) continue;
    found.push({
      name: m[1],
      line: src.slice(0, m.index).split('\n').length,
      where: where === 'template' ? 'emitted' : 'module',
      language: /&apos;/.test(stmt) ? 'xml' : 'html',
      canImport: where === null && canImport,
      full: ESCAPES_DQ.test(stmt) && ESCAPES_SQ.test(stmt),
    });
  }
  return { ok: true, reason: null, found };
}

function trackedSources() {
  return execFileSync('git', ['-C', ROOT, 'ls-files', '*.mjs', '*.js'], { encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => !/(^|\/)(test|fixtures|vendor|node_modules)\//.test(f));
}

function scanRepo() {
  const rows = [];
  const unread = [];
  for (const file of trackedSources()) {
    let src;
    try { src = readFileSync(join(ROOT, file), 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const r = escapersIn(src);
    if (!r.ok) { unread.push(`${file}: ${r.reason}`); continue; }
    for (const e of r.found) rows.push({ file, ...e });
  }
  return { rows, unread };
}

test('the shared escaper covers text and both quoted attribute forms', () => {
  assert.equal(esc(`<a href="x" title='y'>&`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});

test('the text-only escaper escapes & < > and leaves quotes as typed', () => {
  assert.equal(escText(`<a href="x" title='y'>&`), `&lt;a href="x" title='y'&gt;&amp;`);
  assert.equal(escText('&quot; &#39;'), '&amp;quot; &amp;#39;');
  assert.equal(escText(null), '');
  assert.equal(escText(0), '0');
});

test('the detector finds a planted escaper and ignores a decoder (positive and negative control)', () => {
  const planted = "import x from './y.mjs';\nconst esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');\n";
  const decoder = "const dec = (x) => x.replace(/&lt;/g, '<').replace(/&amp;/g, '&');\n";
  const emitted = 'const page = `<script>const e=s=>String(s).replace(/&/g,\'&amp;\').replace(/</g,\'&lt;\');</script>`;\n';
  assert.deepEqual(escapersIn(planted).found.map((e) => [e.name, e.where, e.canImport, e.full]), [['esc', 'module', true, false]]);
  assert.deepEqual(escapersIn(decoder).found, []);
  assert.deepEqual(escapersIn(emitted).found.map((e) => [e.name, e.where, e.canImport]), [['e', 'emitted', false]]);
  const xml = "const x = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\"/g, '&quot;').replace(/'/g, '&apos;');\n";
  assert.deepEqual(escapersIn(xml).found.map((e) => [e.language, e.full]), [['xml', true]]);
});

test('every tracked source was read by the lexer', () => {
  assert.deepEqual(scanRepo().unread, []);
});

test('no importable module defines its own HTML escaper', () => {
  const offenders = scanRepo().rows
    .filter((r) => r.language === 'html' && r.canImport && r.file !== CANONICAL)
    .map((r) => `${r.file}:${r.line} ${r.name} — import { esc } from '${CANONICAL}'`);
  assert.deepEqual(offenders, []);
});

test('every escaper that stays local escapes both quote characters', () => {
  const offenders = scanRepo().rows
    .filter((r) => (!r.canImport || r.language === 'xml') && !r.full)
    .map((r) => `${r.file}:${r.line} ${r.name} (${r.where})`);
  assert.deepEqual(offenders, []);
});
