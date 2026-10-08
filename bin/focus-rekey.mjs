#!/usr/bin/env node
// focus-rekey — give the historical gate-focus records the session they watched.
//
// Registry WP3 prerequisite (2). 134 of the first 139 gate-focus records carry a `session` that is
// cksum(PWD|USER|hour): the hook read an env var the harness never set, so the key identifies a
// directory-hour, not a session, and a rater cannot find the transcript to judge. The journal is
// hash-chained and append-only, so the records are NOT rewritten. This writes a separate re-key
// ledger, one row per record, saying which transcript the firing joins to and HOW — and, on a tie
// or a miss, saying that instead of guessing.
//
// THE JOIN. A UserPromptSubmit hook fires when a prompt is submitted, and the transcript records
// that prompt as a `type:"user"` line with a millisecond timestamp. A firing at `at` in repo R joins
// to the transcript whose cwd basename is R and which holds a user line within `window` ms of
// `at`. Exactly one candidate is a re-key; zero is `no-transcript`; more than one is `tie` and is
// dropped, not picked — two sessions in one directory can submit in the same second, and a guessed
// key would be a confident wrong session (M1).
//
// Records already keyed on a real session (8 hex, matching a transcript) are re-keyed as
// `already-session` with candidates:1 for completeness, so the ledger covers the whole population.
//
// Env (call time): CW_VERDICT_DIR (journal dir), CW_TRANSCRIPT_ROOT (default ~/.claude/projects),
// CW_FOCUS_REKEY_WINDOW_MS (default 3000).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { readJournal, appendRecord } from './lib/verdict-journal-core.mjs';

const GATE = 'gate-focus';
const transcriptRoot = () => process.env.CW_TRANSCRIPT_ROOT || join(homedir(), '.claude', 'projects');
// 1000 ms, from a sweep over the live corpus on 2026-09-11 (143 records, 286 transcripts):
//   300 ms → 127 joined · 5 tie · 11 no-transcript      700 ms → 130 · 9 · 4
//   1000 ms → 129 · 10 · 4                               1500 ms → 128 · 12 · 3
//   3000 ms → 95 · 47 · 1                                5000 ms → 69 · 74 · 0
// The hook fires a few hundred ms before the transcript line lands; past ~1 s the ties are other
// sessions' unrelated prompts in the same directory, not ambiguity about this one. The nudge
// witness (a bare-nudge prompt at the instant) breaks a tie when it can, but cannot be required:
// the streak DECAYS rather than resets, so a firing can sit on a real instruction.
const windowMs = () => Number(process.env.CW_FOCUS_REKEY_WINDOW_MS) || 1000;
export const rekeyPath = (dir) => join(dir || process.env.CW_VERDICT_DIR || join(process.cwd(), '.claude', 'verdicts'), 'gate-focus-rekey.jsonl');

/**
 * Index every transcript's user-prompt timestamps. Regex over the line, not JSON.parse of every
 * line — the corpus is hundreds of MB and only three fields matter. Returns
 * [{ file, session, repo, times:number[] }].
 */
export function indexTranscripts(root = transcriptRoot()) {
  const out = [];
  let dirs = [];
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(root, d.name)); }
  catch (e) { if (e.code === 'ENOENT') return out; throw e; }
  for (const d of dirs) {
    let files = [];
    try { files = readdirSync(d).filter((n) => n.endsWith('.jsonl')); } catch { continue; }
    for (const n of files) {
      const file = join(d, n);
      let text;
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      const times = [];
      const nudges = [];   // timestamps of prompts that are BARE NUDGES — the hook's own trigger
      let repo = null;
      let session = null;
      for (const line of text.split('\n')) {
        if (!line.includes('"type":"user"')) continue;
        // Only PROMPTS join. A tool result is a `type:"user"` line too, and joining on one would
        // key a firing to whichever session's tool happened to return in that second.
        if (promptText(line) === null) continue;
        const ts = /"timestamp":"([^"]+)"/.exec(line);
        if (!ts) continue;
        const t = Date.parse(ts[1]);
        if (!Number.isFinite(t)) continue;
        times.push(t);
        if (isNudgeLine(line)) nudges.push(t);
        if (!repo) { const c = /"cwd":"([^"]+)"/.exec(line); if (c) repo = basename(c[1]); }
        if (!session) { const s = /"sessionId":"([0-9a-f-]{36})"/.exec(line); if (s) session = s[1]; }
      }
      if (!times.length) continue;
      times.sort((a, b) => a - b);
      nudges.sort((a, b) => a - b);
      out.push({ file, session: session || n.replace(/\.jsonl$/, ''), repo, times, nudges });
    }
  }
  return out;
}

// The hook's nudge list, verbatim from ~/.claude/hooks/get-focused.sh, so the second witness asks
// the same question the sensor asked: was THIS prompt a bare nudge? A human prompt is a string
// `content`; tool results are arrays and never match.
const NUDGES = new Set(['continue', 'carry on', 'go on', 'next', 'and?', 'and', '?', '??', '???', 'go', 'proceed', 'keep going', 'more']);
/**
 * The text of a user PROMPT on a transcript line, or null when the line is not a prompt.
 * Anchored on the message's own role key: a tool result nested in an array also carries a
 * `content` key, and an unanchored match read one as the prompt on the first run of the test.
 * A prompt's content is a string, or — measured on the live corpus, where the first batch of
 * re-keyed nudges all had this shape — a list of text blocks `[{"type":"text","text":"continue"}]`.
 */
