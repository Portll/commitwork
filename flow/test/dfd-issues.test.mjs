// A scan's results as issues on the map (flow/dfd-adapter.mjs issuesFromRecords and severityOf;
// flow/dfd-cli.mjs rulesOf, issueFacts, --issues and --view map).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { validateDfd } from '../../lib/dfd.mjs';
import { issuesFromRecords, severityOf, applyVerdicts } from '../dfd-adapter.mjs';
import { CONTROL_AXES, DATA_CLASSES } from '../../lib/dfd.mjs';
import { rulesOf, issueFacts, parseArgs, main } from '../dfd-cli.mjs';

const MODEL = () => ({ v: 1, kind: 'dfd', groups: [{ id: 'lib', label: 'lib', boundary: 'system' }],
  nodes: [{ id: 'node:module:lib/a.mjs', kind: 'process', label: 'lib/a.mjs', group: 'lib' }, { id: 'code:shop:api/db.js', kind: 'process', label: 'api/db.js' }], flows: [],
  findings: [{ id: 'CQ-01', at: { node: 'node:module:lib/a.mjs' } }] });

test('severityOf bands a score as CVSS does, and no score is undetermined', () => {
  // arrange
  const scores = [9.8, 9, 8.9, 7, 6.9, 4, 3.9, 0, undefined, NaN];
  // act
  const got = scores.map(severityOf);
  // assert
  assert.deepEqual(got, ['critical', 'critical', 'high', 'high', 'medium', 'medium', 'low', 'low', 'undetermined', 'undetermined']);
});

test('issuesFromRecords places each result on its file\'s element, adds an element where there is none, and skips what names no file', () => {
  // arrange
  const records = [
    { repo: 'shop', rule: 'js/redos', file: 'lib/a.mjs', line: 53, securitySeverity: 7.5, cwe: 'CWE-1333', message: 'slow on many a', path: { trace: [{ file: 'lib/a.mjs', line: 50, expr: 'input' }, { file: null, line: 1 }, { file: 'lib/a.mjs', line: 53 }] } },
    { repo: 'shop', rule: 'js/sql-injection', file: 'api/db.js', path: { trace: 'none' } },
    { repo: 'shop', rule: 'js/bad-tag-filter', file: 'lib/new.mjs', line: 4, securitySeverity: 4.1 },
    { repo: 'shop', rule: 'js/x', file: 'other/z.mjs' },
    { repo: 'shop', rule: 'js/no-file' }, { repo: 'shop', file: 'lib/a.mjs' }, null,
  ];
  // act
  const got = issuesFromRecords(MODEL(), records);
  const empty = issuesFromRecords({ v: 1, kind: 'dfd', nodes: [{ id: 'a', kind: 'process', label: 'a' }], flows: [] }, undefined, { prefix: 'S' });
  // assert
  assert.deepEqual([got.placed, got.added, got.skipped], [4, 2, 3]);
  assert.deepEqual(got.model.findings.slice(1), [
    { id: 'CQ-02', at: { node: 'node:module:lib/a.mjs' }, title: 'js/redos at lib/a.mjs:53', severity: 'high', status: 'undetermined', cwe: 'CWE-1333', source: { tool: 'codeql', rule: 'js/redos', file: 'lib/a.mjs', line: 53, message: 'slow on many a', steps: [{ file: 'lib/a.mjs', line: 50, expr: 'input' }, { file: 'lib/a.mjs', line: 53 }] } },
    { id: 'CQ-03', at: { node: 'code:shop:api/db.js' }, title: 'js/sql-injection at api/db.js', severity: 'undetermined', status: 'undetermined', source: { tool: 'codeql', rule: 'js/sql-injection', file: 'api/db.js' } },
    { id: 'CQ-04', at: { node: 'node:module:lib/new.mjs' }, title: 'js/bad-tag-filter at lib/new.mjs:4', severity: 'medium', status: 'undetermined', source: { tool: 'codeql', rule: 'js/bad-tag-filter', file: 'lib/new.mjs', line: 4 } },
    { id: 'CQ-05', at: { node: 'node:module:other/z.mjs' }, title: 'js/x at other/z.mjs', severity: 'undetermined', status: 'undetermined', source: { tool: 'codeql', rule: 'js/x', file: 'other/z.mjs' } },
  ]);
  const added = got.model.nodes.slice(2);
  assert.deepEqual(added.map((n) => [n.id, n.group, n.kind, /scan result sits in it/.test(n.note)]), [['node:module:lib/new.mjs', 'lib', 'process', true], ['node:module:other/z.mjs', undefined, 'process', true]]);
  assert.equal(validateDfd(got.model).ok, true, JSON.stringify(validateDfd(got.model).errors));
  assert.deepEqual([empty.placed, empty.added, empty.skipped, empty.model.findings], [0, 0, 0, []]);
});

