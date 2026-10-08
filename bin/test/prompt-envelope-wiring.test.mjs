// Source-level: repo-originating text reaches a prompt only through the envelope's data block, on
// both paths. A second witness beside lib/test/prompt-envelope.test.mjs's shape check — this one
// locates every use of the raw fields and shows a negative control it would catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// The body of `function <name>(` up to its closing brace at column 0.
function fnBody(s, name) {
  const at = s.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} not found`);
  const end = s.indexOf('\n}\n', at);
  return s.slice(at, end + 2);
}

// Raw-field uses in a findingBlock body that sit outside the `const data = [ ... ].join(` literal
// handed to envelope(). Returns the offending tokens; [] means every use is inside the data block.
function rawUsesOutsideData(body) {
  const dataStart = body.indexOf('const data = [');
  const dataEnd = dataStart >= 0 ? body.indexOf('].join(', dataStart) : -1;
  const out = [];
  for (const m of body.matchAll(/\$\{(finding\.message|ctx\.text)\}/g)) {
    if (!(dataStart >= 0 && m.index > dataStart && m.index < dataEnd)) out.push(`${m[0]} @${m.index}`);
  }
  if (!(dataEnd >= 0 && /envelope\(data,/.test(body.slice(dataEnd)))) out.push('data is not passed to envelope()');
  return out;
}

test('rawUsesOutsideData: a negative control is caught, the enveloped shape passes', () => {
  const bad = 'function findingBlock(finding, ctx) {\n  const data = [`m: ${finding.message}`].join(\'\\n\');\n  return [`- message: ${finding.message}`, envelope(data, {})].join(\'\\n\');\n}\n';
  const hits = rawUsesOutsideData(bad);
  assert.equal(hits.length, 1, JSON.stringify(hits));
  assert.match(hits[0], /^\$\{finding\.message\} @\d+$/);
  const good = 'function findingBlock(finding, ctx) {\n  const data = [`m: ${finding.message}`, `${ctx.text}`].join(\'\\n\');\n  return [envelope(data, {})].join(\'\\n\');\n}\n';
  assert.deepEqual(rawUsesOutsideData(good), []);
  assert.deepEqual(rawUsesOutsideData('function findingBlock() {\n  return `${finding.message}`;\n}\n'), ['${finding.message} @36', 'data is not passed to envelope()']);
});

test('machine path: message and source text live only in the data block, the path is stripped, the spawn is private', () => {
  const s = src('admin/routes/codeql-remediation.mjs');
  assert.match(s, /import \{ envelope, stripHidden \} from '\.\.\/\.\.\/lib\/prompt-envelope\.mjs'/);
  const body = fnBody(s, 'findingBlock');
  assert.deepEqual(rawUsesOutsideData(body), []);
  for (const m of body.matchAll(/finding\.file\b/g)) {
    assert.equal(body.slice(m.index - 12, m.index), 'stripHidden(', `finding.file at ${m.index} is not passed through stripHidden()`);
  }
  assert.doesNotMatch(s, /```\\n\$\{ctx\.text\}/, 'the old markdown fence around raw source is gone');
  assert.match(s, /export function reviewFinding\(/);
  assert.doesNotMatch(s, /export function runClaude\b/, 'the spawn is not exported — only prompts this module built reach it');
  assert.match(s, /stage\('opus', OPUS_LANE, \(\) => reviewFinding\(job\.finding, ctx/, 'the pipeline uses the same exported run path the corpus test drives');
});

test('human path: the scanner artifact handed to a local model is enveloped, never interpolated raw', () => {
  const s = src('admin/routes/remediation.mjs');
  assert.match(s, /import \{ envelope \} from '\.\.\/\.\.\/lib\/prompt-envelope\.mjs'/);
  const body = fnBody(s, 'runLocalModel');
  assert.match(body, /\$\{artifactText \? envelope\(artifactText, \{/);
  assert.doesNotMatch(body, /\$\{artifactText\s*\}|\$\{artifactText \|\||\+\s*artifactText\s*[+;)]|artifactText\s*\+/, 'artifactText is never concatenated raw');
});
