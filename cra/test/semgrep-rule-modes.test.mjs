// node --test cra/test/semgrep-rule-modes.test.mjs — which Semgrep rules trace (cra/semgrep-rule-modes.mjs,
// bin/semgrep-rule-modes.mjs). No test reaches the network: the registry is an injected fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseRuleModes, readRuleModes, readLocalModes, modeFor, mergeOutcomes, fetchRuleMode, tableText, sha256,
} from '../semgrep-rule-modes.mjs';
import { fetchModes, firedRules } from '../../bin/semgrep-rule-modes.mjs';

const NOW = '2026-11-18T00:00:00.000Z';

// The registry's shape, as semgrep.dev/c/r/<id> served it on 2026-11-18: list items at column 0.
const REGISTRY_TAINT = `rules:
- id: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
  message: Detected string concatenation with a non-literal variable in a util.format
    / console.log function.
  metadata:
    mode: search
    cwe:
    - 'CWE-134: Use of Externally-Controlled Format String'
  languages:
  - javascript
  severity: INFO
  mode: taint
  pattern-sources:
  - patterns:
    - pattern-inside: function $F(...) {...}
`;
const REGISTRY_SEARCH = `rules:
- id: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
  patterns:
  - pattern-not: urllib.$W("...")
  - pattern-either:
    - pattern: urllib.urlopen(...)
  message: Detected a dynamic value being used with urllib.
  severity: WARNING
`;

test('a rule\'s mode is its own top-level key; a nested `mode:` and a folded message are not read', () => {
  // arrange: commitwork's local shape, list items at column 2, three rules in one file
  const local = [
    'rules:',
    '  - id: cw-a',
    '    mode: taint',
    '    message: >-',
    '      mode: search is prose here',
    '  - id: "cw-b"',
    '    patterns:',
    '      - pattern: eval(...)',
    '  - id: cw-c',
    '    taint:',
    '      sources: []',
    '',
  ].join('\r\n');
  // act
  const got = [parseRuleModes(REGISTRY_TAINT), parseRuleModes(REGISTRY_SEARCH), parseRuleModes(local), parseRuleModes('')];
  // assert
  assert.deepEqual(got[0], [{ id: 'javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring', mode: 'taint' }]);
  assert.deepEqual(got[1], [{ id: 'python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected', mode: 'search' }]);
  assert.deepEqual(got[2], [{ id: 'cw-a', mode: 'taint' }, { id: 'cw-b', mode: 'search' }, { id: 'cw-c', mode: 'taint' }]);
  assert.deepEqual(got[3], []);
});