test('rulesOf reads the driver\'s rules and every extension\'s; issueFacts takes the line, the score and the first CWE', () => {
  // arrange
  const doc = { runs: [{ tool: { driver: { rules: [{ id: 'a', properties: { 'security-severity': '7.8', tags: ['security', 'external/cwe/cwe-078', 'external/cwe/cwe-088'] } }, { name: 'no id' }] },
    extensions: [{ rules: [{ id: 'b', properties: { 'security-severity': 'n/a', tags: 'not a list' } }] }, { rules: 'none' }, null] } }, { tool: {} }, null] };
  const at = (line) => ({ message: { text: line === 12 ? 'm'.repeat(700) : '' }, locations: [{ physicalLocation: { region: { startLine: line } } }] });
  // act
  const rules = rulesOf(doc);
  const got = [issueFacts({ ruleId: 'a', ...at(12) }, rules), issueFacts({ ruleId: 'b', ...at('x') }, rules), issueFacts({ ruleId: 'missing' }, rules), issueFacts(null, rules)];
  // assert
  assert.deepEqual([...rules.keys()], ['a', 'b']);
  assert.deepEqual(got, [{ line: 12, message: 'm'.repeat(600), securitySeverity: 7.8, cwe: 'CWE-78' }, {}, {}, {}]);
  assert.deepEqual([...rulesOf(null).keys(), ...rulesOf({ runs: 'x' }).keys()], []);
});

test('--issues needs --codeql, and --view map takes no --collapse', () => {
  // arrange
  const cases = [['--from', 'x.json', '--issues'], ['--from', 'x.json', '--view', 'map', '--collapse', 'g'], ['--from', 'x.json', '--view', 'map']];
  // act
  const got = cases.map((argv) => parseArgs(argv));
  // assert
  assert.match(got[0].error, /--issues places a scan's results, so it needs --codeql/);
  assert.match(got[1].error, /--view map opens and closes groups on the page, so it takes no --collapse/);
  assert.equal(got[2].error, undefined);
});

/** A git checkout of 200 modules in one directory, and a scan with two results: one in a module with a data flow, one in a module without. */
function checkout() {
  const dir = mkdtempSync(join(tmpdir(), 'flow-dfd-issues-'));
  mkdirSync(join(dir, 'lib'));
  for (let i = 0; i < 200; i++) writeFileSync(join(dir, `lib/m${i}.mjs`), `import { readFileSync } from 'node:fs';\nexport const v${i} = () => readFileSync('data/f${i}.json', 'utf8') + process.env.KEY_${i};\n`);
  writeFileSync(join(dir, 'lib/pure.mjs'), 'export const twice = (n) => n * 2;\n');
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  const result = (ruleId, uri, startLine) => ({ ruleId, message: { text: 'm' }, locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine } } }] });
  const sarif = { version: '2.1.0', runs: [{ tool: { driver: { name: 'CodeQL', rules: [{ id: 'js/redos', properties: { 'security-severity': '7.5', tags: ['external/cwe/cwe-1333'] } }, { id: 'js/odd' }] } },
    results: [result('js/redos', 'lib/m3.mjs', 2), result('js/odd', 'lib/pure.mjs', 1)] }] };
  const sarifPath = join(dir, 'scan.sarif');
  writeFileSync(sarifPath, JSON.stringify(sarif));
  return { dir, sarifPath };
}
const io = () => { const out = []; const err = []; return { out, err, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } }; };

