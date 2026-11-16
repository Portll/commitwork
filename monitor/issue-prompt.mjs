// monitor/issue-prompt.mjs — the ONE composition of "here is a finding, triage it", shared by the
// CLI and the panel so the two never drift. Carries REAL SOURCE (±CONTEXT_LINES), which is why the
// panel may only serve it from the operator port. Zero dependencies; pure: same inputs ⇒ same bytes.

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJournalFile, readAdjudications, adjudicationsPath } from '../bin/lib/verdict-journal-core.mjs';
import { checkForIssue, selectExemplars, formatExemplarBlock } from '../lib/exemplar-select.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CW_ROOT = resolve(HERE, '..');

export const CONTEXT_LINES = 40; // around the anchor — enough for a taint path, small enough to read

// Segments, not prefixes: "..foo" at the root is inside, and Windows separators count.
function escapesRoot(root, target) {
  const rel = relative(root, target);
  if (rel === '' || isAbsolute(rel)) return true;
  return rel.split(/[\\/]/)[0] === '..';
}

/**
 * Source window around the anchor, or null — an unresolvable location is a real state, and the
 * prompt says "(source unavailable)" rather than pretending it read something. An anchor that
 * resolves outside the root is refused, and the refusal is stated in the prompt.
 */
export function codeContext(issue, { root = CW_ROOT } = {}) {
  const a = issue && issue.anchor;
  if (!a || typeof a.file !== 'string' || !a.file) return null;
  if (!Number.isInteger(a.line) || a.line < 1) return null;
  const p = isAbsolute(a.file) ? resolve(a.file) : resolve(root, a.file);
  if (escapesRoot(resolve(root), p)) {
    return { file: a.file, excerpt: null, refused: 'path resolves outside the repository root' };
  }
  if (!existsSync(p)) return null;
  let realRoot, real;
  try {
    realRoot = realpathSync(root);
    real = realpathSync(p);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    return { file: a.file, excerpt: null, refused: `could not resolve the path (${e.code})` };
  }
  if (escapesRoot(realRoot, real)) {
    return { file: a.file, excerpt: null, refused: 'path is a link that resolves outside the repository root' };
  }
  let lines;
  try { lines = readFileSync(real, 'utf8').split('\n'); }
  catch { return null; }
  const from = Math.max(0, a.line - 1 - CONTEXT_LINES / 2);
  const to = Math.min(lines.length, a.line + CONTEXT_LINES / 2);
  return {
    file: a.file,
    excerpt: lines.slice(from, to).map((l, i) => `${from + i + 1}${from + i + 1 === a.line ? ' >>' : '  '} ${l}`).join('\n'),
  };
}

/**
 * Exemplars from the finding-adjudication ledger, or null — an enhancement, not a precondition;
 * an issue must still triage cleanly with zero adjudication history.
 */
function exemplarsFor(issue) {
  const check = checkForIssue(issue);
  if (!check) return null;
  let records;
  try { records = readAdjudications().records; }
  catch { return null; }
  return formatExemplarBlock(selectExemplars(records, { check }));
}

/** The triage prompt. The answer format is FRONT-LOADED — a truncated reply must still carry VERDICT. */
export function composeIssuePrompt(issue, { root = CW_ROOT } = {}) {
  const ctx = codeContext(issue, { root });
  const sourceBlock = !ctx
    ? '(source unavailable)'
    : ctx.refused
      ? `(source refused: ${ctx.refused})`
      : `Source (the flagged line is marked >>):\n\`\`\`js\n${ctx.excerpt}\n\`\`\``;
  const src = issue.source || {};
  // After the check-context section, before the front-loaded answer block; absent-not-broken
  const exemplarBlock = exemplarsFor(issue);
  return [
    'You are triaging one static-analysis finding in a zero-dependency Node.js codebase.',
    '',
    `Rule: ${src.rule || '(unnamed)'}   Severity: ${issue.severity}   Scanner: ${src.tool}`,
    `Location: ${issue.anchor ? `${issue.anchor.file}:${issue.anchor.line}` : '(no location recorded)'}`,
    issue.body ? `Scanner message: ${issue.body}` : '',
    '',
    sourceBlock,
    '',
    ...(exemplarBlock ? [exemplarBlock, ''] : []),
    'Answer in this exact shape. Put VERDICT on the FIRST line, before any reasoning:',
    'VERDICT: one of real-vulnerability | needs-context | false-positive | already-mitigated',
    'CONFIDENCE: high | medium | low',
    'WHY: two sentences, naming the source->sink path if there is one.',
    'FIX: the concrete change, or "none needed" — a diff-shaped suggestion if you can.',
    '',
    'Be honest about uncertainty. Saying "needs-context" is more useful than a confident guess:',
    'this goes into an audit trail a human reads, and a wrong confident answer costs more than',
    'an admitted unknown.',
  ].filter(Boolean).join('\n');
}
