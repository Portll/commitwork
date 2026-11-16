// A scan result of a rule that traces no value is drawn at its place, and a remediation verdict is
// laid over an issue with its reason (flow/dfd-adapter.mjs fromCodeFlows, sinkKindOf, applyVerdicts;
// lib/dfd.mjs scannerOnly; lib/dfd-paths-core.mjs chipState; flow/dfd-cli.mjs --scanner-only,
// --verdicts). Before this, a result without a code flow was counted and left out, so a diagram
// drawn from a scan showed the taint queries' results and none of the pattern queries'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDfd, subgraph, taintOnly, scannerOnly } from '../../lib/dfd.mjs';
import { createCore } from '../../lib/dfd-paths-core.mjs';
import { fromCodeFlows, sinkKindOf, applyVerdicts } from '../dfd-adapter.mjs';
import { parseArgs, prepare, main } from '../dfd-cli.mjs';

const pattern = (rule, file, line) => ({ repo: 'shop', rule, file, reachability: 'reachability_unknown', path: null, ...(line === undefined ? {} : { line }) });
const end = (file, line, expr) => ({ file, line, expr });
const traced = (rule, from, to) => ({ repo: 'shop', rule, file: to.file, reachability: 'reachable', path: { steps: 2, flows: 1, source: from, sink: to, trace: [from, to] } });
const FUNCTIONS = { 'lib/judge.js': [[10, 20, 'judge']], 'api/db.js': [[1, 9, 'run']] };
const functionOf = (file, line) => {
  if (!FUNCTIONS[file]) return undefined;
  const hit = FUNCTIONS[file].find(([a, b]) => line >= a && line <= b);
  return hit ? { name: hit[2], kind: 'function' } : null;
};
const arrows = (m) => m.flows.map((f) => `${f.from} -> ${f.to} [${f.evidence.method}]`);
const io = () => { const out = []; const err = []; return { out, err, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } }; };

test('a result with no code flow is drawn from an unknown origin, through its file, to the sink its rule names', () => {
  // arrange
  const records = [pattern('js/redos', 'lib/judge.js', 12)];
  // act
  const m = fromCodeFlows(records);
  // assert
  assert.deepEqual(arrows(m), [
    'input:shop:untraced -> code:shop:lib/judge.js [pattern]',
    'code:shop:lib/judge.js -> sink:shop:regular expression engine (availability) [pattern]',
  ]);
  assert.deepEqual(m.flows.map((f) => [f.label, f.existence, f.evidence.refs]), [['not traced', 'unknown', ['js/redos lib/judge.js:12']], ['js/redos', 'unknown', ['js/redos lib/judge.js:12']]]);
  const origin = m.nodes.find((n) => n.id === 'input:shop:untraced');
  assert.equal(origin.unknown, true);
  assert.equal(origin.group, 'untraced');
  assert.match(origin.note, /unknown, not absent/);
  assert.deepEqual(m.source.omitted, { noPath: 0, unreadable: 0 });
  assert.deepEqual(validateDfd(m).errors, []);
});

test('with functions placed, a result with no code flow sits in the function its line is in', () => {
  // arrange
  const records = [pattern('js/redos', 'lib/judge.js', 12), pattern('js/redos', 'lib/judge.js', 30), pattern('js/redos', 'lib/gone.js', 3), pattern('js/redos', 'lib/judge.js')];
  // act
  const m = fromCodeFlows(records, { functionOf });
  // assert
  assert.deepEqual([...new Set(m.flows.filter((f) => f.label === 'not traced').map((f) => f.to))], [
    'fn:shop:lib/judge.js#judge', 'fn:shop:lib/judge.js#', 'code:shop:lib/gone.js', 'code:shop:lib/judge.js',
  ]);
  assert.equal(m.source.omitted.noFunction, 1);
  assert.deepEqual(validateDfd(m).errors, []);
});

test('results that share a place and a rule are one pair of flows carrying every reference', () => {
  // arrange
  const records = [pattern('js/redos', 'lib/judge.js', 53), pattern('js/redos', 'lib/judge.js', 54)];
  // act
  const m = fromCodeFlows(records);
  // assert
  assert.equal(m.flows.length, 2);
  assert.deepEqual(m.flows[1].evidence.refs, ['js/redos lib/judge.js:53', 'js/redos lib/judge.js:54']);
});

