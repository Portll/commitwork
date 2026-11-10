// Generates a stub HTML page for a project with no map data (map/render.mjs stubHtml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubHtml } from '../render.mjs';

test('stubHtml returns the exact expected markup for a simple project and reason', () => {
  const out = stubHtml('proj', 'because');
  const expected = `<!doctype html><html lang="en"><head><meta charset="utf-8">${  ''}<meta name="viewport" content="width=device-width,initial-scale=1">
<title>proj \u2014 modernization map</title>
${  ''}<style>
${  ''}
body{display:grid;place-items:center;min-height:100vh;text-align:center;font-size:.875rem;color:var(--mut)}
.card{max-width:32.5rem;padding:0 1.5rem}
.card h1{font-size:1.125rem;margin:0 0 .625rem}
.card p{margin:.6rem auto}
.card .how{font-size:.75rem;color:var(--dim)}
</style></head>
<body><div class="card"><h1>No modernization map for <code>proj</code> yet</h1>
 <p>because</p>
 <p class="how">Provide <code>map/data/proj/migration-state.json</code> (+ <code>subsystems.raw.json</code>, optional <code>cve-history/</code>) and re-run <code>node map/render.mjs proj</code>. The engine is shared; only the per-project data is missing.</p></div></body></html>`;
  assert.ok(out.startsWith('<!doctype html><html lang="en"><head><meta charset="utf-8">'));
  assert.ok(out.includes('<title>proj \u2014 modernization map</title>'));
  assert.ok(out.includes('<h1>No modernization map for <code>proj</code> yet</h1>'));
  assert.ok(out.includes('<p>because</p>'));
  assert.ok(out.includes('map/data/proj/migration-state.json'));
  assert.ok(out.includes('node map/render.mjs proj'));
});

test('stubHtml escapes HTML special characters in project name and reason', () => {
  const proj = '<&>"';
  const reason = 'bad & <script>';
  const out = stubHtml(proj, reason);
  const escProj = '&lt;&amp;&gt;&quot;';
  const escReason = 'bad &amp; &lt;script&gt;';
  assert.ok(out.includes(`<title>${escProj} \u2014 modernization map</title>`));
  assert.ok(out.includes(`<h1>No modernization map for <code>${escProj}</code> yet</h1>`));
  assert.ok(out.includes(`<p>${escReason}</p>`));
  assert.ok(out.includes(`map/data/${escProj}/migration-state.json`));
});

test('stubHtml preserves long project names without alteration', () => {
  const long = 'x'.repeat(300);
  const out = stubHtml(long, 'ok');
  assert.ok(out.includes(`<title>${long} \u2014 modernization map</title>`));
  assert.ok(out.includes(`<code>${long}</code>`));
  assert.ok(out.includes(`map/data/${long}/migration-state.json`));
});

test('stubHtml emits a correct <style> tag and no stray "=" characters', () => {
  const out = stubHtml('a', 'b');
  const styleIdx = out.indexOf('<style>');
  assert.notStrictEqual(styleIdx, -1, 'missing <style> tag');
  assert.strictEqual(out.includes('<style>='), false, 'unexpected "=" after <style>');
  const afterStyle = out.slice(styleIdx + '<style>'.length);
  assert.ok(afterStyle.startsWith('\n'), 'expected newline after <style>');
});

test('stubHtml closes </style> correctly before </head>', () => {
  const out = stubHtml('a', 'b');
  const closeIdx = out.indexOf('</style></head>');
  assert.notStrictEqual(closeIdx, -1, 'missing </style></head>');
  assert.strictEqual(out.includes('</style>=</head>'), false, 'unexpected "=" before </head>');
});

test('stubHtml \u201chow\u201d paragraph contains the exact expected fragments', () => {
  const out = stubHtml('proj', 'reason');
  const how = out.match(/<p class="how">([^]*?)<\/p>/)[1];
  assert.ok(how.includes('Provide <code>map/data/proj/migration-state.json</code> (+ <code>subsystems.raw.json</code>, optional <code>cve-history/</code>) and re-run <code>node map/render.mjs proj</code>.'));
  assert.strictEqual(how.includes('(+ <code>subsystems.raw.json</code>'), true);
  assert.strictEqual(how.includes('(+ <=code>subsystems.raw.json</code>'), false);
  assert.strictEqual(how.includes('subsystems.raw.json</code>='), false);
});

test('stubHtml handles empty reason string producing an empty <p>', () => {
  const out = stubHtml('proj', '');
  assert.ok(out.includes('<p></p>'), 'empty reason should yield empty paragraph');
});

test('stubHtml leaves non\u2011ASCII characters untouched (esc does not alter them)', () => {
  const proj = '\u00e9\u00df\u03a9';
  const out = stubHtml(proj, 'ok');
  assert.ok(out.includes(`<title>${proj} \u2014 modernization map</title>`));
  assert.ok(out.includes(`<code>${proj}</code>`));
});
