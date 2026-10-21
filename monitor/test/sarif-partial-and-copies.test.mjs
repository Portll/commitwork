// The shared SARIF reader, on three things a published count must not hide: a file the tool read
// only in part, a rule the engine could not evaluate, and a finding that describes a worktree copy
// of the repository. Each notification below is shaped on one seen in stored Semgrep SARIF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { partialAnalysis, ruleFailures, ruleTitle } from '../sarif-read.mjs';
import { _sarifCounts, _sarifDetail } from '../extractors/sarif.mjs';

const note = (id, text) => ({ descriptor: { id }, level: 'warning', message: { text } });
const NOTES = [
  note('Timeout', 'Timeout when running rust.lang.security.x on crates/rt/src/sql/run.rs:\n '),
  note('Timeout', 'Timeout when running rust.lang.security.y on crates/rt/src/sql/run.rs:\n '),
  note('Syntax error', 'Syntax error at line tools/bench.sh:19:\n `/ 2` was unexpected'),
  note('Syntax error', "Syntax error at line .github/workflows/ci.yml:65:\n When parsing a snippet as Bash for metavariable-pattern in rule 'yaml.github-actions.security.run-shell-injection.run-shell-injection', `x` was unexpected"),
  note('Internal matching error', 'Internal matching error when running javascript.crypto-js.cryptojs-weak-algorithm.cryptojs-weak-algorithm on src/a.ts:\n An error occurred while invoking the Semgrep engine.\n\nmetavariable-name:module(s) operator is only supported in the Pro engine'),
  note('Internal matching error', 'Internal matching error when running javascript.crypto-js.cryptojs-weak-algorithm.cryptojs-weak-algorithm on src/b.ts:\n An error occurred while invoking the Semgrep engine.\n\nmetavariable-name:module(s) operator is only supported in the Pro engine'),
  note('Timeout', 'Timeout when running r on .claude/worktrees/agent-x/src/big.rs:\n '),
];

test('partialAnalysis keeps file reading failures and leaves rule-internal snippet parses out', () => {
  const rows = partialAnalysis([{ toolExecutionNotifications: NOTES }]);
  assert.deepEqual(rows.map((r) => [r.uri, r.reasons.join(','), r.notices]), [
    ['.claude/worktrees/agent-x/src/big.rs', 'timeout', 1],
    ['crates/rt/src/sql/run.rs', 'timeout', 2],
    ['tools/bench.sh', 'syntax-error', 1],
  ]);
});

test('ruleFailures names each rule the engine could not evaluate, with the reason it gave', () => {
  const rows = ruleFailures([{ toolExecutionNotifications: NOTES }]);
  assert.deepEqual(rows.map((r) => [r.rule, r.notices]), [
    ['javascript.crypto-js.cryptojs-weak-algorithm.cryptojs-weak-algorithm', 2],
    ['yaml.github-actions.security.run-shell-injection.run-shell-injection', 1],
  ]);
  assert.match(rows[0].reason, /only supported in the Pro engine/);
});

test('ruleTitle takes a rule-level description and refuses one that only restates the id or names a class', () => {
  assert.equal(ruleTitle({ id: 'DS-0002', name: 'Misconfiguration', shortDescription: { text: "Image user should not be 'root'" } }), "Image user should not be 'root'");
  assert.equal(ruleTitle({ id: 'rust/cleartext-logging', name: 'rust/cleartext-logging', shortDescription: { text: 'Cleartext logging of sensitive information' } }), 'Cleartext logging of sensitive information');
  assert.equal(ruleTitle({ id: 'a.b.c', name: 'a.b.c', shortDescription: { text: 'Semgrep Finding: a.b.c' } }), null);
  assert.equal(ruleTitle({ id: 'X', name: 'Misconfiguration' }), null);
  assert.equal(ruleTitle({ id: 'X', shortDescription: { text: 'line one\nline\ttwo' } }), 'line one line two');
  assert.ok(ruleTitle({ id: 'X', shortDescription: { text: 'w '.repeat(200) } }).length <= 100);
  assert.equal(ruleTitle(null), null);
});