test('a traced result and an untraced one in the same file share its element, each with its own kind of evidence', () => {
  // arrange
  const records = [traced('js/sql-injection', end('api/routes.js', 4, 'req.query'), end('api/db.js', 5, 'sql')), pattern('js/disabling-certificate-validation', 'api/db.js', 7)];
  // act
  const m = fromCodeFlows(records);
  // assert
  assert.deepEqual(arrows(m), [
    'input:shop:api/routes.js:4 -> code:shop:api/routes.js [taint]',
    'code:shop:api/routes.js -> code:shop:api/db.js [taint]',
    'code:shop:api/db.js -> sink:shop:database query [taint]',
    'input:shop:untraced -> code:shop:api/db.js [pattern]',
    'code:shop:api/db.js -> sink:shop:peer whose identity is not checked [pattern]',
  ]);
  assert.deepEqual(m.groups.map((g) => g.id), ['repo:shop', 'untrusted', 'untraced']);
});

test('only a result with neither a code flow nor a file draws nothing, and it is counted', () => {
  // arrange
  const records = [{ repo: 'shop', rule: 'js/redos', reachability: 'reachability_unknown', path: null }];
  // act
  const m = fromCodeFlows(records);
  // assert
  assert.deepEqual(m.nodes, []);
  assert.deepEqual(m.source.omitted, { noPath: 1, unreadable: 0 });
});

test('sinkKindOf names what is at risk for the rules that trace no value', () => {
  // arrange
  const rules = ['js/redos', 'js/polynomial-redos', 'js/regex/missing-regexp-anchor', 'js/disabling-certificate-validation', 'js/insecure-transport', 'js/clear-text-logging', 'js/cleartext-storage',
    'js/insufficient-password-hash', 'js/insecure-randomness', 'js/incomplete-sanitization', 'js/bad-tag-filter', 'js/incomplete-multi-character-sanitization', 'js/double-escaping', 'js/bad-code-sanitization'];
  // act
  const got = rules.map((r) => { const s = sinkKindOf(r); return `${s.label}|${s.impact}${s.unknown ? '|unknown' : ''}`; });
  // assert
  assert.deepEqual(got, [
    'regular expression engine (availability)|medium', 'regular expression engine (availability)|medium', 'regular expression engine (availability)|medium',
    'peer whose identity is not checked|high', 'peer whose identity is not checked|high', 'log or store holding a secret|medium', 'log or store holding a secret|medium',
    'stored secret or credential|high', 'stored secret or credential|high', 'reader of text meant to be escaped|medium', 'reader of text meant to be escaped|medium',
    'reader of text meant to be escaped|medium', 'reader of text meant to be escaped|medium', 'interpreter|critical',
  ]);
});

test('sinkKindOf reads "dom" as the browser only where the rule id names it as a word', () => {
  // arrange
  const rules = ['js/xss-through-dom', 'js/dom-text-reinterpreted', 'js/random-thing', 'js/freedom'];
  // act
  const got = rules.map((r) => sinkKindOf(r).label);
  // assert
  assert.deepEqual(got, ['browser that renders the response', 'browser that renders the response', 'unclassified sink', 'unclassified sink']);
});

const MIXED = () => {
  const m = fromCodeFlows([traced('js/sql-injection', end('api/routes.js', 4, 'req.query'), end('api/db.js', 5, 'sql')), pattern('js/redos', 'lib/judge.js', 12)]);
  return { ...m, nodes: [...m.nodes, { id: 'cfg', kind: 'store', subtype: 'file', label: 'config.json' }],
    flows: [...m.flows, { from: 'code:shop:api/db.js', to: 'cfg', mode: 'sync', label: 'reads', existence: 'unknown', evidence: { witness: 'static', method: 'site', existence: 'unknown' } }] };
};

