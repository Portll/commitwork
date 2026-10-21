// divergence-review.test.mjs — the model review of a CodeQL stage-1 divergence: which engine reviews,
// the blind labels, the schema check, a failed review recorded as failed, row selection, evidence
// that is absent or superseded, the dry run, and the claude -p path through its command seam.
// Synthetic rows and a fake reviewer command only; no model is called.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  reviewMin, chooseReviewer, reviewPrompt, shapeReview, reviewDivergence, reviewsBySubject,
  reviewSchema, runReviewer, REVIEW_DIMENSION, POINTER,
} from '../divergence-review.mjs';
import { parseArgs, selectRows, loadEvidence, main, EXIT } from '../../bin/divergence-review.mjs';
import { readDimension, record } from '../nondeterministic-store.mjs';

const QWEN = 'qwen/qwen3.8-27b';
const local = (classification, model = QWEN) => ({
  classification, sampling: 'pinned-0',
  answeredBy: { provider: 'local', engine: 'lmstudio', model, host: '127.0.0.1:1234' },
});
const opus = (classification) => ({ classification, answeredBy: null, engine: { engine: 'claude-p', model: 'opus' } });
const SUBJECT = 'svc|codeql.sarif|js/sql-injection|src/db.js';
const row = ({ a = 'real', b = 'false-positive', score = 0.9, ts = '2026-10-08T00:00:00.000Z', model = QWEN, jobId = '0123456789abcdef', subject = SUBJECT, extra = {} } = {}) => ({
  subject, dimension: 'divergence', score, ts,
  detail: { source: 'codeql-remediation', basis: 'stage-1 independent analyses', jobId, local: local(a, model), opus: opus(b), ...extra },
});
const REVIEW = Object.freeze({
  betterSupported: 'analyst-a', why: 'the sink takes the raw parameter',
  disagreementSource: 'prompt-or-schema', promptSchemaIssue: 'unclear-class-definition',
  suggestedClarification: 'define needs-human against an unresolved taint path',
});
const EVIDENCE = Object.freeze({
  ok: true, match: 'in-run', sourceNote: 'source context read in-run',
  analysisPrompt: 'ANALYSE THIS FINDING', promptNote: 'note on the two prompts',
  verdictSchema: { type: 'object' }, a: { verdict: { classification: 'real', marker: 'VERDICT-A' } },
  b: { verdict: { classification: 'false-positive', marker: 'VERDICT-B' } },
});
const ENV_KEYS = ['CW_NONDET_STORE', 'CW_DIVERGENCE_REVIEW_MIN', 'CW_DIVERGENCE_REVIEWER', 'CW_DIVERGENCE_REVIEWER_MODEL',
  'CW_DIVERGENCE_REVIEW_CLAUDE_CMD', 'CW_DIVERGENCE_REVIEW_TIMEOUT_MS', 'CW_MONITOR_OUT', 'CW_REGISTRY'];

let dir, saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  dir = mkdtempSync(join(tmpdir(), 'cw-divreview-'));
  process.env.CW_NONDET_STORE = join(dir, 'store');
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(dir, { recursive: true, force: true });
});

describe('settings', () => {
  test('the threshold defaults to 0.5 and refuses a value outside [0,1]', () => {
    assert.deepEqual(reviewMin({}), { ok: true, value: 0.5 });
    assert.deepEqual(reviewMin({ CW_DIVERGENCE_REVIEW_MIN: '0.7' }), { ok: true, value: 0.7 });
    assert.equal(reviewMin({ CW_DIVERGENCE_REVIEW_MIN: '1.5' }).ok, false);
    assert.equal(reviewMin({ CW_DIVERGENCE_REVIEW_MIN: 'high' }).ok, false);
  });

  test('an unknown reviewer is refused, never defaulted', () => {
    const c = chooseReviewer(row(), { CW_DIVERGENCE_REVIEWER: 'gpt' });
    assert.equal(c.ok, false);
    assert.match(c.error, /not one of opus, local/);
  });
});

