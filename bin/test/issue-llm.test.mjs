// The reply parser, table-driven over shapes MEASURED from real local models. The contract is
// not "find the verdict" — it is "report honestly when there isn't one".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { splitThinking, parseVerdict } from '../../lib/llm-reply.mjs';
import {
  baseChainCount, chainsFor, fuseChains, findingKeyFor,
  buildAdjudicationRecord,
} from '../issue-llm.mjs';
import { composeIssuePrompt, CONTEXT_LINES } from '../../monitor/issue-prompt.mjs';

// a throwaway tree holding src/a.js, so the composition reads a real file rather than a mock
const mkTree = (body = 'one\ntwo\nthree\n') => {
  const root = mkdtempSync(join(tmpdir(), 'cw-prompt-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.js'), body);
  return root;
};

test('fenced <think> is split from the answer', () => {
  const r = splitThinking('<think>weighing it up</think>\nVERDICT: false-positive');
  assert.equal(r.thinking, 'weighing it up');
  assert.match(r.answer, /^VERDICT:/);
});

test('<thinking> long form is also recognised', () => {
  assert.equal(splitThinking('<thinking>x</thinking>ok').thinking, 'x');
});

test('no fence leaves the text whole and thinking null', () => {
  const r = splitThinking('VERDICT: real-vulnerability');
  assert.equal(r.thinking, null);
  assert.equal(r.answer, 'VERDICT: real-vulnerability');
});

test('a verdict on the first line parses, with confidence', () => {
  const r = parseVerdict('VERDICT: false-positive\nCONFIDENCE: high\nWHY: the sink is constant.');
  assert.equal(r.verdict, 'false-positive');
  assert.equal(r.confidence, 'high');
  assert.equal(r.preamble, null);
});

test('THE LIVE FAILURE: unfenced reasoning preamble before the fields', () => {
  // shape recorded from qwen/qwen3.6-27b on ISS-000001
  const r = parseVerdict("Here's a thinking process:\n\n1. Analyze the input\n2. Consider the sink\n\nVERDICT: needs-context\nCONFIDENCE: medium");
  assert.equal(r.verdict, 'needs-context', 'the verdict is found after a preamble');
  assert.match(r.preamble, /thinking process/, 'the preamble is captured as thinking, not lost');
  assert.match(r.answer, /^VERDICT:/, 'the answer starts at the first structured field');
});

test('markdown-decorated fields still parse', () => {
  assert.equal(parseVerdict('**VERDICT:** `real-vulnerability`').verdict, 'real-vulnerability');
});

test('a trailing clause after the verdict is trimmed to the token', () => {
  assert.equal(parseVerdict('VERDICT: false-positive (the path is unreachable)').verdict, 'false-positive');
});

test('NO verdict at all reports null — never a guess from prose', () => {
  // the exact hazard: prose that a keyword matcher would read backwards
  const r = parseVerdict('This is certainly not a false positive; the taint reaches the sink.');
  assert.equal(r.verdict, null, 'absence is reported as absence');
  assert.equal(r.preamble, null);
});

test('empty and nullish replies do not throw', () => {
  for (const v of ['', null, undefined]) {
    const r = parseVerdict(v);
    assert.equal(r.verdict, null);
  }
});

// ── the shared composition (monitor/issue-prompt.mjs) ────────────────────────
// The CLI and admin/routes/issue-detail.mjs must ask the SAME question. These pin the properties
// the extraction had to preserve, and the honest-absence behaviour it added.
test('composeIssuePrompt front-loads VERDICT and names rule/severity/scanner/location', () => {
  const p = composeIssuePrompt({
    severity: 'high', body: 'eval() on user input',
    source: { rule: 'js/code-injection', tool: 'sastCodeql' },
    anchor: { file: 'src/a.js', line: 12, hash: 'abc' },
  }, { root: mkTree() });
  const lines = p.split('\n');
  assert.equal(lines[0], 'You are triaging one static-analysis finding in a zero-dependency Node.js codebase.');
  assert.ok(p.includes('Rule: js/code-injection   Severity: high   Scanner: sastCodeql'));
  assert.ok(p.includes('Location: src/a.js:12'));
  assert.ok(p.includes('Scanner message: eval() on user input'));
  // the answer format precedes nothing that could push it past a truncation point
  assert.ok(p.indexOf('VERDICT: one of') < p.indexOf('CONFIDENCE:'));
  assert.ok(p.indexOf('Answer in this exact shape') > p.indexOf('Rule:'));
});

