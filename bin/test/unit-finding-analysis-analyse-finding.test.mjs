// Computes the evidence-only analysis envelope for one scanner finding (bin/finding-analysis.mjs analyseFinding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseFinding } from '../finding-analysis.mjs';

test('returns evidence-only envelope with no analysts', async () => {
  const finding = { repo: 'r', file: 'f.js', rule: 'x', severity: 'high' };
  const out = await analyseFinding(finding, { analysts: [], now: '2025-01-01T00:00:00.000Z' });
  assert.equal(out.evidenceOnly, true);
  assert.equal(out.severityChangedByAnalysis, false);
  assert.equal(out.findingSuppressed, false);
  assert.equal(out.contractVersion, 1);
  assert.equal(out.generated, '2025-01-01T00:00:00.000Z');
  assert.equal(out.severity, 'high');
  assert.equal(out.findingKey, 'r|f.js|x|');
  assert.equal(out.analysts.length, 0);
  assert.equal(out.comparison.agreement, 'indeterminate');
  assert.equal(out.comparison.reason, 'only 0 analyst ran \u2014 a comparison needs two, so this is a reading, not a corroboration');
  assert.equal(out.reachabilityClaims.length, 0);
  assert.equal(out.dismissalClaims.length, 0);
  assert.equal(out.promptSha.length, 64);
});

test('reports single analyst as a reading not corroboration', async () => {
  const finding = { repo: 'r', file: 'f.js', rule: 'x' };
  const a = async () => ({ analyst: 'a1', state: 'analysed', verdict: 'true-positive' });
  const out = await analyseFinding(finding, { analysts: [a], now: '2025-01-01T00:00:00.000Z' });
  assert.equal(out.comparison.agreement, 'indeterminate');
  assert.equal(out.comparison.reason, 'only 1 analyst ran \u2014 a comparison needs two, so this is a reading, not a corroboration');
  assert.deepEqual(out.comparison.verdicts, [{ analyst: 'a1', state: 'analysed', verdict: 'true-positive' }]);
});

test('two agreeing analysts produce agree', async () => {
  const finding = { repo: 'r', file: 'f.js', rule: 'x' };
  const a1 = async () => ({ analyst: 'a1', state: 'analysed', verdict: 'false-positive' });
  const a2 = async () => ({ analyst: 'a2', state: 'analysed', verdict: 'false-positive' });
  const out = await analyseFinding(finding, { analysts: [a1, a2], now: '2025-01-01T00:00:00.000Z' });
  assert.equal(out.comparison.agreement, 'agree');
  assert.equal(out.comparison.reason, null);
  assert.equal(out.analysts.length, 2);
});

test('two disagreeing analysts produce disagree with reason', async () => {
  const finding = { repo: 'r', file: 'f.js', rule: 'x' };
  const a1 = async () => ({ analyst: 'a1', state: 'analysed', verdict: 'true-positive' });
  const a2 = async () => ({ analyst: 'a2', state: 'analysed', verdict: 'false-positive' });
  const out = await analyseFinding(finding, { analysts: [a1, a2], now: '2025-01-01T00:00:00.000Z' });
  assert.equal(out.comparison.agreement, 'disagree');
  assert.equal(out.comparison.reason, 'analysts disagree: a1=true-positive, a2=false-positive \u2014 recorded as a split, not resolved');
});

test('non-analysed analysts are excluded from verdict comparison', async () => {
  const finding = { repo: 'r', file: 'f.js', rule: 'x' };
  const a1 = async () => ({ analyst: 'a1', state: 'analysed', verdict: 'true-positive' });
  const a2 = async () => ({ analyst: 'a2', state: 'timeout', verdict: null });
  const out = await analyseFinding(finding, { analysts: [a1, a2], now: '2025-01-01T00:00:00.000Z' });
  assert.equal(out.comparison.agreement, 'indeterminate');
  assert.equal(out.comparison.reason, '1 of 2 analysts produced a verdict \u2014 absence is not concurrence');
  assert.equal(out.comparison.verdicts.length, 2);
  assert.equal(out.comparison.verdicts[1].state, 'timeout');
});

test('collects reachability and dismissal claims from results', async () => {
  const finding = { repo: 'r', file: 'f.js', rule: 'x' };
  const a1 = async () => ({ analyst: 'a1', state: 'analysed', verdict: 'unreachable', reachability: { kind: 'unreachable', entryPoints: 'main' } });
  const a2 = async () => ({ analyst: 'a2', state: 'analysed', verdict: 'false-positive', dismissal: { kind: 'dismissed', evidence: 'nanoid@3.3.18' } });
  const out = await analyseFinding(finding, { analysts: [a1, a2], now: '2025-01-01T00:00:00.000Z' });
  assert.equal(out.reachabilityClaims.length, 1);
  assert.equal(out.reachabilityClaims[0].analyst, 'a1');
  assert.equal(out.reachabilityClaims[0].kind, 'unreachable');
  assert.equal(out.dismissalClaims.length, 1);
  assert.equal(out.dismissalClaims[0].analyst, 'a2');
  assert.equal(out.dismissalClaims[0].evidence, 'nanoid@3.3.18');
});

test('finding fields are copied verbatim into envelope', async () => {
  const finding = { repo: 'r', file: 'f.js', rule: 'x', package: 'p', severity: 'low', snippet: 'code' };
  const out = await analyseFinding(finding, { analysts: [], now: '2025-01-01T00:00:00.000Z' });
  assert.deepEqual(out.finding, finding);
  assert.equal(out.severity, 'low');
  assert.equal(out.findingKey, 'r|f.js|x|p');
});

test('missing severity becomes null in envelope', async () => {
  const finding = { repo: 'r', file: 'f.js', rule: 'x' };
  const out = await analyseFinding(finding, { analysts: [], now: '2025-01-01T00:00:00.000Z' });
  assert.equal(out.severity, null);
});