test('dfd --issues --view map draws a repository far past --max, with the scan\'s results as issues', async () => {
  // arrange
  const { dir, sarifPath } = checkout();
  const page = join(dir, 'map.html');
  const doc = join(dir, 'model.json');
  const a = io(); const b = io(); const c = io();
  // act
  const mapped = await main(['--repo', dir, '--codeql', sarifPath, '--issues', '--view', 'map', '--fonts', 'none', '--out', page], a);
  const modelled = await main(['--repo', dir, '--codeql', sarifPath, '--issues', '--emit', 'model', '--out', doc], b);
  const classic = await main(['--repo', dir, '--codeql', sarifPath, '--issues', '--fonts', 'none', '--out', join(dir, 'classic.html')], c);
  // assert
  assert.equal(mapped, 0, a.err.join(''));
  assert.match(a.out.join(''), /map view: 203 code element\(s\), 201 folded, 2 issue\(s\), 4 box\(es\) drawn at first\); .*; 2 result\(s\) with no code flow drawn at their place, reach not traced/);
  assert.match(readFileSync(page, 'utf8'), /<title>data flows of [^<]* — map<\/title>/);
  assert.equal(modelled, 0, b.err.join(''));
  const model = JSON.parse(readFileSync(doc, 'utf8'));
  assert.deepEqual(model.findings, [
    { id: 'CQ-01', at: { node: 'node:module:lib/m3.mjs' }, title: 'js/redos at lib/m3.mjs:2', severity: 'high', status: 'undetermined', cwe: 'CWE-1333', source: { tool: 'codeql', rule: 'js/redos', file: 'lib/m3.mjs', line: 2, message: 'm' } },
    { id: 'CQ-02', at: { node: `code:${basename(dir)}:lib/pure.mjs` }, title: 'js/odd at lib/pure.mjs:1', severity: 'undetermined', status: 'undetermined', source: { tool: 'codeql', rule: 'js/odd', file: 'lib/pure.mjs', line: 1, message: 'm' } },
  ]);
  // the result in a module with no data flow is drawn at its place by the scan's own element
  assert.equal(model.nodes.find((n) => n.id === `code:${basename(dir)}:lib/pure.mjs`).group, `repo:${basename(dir)}`);
  assert.deepEqual(model.flows.filter((f) => f.evidence && f.evidence.method === 'pattern').map((f) => `${f.from} -> ${f.to}`), [
    `input:${basename(dir)}:untraced -> node:module:lib/m3.mjs`,
    `node:module:lib/m3.mjs -> sink:${basename(dir)}:regular expression engine (availability)`,
    `input:${basename(dir)}:untraced -> code:${basename(dir)}:lib/pure.mjs`,
    `code:${basename(dir)}:lib/pure.mjs -> sink:${basename(dir)}:unclassified sink`,
  ]);
  assert.ok(classic > 0);
  assert.match(c.err.join(''), /elements is more than --max 150/);
});

test('a verdict\'s controls and data class are kept on the issue when well formed; "hardened" is a dismissal that claims controls', () => {
  // arrange
  const model = { v: 1, kind: 'dfd', nodes: [{ id: 'p', kind: 'process', label: 'p' }], flows: [], findings: [{ id: 'A', at: { node: 'p' } }, { id: 'B', at: { node: 'p' } }, { id: 'C', at: { node: 'p' } }] };
  const verdicts = [
    { id: 'A', verdict: 'hardened', reason: 'two controls', dataClass: 'identifier', controls: [
      { axis: 'sink', what: 'escaped', where: 'a.mjs:3', test: 'a.test.mjs: escapes' }, { axis: 'source', what: 'allowlist', test: null }, { axis: 'luck', what: 'none' }, { axis: 'flow' }, null] },
    { id: 'B', verdict: 'fixed', dataClass: 'made up', controls: 'none' },
    { id: 'C', verdict: 'not-a-defect', reason: 'r', controls: [{ axis: 'nowhere', what: 'x' }] },
  ];
  // act
  const got = applyVerdicts(model, verdicts);
  const [a, b, c] = got.model.findings;
  // assert
  assert.deepEqual([got.applied, got.unmatched, got.ignored], [3, [], ['A: 3 control(s) not well formed', 'C: 1 control(s) not well formed']]);
  assert.deepEqual(a, { id: 'A', at: { node: 'p' }, status: 'dismissed', note: 'Hardened: two controls (a remediation verdict, not a rescan)', dataClass: 'identifier',
    controls: [{ axis: 'sink', what: 'escaped', where: 'a.mjs:3', test: 'a.test.mjs: escapes' }, { axis: 'source', what: 'allowlist' }] });
  assert.deepEqual([b.status, b.dataClass, b.controls, b.note], ['mitigated', undefined, undefined, 'Fixed. (a remediation verdict, not a rescan)']);
  assert.deepEqual([c.status, c.controls], ['dismissed', undefined]);
  assert.equal(validateDfd(got.model).ok, true, JSON.stringify(validateDfd(got.model).errors));
  assert.deepEqual([[...CONTROL_AXES], [...DATA_CLASSES]], [['source', 'flow', 'sink', 'transport', 'privilege', 'containment'], ['secret', 'identifier', 'public', 'untrusted-input', 'configuration']]);
});

