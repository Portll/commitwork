#!/usr/bin/env node
// bin/turn-gate.mjs — run the turn gate over a session transcript.
//
// The decisions are in bin/lib/turn-gate-core.mjs and the reading in
// bin/lib/turn-recorder-core.mjs; this file is the entry point that makes them runnable, which is
// the whole reason it exists. A judgement library with no way to invoke it is a capability on
// paper: it never runs, so it is never wrong, so nobody ever finds out it was.
//
// usage:
//   node bin/turn-gate.mjs --transcript <path>        assess one transcript
//   node bin/turn-gate.mjs --session <id>             resolve <id>.jsonl in the project transcript dir
//   node bin/turn-gate.mjs --all [--limit N]          every transcript in that dir, newest first
//   node bin/turn-gate.mjs … --json
//   node bin/turn-gate.mjs … --policy '{"reportLoopRun":4}'
//   node bin/turn-gate.mjs --hook                     Stop hook: transcript_path from stdin, journal, exit 0
//
// exit: 0 every assessed session passed · 1 at least one BLOCK · 2 usage error, or nothing could
//       be assessed. A run that reached no verdict exits 2 and never 0 — "I could not tell" and
//       "it was fine" are different answers and only one of them is a pass.
//       --hook is record-only and exits 0 on every path: blocking waits on adjudicated firings.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseTranscript, foldTurns, tokenSummary } from './lib/turn-recorder-core.mjs';
import { assess, DEFAULT_POLICY } from './lib/turn-gate-core.mjs';
import { journal } from './lib/verdict-journal-core.mjs';
import { sessionFacts, assignedTouched, declaredBlockers } from './lib/assigned-touched.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { transcriptDir, missingTranscriptDir } from './lib/transcript-dir.mjs';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const has = (n) => argv.includes(n);

/** One transcript → an assessment, or a stated reason it could not be read. */
export function assessFile(path, policy, sessionId = null) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    // ENOENT is absence; anything else is a broken reader. Neither is a pass, and they are
    // reported apart so "no such session" cannot be confused with "could not open it".
    const reason = e && e.code === 'ENOENT' ? 'absent' : `unreadable (${e?.code || e})`;
    return { file: path, outcome: 'unknown', reason: `transcript is ${reason}`, verdicts: [], tokens: null };
  }
  const { steps, unparseable } = parseTranscript(text);
  const turns = foldTurns(steps);
  const result = assess({ turns, unparseable, steps: steps.length, ledger: ledgerFor(sessionId, turns) }, policy);
  return { file: path, ...result, tokens: tokenSummary(turns) };
}

