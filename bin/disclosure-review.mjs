#!/usr/bin/env node
// bin/disclosure-review.mjs — run a judge over a set of findings and emit a triaged, priority-ordered
// review plus a disclosure-draft stub per CONFIRMED finding.
//
// It classifies every finding on three axes (severity/urgency/size, lib/judge-taxonomy.mjs), asks the
// judge (lib/judge.mjs — claude by default, or a model backend) to verify each, then buckets:
//   confirmed    — the judge called it true-positive. Ordered by priority for remediation.
//   dismissed    — a SUPPORTED false-positive/unreachable (a checkable citation). Recorded, not acted on.
//   undetermined — its OWN bucket: the judge returned undetermined, a dismissal with nothing checkable
//                  (demoted to an opinion), a backend error, or no reply. The original claim is PRESERVED.
//
// House invariants honoured: an unverified finding is never published as a pass OR as a confirmed
// finding (it is `undetermined`); fail closed (a judge error is `undetermined`, never empty); the
// stamp honours CW_NOW for determinism; writes are atomic (tmp+rename).
//
//   node bin/disclosure-review.mjs --findings findings.json --backend claude --out <dir> --lens
//
// --findings <file>   JSON array of { repo,file,rule,cwe,severity,urgency,size,description,snippet,evidence }
// --backend           claude (default) | model      (model → lib/model-provider.mjs, CW_MODEL_PROVIDER)
// --lens              also run a free-form analysis pass per finding (chain / what-fails-next)
// --concurrency N      parallel judge calls (default 2; claude -p is heavy)
// --out <dir>         output dir (default $CW_DISCLOSURE_OUT or ./reports/disclosure-<stamp>)
// Exit 0 always on a completed run; 1 on bad input.

import { readFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { nowISO } from '../lib/clock.mjs';
import { judge } from '../lib/judge.mjs';
import { classify, priorityKey } from '../lib/judge-taxonomy.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';

export const BUCKETS = Object.freeze(['confirmed', 'dismissed', 'undetermined']);

async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length || 1)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// Which bucket a judged finding lands in. The ONLY path to `confirmed` is an explicit true-positive;
// everything the judge did not positively confirm is dismissed-with-proof or undetermined.
export function bucketOf(judged) {
  if (judged.error) return 'undetermined';
  if (judged.verdict === 'true-positive') return 'confirmed';
  if ((judged.verdict === 'false-positive' || judged.verdict === 'unreachable') && judged.dismissalSupported) return 'dismissed';
  return 'undetermined';
}

/**
 * Judge every finding and triage. `judgeFn` is injectable so tests run without a model.
 * Returns a plain, serialisable review object; does no IO.
 */