describe('chooseReviewer', () => {
  test('opus analysed the finding and the Qwen 3.8 reviewer did not: the preference is set aside', () => {
    const c = chooseReviewer(row({ model: 'google/gemma-3-27b' }), {});
    assert.equal(c.engine, 'local');
    assert.equal(c.avoided, true);
    assert.deepEqual(c.party, { opus: true, local: false });
  });

  test('both engines analysed it: the preference decides and the note says the review is not independent', () => {
    const c = chooseReviewer(row(), {});
    assert.equal(c.engine, 'opus');
    assert.equal(c.reviewerIsParty, true);
    assert.match(c.note, /not independent of either side/);
  });

  test('a named local model is matched exactly, not by family', () => {
    const c = chooseReviewer(row(), { CW_DIVERGENCE_REVIEWER: 'local', CW_DIVERGENCE_REVIEWER_MODEL: 'qwen/qwen3.8-8b' });
    assert.equal(c.party.local, false);
    assert.equal(c.engine, 'local');
  });

  test('a row that records neither analyst leaves party unknown, not false', () => {
    const c = chooseReviewer({ subject: SUBJECT, score: 0.9, detail: {} }, {});
    assert.deepEqual(c.party, { opus: null, local: null });
    assert.equal(c.avoided, false);
  });
});

describe('the prompt and the answer', () => {
  test('both verdicts appear under blind labels, with the schema and the answer fields', () => {
    const p = reviewPrompt(EVIDENCE);
    const a = p.indexOf('# Analyst A'), b = p.indexOf('# Analyst B');
    assert.ok(a > 0 && b > a, 'Analyst A precedes Analyst B');
    assert.ok(p.indexOf('VERDICT-A') > a && p.indexOf('VERDICT-A') < b, "A's verdict sits under Analyst A");
    assert.ok(p.indexOf('VERDICT-B') > b, "B's verdict sits under Analyst B");
    assert.ok(p.includes('ANALYSE THIS FINDING'));
    assert.ok(p.includes('"betterSupported"'));
    assert.doesNotMatch(p, /opus|claude/i, 'the prompt never names which engine wrote which verdict');
  });

  test('a reply in the schema maps the blind label back to the analyst', () => {
    assert.equal(shapeReview(REVIEW).betterSupported, 'local');
    assert.equal(shapeReview({ ...REVIEW, betterSupported: 'analyst-b' }).betterSupported, 'opus');
    assert.equal(shapeReview({ ...REVIEW, betterSupported: 'neither' }).betterSupported, 'neither');
    assert.equal(shapeReview(REVIEW).betterSupportedLabel, 'analyst-a');
  });

  test('a reply missing a field or outside an enum is not a review', () => {
    const { why, ...noWhy } = REVIEW;
    assert.equal(shapeReview(noWhy), null);
    assert.equal(shapeReview({ ...REVIEW, disagreementSource: 'vibes' }), null);
    assert.equal(shapeReview([REVIEW]), null);
    assert.equal(shapeReview(null), null);
  });

  test('the schema requires every field the prompt asks for', () => {
    assert.deepEqual([...reviewSchema().required].sort(), ['betterSupported', 'disagreementSource', 'promptSchemaIssue', 'suggestedClarification', 'why']);
  });
});

