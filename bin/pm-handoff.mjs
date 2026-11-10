#!/usr/bin/env node
// bin/pm-handoff.mjs — regenerate a COMPACT, reload-ready handoff from a disclosure review, for the
// interactive project-management session that drives the orchestrator and clears its context on a
// token ceiling. On `/clear`, the PM session pastes this back to resume cold: it carries the state
// (what is confirmed and in what order, what is still undetermined, what was dismissed) WITHOUT the
// per-finding evidence that blows the budget. Deterministic given the same review (honours CW_NOW).
//
//   node bin/pm-handoff.mjs --review <review.json> [--top N] [--notes <file>] [--out <file>]
//
// --top N   how many confirmed items to spell out (default 12); the rest are summarised as a count.
// Exit 0 on success; 1 on bad input.

import { readFileSync, writeFileSync } from 'node:fs';
import { nowISO } from '../lib/clock.mjs';

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const reviewPath = arg('review');
if (!reviewPath || reviewPath === true) { process.stderr.write('pm-handoff: --review <review.json> is required\n'); process.exit(1); }
let review;
try { review = JSON.parse(readFileSync(reviewPath, 'utf8')); } catch (e) { process.stderr.write(`pm-handoff: ${reviewPath} is not JSON: ${e.message}\n`); process.exit(1); }

const top = Number(arg('top', '12')) || 12;
const notesFile = arg('notes');
const notes = notesFile && notesFile !== true ? readFileSync(notesFile, 'utf8').trim() : null;
const axes = (r) => `${r.axes.severity}/${r.axes.urgency}/${r.axes.size}`;

const lines = [];
lines.push('# PM handoff — disclosure review (reload after /clear)', '');
lines.push(`Regenerated ${nowISO()} · source review ${review.generatedAt} · backend \`${review.backend}\``, '');
lines.push('## State');
lines.push(`- **${review.counts.confirmed} confirmed** (ordered), **${review.counts.undetermined} undetermined** (triage, do not close), **${review.counts.dismissed} dismissed** (of ${review.counts.total}).`);
lines.push('- `undetermined` is its OWN bucket: the judge could not confirm it. It is neither a pass nor a finding — re-judge or hand to a human, never silently drop.', '');

lines.push('## Confirmed — remediation order (work large/high first; the orchestrator sized each)');
review.confirmed.slice(0, top).forEach((r, i) => lines.push(`${i + 1}. **${r.id}** [${axes(r)}] — ${r.fix || 'fix: TBD'}`));
if (review.confirmed.length > top) lines.push(`…and ${review.confirmed.length - top} more confirmed items (see review.json).`);
if (!review.confirmed.length) lines.push('_none confirmed yet._');
lines.push('');

if (review.undetermined.length) {
  lines.push('## Undetermined — why each stalled (re-judge or escalate)');
  for (const r of review.undetermined.slice(0, top)) {
    const why = r.error ? `judge error: ${r.error}` : r.demotedToOpinion ? 'dismissal had nothing checkable' : `verdict ${r.verdict || 'none'}`;
    lines.push(`- **${r.id}** (claimed ${r.claimedSeverity ?? '—'}): ${why}`);
  }
  if (review.undetermined.length > top) lines.push(`…and ${review.undetermined.length - top} more.`);
  lines.push('');
}

lines.push('## How to resume');
lines.push('1. `node bin/disclosure-review.mjs --findings <file> --backend claude [--lens]` to (re)run the judge over findings.');
lines.push('2. Work the confirmed list top-down; each confirmed item carries the confinement a fix must add.');
lines.push('3. Re-judge the undetermined bucket with a second backend (`--backend model`, or a different model) before closing anything.');
lines.push('4. Regenerate this handoff (`node bin/pm-handoff.mjs --review <review.json>`) and `/clear` when the context nears its ceiling.', '');

if (notes) { lines.push('## Carried notes', '', notes, ''); }

const outFile = arg('out');
const text = lines.join('\n');
if (outFile && outFile !== true) { writeFileSync(outFile, text); process.stderr.write(`pm-handoff: wrote ${outFile}\n`); }
else process.stdout.write(text + '\n');
process.exit(0);
