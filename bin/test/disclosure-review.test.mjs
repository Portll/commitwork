import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewFindings, renderMarkdown, bucketOf } from '../disclosure-review.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'disclosure-review.mjs');

// A fake judge keyed on finding.id — the whole point of the injectable judgeFn: no model in a test.
// REPLIES express the judge's OUTPUT contract (what lib/judge.mjs returns, already demoted), since
// that is exactly what reviewFindings consumes.
const fakeJudge = (replies) => async ({ finding, mode }) => {
  const r = replies[finding.id] || {};
  if (mode === 'analysis') return { verdict: null, error: r.analysisError || null, answer: r.analysis || 'analysis text', citations: [], demotedToOpinion: false, answeredBy: 'fake' };
  return { verdict: r.verdict ?? null, confidence: 'low', fix: r.fix || null, citations: r.citations || [], dismissalSupported: r.dismissalSupported ?? null, demotedToOpinion: !!r.demotedToOpinion, answeredBy: 'fake', error: r.error || null };
};

const FINDINGS = [
  { id: 'trav', rule: 'path-traversal', severity: 'high', urgency: 'high', size: 'S', description: 'd' },
  { id: 'crit1', rule: 'rce', severity: 'crit', urgency: 'crit', size: 'M', description: 'd' },
  { id: 'fp', rule: 'noise', severity: 'low', description: 'd' },
  { id: 'opinion', rule: 'maybe', severity: 'med', description: 'd' },
  { id: 'broke', rule: 'x', severity: 'high', description: 'd' },
];
const REPLIES = {
  trav: { verdict: 'true-positive', fix: 'confine path under root' },
  crit1: { verdict: 'true-positive', fix: 'drop shell' },
  fp: { verdict: 'false-positive', dismissalSupported: true, citations: ['server.js:40'] },
  opinion: { verdict: 'undetermined', demotedToOpinion: true }, // judge demoted an unsupported dismissal
  broke: { verdict: null, error: 'no answer within 180s' },
};

test('bucketOf: only an explicit true-positive confirms; errors and demotions are undetermined', () => {
  assert.equal(bucketOf({ verdict: 'true-positive' }), 'confirmed');
  assert.equal(bucketOf({ verdict: 'false-positive', dismissalSupported: true }), 'dismissed');
  assert.equal(bucketOf({ verdict: 'false-positive', dismissalSupported: false }), 'undetermined');
  assert.equal(bucketOf({ error: 'boom', verdict: 'true-positive' }), 'undetermined'); // error wins
  assert.equal(bucketOf({ verdict: 'undetermined' }), 'undetermined');
});

test('reviewFindings triages into the three buckets and orders confirmed by priority', async () => {
  const review = await reviewFindings({ findings: FINDINGS, judgeFn: fakeJudge(REPLIES), env: { CW_NOW: '2026-11-08T00:00:00Z' } });
  assert.deepEqual(review.counts, { total: 5, confirmed: 2, dismissed: 1, undetermined: 2 });
  // crit1 (crit/crit) must sort ahead of trav (high/high)
  assert.deepEqual(review.remediationOrder, ['crit1', 'trav']);
  assert.equal(review.dismissed[0].id, 'fp');
  assert.deepEqual(review.undetermined.map((r) => r.id).sort(), ['broke', 'opinion']);
});

test('an unverifiable finding keeps its claim and is never a pass', async () => {
  const review = await reviewFindings({ findings: FINDINGS, judgeFn: fakeJudge(REPLIES), env: { CW_NOW: '2026-11-08T00:00:00Z' } });
  const broke = review.undetermined.find((r) => r.id === 'broke');
  assert.equal(broke.error, 'no answer within 180s');
  assert.equal(broke.claimedSeverity, 'high', 'the original claim is preserved');
  assert.ok(!review.confirmed.some((r) => r.id === 'broke'));
});

test('lens mode attaches an analysis pass per finding', async () => {
  const review = await reviewFindings({ findings: [FINDINGS[0]], lens: true, judgeFn: fakeJudge({ trav: { ...REPLIES.trav, analysis: 'chains to X' } }), env: { CW_NOW: '2026-11-08T00:00:00Z' } });
  assert.equal(review.confirmed[0].analysis, 'chains to X');
});

test('renderMarkdown names undetermined as its own state', async () => {
  const review = await reviewFindings({ findings: FINDINGS, judgeFn: fakeJudge(REPLIES), env: { CW_NOW: '2026-11-08T00:00:00Z' } });
  const md = renderMarkdown(review, { project: 'demo' });
  assert.match(md, /2 confirmed · 2 undetermined · 1 dismissed/);
  assert.match(md, /`undetermined` is its own state/);
  assert.match(md, /demoted to opinion/);
});

test('determinism: same inputs + same judge → byte-identical review', async () => {
  const opts = { findings: FINDINGS, judgeFn: fakeJudge(REPLIES), env: { CW_NOW: '2026-11-08T00:00:00Z' } };
  const a = JSON.stringify(await reviewFindings(opts));
  const b = JSON.stringify(await reviewFindings(opts));
  assert.equal(a, b);
});

test('CLI writes review.json + drafts and fails every finding closed with no reachable backend', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-disc-'));
  try {
    const f = join(dir, 'findings.json');
    writeFileSync(f, JSON.stringify([{ id: 'x', rule: 'r', severity: 'high', description: 'd' }]));
    const out = join(dir, 'out');
    // backend=model with provider=anthropic and NO key → resolution fails with no network, judge fails closed.
    execFileSync(process.execPath, [CLI, '--findings', f, '--backend', 'model', '--out', out], {
      env: { ...process.env, CW_MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: '', CW_MODEL_API_KEY: '', CW_NOW: '2026-11-08T00:00:00Z' },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const review = JSON.parse(readFileSync(join(out, 'review.json'), 'utf8'));
    assert.equal(review.counts.confirmed, 0);
    assert.equal(review.counts.undetermined, 1);
    assert.ok(review.undetermined[0].error, 'the resolution failure is recorded, not swallowed');
    assert.ok(readdirSync(out).includes('review.md'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