test('scannerOnly keeps traced and pattern flows and leaves out the static pass call sites', () => {
  // arrange
  const m = MIXED();
  // act
  const kept = subgraph(m, scannerOnly);
  const tracedOnly = subgraph(m, taintOnly);
  // assert
  assert.deepEqual(kept.flows.map((f) => f.evidence.method), ['taint', 'taint', 'taint', 'pattern', 'pattern']);
  assert.ok(!kept.nodes.some((n) => n.id === 'cfg'));
  assert.deepEqual(tracedOnly.flows.map((f) => f.evidence.method), ['taint', 'taint', 'taint']);
  assert.equal(scannerOnly({ from: 'a', to: 'b' }), false);
  assert.deepEqual(validateDfd(kept).errors, []);
});

test('dfd --scanner-only draws both kinds, says how many results have no code flow, and refuses a model with neither', () => {
  // arrange
  const dir = mkdtempSync(join(tmpdir(), 'flow-dfd-pattern-'));
  const doc = join(dir, 'm.dfd.json');
  const bare = join(dir, 'bare.dfd.json');
  const out = join(dir, 'out.json');
  writeFileSync(doc, JSON.stringify(MIXED()));
  writeFileSync(bare, JSON.stringify({ v: 1, kind: 'dfd', nodes: [{ id: 'a', kind: 'process', label: 'a' }, { id: 'b', kind: 'store', label: 'b' }], flows: [{ from: 'a', to: 'b', mode: 'sync', label: 'x' }] }));
  const a = io();
  // act
  const parsed = parseArgs(['--from', doc, '--scanner-only']);
  const code = main(['--from', doc, '--scanner-only', '--emit', 'model', '--out', out], a);
  const refused = prepare({ from: bare, 'scanner-only': true });
  const taintWins = prepare({ from: doc, 'taint-only': true, 'scanner-only': true });
  // assert
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.opts['scanner-only'], true);
  assert.equal(code, 0, a.err.join(''));
  assert.match(a.out.join(''), /; 1 result\(s\) with no code flow drawn at their place, reach not traced/);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).flows.length, 5);
  assert.match(refused.error, /--scanner-only: the model holds no flow a scanner reported/);
  assert.ok(refused.code > 0);
  assert.equal(taintWins.model.flows.length, 3);
});

// ── verdicts ────────────────────────────────────────────────────────────────────────────────────
const ISSUES = () => ({ v: 1, kind: 'dfd', nodes: [{ id: 'p', kind: 'process', label: 'p' }, { id: 's', kind: 'store', label: 's', impact: 'high' }], flows: [{ from: 'p', to: 's', mode: 'sync', label: 'x' }],
  findings: [
    { id: 'CQ-01', at: { node: 'p' }, severity: 'high', status: 'undetermined', source: { tool: 'codeql', rule: 'js/redos', file: 'a.js', line: 3 } },
    { id: 'CQ-02', at: { node: 'p' }, severity: 'high', status: 'undetermined', source: { tool: 'codeql', rule: 'js/redos', file: 'a.js', line: 9 } },
    { id: 'CQ-03', at: { node: 'p' }, severity: 'low', status: 'undetermined', source: { tool: 'codeql', rule: 'js/odd', file: 'b.js' } },
    { id: 'H-1', at: { node: 'p' }, severity: 'low', status: 'live' },
  ] });

test('applyVerdicts sets fixed and not-a-defect by id or by rule, file and line, and keeps the reason in the note', () => {
  // arrange
  const verdicts = [
    { id: 'CQ-01', verdict: 'fixed', reason: 'the pattern reads each word one way' },
    { rule: 'js/redos', file: 'a.js', line: 9, verdict: 'Not a defect' },
    { rule: 'js/odd', file: 'b.js', reason: 'a frozen constant' },
  ];
  // act
  const got = applyVerdicts(ISSUES(), verdicts);
  // assert
  assert.deepEqual(got.model.findings.map((f) => [f.id, f.status, f.note || null]), [
    ['CQ-01', 'mitigated', 'Fixed: the pattern reads each word one way (a remediation verdict, not a rescan)'],
    ['CQ-02', 'dismissed', 'Not a defect. (a remediation verdict, not a rescan)'],
    ['CQ-03', 'dismissed', 'Not a defect: a frozen constant (a remediation verdict, not a rescan)'],
    ['H-1', 'live', null],
  ]);
  assert.deepEqual([got.applied, got.unmatched, got.ignored], [3, [], []]);
  assert.deepEqual(validateDfd(got.model).errors, []);
});

