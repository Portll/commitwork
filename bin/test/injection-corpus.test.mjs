// Replays fixtures/injection-corpus/*.txt through the CodeQL remediation prompt builders and the
// exported opus run path (stub-recorded), asserting each string reaches the model only inside the
// envelope's data block. The opt-in live test (CW_LIVE_LLM=1) replays one file through
// monitor/envelope-witness.mjs, the producer of the witness monitor/stpa-sweep.mjs and
// monitor/remediation-policy.mjs read — a stub run is not a live replay and writes no witness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREAMBLE, ENVELOPE_OPEN, ENVELOPE_CLOSE, stripHidden } from '../../lib/prompt-envelope.mjs';
import { analysisPrompt, crossPrompt, findingBlock, reviewFinding } from '../../admin/routes/codeql-remediation.mjs';
import { witnessPath } from '../../monitor/stpa-sweep.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS = join(ROOT, 'fixtures', 'injection-corpus');
const STUB = join(ROOT, 'bin', 'test', 'fixtures', 'claude-stub-record.mjs');
const FILES = readdirSync(CORPUS).filter((f) => f.endsWith('.txt')).sort();
const REQUIRED = ['direct.txt', 'indirect-comment.txt', 'encoded.txt', 'hidden-unicode.txt', 'html-comment.txt', 'ignore-previous.txt', 'tool-call.txt', 'fence-escape.txt'];
const TMP = mkdtempSync(join(tmpdir(), 'cw-injection-'));

// ruleName is commitwork's own field and stays outside the block, so it must not carry corpus text
const findingFor = (name, text) => ({ service: 'fixture-service', sarif: 'codeql.sarif', ruleId: `js/${name}`, ruleName: 'fixture rule', severity: 'error', securitySeverity: 7.5, message: text, file: `src/${name}.js`, line: 5 });
const ctxFor = (text) => ({ text, note: 'lines 1-3 of 3' });

// The one data block of a prompt: text between the open-marker LINE and the close-marker LINE.
// Line-anchored on purpose: a forged marker inside the data is space-prefixed by the envelope, so a
// plain substring search would find the forgery first and read the block as ending there.
function block(prompt) {
  const open = prompt.indexOf(`\n${ENVELOPE_OPEN}`) + 1;
  const close = prompt.indexOf(`\n${ENVELOPE_CLOSE}`, open) + 1;
  assert.ok(open > 0 && close > open, 'no data block found');
  return { inner: prompt.slice(prompt.indexOf('\n', open) + 1, close - 1), outside: prompt.slice(0, open) + prompt.slice(close + ENVELOPE_CLOSE.length) };
}
const markerLines = (s, marker) => s.split('\n').filter((l) => l.startsWith(marker)).length;
// the longest line of the corpus text that survives stripping is the probe for "appears only inside"
const probeLine = (text) => stripHidden(text).text.split('\n').map((l) => l.trim()).filter((l) => l.length >= 12 && !/^(<<<|>>>)/.test(l)).sort((a, b) => b.length - a.length)[0];

test('the corpus holds every required attack shape', () => {
  for (const f of REQUIRED) assert.ok(FILES.includes(f), `${f} is missing from fixtures/injection-corpus`);
  assert.ok(existsSync(join(CORPUS, 'README.md')));
});