test('the table reads absent, unparseable, invalid or ok — only ENOENT is absent', () => {
  // arrange
  const T = mkdtempSync(join(tmpdir(), 'srm-'));
  try {
    writeFileSync(join(T, 'bad.json'), '{nope');
    writeFileSync(join(T, 'other.json'), JSON.stringify({ v: 1, rules: {} }));
    writeFileSync(join(T, 'ok.json'), tableText(mergeOutcomes(null, [], NOW, 'https://r/')));
    // act
    const states = ['missing.json', 'bad.json', 'other.json', 'ok.json'].map((n) => readRuleModes(join(T, n)).state);
    const dir = readRuleModes(T).state;
    // assert
    assert.deepEqual(states, ['absent', 'unparseable', 'invalid', 'ok']);
    assert.equal(dir, 'unreadable', 'a directory where the table should be is not an absent table');
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('modeFor names where a mode came from, matches a local rule by its last segment, and never guesses', () => {
  // arrange
  const table = mergeOutcomes(null, [
    ['reg.taint', { ok: true, mode: 'taint', sha256: 'a' }],
    ['reg.gone', { ok: false, reason: 'HTTP 404' }],
  ], NOW, 'https://r/');
  const local = { rules: new Map([['cw-req-to-shell', { mode: 'taint', file: 'x.yaml' }]]), errors: [] };
  // act
  const got = ['reg.taint', 'manifests.semgrep-taint.cw-req-to-shell', 'reg.gone', 'reg.never'].map((id) => modeFor(id, { table, local }));
  // assert
  assert.deepEqual(got, [
    { mode: 'taint', source: 'registry' },
    { mode: 'taint', source: 'local' },
    { mode: null, source: 'unresolved', why: 'HTTP 404' },
    { mode: null, source: 'unrecorded' },
  ]);
});

test('commitwork\'s own rules are read from the checkout', () => {
  // act
  const { rules, errors } = readLocalModes();
  // assert
  assert.deepEqual(errors, []);
  assert.equal(rules.get('cw-env-to-shell')?.mode, 'taint');
  assert.equal(rules.get('cw-compose-docker-socket-mount')?.mode, 'search');
});

test('a failed refetch keeps the mode already read, records only what never resolved, and is byte-stable', () => {
  // arrange
  const first = mergeOutcomes(null, [['b', { ok: true, mode: 'search', sha256: 's' }], ['a', { ok: false, reason: 'HTTP 500' }]], NOW, 'https://r/');
  // act
  const second = mergeOutcomes(first, [['b', { ok: false, reason: 'fetch failed: ENOTFOUND' }]], '2026-11-19T00:00:00.000Z', 'https://r/');
  const third = mergeOutcomes(second, [['a', { ok: true, mode: 'taint', sha256: 't' }]], NOW, 'https://r/');
  // assert
  assert.deepEqual(second.rules.b, { mode: 'search', sha256: 's', fetchedAt: NOW });
  assert.deepEqual(Object.keys(second.unresolved), ['a']);
  assert.deepEqual(Object.keys(third.rules), ['a', 'b']);
  assert.deepEqual(third.unresolved, {});
  assert.equal(tableText(third), tableText(mergeOutcomes(second, [['a', { ok: true, mode: 'taint', sha256: 't' }]], NOW, 'https://r/')));
});

const fakeRegistry = (bodies) => async (url) => {
  const id = decodeURIComponent(url.split('/').pop());
  if (bodies[id] instanceof Error) throw bodies[id];
  if (!(id in bodies)) return { status: 404, text: async () => 'not found' };
  return { status: 200, text: async () => bodies[id] };
};

test('fetchRuleMode turns every failure into a reason, never a mode', async () => {
  // arrange
  const id = 'javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring';
  const f = fakeRegistry({
    [id]: REGISTRY_TAINT,
    wrong: REGISTRY_SEARCH,
    odd: 'rules:\n- id: odd\n  mode: sideways\n',
    down: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
  });
  // act
  const got = await Promise.all([id, 'missing', 'wrong', 'odd', 'down'].map((x) => fetchRuleMode(x, { base: 'https://r/', fetchImpl: f })));
  // assert
  assert.deepEqual([got[0].ok, got[0].mode, got[0].sha256], [true, 'taint', sha256(REGISTRY_TAINT)]);
  assert.deepEqual(got.slice(1).map((o) => [o.ok, o.reason]), [
    [false, 'HTTP 404'],
    [false, 'definition names python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected, not wrong'],
    [false, 'mode "sideways" is not one Semgrep defines'],
    [false, 'fetch failed: ECONNREFUSED'],
  ]);
});

function sweep() {
  const T = mkdtempSync(join(tmpdir(), 'srm-sweep-'));
  mkdirSync(join(T, 'sweep-x', 'repo-a'), { recursive: true });
  const res = (ruleId) => ({ ruleId, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' }, region: { startLine: 1 } } }] });
  writeFileSync(join(T, 'sweep-x', 'repo-a', 'semgrep.sarif'), JSON.stringify({ runs: [{ tool: { driver: { name: 'Semgrep OSS' } }, results: [res('r.taint'), res('r.taint'), res('r.search'), res('manifests.semgrep-taint.cw-req-to-shell')] }] }));
  writeFileSync(join(T, 'sweep-x', 'repo-a', 'codeql.sarif'), JSON.stringify({ runs: [{ results: [res('js/xss')] }] }));
  return T;
}

test('fetch reads the fired rules, fetches only registry rules not yet recorded, and a re-run changes nothing', async () => {
  // arrange
  const T = sweep();
  const tablePath = join(T, 'modes.json');
  const calls = [];
  const reg = fakeRegistry({ 'r.taint': 'rules:\n- id: r.taint\n  mode: taint\n', 'r.search': 'rules:\n- id: r.search\n  pattern: x\n' });
  const fetchImpl = async (u, o) => { calls.push(decodeURIComponent(u.split('/').pop())); return reg(u, o); };
  const quiet = () => {};
  try {
    // act
    const first = await fetchModes({ dirs: [T], tablePath, fetchImpl, base: 'https://r/', atIso: NOW, log: quiet });
    const bytes = readFileSync(tablePath, 'utf8');
    const second = await fetchModes({ dirs: [T], tablePath, fetchImpl, base: 'https://r/', atIso: '2026-12-01T00:00:00.000Z', log: quiet });
    // assert
    assert.equal(first, 0);
    assert.deepEqual(calls, ['r.search', 'r.taint'], 'the local rule is read from the checkout, never fetched; codeql.sarif is not read');
    assert.deepEqual(Object.fromEntries(Object.entries(JSON.parse(bytes).rules).map(([k, v]) => [k, v.mode])), { 'r.search': 'search', 'r.taint': 'taint' });
    assert.equal(second, 0);
    assert.equal(calls.length, 2, 'a recorded rule is not fetched again without --refresh');
    assert.equal(readFileSync(tablePath, 'utf8'), bytes);
    assert.deepEqual([...firedRules([T]).counts.entries()], [['r.taint', 2], ['r.search', 1], ['manifests.semgrep-taint.cw-req-to-shell', 1]]);
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('an unresolved rule exits 1 and is recorded; a table that cannot be used exits 2 and is left as it was', async () => {
  // arrange
  const T = sweep();
  const tablePath = join(T, 'modes.json');
  const quiet = () => {};
  const reg = fakeRegistry({ 'r.taint': 'rules:\n- id: r.taint\n  mode: taint\n' });
  try {
    // act
    const partial = await fetchModes({ dirs: [T], tablePath, fetchImpl: reg, base: 'https://r/', atIso: NOW, log: quiet });
    const recorded = JSON.parse(readFileSync(tablePath, 'utf8'));
    writeFileSync(tablePath, '{corrupt');
    const refused = await fetchModes({ dirs: [T], tablePath, fetchImpl: reg, base: 'https://r/', atIso: NOW, log: quiet });
    const empty = await fetchModes({ dirs: [join(T, 'nothing-here')], tablePath: join(T, 'm2.json'), fetchImpl: reg, base: 'https://r/', atIso: NOW, log: quiet });
    // assert
    assert.equal(partial, 1);
    assert.deepEqual(recorded.unresolved, { 'r.search': { reason: 'HTTP 404', at: NOW } });
    assert.equal(recorded.rules['r.taint'].mode, 'taint');
    assert.equal(refused, 2);
    assert.equal(readFileSync(tablePath, 'utf8'), '{corrupt');
    assert.equal(empty, 1, 'no Semgrep artifact found is nothing measured, not a clean pass');
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('the committed table validates against its schema, which rejects drift', async () => {
  // arrange
  const { validateAgainstSchema } = await import('../../lib/json-schema.mjs');
  const schemaPath = new URL('../../schema/semgrep-rule-modes.schema.json', import.meta.url);
  const table = JSON.parse(readFileSync(new URL('../../monitor/semgrep-rule-modes.json', import.meta.url), 'utf8'));
  const path = schemaPath.pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const bad = structuredClone(table);
  bad.rules[Object.keys(bad.rules)[0]].mode = 'pattern';
  // act
  const got = [validateAgainstSchema(table, { path }).errors, validateAgainstSchema(bad, { path }).errors.length > 0];
  // assert
  assert.deepEqual(got[0], []);
  assert.equal(got[1], true, 'a mode Semgrep does not define is rejected');
});