function sarifDir(results, notifications = []) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-sarif-'));
  const doc = {
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'Trivy', rules: [{ id: 'DS-0002', name: 'Misconfiguration', shortDescription: { text: "Image user should not be 'root'" }, defaultConfiguration: { level: 'error' } }] } },
      invocations: [{ executionSuccessful: true, toolExecutionNotifications: notifications }],
      results,
    }],
  };
  writeFileSync(join(dir, 'trivy-config.sarif'), JSON.stringify(doc));
  return dir;
}
const hit = (uri) => ({ ruleId: 'DS-0002', level: 'error', message: { text: 'Specify at least 1 USER command' }, locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: 1 } } }] });

test('a finding under a worktree copy leaves the counts, stays enumerable, and names the file it stands for', () => {
  const dir = sarifDir([hit('tools/gcobol/Dockerfile'), hit('.claude/worktrees/agent-a/tools/gcobol/Dockerfile'), hit('.git/gate-head-9/tools/gcobol/Dockerfile')]);
  const c = _sarifCounts(dir, 'trivy-config.sarif');
  assert.equal(c.total, 1, 'one Dockerfile is one finding');
  assert.equal(c.worktrees.total, 2);
  assert.deepEqual(c.worktrees.rows.map((r) => r.canonical), ['tools/gcobol/Dockerfile', 'tools/gcobol/Dockerfile']);
  assert.equal(c.worktrees.high, 2, 'a set-aside row keeps its severity');
  assert.match(c.worktrees.note, /2 of 3/);
});

test('CW_WORKTREE_PATHS=off counts the copies again, read at call time', () => {
  const dir = sarifDir([hit('a/Dockerfile'), hit('.claude/worktrees/w/a/Dockerfile')]);
  const prev = process.env.CW_WORKTREE_PATHS;
  process.env.CW_WORKTREE_PATHS = 'off';
  try { assert.equal(_sarifCounts(dir, 'trivy-config.sarif').total, 2); }
  finally { if (prev === undefined) delete process.env.CW_WORKTREE_PATHS; else process.env.CW_WORKTREE_PATHS = prev; }
});

test('rule titles ride beside the rows as one map, never as a row field', () => {
  const d = _sarifDetail(sarifDir([hit('tools/gcobol/Dockerfile'), hit('x/Dockerfile')]), 'trivy-config.sarif', 'iac');
  assert.equal(d.findings.length, 2);
  assert.deepEqual(d.ruleTitles, { 'DS-0002': "Image user should not be 'root'" });
  assert.equal(d.findings[0].title, undefined, 'a row field would add a column to every SARIF table');
});

test('a partly read file makes coverage partial and names it; a rule failure is stated without touching coverage', () => {
  const c = _sarifCounts(sarifDir([], NOTES), 'trivy-config.sarif');
  assert.equal(c.total, 0);
  assert.equal(c.coverageIncomplete, true, 'a zero over a partly read file is not clean');
  assert.equal(c.coverage.state, 'partial');
  assert.equal(c.partialAnalysis.files, 2, 'the worktree copy is not counted as this repository\'s file');
  assert.deepEqual(c.partialAnalysis.byReason, { timeout: 1, 'syntax-error': 1 });
  assert.match(c.coverage.reason, /2 file\(s\) were read only in part/);
  assert.equal(c.rulesNotEvaluated.rules, 2);

  const onlyRules = _sarifCounts(sarifDir([], NOTES.filter((n) => n.descriptor.id === 'Internal matching error')), 'trivy-config.sarif');
  assert.equal(onlyRules.coverage, undefined, 'a ruleset problem is not a coverage reduction for these files');
  assert.equal(onlyRules.coverageIncomplete, undefined);
  assert.equal(onlyRules.rulesNotEvaluated.rules, 1);
});

test('a clean run carries none of the three fields', () => {
  const c = _sarifCounts(sarifDir([hit('a/Dockerfile')]), 'trivy-config.sarif');
  assert.equal(c.partialAnalysis, undefined);
  assert.equal(c.rulesNotEvaluated, undefined);
  assert.equal(c.worktrees, undefined);
});