describe('reviewDivergence records every outcome beside the row', () => {
  const stored = () => readDimension(REVIEW_DIMENSION).subjects.find((s) => s.subject === SUBJECT)?.rows ?? [];

  test('a review is recorded with the score of the row it reviews and the pointer statement', async () => {
    const r = row();
    const out = await reviewDivergence(r, EVIDENCE, { env: {}, run: async () => ({ ok: true, value: REVIEW, answeredBy: { engine: 'claude-p', model: 'opus' }, sampling: 'model-default' }) });
    assert.equal(out.status, 'reviewed');
    assert.equal(out.recorded, true);
    const [rec] = stored();
    assert.equal(rec.score, 0.9);
    assert.equal(rec.detail.pointer, POINTER);
    assert.equal(rec.detail.reviewOf.ts, r.ts);
    assert.equal(rec.detail.review.betterSupported, 'local');
    assert.equal(rec.detail.error, null);
  });

  test('a reviewer failure is recorded as failed, with its reason', async () => {
    const out = await reviewDivergence(row(), EVIDENCE, { env: {}, run: async () => ({ ok: false, error: 'LM Studio unreachable' }) });
    assert.equal(out.status, 'failed');
    const [rec] = stored();
    assert.equal(rec.detail.status, 'failed');
    assert.equal(rec.detail.error, 'LM Studio unreachable');
    assert.equal(rec.detail.review, null);
  });

  test('a reply outside the schema is failed and its raw text is kept', async () => {
    await reviewDivergence(row(), EVIDENCE, { env: {}, run: async () => ({ ok: true, value: { verdict: 'real' }, raw: '{"verdict":"real"}' }) });
    const [rec] = stored();
    assert.equal(rec.detail.status, 'failed');
    assert.match(rec.detail.error, /not a review in the schema/);
    assert.equal(rec.detail.raw, '{"verdict":"real"}');
  });

  test('missing evidence fails without calling the reviewer', async () => {
    let called = false;
    const out = await reviewDivergence(row(), { ok: false, error: 'job record cleared' }, { env: {}, run: async () => { called = true; return { ok: true, value: REVIEW }; } });
    assert.equal(called, false);
    assert.equal(out.status, 'failed');
    assert.equal(stored()[0].detail.error, 'job record cleared');
  });

  test('a reviewer that throws is a failed review, never a thrown one', async () => {
    const out = await reviewDivergence(row(), EVIDENCE, { env: {}, run: async () => { throw new Error('boom'); } });
    assert.equal(out.status, 'failed');
    assert.match(out.detail.error, /the reviewer threw: boom/);
  });

  test('a row with no subject is reported as not recorded', async () => {
    const out = await reviewDivergence({ ...row(), subject: undefined }, EVIDENCE, { env: {}, run: async () => ({ ok: true, value: REVIEW }) });
    assert.equal(out.recorded, false);
    assert.match(out.error, /names no subject/);
  });
});

describe('the claude -p path', () => {
  test('the command seam answers in the claude -p JSON envelope and the review is recorded', async () => {
    const fake = join(dir, 'fake-claude.mjs');
    writeFileSync(fake, `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(!s.includes('# Analyst A'))process.exit(3);process.stdout.write(JSON.stringify({result:JSON.stringify(${JSON.stringify(REVIEW)})}))});`);
    const env = { ...process.env, CW_DIVERGENCE_REVIEW_CLAUDE_CMD: `${process.execPath} ${fake}` };
    const choice = chooseReviewer(row({ model: 'google/gemma-3-27b' }), { CW_DIVERGENCE_REVIEWER: 'opus' });
    const forced = { ...choice, engine: 'opus' };
    const out = await runReviewer(forced, reviewPrompt(EVIDENCE), { schema: reviewSchema(), env });
    assert.equal(out.ok, true, out.error);
    assert.deepEqual(out.value, REVIEW);
    assert.equal(out.sampling, 'model-default');
    assert.equal(out.answeredBy.via, 'CW_DIVERGENCE_REVIEW_CLAUDE_CMD');
  });

  test('a non-zero exit is a failure naming the exit code', async () => {
    const env = { ...process.env, CW_DIVERGENCE_REVIEW_CLAUDE_CMD: `${process.execPath} -e process.exit(7)` };
    const out = await runReviewer({ ok: true, engine: 'opus' }, 'prompt', { schema: reviewSchema(), env });
    assert.equal(out.ok, false);
    assert.match(out.error, /exited 7/);
  });
});

