// The Remediation table's fleet-wide marker. serve.mjs tags runtime rows (DAST/TLS/BOLA/CSPM) with
// scope:'fleet-wide' because they come from the shared runtime scan, which has no project dimension,
// and the client never read the tag: those rows appeared under every project as if they were its own.
// remedRow() is lifted from the assembled panel and run with the panel's own esc() and pill().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelSource } from './lib/panel-source.mjs';
import { serverSource } from './lib/server-source.mjs';

const SRC = panelSource('index.html');
const constLine = (name) => {
  const line = SRC.split('\n').find((l) => l.startsWith(`const ${name}=`));
  assert.ok(line, `const ${name} not found in the panel`);
  return line;
};
const fn = (name) => {
  const at = SRC.indexOf(`function ${name}(`);
  assert.ok(at > -1, `function ${name}() not found in the panel`);
  let depth = 0;
  for (let i = SRC.indexOf('{', at); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(at, i + 1);
  }
  return assert.fail('unbalanced braces');
};
const remedRow = new Function([constLine('esc'), constLine('pill'), fn('remedRow'), 'return remedRow;'].join('\n'))();
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const RUNTIME = { project: 'Client A', scope: 'fleet-wide', source: 'TLS', sev: 'med', title: 'Missing security headers', detail: 'hsts', status: 'open', action: 'add headers' };
const AREA = { project: 'Client A', source: 'CVE', sev: 'high', title: 'lodash', detail: 'proto pollution', status: 'open', action: 'upgrade' };

test('a fleet-wide row says so in text, and the title says it is not this project\'s', () => {
  const row = remedRow(RUNTIME, 0);
  assert.match(text(row), /\bTLS fleet-wide\b/, 'the marker must be readable text beside the source, not a colour');
  assert.match(row, /<span class="pill plan" title="[^"]*not specific to this project[^"]*">fleet-wide<\/span>/);
});

test('an area row carries no marker', () => {
  assert.doesNotMatch(remedRow(AREA, 0), /fleet-wide/);
  assert.doesNotMatch(remedRow({ ...RUNTIME, scope: 'area' }, 0), /fleet-wide/, 'only the declared value marks a row');
});

test('every value in the row is escaped, the source included', () => {
  const row = remedRow({ ...RUNTIME, source: '<i>X</i>', title: '<img src=x>', detail: '"q"', action: '<b>' }, 0);
  assert.doesNotMatch(row, /<i>X|<img|<b>/);
  assert.match(row, /&lt;i&gt;X&lt;\/i&gt;/);
});

test('the Remediation table renders through remedRow and counts the fleet-wide rows', () => {
  assert.match(SRC, /\$\('remed'\)\.innerHTML=rem\.map\(remedRow\)/, 'remedRow is lifted here; the table must be what calls it');
  assert.match(SRC, /x\.scope==='fleet-wide'\)\.length/);
});

test('the server still writes the tag the client reads, on every runtime source', () => {
  const tagged = new Set();
  for (const line of serverSource().split('\n')) {
    if (!/scope:\s*'fleet-wide'/.test(line)) continue;
    for (const m of line.matchAll(/source:\s*'([A-Z]+)'/g)) tagged.add(m[1]);
  }
  for (const s of ['DAST', 'TLS', 'BOLA', 'CSPM']) assert.ok(tagged.has(s), `${s} rows are no longer tagged scope:'fleet-wide' by the server`);
});