test('the anchored line is marked >> and the window is bounded to CONTEXT_LINES', () => {
  const root = mkTree(Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n'));
  const p = composeIssuePrompt({
    severity: 'high', body: null, source: { rule: 'r', tool: 't' },
    anchor: { file: 'src/a.js', line: 100, hash: 'x' },
  }, { root });
  assert.ok(p.includes('100 >> line 100'), 'the flagged line carries the >> marker');
  assert.ok(!p.includes('line 200'), 'the window is bounded, not the whole file');
  // slice(line-1-20, line+20) is 41 lines, not 40 — pinned so a window change is a test failure
  const shown = [...p.matchAll(/^(\d+)(?: >>|  ) line \d+$/gm)];
  assert.equal(shown.length, CONTEXT_LINES + 1, `expected ${CONTEXT_LINES + 1} source lines, got ${shown.length}`);
  assert.equal(shown[0][1], '80');
  assert.equal(shown[shown.length - 1][1], '120');
});

test('an unresolvable location says "(source unavailable)" rather than showing an empty block', () => {
  const base = { severity: 'high', body: null, source: { rule: 'r', tool: 't' } };
  const root = mkTree();
  for (const anchor of [
    null,                                              // CodeQL results with no location at all
    { file: 'src/gone.js', line: 3, hash: 'x' },        // repo not checked out here
    { file: 'src/a.js', line: null, hash: 'x' },        // malformed line
  ]) {
    const p = composeIssuePrompt({ ...base, anchor }, { root });
    assert.ok(p.includes('(source unavailable)'), `anchor ${JSON.stringify(anchor)} must state absence`);
    assert.ok(!p.includes('```js'), 'no empty fenced block may be emitted');
  }
});

// ── N-chain adjudication ──────────────────────────────────────────────────────────────────────
// Pure functions over plain data — ask() itself stays untested here.

test('CW_ADJUDICATE_CHAINS unset -> baseChainCount is 1, today\'s cost (regression guard)', () => {
  const saved = process.env.CW_ADJUDICATE_CHAINS;
  delete process.env.CW_ADJUDICATE_CHAINS;
  try { assert.equal(baseChainCount(), 1); }
  finally { if (saved !== undefined) process.env.CW_ADJUDICATE_CHAINS = saved; }
});

test('CW_ADJUDICATE_CHAINS is read at call time, not cached at import', () => {
  const saved = process.env.CW_ADJUDICATE_CHAINS;
  try {
    process.env.CW_ADJUDICATE_CHAINS = '5';
    assert.equal(baseChainCount(), 5);
    process.env.CW_ADJUDICATE_CHAINS = '0';   // not >= 1 -> falls back to the default
    assert.equal(baseChainCount(), 1);
  } finally {
    if (saved === undefined) delete process.env.CW_ADJUDICATE_CHAINS;
    else process.env.CW_ADJUDICATE_CHAINS = saved;
  }
});

test('chainsFor: no calibration signal -> stays at the floor (N=1 default path)', () => {
  assert.equal(chainsFor('sastSemgrep', 'qwen3.6-27b', null, 1), 1);
  assert.equal(chainsFor(null, 'qwen3.6-27b', { checks: {} }, 1), 1);
});

const calibNode = (overrides) => ({
  denominator: 10, adjudicated: 10, unadjudicated: 0, falseAlarmRate: 0, falseCleanRate: 0,
  cohortUnknown: 0,
  cohorts: {
    standing: { denominator: 5, falseAlarmRate: 0, falseCleanRate: 0 },
    delta: { denominator: 5, falseAlarmRate: 0, falseCleanRate: 0 },
  },
  ...overrides,
});

test('chainsFor escalates to 3 when OVERALL falseAlarmRate >= 0.3 with denominator >= 5', () => {
  const calibration = { checks: { sastSemgrep: { 'qwen3.6-27b': calibNode({ falseAlarmRate: 0.3 }) } } };
  assert.equal(chainsFor('sastSemgrep', 'qwen3.6-27b', calibration, 1), 3);
});

test('chainsFor escalates to 3 when OVERALL falseCleanRate > 0, any amount, with denominator >= 5', () => {
  const calibration = { checks: { sastSemgrep: { 'qwen3.6-27b': calibNode({ falseCleanRate: 0.01 }) } } };
  assert.equal(chainsFor('sastSemgrep', 'qwen3.6-27b', calibration, 1), 3);
});

test('chainsFor never escalates on the DELTA cohort alone — only the OVERALL rate counts', () => {
  // overall (aggregate) rates are clean; only the delta cohort looks bad — must NOT escalate
  const calibration = {
    checks: {
      sastSemgrep: {
        'qwen3.6-27b': calibNode({
          falseAlarmRate: 0.05, falseCleanRate: 0,
          cohorts: { standing: { denominator: 9, falseAlarmRate: 0, falseCleanRate: 0 },
            delta: { denominator: 1, falseAlarmRate: 1, falseCleanRate: 1 } },
        }),
      },
    },
  };
  assert.equal(chainsFor('sastSemgrep', 'qwen3.6-27b', calibration, 1), 1);
});

test('chainsFor respects the denominator floor — a bad rate on too few records does not escalate', () => {
  const calibration = { checks: { sastSemgrep: { 'qwen3.6-27b': calibNode({ denominator: 4, falseAlarmRate: 1 }) } } };
  assert.equal(chainsFor('sastSemgrep', 'qwen3.6-27b', calibration, 1), 1);
});

test('chainsFor is per (check, model) — a different model\'s bad rate does not escalate this model', () => {
  const calibration = { checks: { sastSemgrep: { 'other-model': calibNode({ falseAlarmRate: 1 }) } } };
  assert.equal(chainsFor('sastSemgrep', 'qwen3.6-27b', calibration, 1), 1);
});

test('chainsFor never lowers an operator-raised floor below what calibration alone would pick', () => {
  assert.equal(chainsFor('sastSemgrep', 'm', null, 5), 5, 'a manually-raised floor is never reduced');
});

const chainOk = (verdict, overrides) => ({
  answer: `VERDICT: ${verdict}`, thinking: 'the sink is reachable from user input', verdict,
  confidence: 'high', truncated: false, recovered: false, ...overrides,
});

test('fuseChains: unanimous verdict + clean reasoning on every chain -> unanimous', () => {
  const chains = [chainOk('real-vulnerability'), chainOk('real-vulnerability'), chainOk('real-vulnerability')];
  assert.deepEqual(fuseChains(chains), { outcome: 'unanimous', verdict: 'real-vulnerability' });
});

test('fuseChains: a 2-1 split escalates as a disagreement', () => {
  const chains = [chainOk('real-vulnerability'), chainOk('real-vulnerability'), chainOk('false-positive')];
  assert.deepEqual(fuseChains(chains), { outcome: 'escalate', reason: 'disagreement' });
});

test('fuseChains: unanimous verdict but ANY chain lint-flagged still escalates', () => {
  const chains = [
    chainOk('real-vulnerability'),
    chainOk('real-vulnerability'),
    // this chain's own reasoning contradicts the verdict it gave
    chainOk('real-vulnerability', { thinking: 'this is not a real credential, just a test fixture' }),
  ];
  assert.deepEqual(fuseChains(chains), { outcome: 'escalate', reason: 'lint-flagged' });
});

test('fuseChains: ANY chain execution error escalates — NEVER a unanimous read on partial chains', () => {
  const chains = [chainOk('real-vulnerability'), chainOk('real-vulnerability'), { error: 'LM Studio 500: boom' }];
  assert.deepEqual(fuseChains(chains), { outcome: 'escalate', reason: 'chain-error' });
});

test('fuseChains: a chain with no verdict at all cannot be part of a unanimous read', () => {
  const chains = [chainOk('real-vulnerability'), chainOk(null), chainOk('real-vulnerability')];
  assert.equal(fuseChains(chains).outcome, 'escalate');
});

test('findingKeyFor builds a place-keyed (no line) key when the issue supplies rule+file', () => {
  const issue = { repo: 'commitwork', source: { rule: 'js/code-injection' }, anchor: { file: 'admin/serve.mjs', line: 523 } };
  const key = findingKeyFor(issue, 'sastSemgrep');
  assert.equal(key, 'sastSemgrep|commitwork|js/code-injection|admin/serve.mjs');
  assert.ok(!key.includes('523'), 'the line number must never enter the identity');
});

test('findingKeyFor is null for dependency-cve — an issue cannot supply id+package structurally', () => {
  const issue = { repo: 'commitwork', source: { rule: null }, anchor: null };
  assert.equal(findingKeyFor(issue, 'dependency-cve'), null);
});

test('findingKeyFor is null when the category needs fields an issue cannot supply', () => {
  const issue = { repo: 'commitwork', source: { rule: 'x' }, anchor: { file: 'f.js' } };
  // maliciousPackages identity is ['id','package'] — neither is derivable from an issue
  assert.equal(findingKeyFor(issue, 'maliciousPackages'), null);
});

test('findingKeyFor is null without a repo — never guesses one', () => {
  const issue = { repo: null, source: { rule: 'x' }, anchor: { file: 'f.js' } };
  assert.equal(findingKeyFor(issue, 'sastSemgrep'), null);
});

test('buildAdjudicationRecord: unanimous -> provenance unanimous(N), truth null, verdict carried', () => {
  const issue = { repo: 'commitwork' };
  const chains = [chainOk('real-vulnerability'), chainOk('real-vulnerability'), chainOk('real-vulnerability')];
  const fused = fuseChains(chains);
  const rec = buildAdjudicationRecord(issue, 'sastSemgrep', 'sastSemgrep|commitwork|r|f', fused, chains, 'qwen3.6-27b');
  assert.equal(rec.provenance, 'unanimous(3)');
  assert.equal(rec.truth, null, 'self-consistency is never recorded as ground truth');
  assert.equal(rec.machineVerdict, 'real-vulnerability');
  assert.equal(rec.humanVerdict, null);
  assert.equal(JSON.parse(rec.evidence).length, 3, 'every chain is attached, even on the clean path');
});

test('buildAdjudicationRecord: escalation -> provenance names the reason, ALL chains attached, no machineVerdict', () => {
  const issue = { repo: 'commitwork' };
  const chains = [chainOk('real-vulnerability'), chainOk('real-vulnerability'), chainOk('false-positive')];
  const fused = fuseChains(chains);
  const rec = buildAdjudicationRecord(issue, 'sastSemgrep', 'sastSemgrep|commitwork|r|f', fused, chains, 'qwen3.6-27b');
  assert.equal(rec.provenance, 'escalation:disagreement(3)');
  assert.equal(rec.machineVerdict, null, 'a disputed read carries no single machine verdict');
  assert.equal(rec.truth, null);
  assert.equal(JSON.parse(rec.evidence).length, 3);
});

// ── exemplars wired into composeIssuePrompt ──────────────────────────────────────────────────
// The ledger (CW_VERDICT_DIR/adjudications.jsonl) is read at CALL time, so a throwaway dir with a
// hand-written fixture exercises the real read path.
const mkLedgerDir = (lines) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-ledger-'));
  if (lines) writeFileSync(join(dir, 'adjudications.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return dir;
};
const withVerdictDir = (dir, fn) => {
  const saved = process.env.CW_VERDICT_DIR;
  process.env.CW_VERDICT_DIR = dir;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.CW_VERDICT_DIR; else process.env.CW_VERDICT_DIR = saved;
  }
};
const scannerIssue = () => ({
  severity: 'high', body: 'eval() on user input', source: { rule: 'js/code-injection', tool: 'sastCodeql', key: 'sc:commitwork|sastSemgrep|js/code-injection|src/a.js|12' },
  anchor: { file: 'src/a.js', line: 12, hash: 'abc' },
});

test('composeIssuePrompt shows exemplars when the ledger has eligible history for the check', () => {
  const dir = mkLedgerDir([
    { v: 1, kind: 'finding-adjudication', category: 'sastSemgrep', repo: 'commitwork',
      findingKey: 'sastSemgrep|commitwork|other-rule|other/file.js', humanVerdict: 'false-positive',
      truth: 'false-alarm', model: null, at: '2026-08-01T00:00:00.000Z' },
  ]);
  const root = mkTree();
  const p = withVerdictDir(dir, () => composeIssuePrompt(scannerIssue(), { root }));
  assert.match(p, /Recent adjudications for this same check/);
  assert.match(p, /false-alarm/);
});

test('composeIssuePrompt shows nothing exemplar-shaped when the ledger is absent (ENOENT)', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'cw-ledger-')), 'does-not-exist');
  const root = mkTree();
  const p = withVerdictDir(dir, () => composeIssuePrompt(scannerIssue(), { root }));
  assert.ok(!p.includes('Recent adjudications for this same check'), 'absent ledger must not fabricate a section');
});