describe('bin/divergence-review.mjs', () => {
  test('arguments: --limit is bounded and an unknown flag is a usage error', () => {
    assert.deepEqual(parseArgs([]), { limit: 5, dryRun: false, retryFailed: false });
    assert.equal(parseArgs(['--limit', '3']).limit, 3);
    assert.ok(parseArgs(['--limit', '0']).error);
    assert.ok(parseArgs(['--limit', '101']).error);
    assert.ok(parseArgs(['--force']).error);
  });

  test('selectRows takes each finding\'s latest row once, highest score first, skipping reviewed ones', () => {
    const other = 'svc|codeql.sarif|js/xss|src/view.js';
    const div = { subjects: [
      { subject: SUBJECT, rows: [row({ score: 0.95, ts: 't1' }), row({ score: 0.6, ts: 't2' })] },
      { subject: other, rows: [row({ subject: other, score: 0.8, ts: 't3' })] },
      { subject: 'low', rows: [row({ subject: 'low', score: 0.2, ts: 't4' })] },
    ] };
    const picked = selectRows(div, new Map(), { min: 0.5 });
    assert.deepEqual(picked.map((r) => [r.subject, r.ts]), [[other, 't3'], [SUBJECT, 't2']]);
    const reviewed = new Map([[other, [{ detail: { status: 'reviewed', reviewOf: { ts: 't3' } } }]]]);
    assert.deepEqual(selectRows(div, reviewed, { min: 0.5 }).map((r) => r.subject), [SUBJECT]);
  });

  test('a failed review is retried only on request', () => {
    const div = { subjects: [{ subject: SUBJECT, rows: [row({ ts: 't1' })] }] };
    const failed = new Map([[SUBJECT, [{ detail: { status: 'failed', reviewOf: { ts: 't1' } } }]]]);
    assert.equal(selectRows(div, failed, { min: 0.5 }).length, 0);
    const [r] = selectRows(div, failed, { min: 0.5, retryFailed: true });
    assert.equal(r.retry, true);
  });

  test('evidence: an absent job, a re-run job and an unreadable record are each a stated reason', () => {
    const jobs = join(dir, 'reports', 'svc', 'codeql-remediation');
    mkdirSync(jobs, { recursive: true });
    const r = row({ extra: { runAt: '2026-10-08T00:00:00.000Z' } });
    assert.match(loadEvidence(r, [jobs]).error, /no job record/);
    writeFileSync(join(jobs, '0123456789abcdef.json'), JSON.stringify({
      createdAt: '2026-10-08T00:00:00.000Z', finding: { file: 'src/db.js', line: 3 },
      stages: { local: { verdict: { classification: 'real' } }, opus: { verdict: { classification: 'real' } } },
    }));
    assert.match(loadEvidence(r, [jobs]).error, /re-run after this row/);
    writeFileSync(join(jobs, '0123456789abcdef.json'), '{torn');
    assert.match(loadEvidence(r, [jobs]).error, /unreadable .*not an absent record/);
    assert.match(loadEvidence(row({ jobId: 'not-a-job' }), [jobs]).error, /names no job id/);
  });

  test('--dry-run lists the rows, calls no model and writes nothing', async () => {
    record({ subject: SUBJECT, dimension: 'divergence', score: 0.9, detail: row().detail });
    const log = [], err = [];
    const code = await main(['--dry-run'], { log: (s) => log.push(s), err: (s) => err.push(s), env: process.env });
    assert.equal(code, EXIT.OK, err.join('\n'));
    assert.match(log.join('\n'), /would review .* with opus/);
    assert.equal(reviewsBySubject().size, 0);
    assert.deepEqual(readdirSync(join(dir, 'store')).filter((f) => f.includes(REVIEW_DIMENSION)), []);
  });

  test('no divergence recorded is nothing to review, exit 0; a bad threshold is a usage error', async () => {
    const log = [];
    assert.equal(await main([], { log: (s) => log.push(s), err: () => {}, env: process.env }), EXIT.OK);
    assert.match(log.join('\n'), /no divergence row is recorded/);
    assert.equal(await main([], { log: () => {}, err: () => {}, env: { ...process.env, CW_DIVERGENCE_REVIEW_MIN: '2' } }), EXIT.USAGE);
  });
});