export function promptText(line) {
  const s = /"role":"user","content":"((?:[^"\\]|\\.){0,400})"/.exec(line);
  if (s) return s[1].replace(/\\n/g, ' ');
  const l = /"role":"user","content":\[\{"type":"text","text":"((?:[^"\\]|\\.){0,400})"/.exec(line);
  if (l) return l[1].replace(/\\n/g, ' ');
  return null;
}
export function isNudgeLine(line) {
  const text = promptText(line);
  if (text === null) return false;
  const norm = text.toLowerCase().trim().replace(/[.!]+$/, '');
  return NUDGES.has(norm) || /^\?+$/.test(norm);
}

/** Does this transcript hold a user prompt within `w` ms of `t`? Binary search on sorted times. */
function hasPromptNear(times, t, w) {
  let lo = 0; let hi = times.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t - w) lo = mid + 1;
    else if (times[mid] > t + w) hi = mid - 1;
    else return true;
  }
  return false;
}

/** Re-key one record against the index. Pure. */
export function rekeyRecord(rec, index, { window = windowMs() } = {}) {
  const t = Date.parse(rec.at);
  const base = { recordAt: rec.at, ...(rec.pid ? { recordPid: rec.pid } : {}), recordSession: rec.session ?? null, repo: rec.repo ?? null };
  if (!Number.isFinite(t)) return { ...base, how: 'unparseable-at', session: null, candidates: 0 };
  const already = typeof rec.session === 'string' && /^[0-9a-f]{8}$/.test(rec.session)
    && index.find((x) => x.session.startsWith(rec.session));
  if (already) return { ...base, how: 'already-session', session: rec.session, transcript: basename(already.file), candidates: 1 };
  const pool = rec.repo ? index.filter((x) => x.repo === rec.repo) : index;
  const hits = pool.filter((x) => hasPromptNear(x.times, t, window));
  if (hits.length === 1) return { ...base, how: 'timestamp-join', window, session: hits[0].session.slice(0, 8), transcript: basename(hits[0].file), candidates: 1 };
  if (hits.length === 0) return { ...base, how: 'no-transcript', window, session: null, candidates: 0 };
  // SECOND WITNESS on a tie: the sensor fired on a bare nudge, so the prompt at that instant in
  // the watched transcript IS a nudge. Sessions whose prompt in the window was a real instruction
  // drop out. Exactly one left is a join with two witnesses; still several is a genuine tie.
  const nudged = hits.filter((x) => hasPromptNear(x.nudges || [], t, window));
  if (nudged.length === 1) return { ...base, how: 'timestamp-join+nudge', window, session: nudged[0].session.slice(0, 8), transcript: basename(nudged[0].file), candidates: hits.length, nudgeCandidates: 1 };
  return { ...base, how: 'tie', window, session: null, candidates: hits.length, nudgeCandidates: nudged.length, tied: (nudged.length ? nudged : hits).map((h) => h.session.slice(0, 8)) };
}

/** The current re-key for each recordAt: the LAST row wins, so a re-run with a wider window supersedes. */
export function readRekeys(dir) {
  const p = rekeyPath(dir);
  const map = new Map();
  if (!existsSync(p)) return map;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.kind === 'focus-rekey') map.set(r.recordAt, r); } catch { /* torn line: skipped, counted by the journal reader elsewhere */ }
  }
  return map;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = process.env.CW_VERDICT_DIR;
  const { records } = readJournal(GATE, { dir });
  const firings = records.filter((r) => r.verdict === 'refocus-fired' || r.verdict === 'state-unreadable');
  const index = indexTranscripts();
  const existing = readRekeys(dir);
  const results = firings.map((r) => rekeyRecord(r, index));
  const counts = {};
  for (const r of results) counts[r.how] = (counts[r.how] || 0) + 1;
  console.log(`focus-rekey: ${firings.length} record(s) against ${index.length} transcript(s) — ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  if (args.includes('--json')) console.log(JSON.stringify(results, null, 2));
  if (args.includes('--write')) {
    let written = 0;
    for (const r of results) {
      const prev = existing.get(r.recordAt);
      if (prev && prev.how === r.how && prev.session === r.session) continue;   // idempotent
      const w = appendRecord(rekeyPath(dir), { v: 1, kind: 'focus-rekey', at: new Date().toISOString(), gate: GATE, ...r });
      if (!w.ok) { console.error(`focus-rekey: write FAILED (${w.error})`); process.exit(1); }
      written++;
    }
    console.log(`focus-rekey: ${written} row(s) appended to ${rekeyPath(dir)}`);
  } else {
    console.log('focus-rekey: dry run — add --write to append the re-key ledger (the journal itself is never rewritten)');
  }
  process.exit(0);
}
