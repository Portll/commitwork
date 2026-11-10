// Security hazard findings and suppressed findings for one file's text (bin/node-hazards.mjs scanFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanFile } from '../node-hazards.mjs';

const TLS_ID = 'node/tls-verification-disabled';
const TLS_MSG = 'NODE_TLS_REJECT_UNAUTHORIZED is set to 0, disabling TLS certificate verification process-wide';
const CORS_ID = 'node/cors-wildcard-with-credentials';
const CORS_MSG = "CORS allows any origin WITH credentials \u2014 any site can make authenticated requests on the user's behalf";
const EJS_MSG = 'EJS emits an unescaped variable with <%- ... %> \u2014 use <%= ... %> unless the value is trusted HTML';
const TLS_LINE = "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';";

test('reports the TLS env var assignment on its one-based line number', () => {
  const r = scanFile('a.js', 'const a = 1;\n' + TLS_LINE + '\n', '.js');
  assert.deepEqual([...r], [
    { ruleId: TLS_ID, level: 'error', line: 2, message: TLS_MSG, path: 'a.js' },
  ]);
  assert.deepEqual(r.suppressed, []);
});

test('moves a finding to suppressed when a comment line above carries the line marker', () => {
  const r = scanFile('a.js', '// cw-hazards-ignore: test\n' + TLS_LINE + '\n', '.js');
  assert.deepEqual([...r], []);
  assert.deepEqual(r.suppressed, [
    {
      ruleId: TLS_ID, level: 'error', line: 2, message: TLS_MSG, path: 'a.js',
      suppression: { marker: 'cw-hazards-ignore', justification: 'test', ownLine: false },
    },
  ]);
});

test('suppresses a finding with a marker on its own line and keeps the justification', () => {
  const r = scanFile('a.js', TLS_LINE + ' // nosemgrep - legacy proxy\n', '.js');
  assert.deepEqual([...r], []);
  assert.deepEqual(r.suppressed, [
    {
      ruleId: TLS_ID, level: 'error', line: 1, message: TLS_MSG, path: 'a.js',
      suppression: { marker: 'nosemgrep', justification: 'legacy proxy', ownLine: true },
    },
  ]);
});

test('suppresses every finding when the file marker appears in the head', () => {
  const text = '// cw-hazards-ignore-file: vendored fixture\nconst a = 1;\n' + TLS_LINE + '\n';
  const r = scanFile('a.js', text, '.js');
  assert.deepEqual([...r], []);
  assert.deepEqual(r.suppressed, [
    {
      ruleId: TLS_ID, level: 'error', line: 3, message: TLS_MSG, path: 'a.js',
      suppression: { marker: 'cw-hazards-ignore-file', justification: 'vendored fixture', ownLine: false },
    },
  ]);
});

test('applies no rule to an extension outside every rule filter', () => {
  const r = scanFile('notes.txt', 'const a = 1;\n' + TLS_LINE + '\n', '.txt');
  assert.deepEqual([...r], []);
  assert.deepEqual(r.suppressed, []);
});

test('reports a template rule only for its own extension', () => {
  const r = scanFile('view.ejs', '<%- user %>\n', '.ejs');
  assert.deepEqual([...r], [
    { ruleId: 'template/ejs-unescaped', level: 'warning', line: 1, message: EJS_MSG, path: 'view.ejs' },
  ]);
  assert.deepEqual(r.suppressed, []);
  const js = scanFile('view.js', '<%- user %>\n', '.js');
  assert.deepEqual([...js], []);
  assert.deepEqual(js.suppressed, []);
});

test('reports the CORS pair on the line holding the wildcard origin', () => {
  const text = "const a = 1;\nconst h = {\n  origin: '*',\n  credentials: true,\n};\n";
  const r = scanFile('a.js', text, '.js');
  assert.deepEqual([...r], [
    { ruleId: CORS_ID, level: 'error', line: 3, message: CORS_MSG, path: 'a.js' },
  ]);
  assert.deepEqual(r.suppressed, []);
});

test('skips the CORS pair when only the wildcard origin is present', () => {
  const r = scanFile('a.js', "const h = { origin: '*' };\n", '.js');
  assert.deepEqual([...r], []);
  assert.deepEqual(r.suppressed, []);
});

test('skips the CORS pair when the wildcard origin only appears in a comment', () => {
  const r = scanFile('a.js', "// origin: '*'\nconst c = { credentials: true };\n", '.js');
  assert.deepEqual([...r], []);
  assert.deepEqual(r.suppressed, []);
});

test('ignores a hazard written inside a comment line', () => {
  const r = scanFile('a.js', '// ' + TLS_LINE + '\n', '.js');
  assert.deepEqual([...r], []);
  assert.deepEqual(r.suppressed, []);
});