function listTranscripts(dir, limit) {
  let names;
  try {
    names = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch (e) {
    return { ok: false, reason: e && e.code === 'ENOENT' ? 'absent' : `unreadable (${e?.code || e})` };
  }
  const withTime = names.map((f) => {
    const p = join(dir, f);
    try { return { p, mtime: statSync(p).mtimeMs }; } catch { return { p, mtime: 0 }; }
  }).sort((a, b) => b.mtime - a.mtime);
  return { ok: true, files: withTime.slice(0, limit || withTime.length).map((x) => x.p) };
}

function render(r) {
  const mark = r.outcome === 'pass' ? 'PASS ' : r.outcome === 'block' ? 'BLOCK' : '?????';
  console.log(`${mark}  ${basename(r.file)} — ${r.reason}`);
  if (r.vetoedBy) console.log(`       vetoed by ${r.vetoedBy}; the rules below still ran and are shown so unreadable cannot look clean`);
  for (const v of r.verdicts || []) {
    if (v.verdict === 'pass' && r.outcome === 'pass') continue;   // only the interesting ones
    console.log(`       ${v.verdict.toUpperCase().padEnd(7)} ${v.rule} — ${v.reason}`);
    // Array-guarded on purpose: a rule whose evidence names `turns` something other than a list of
    // turns must degrade to printing nothing, not throw. The renderer is the last thing between a
    // verdict and the operator, and it must not be able to convert a report into a crash.
    const offenders = Array.isArray(v.evidence?.turns) ? v.evidence.turns : [];
    for (const t of offenders.slice(0, 3)) {
      console.log(`               turn ${t.openedByUuid}: ${String(t.text ?? '').replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  const t = r.tokens;
  if (t && t.turns > 0) {
    const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
    console.log(`       ${t.turns} model turn(s), ${t.syntheticTurns} harness · output ${t.totals.output ?? 'unknown'} · rumination ${pct(t.ruminationShare)} · cache ${pct(t.cacheHitRatio)}`);
  }
}

/**
 * What gets written to the ledger — and, more importantly, what does not.
 *
 * THE TRANSCRIPT TEXT NEVER GOES IN. The evidence for an unwitnessed claim is the sentence the
 * model wrote, and a session's prose can contain anything it was working on: credentials it was
 * rotating, customer data, private source. The ledger is durable, replicated to a sidecar repo and
 * read by tooling that was never designed to hold secrets, so journalling the quoted text would
 * turn a behavioural gate into an exfiltration path with a retention policy. Turn uuids and rule
 * names are enough to go back to the transcript, which is access-controlled where it already lives.
 *
 * The file is recorded by BASENAME for the same reason: a full path carries the operator's home
 * directory and the project layout.
 */
export function ledgerRecord(r) {
  return {
    subject: basename(r.file),
    outcome: r.outcome,
    reason: r.reason,
    vetoedBy: r.vetoedBy ?? null,
    rules: (r.verdicts || []).map((v) => ({
      rule: v.rule,
      verdict: v.verdict,
      // Counts and uuids only. No `text`, ever.
      count: v.evidence?.count ?? v.evidence?.modelTurns ?? null,
      turns: Array.isArray(v.evidence?.turns) ? v.evidence.turns.map((t) => t.openedByUuid) : null,
    })),
    policy: r.policy ?? null,
    tokens: r.tokens ? { turns: r.tokens.turns, output: r.tokens.totals?.output ?? null, ruminationShare: r.tokens.ruminationShare } : null,
  };
}

/**
 * The task facts for the stranded-assignment rule, or undefined when they cannot be established.
 *
 * Undefined is the honest answer for a transcript-only run: an empty assigned set would read as
 * "nothing was assigned", which is the false clean the rule exists to catch.
 */
function ledgerFor(sessionId, turns) {
  if (!sessionId) return undefined;
  const facts = sessionFacts(sessionId);
  if (facts === undefined) return { assigned: undefined, touched: undefined };
  if (!facts || !facts.planId || !facts.startedAt) return { assigned: null, touched: [] };
  const at = assignedTouched(facts.planId, facts.startedAt);
  if (at === undefined) return { assigned: undefined, touched: undefined };
  if (at === null) return { assigned: null, touched: [] };
  const last = [...turns].reverse().find((t) => t?.modelAuthored !== false && String(t.text || '').trim());
  return { ...at, planId: facts.planId, blockers: declaredBlockers(last?.text, at.assigned.map((t) => t.id)) };
}

function main() {
  let policy = DEFAULT_POLICY;
  const raw = flag('--policy');
  if (raw) {
    try {
      policy = { ...DEFAULT_POLICY, ...JSON.parse(raw) };
    } catch (e) {
      // A policy that did not parse must not silently fall back to the defaults: the caller asked
      // for different thresholds and would read the result as though they had been applied.
      console.error(`turn-gate: --policy is not valid JSON (${e?.message || e}) — refusing to run under thresholds you did not choose`);
      return 2;
    }
  }

  const targets = [];
  const hook = has('--hook');
  let hookSession = null;
  if (hook) {
    let payload = null;
    try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { /* reported below */ }
    if (!payload?.transcript_path) {
      console.error('turn-gate --hook: no transcript_path in the Stop payload — nothing assessed, not a pass');
      return 0;
    }
    targets.push(payload.transcript_path);
    // CLAUDE_SESSION_ID is never set in a hook's environment; the payload is the only carrier.
    hookSession = typeof payload.session_id === 'string' ? payload.session_id : null;
  }
  const one = flag('--transcript');
  const sess = flag('--session');
  if (one) targets.push(one);
  if (sess) targets.push(join(transcriptDir(), `${sess}.jsonl`));
  if (has('--all')) {
    const listed = listTranscripts(transcriptDir(), Number(flag('--limit')) || 0);
    if (!listed.ok) {
      console.error(listed.reason === 'absent'
        ? `turn-gate: ${missingTranscriptDir(transcriptDir())} — nothing assessed, which is not a pass`
        : `turn-gate: transcript directory ${transcriptDir()} is ${listed.reason} — nothing assessed, which is not a pass`);
      return 2;
    }
    targets.push(...listed.files);
  }
  if (targets.length === 0) {
    console.error('usage: node bin/turn-gate.mjs --transcript <path> | --session <id> | --all [--limit N] [--json] [--policy <json>]');
    return 2;
  }

  const results = targets.map((t) => assessFile(t, policy, hookSession));
  if (has('--json') && !hook) {
    console.log(JSON.stringify({ generated: process.env.CW_NOW || new Date().toISOString(), policy, results }, null, 2));
  } else if (!hook) {
    for (const r of results) render(r);
    const n = (o) => results.filter((r) => r.outcome === o).length;
    console.log(`\n${results.length} assessed — ${n('pass')} pass, ${n('block')} block, ${n('unknown')} undetermined`);
  }

  // DRY BY DEFAULT, mirroring bin/canary-harness.mjs --write. A tool that writes to the live ledger
  // merely by being run cannot be explored, and this one is new enough that people will run it to
  // see what it does. Writing is a separate, typed decision.
  if (has('--record') || hook) {
    let written = 0;
    const failures = [];
    for (const r of results) {
      const res = journal('turn-gate', ledgerRecord(r), { session: hookSession || process.env.CLAUDE_SESSION_ID || null });
      // A ledger write that failed is REPORTED. Silently losing the record would leave a gate whose
      // history is quietly shorter than its run count, which is the durability defect this
      // repository has recorded more than once.
      if (res?.error) failures.push(`${basename(r.file)}: ${res.error}`); else written += 1;
    }
    if (!hook || failures.length) console.error(`turn-gate: journalled ${written}/${results.length} assessment(s)`
      + (failures.length ? ` — ${failures.length} FAILED: ${failures.join('; ')}` : ''));
    if (failures.length && !hook) return 2;
  }

  // Record-only: an unadjudicated behavioural gate does not get to hold a session's turn.
  if (hook) return 0;
  if (results.some((r) => r.outcome === 'block')) return 1;
  if (results.every((r) => r.outcome === 'unknown')) return 2;
  return 0;
}

// AN INTERNAL ERROR IS NOT A FINDING. An uncaught throw exits 1, which is this command's code for
// "a session was blocked" — so a crash in the renderer reported itself as a verdict about somebody's
// work, and did exactly that during development. Anything unexpected exits 2 (could not determine)
// and says so on stderr. The gate is allowed to fail; it is not allowed to fail as an accusation.
if (isMainModule(import.meta.url)) {
  let code;
  try {
    code = main();
  } catch (e) {
    console.error(`turn-gate: internal error, no verdict reached — ${e?.stack || e}`);
    code = 2;
  }
  process.exit(code);
}