test('composeIssuePrompt shows nothing exemplar-shaped when the ledger has no eligible records', () => {
  const dir = mkLedgerDir([
    // wrong category — must not leak into this check's exemplars
    { v: 1, kind: 'finding-adjudication', category: 'secrets', repo: 'commitwork',
      findingKey: 'secrets|commitwork|x|y', humanVerdict: 'false-positive', truth: 'false-alarm',
      model: null, at: '2026-08-01T00:00:00.000Z' },
  ]);
  const root = mkTree();
  const p = withVerdictDir(dir, () => composeIssuePrompt(scannerIssue(), { root }));
  assert.ok(!p.includes('Recent adjudications for this same check'));
});

test('exemplars never disturb the VERDICT front-load: exemplar block sits before the answer format', () => {
  const dir = mkLedgerDir([
    { v: 1, kind: 'finding-adjudication', category: 'sastSemgrep', repo: 'commitwork',
      findingKey: 'sastSemgrep|commitwork|other-rule|other/file.js', humanVerdict: 'false-positive',
      truth: 'false-alarm', model: null, at: '2026-08-01T00:00:00.000Z' },
  ]);
  const root = mkTree();
  const p = withVerdictDir(dir, () => composeIssuePrompt(scannerIssue(), { root }));
  const exemplarIdx = p.indexOf('Recent adjudications for this same check');
  const answerIdx = p.indexOf('Answer in this exact shape');
  const verdictIdx = p.indexOf('VERDICT: one of');
  assert.ok(exemplarIdx > 0 && exemplarIdx < answerIdx, 'exemplars precede the front-loaded answer block');
  assert.ok(answerIdx < verdictIdx, 'VERDICT still leads the answer format itself');
  assert.ok(verdictIdx < p.indexOf('CONFIDENCE:'), 'VERDICT still precedes CONFIDENCE — front-load intact');
});