test('verdicts carry their pull request onto the issue when the file declares it, and the model gains the list', () => {
  // arrange
  const model = { v: 1, kind: 'dfd', nodes: [{ id: 'p', kind: 'process', label: 'p' }], flows: [], prs: [{ id: '#1', title: 'kept' }],
    findings: [{ id: 'A', at: { node: 'p' } }, { id: 'B', at: { node: 'p' } }, { id: 'C', at: { node: 'p' } }] };
  const prs = [{ id: '#1', title: 'not this one' }, { id: '#2', title: 'second', state: 'draft', files: ['p.mjs'] }, { title: 'no id' }, null];
  const verdicts = [{ id: 'A', verdict: 'fixed', pr: '#2' }, { id: 'B', verdict: 'fixed', pr: '#404' }, { id: 'C', verdict: 'fixed', pr: 7 }];
  // act
  const got = applyVerdicts(model, verdicts, { prs });
  const plain = applyVerdicts({ ...model, prs: undefined }, [{ id: 'A', verdict: 'fixed' }]);
  // assert
  assert.deepEqual(got.model.prs, [{ id: '#1', title: 'kept' }, { id: '#2', title: 'second', state: 'draft', files: ['p.mjs'] }]);
  assert.deepEqual(got.model.findings.map((f) => f.pr), ['#2', undefined, undefined]);
  assert.deepEqual(got.ignored, ['B: names a pull request the file does not declare', 'C: names a pull request the file does not declare']);
  assert.equal(validateDfd(got.model).ok, true, JSON.stringify(validateDfd(got.model).errors));
  assert.equal('prs' in plain.model && plain.model.prs !== undefined, false);
});

test('a document is refused when an issue or a patch names a pull request it does not declare, or declares one twice', () => {
  // arrange
  const base = { v: 1, kind: 'dfd', nodes: [{ id: 'a', kind: 'process', label: 'a' }, { id: 'b', kind: 'process', label: 'b' }], flows: [{ from: 'a', to: 'b', mode: 'sync' }] };
  const bad = { ...base, prs: [{ id: '#1' }, { id: '#1' }], findings: [{ id: 'F', at: { node: 'a' }, pr: '#2' }], patches: [{ id: 'K', closes: [{ from: 'a', to: 'b' }], pr: '#3' }] };
  const good = { ...base, prs: [{ id: '#1', state: 'open', url: 'https://example.invalid/1', commits: ['abc'], files: ['a'] }], findings: [{ id: 'F', at: { node: 'a' }, pr: '#1' }], patches: [{ id: 'K', closes: [{ from: 'a', to: 'b' }], pr: '#1' }] };
  // act
  const errors = validateDfd(bad).errors;
  // assert
  assert.deepEqual(errors.filter((e) => /pull request|repeats/.test(e)), ['dfd: prs[1] repeats the id "#1"', 'dfd: findings[0] ("F") names the pull request "#2", which "prs" does not declare', 'dfd: patches[0] ("K") names the pull request "#3", which "prs" does not declare']);
  assert.equal(validateDfd(good).ok, true, JSON.stringify(validateDfd(good).errors));
});