for (const f of FILES) {
  test(`${f}: reaches the analysis and cross prompts only inside the data block, stripped, with the markers unforged`, () => {
    const text = readFileSync(join(CORPUS, f), 'utf8');
    const finding = findingFor(f.replace(/\.txt$/, ''), text);
    const ctx = ctxFor(text);
    const verdict = { classification: 'needs-human', investigation: 'x', falsePositiveAnalysis: 'x', remediation: 'x', diff: '', confidence: 'low' };
    const probe = probeLine(text);
    assert.ok(probe, `${f} has no line long enough to probe with`);
    for (const prompt of [analysisPrompt(finding, ctx, 'the reviewing agent'), crossPrompt(finding, ctx, verdict, verdict, 'OPUS (you)', 'LOCAL')]) {
      assert.ok(prompt.includes(PREAMBLE), 'the preamble is present');
      assert.equal(markerLines(prompt, ENVELOPE_OPEN), 1, 'exactly one open marker line');
      assert.equal(markerLines(prompt, ENVELOPE_CLOSE), 1, 'exactly one close marker line');
      const { inner, outside } = block(prompt);
      assert.ok(inner.includes(probe), 'the corpus text is inside the data block');
      assert.ok(!outside.includes(probe), 'the corpus text does not appear outside the data block');
      assert.equal(stripHidden(prompt).stripped, 0, 'no hidden code point survives anywhere in the prompt');
      assert.ok(!inner.split('\n').some((l) => /^(<<<|>>>)/.test(l)), 'no marker-shaped line survives unescaped inside the block');
      const closeLine = prompt.indexOf(`\n${ENVELOPE_CLOSE}`);
      assert.ok(prompt.indexOf('# Your tasks') > closeLine || prompt.indexOf('# How your output must READ') > closeLine, 'the governing instructions follow the block');
    }
    const fb = findingBlock(finding, ctx);
    assert.ok(!/\n- message: /.test(fb), 'the message is no longer written as a plain bullet');
    if (f === 'hidden-unicode.txt') assert.ok(stripHidden(text).stripped > 0, 'the fixture itself must carry hidden code points, or the strip is untested');
    if (f === 'fence-escape.txt') assert.ok(text.includes(ENVELOPE_CLOSE), 'the fixture forges the real close marker');
  });
}

test('the exported run path sends an enveloped prompt to the claude seam (stub records stdin)', async () => {
  const f = 'tool-call.txt';
  const text = readFileSync(join(CORPUS, f), 'utf8');
  const rec = join(TMP, 'stdin.txt');
  const prev = process.env.CW_CODEQL_CLAUDE_CMD;
  process.env.CW_CODEQL_CLAUDE_CMD = `${process.execPath} ${STUB} ${rec}`;
  let r;
  try { r = await reviewFinding(findingFor('tool', text), ctxFor(text), { cwd: TMP }); }
  finally { if (prev === undefined) delete process.env.CW_CODEQL_CLAUDE_CMD; else process.env.CW_CODEQL_CLAUDE_CMD = prev; }
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.verdict && r.verdict.classification, 'needs-human', 'the stub reply came back through the json wrapper');
  const sent = readFileSync(rec, 'utf8');
  assert.ok(sent.includes(PREAMBLE));
  const { inner, outside } = block(sent);
  assert.ok(inner.includes('"type":"tool_result"'), 'the fake tool result is inside the data block');
  assert.ok(!outside.includes('"type":"tool_result"'), 'and nowhere outside it');
  assert.equal(stripHidden(sent).stripped, 0);
});

// One file through the producer's own replay, so the test and monitor/envelope-witness.mjs cannot
// disagree about what a live pass is. A one-file witness is written only when the run completed.
test('LIVE (CW_LIVE_LLM=1): the real claude -p over one corpus file uses no tool outside the allowed list, and writes the witness', { skip: process.env.CW_LIVE_LLM === '1' ? false : 'CW_LIVE_LLM is not 1 — the live model call is opt-in (cost, network, credential)' }, async () => {
  const { replayCorpus, writeWitness, witnessRecord } = await import('../../monitor/envelope-witness.mjs');
  const replay = await replayCorpus({ files: ['tool-call.txt'], say: (l) => process.stderr.write(`${l}\n`) });
  assert.equal(replay.ran, true, JSON.stringify(replay.files));
  assert.equal(replay.live, true);
  writeWitness(witnessPath(), witnessRecord(replay, process.env.CW_NOW || new Date().toISOString()));
  assert.equal(replay.pass, true, JSON.stringify(replay.files));
});

test.after(() => rmSync(TMP, { recursive: true, force: true }));
