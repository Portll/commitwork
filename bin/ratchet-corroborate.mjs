#!/usr/bin/env node
// bin/ratchet-corroborate.mjs — corroborate gate-ratchet's `steady` stratum against the tracked
// queue.json artifact at each record's own commit. `steady` is a working-tree claim and this
// re-derives the COMMITTED tree, so it corroborates or refutes only — never writes a true-clean
// or any adjudication (proposals only). `drifted` is a live scan and is reported as unchecked.
//
//   node bin/ratchet-corroborate.mjs            readable report
//   node bin/ratchet-corroborate.mjs --json     machine-readable
import { readJournal } from './lib/verdict-journal-core.mjs';
import { rethrowIfBugParsing } from './rethrow.mjs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { auditDirFor } from '../monitor/store-paths.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE_PATH = () => process.env.CW_RATCHET_QUEUE_PATH || join(auditDirFor(REPO), 'queue.json');

/** Same coercion the gate itself uses: an array's length, a number as-is, anything else UNKNOWN. */
export const count = (v) => (Array.isArray(v) ? v.length : typeof v === 'number' ? v : null);

/** The tracked artifact as it stood at one commit. null on any failure — never an assumed zero. */
export function queueAt(sha, { cwd = REPO } = {}) {
  // Shape-check the sha before git sees it: an argv element starting with `-` parses as a flag,
  // and these journals live in a tree untrusted agents edit.
  if (!/^[0-9a-f]{40}$/.test(String(sha))) {
    return { ok: false, reason: `refusing to resolve ${JSON.stringify(String(sha).slice(0, 40))} — not a 40-hex sha, so it is not something git should be handed` };
  }
  try {
    const raw = execFileSync('git', ['show', `${sha}:${QUEUE_PATH()}`], {
      cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000,
    });
    const j = JSON.parse(raw);
    const c = (j && j.conflicts) || null;
    if (!c) return { ok: false, reason: 'no conflicts block in the artifact at that commit' };
    return { ok: true, conflicts: count(c.withinEntryConflicts), unreviewed: count(c.unreviewedEntries) };
  } catch (e) {
    // A missing commit or a corrupt artifact is expected here; a misspelt function is not.
    rethrowIfBugParsing(e);
    const why = String((e && (e.stderr || e.message)) || 'unknown').split('\n')[0].slice(0, 160);
    return { ok: false, reason: `artifact unreadable at ${String(sha).slice(0, 8)} (${why})` };
  }
}

/**
 * Compare every anchored `steady` record against the tracked artifact at its own commit.
 * `corroborated` is never promoted to true-clean; `unanchored` (no headSha) is unrecoverable.
 */
export function corroborate({ dir } = {}) {
  const j = readJournal('gate-ratchet', dir ? { dir } : {});
  const records = j.records.filter((r) => r && r.verdict === 'steady');
  const out = {
    steady: records.length,
    anchored: 0,
    unanchored: 0,
    corroborated: 0,
    refuted: 0,
    unreadable: 0,
    unmeasurable: 0,
    // `drifted` is a live tree scan — named as unchecked, never silently folded in.
    metricsChecked: ['conflicts', 'unreviewed'],
    metricsUnchecked: ['drifted'],
    candidates: [],
  };
  const cache = new Map();
  for (const r of records) {
    if (!r.headSha) { out.unanchored++; continue; }
    out.anchored++;
    if (!cache.has(r.headSha)) cache.set(r.headSha, queueAt(r.headSha));
    const q = cache.get(r.headSha);
    if (!q.ok) { out.unreadable++; continue; }
    const claimed = { conflicts: r.metrics?.conflicts ?? null, unreviewed: r.metrics?.unreviewed ?? null };
    // A record with no metrics made no claim — unmeasurable, never a refutation.
    if (claimed.conflicts === null && claimed.unreviewed === null) { out.unmeasurable++; continue; }
    if (claimed.conflicts === q.conflicts && claimed.unreviewed === q.unreviewed) { out.corroborated++; continue; }
    out.refuted++;
    out.candidates.push({
      at: r.at, headSha: r.headSha, claimed, artifact: { conflicts: q.conflicts, unreviewed: q.unreviewed },
      why: 'the gate recorded metrics that disagree with the tracked artifact at its own commit — a CANDIDATE for human adjudication, not a verdict',
    });
  }
  out.distinctCommits = cache.size;
  // The disclaimer travels ON the payload — a bare corroborated count reads as verified-clean.
  out.corroboratedMeans = 'the tracked artifact at the record\'s own commit agrees with 2 of the 3 '
    + 'metrics the gate recorded. It is NOT a true-clean: `steady` is a working-tree claim, `drifted` '
    + 'is unchecked, and a gate agreeing with an artifact they both derive from is weak independence.';
  // An empty corpus must not render as a clean one.
  out.state = out.steady === 0 ? 'no-steady-records'
    : out.anchored === 0 ? 'none-anchored'
      : out.refuted > 0 ? 'refutations-found' : 'no-refutation-found';
  return out;
}

function main(argv) {
  const r = corroborate();
  if (argv.includes('--json')) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); return 0; }
  const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');
  process.stdout.write([
    'gate-ratchet clean stratum — corroboration against the tracked artifact (proposals only; writes nothing)',
    `  steady records          ${r.steady}`,
    `  anchored (have headSha) ${r.anchored}  (${pct(r.anchored, r.steady)}) across ${r.distinctCommits} commit(s)`,
    `  UNANCHORED              ${r.unanchored}  — no headSha, so no procedure can ever re-derive these`,
    `  corroborated            ${r.corroborated}`,
    `  refuted (candidates)    ${r.refuted}`,
    `  artifact unreadable     ${r.unreadable}`,
    `  unmeasurable            ${r.unmeasurable}  — the record carried no metrics, so it made no claim to check`,
    '',
    `  checked:   ${r.metricsChecked.join(', ')}`,
    `  UNCHECKED: ${r.metricsUnchecked.join(', ')} — a live tree scan, not derivable from a tracked artifact`,
    '',
    r.state === 'no-steady-records'
      ? '  NO STEADY RECORDS AT ALL. Nothing was examined, so nothing is claimed — this is not a clean result.'
      : r.state === 'none-anchored'
        ? `  NONE of the ${r.steady} steady records carry a headSha, so no procedure can reach any of them. Nothing is claimed.`
        : r.refuted
          ? '  CANDIDATES (a human decides; this tool does not):'
          : '  No refutation found. That is NOT a clean bill of health: it covers 2 of 3 metrics, over the',
    ...(r.state === 'no-steady-records' || r.state === 'none-anchored' ? [] : r.refuted
      ? r.candidates.slice(0, 10).map((c) => `    ${c.at}  ${c.headSha.slice(0, 8)}  gate ${JSON.stringify(c.claimed)} vs artifact ${JSON.stringify(c.artifact)}`)
      : ['  anchored minority of steady records, and agreement between a gate and an artifact they both',
        '  derive from is weak independence. It is corroboration — the first evidence gathered about this',
        '  stratum — and it is not a true-clean.']),
  ].join('\n') + '\n');
  return 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