test('applyVerdicts changes nothing for a verdict it cannot place or does not know, and names each', () => {
  // arrange
  const model = ISSUES();
  const verdicts = [{ id: 'CQ-99', verdict: 'fixed' }, { rule: 'js/none', file: 'z.js', verdict: 'dismissed' }, { id: 'CQ-01', verdict: 'not-resolved' }, { rule: 'js/redos', file: 'a.js', verdict: 'maybe' }, null, 'x', { verdict: 'fixed' }];
  // act
  const got = applyVerdicts(model, verdicts);
  const none = applyVerdicts({ ...model, findings: undefined }, undefined);
  // assert
  assert.deepEqual(got.model.findings, model.findings);
  assert.deepEqual(got.unmatched, ['CQ-99', 'js/none z.js', 'undefined undefined']);
  assert.deepEqual(got.ignored, ['CQ-01', 'js/redos a.js', null, 'x']);
  assert.equal(got.applied, 0);
  assert.deepEqual([none.model.findings, none.applied], [[], 0]);
});

test('a dismissed issue shows its judgement in the paths view and is not counted closed', () => {
  // arrange
  const { model } = applyVerdicts(ISSUES(), [{ id: 'CQ-01', verdict: 'fixed' }, { id: 'CQ-02', reason: 'no shell is used' }]);
  const core = createCore(model);
  // act
  const fixed = core.chipState('p', 'CQ-01', new Set());
  const dismissed = core.chipState('p', 'CQ-02', new Set());
  const open = core.chipState('p', 'CQ-03', new Set());
  // assert
  assert.deepEqual([fixed.g, dismissed.g, open.g], ['fixed', 'uneval', 'uneval']);
  assert.equal(core.chipWord(dismissed), 'judged not a defect (reason in its note), not closed');
  assert.equal(core.chipWord(open), 'not evaluated');
  assert.equal(core.gateCls(dismissed), 'grey');
});

test('dfd --verdicts lays a verdicts file or a dismissals file over the issues and reports the count', () => {
  // arrange
  const dir = mkdtempSync(join(tmpdir(), 'flow-dfd-verdicts-'));
  const doc = join(dir, 'm.dfd.json');
  const list = join(dir, 'verdicts.json');
  const wrapped = join(dir, 'wrapped.json');
  const broken = join(dir, 'broken.json');
  const out = join(dir, 'out.json');
  writeFileSync(doc, JSON.stringify(ISSUES()));
  writeFileSync(list, JSON.stringify([{ id: 'CQ-01', verdict: 'fixed' }, { id: 'CQ-77', verdict: 'fixed' }, { id: 'CQ-02', verdict: 'not-resolved' }]));
  writeFileSync(wrapped, JSON.stringify({ verdicts: [{ id: 'CQ-03', reason: 'a frozen constant' }] }));
  writeFileSync(broken, '{');
  const a = io();
  // act
  const code = main(['--from', doc, '--verdicts', list, '--emit', 'model', '--out', out], a);
  const fromObject = prepare({ from: doc, verdicts: wrapped });
  const unreadable = prepare({ from: doc, verdicts: join(dir, 'absent.json') });
  const notJson = prepare({ from: doc, verdicts: broken });
  // assert
  assert.equal(code, 0, a.err.join(''));
  assert.match(a.out.join(''), /; verdicts: 1 applied, 1 naming no issue, 1 ignored/);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).findings[0].status, 'mitigated');
  assert.equal(fromObject.model.findings[2].status, 'dismissed');
  assert.deepEqual(fromObject.verdicts, { applied: 1, unmatched: 0, ignored: 0 });
  assert.match(unreadable.error, /--verdicts .*absent\.json: ENOENT/);
  assert.match(notJson.error, /--verdicts .*broken\.json: not JSON/);
});