export async function reviewFindings({ findings, backend = 'claude', lens = false, concurrency = 2, timeoutMs = undefined, env = process.env, judgeFn = judge } = {}) {
  if (!Array.isArray(findings)) throw new TypeError('reviewFindings needs an array of findings');
  const records = await mapPool(findings, concurrency, async (f) => {
    const axes = classify({ severity: f.severity, urgency: f.urgency, size: f.size, score: f.score });
    const v = await judgeFn({ finding: f, backend, mode: 'verdict', timeoutMs, env });
    const rec = {
      id: f.id || f.rule || f.file || 'finding',
      finding: { repo: f.repo || null, file: f.file || null, rule: f.rule || f.id || null, cwe: f.cwe || null, description: f.description || f.title || null },
      claimedSeverity: f.severity ?? null,
      axes,
      verdict: v.verdict, confidence: v.confidence, fix: v.fix, citations: v.citations,
      demotedToOpinion: v.demotedToOpinion, answeredBy: v.answeredBy, error: v.error,
    };
    if (lens) {
      const a = await judgeFn({ finding: f, backend, mode: 'analysis', question: 'What fails next if this holds, what chains to it, and what must a fix confine? Mark anything you could not determine as undetermined.', timeoutMs, env });
      rec.analysis = a.error ? null : a.answer;
      rec.analysisError = a.error || null;
    }
    rec.bucket = bucketOf(v);
    return rec;
  });

  // priority reads the classified axes (nested under .axes), smaller key first; V8 sort is stable.
  const confirmed = records.filter((r) => r.bucket === 'confirmed')
    .map((r, i) => ({ r, i, k: priorityKey(r.axes) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
    .map((x) => x.r);
  const dismissed = records.filter((r) => r.bucket === 'dismissed');
  const undetermined = records.filter((r) => r.bucket === 'undetermined');
  return {
    generatedAt: nowISO(env),
    backend, lens,
    counts: { total: records.length, confirmed: confirmed.length, dismissed: dismissed.length, undetermined: undetermined.length },
    remediationOrder: confirmed.map((r) => r.id),
    confirmed, dismissed, undetermined,
  };
}

const sevCell = (a) => `${a.severity}/${a.urgency}/${a.size}`;

export function renderMarkdown(review, { project = 'findings' } = {}) {
  const md = [];
  md.push(`# Disclosure review — ${project}`, '', `Generated ${review.generatedAt} · backend \`${review.backend}\``, '');
  md.push(`**${review.counts.confirmed} confirmed · ${review.counts.undetermined} undetermined · ${review.counts.dismissed} dismissed** (of ${review.counts.total})`, '');
  md.push('> `undetermined` is its own state — a finding the judge could not verify, a dismissal with nothing checkable, or a backend error. It is neither a pass nor a confirmed finding; the original claim is kept below.', '');

  md.push('## Confirmed — remediation order', '', '| # | id | sev/urg/size | fix must confine | cites |', '|---|---|---|---|---|');
  review.confirmed.forEach((r, i) => md.push(`| ${i + 1} | ${r.id} | ${sevCell(r.axes)} | ${(r.fix || '—').replace(/\|/g, '\\|')} | ${r.citations.join(', ') || '—'} |`));
  if (!review.confirmed.length) md.push('| — | none confirmed | | | |');

  md.push('', '## Undetermined — triage, do not close', '', '| id | claimed sev | why undetermined |', '|---|---|---|');
  for (const r of review.undetermined) {
    const why = r.error ? `judge error: ${r.error}` : r.demotedToOpinion ? 'dismissal had nothing checkable (demoted to opinion)' : `verdict ${r.verdict || 'none'}`;
    md.push(`| ${r.id} | ${r.claimedSeverity ?? '—'} | ${String(why).replace(/\|/g, '\\|')} |`);
  }
  if (!review.undetermined.length) md.push('| — | | none |');

  md.push('', '## Dismissed — supported false-positive / unreachable', '', '| id | verdict | citations |', '|---|---|---|');
  for (const r of review.dismissed) md.push(`| ${r.id} | ${r.verdict} | ${r.citations.join(', ')} |`);
  if (!review.dismissed.length) md.push('| — | | none |');

  md.push('');
  return md.join('\n');
}

function disclosureDraft(r, project) {
  return [
    `# Disclosure draft — ${r.id}`,
    '',
    `Project: ${project}`,
    `Location: ${r.finding.file || '(unknown)'}`,
    `Weakness: ${r.finding.cwe || '(classify)'}  ·  Severity/Urgency/Size: ${sevCell(r.axes)}`,
    '',
    '## Summary',
    r.finding.description || '(fill in: what the finding is, in one paragraph)',
    '',
    '## What a fix must confine',
    r.fix || '(fill in)',
    '',
    '## Checkable evidence',
    r.citations.length ? r.citations.map((c) => `- ${c}`).join('\n') : '- (add the file:line / version a reader can verify)',
    '',
    '_Draft. Verify every citation at the unpatched baseline before sending. Name both over- and under-mitigation._',
    '',
  ].join('\n');
}

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true; // bare flag → true
}

async function main() {
  const file = arg('findings');
  if (!file || file === true) { process.stderr.write('disclosure-review: --findings <file> is required\n'); process.exit(1); }
  let findings;
  try { findings = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { process.stderr.write(`disclosure-review: ${file} is not JSON: ${e.message}\n`); process.exit(1); }
  if (!Array.isArray(findings)) { process.stderr.write('disclosure-review: findings file must be a JSON array\n'); process.exit(1); }

  const env = process.env;
  const backend = arg('backend', 'claude') === true ? 'claude' : arg('backend', 'claude');
  const lens = arg('lens', false) === true;
  const concurrency = Number(arg('concurrency', '2')) || 2;
  const project = (arg('project') && arg('project') !== true) ? arg('project') : basename(file).replace(/\.json$/, '');
  const stamp = nowISO(env).replace(/[:.]/g, '-');
  const outDir = (arg('out') && arg('out') !== true) ? arg('out') : (env.CW_DISCLOSURE_OUT || join(process.cwd(), 'reports', `disclosure-${stamp}`));

  const review = await reviewFindings({ findings, backend, lens, concurrency, env });
  mkdirSync(outDir, { recursive: true });
  writeAtomic(join(outDir, 'review.json'), JSON.stringify(review, null, 2) + '\n');
  writeAtomic(join(outDir, 'review.md'), renderMarkdown(review, { project }));
  const draftsDir = join(outDir, 'disclosure-drafts');
  mkdirSync(draftsDir, { recursive: true });
  for (const r of review.confirmed) writeAtomic(join(draftsDir, `${String(r.id).replace(/[^\w.-]/g, '_')}.md`), disclosureDraft(r, project));

  process.stderr.write(`disclosure-review: ${review.counts.confirmed} confirmed / ${review.counts.undetermined} undetermined / ${review.counts.dismissed} dismissed → ${outDir}\n`);
  process.exit(0);
}

if (isMainModule(import.meta.url)) main();
