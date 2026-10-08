#!/usr/bin/env node
/**
 * focus-journal.mjs — feed the W family (false progress) into the verdict ledger.
 *
 * The signal is get-focused.sh counting consecutive bare nudges ("continue", "?"). The sensor
 * records that it fired and the streak length; it does NOT classify (class stays null until
 * --adjudicate). Prompt text never reaches or is stored here; `repo` keeps populations separate.
 * Fail closed: an unreadable state file writes a `state-unreadable` record, never a streak of zero
 * (ENOENT is the only legitimately-absent case).
 *
 * Usage:
 *   focus-journal.mjs --from-state <path> [--repo <name>] [--session <id>]
 *   focus-journal.mjs --fire --streak <n> [--prompts <n>] [--repo <name>] [--session <id>]
 *   focus-journal.mjs --fire --state-unreadable   the hook could not parse its own state file
 *   focus-journal.mjs --tally [--json]
 *
 * Env: CW_VERDICT_DIR (journal dir), CW_NOW (pinned clock), CW_FOCUS_MIN_STREAK (default 2).
 * All read at call time.
 */
import { isMainModule } from '../lib/is-main.mjs';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { journal, readJournal, readAdjudications, adjudicationsPath, appendRecord, retractionsFrom } from './lib/verdict-journal-core.mjs';
import { readRekeys } from './focus-rekey.mjs';
import { headSha } from './head-sha.mjs';
import { measuredFromArtifact, measuredInProcess } from './measured.mjs';

const GATE = 'gate-focus';
// Truncate to match the touch ledger's session.slice(0, 8), or records can't be joined to touches.
const SESSION_WIDTH = 8;
const sessionKey = (s) => (s ? String(s).slice(0, SESSION_WIDTH) : null);
const minStreak = () => Number(process.env.CW_FOCUS_MIN_STREAK) || 2;

const argOf = (args, flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

/** Read the hook's state file. Three distinguishable outcomes; `absent` is a state, not a zero. */
export function readFocusState(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { state: 'absent', streak: null, prompts: null, raw: null };
    return { state: 'unreadable', detail: e.code || 'error', streak: null, prompts: null, raw: null };
  }
  // raw feeds measured.digest and rides along even on unparseable state, so identical corruption
  // digests equal — a run of blindness reads as one stuck state, not distinct failures.
  let doc;
  try { doc = JSON.parse(raw); } catch { return { state: 'unreadable', detail: 'unparseable', streak: null, prompts: null, raw }; }
  const streak = doc && typeof doc.nudgeStreak === 'number' && Number.isFinite(doc.nudgeStreak) ? doc.nudgeStreak : null;
  if (streak === null) return { state: 'unreadable', detail: 'no-streak-field', streak: null, prompts: null, raw };
  const prompts = typeof doc.prompts === 'number' && Number.isFinite(doc.prompts) ? doc.prompts : null;
  return { state: 'ok', streak, prompts, lastIso: typeof doc.lastIso === 'string' ? doc.lastIso : null, raw };
}

/** Build the record. Separated from the write; `class` stays null — the sensor never guesses it. */
export function focusRecord({ streak, prompts = null, repo = null, verdict = 'refocus-fired', detail = null }) {
  return {
    verdict,
    signal: 'bare-nudge',
    family: 'W',
    class: null,          // assigned by --adjudicate, never by the sensor
    streak: typeof streak === 'number' ? streak : null,
    prompts,
    repo,
    ...(detail ? { detail } : {}),
  };
}

function fire(record, session) {
  const w = journal(GATE, record, { session: sessionKey(session) });
  return w;
}

// headSha of the CWD, not this script's repo: the record must name the tree the session measured.
const provenanced = (record, measured) => ({ ...record, headSha: headSha(process.cwd()), measured });

export function tally(records, { judged = new Map(), abstained = new Set() } = {}) {
  // `other` counts unrecognised verdict kinds rather than dropping them from every total.
  // `judged` is recordAt → W class from the adjudications ledger; null means it could not be read,
  // and classified is then reported as unknown rather than zero. `abstained` are records a rater
  // looked at and declared unjudgeable — adjudicated, never classified.
  const out = { firings: 0, unreadable: 0, other: 0, maxStreak: 0, byRepo: {}, lastAt: null, classified: judged === null ? null : 0, falseAlarms: judged === null ? null : 0, abstained: abstained === null ? null : 0, byClass: {} };
  for (const r of records) {
    if (r.verdict === 'state-unreadable') { out.unreadable++; continue; }
    if (r.verdict !== 'refocus-fired') { out.other++; continue; }
    out.firings++;
    if (typeof r.streak === 'number' && r.streak > out.maxStreak) out.maxStreak = r.streak;
    const k = r.repo || '(unnamed)';
    out.byRepo[k] = (out.byRepo[k] || 0) + 1;
    const cls = r.class || (judged && judged.get(r.at)) || null;
    if (cls === 'none' && judged !== null) out.falseAlarms++;
    else if (cls && judged !== null) { out.classified++; out.byClass[cls] = (out.byClass[cls] || 0) + 1; }
    else if (abstained && abstained.has(r.at)) out.abstained++;
    if (!out.lastAt || String(r.at) > String(out.lastAt)) out.lastAt = r.at;
  }
  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
const isMain = isMainModule(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const session = argOf(args, '--session');
  const repo = argOf(args, '--repo') || basename(process.cwd());

  // ── --adjudicate: the class is a JUDGEMENT and enters here, never from the sensor ─────────────
  // Registry WP3 prerequisite (3). One appended kind:'adjudication' row in the shared adjudications
  // ledger, joined to the firing by recordAt. The rater must NOT be the session that was watched
  // (G12, self-adjudication): the watched session is the re-keyed one where a re-key exists (see
  // bin/focus-rekey.mjs), else the record's own key. A refusal names both. `--retract` withdraws a
  // judgement by the same join (D7), leaving both rows on disk.
  //   --adjudicate <recordAt> --class W1..W7 --by <session8> --reason "<what in the transcript>"
  //   --retract   <recordAt> --by <session8> --reason "<why>"
  //   --abstain   <recordAt> --by <session8> --reason "<why it cannot be judged>"
  // An abstention is a judgement that the record is not judgeable — the pre-fix corpus, whose
  // streak was POOLED across every session in a directory-hour, is the measured case. It counts
  // as adjudicated (looked at) and never as classified.
  const adjAt = argOf(args, '--adjudicate') || argOf(args, '--retract') || argOf(args, '--abstain');
  if (adjAt) {
    const retract = args.includes('--retract');
    const abstain = args.includes('--abstain');
    const cls = argOf(args, '--class');
    const by = String(argOf(args, '--by') || '').slice(0, 8);
    const reason = argOf(args, '--reason');
    // `--class none` is a judgement too: the rater read the turn and found no avoidance pattern —
    // a FALSE ALARM of the sensor, recorded with truth:'false-alarm' and no class. Without it every
    // judgement would be forced into a W row and the sensor's false-alarm rate would be unmeasurable.
    if (!by || !reason || (!retract && !abstain && !/^(W[1-7]|none)$/.test(String(cls)))) {
      console.error('usage: --adjudicate <recordAt> --class W1..W7|none --by <session8> --reason "<evidence>"  |  --abstain <recordAt> --by <session8> --reason "<why>"  |  --retract <recordAt> --by <session8> --reason "<why>"');
      process.exit(2);
    }
    let j;
    try { j = readJournal(GATE); } catch (e) { console.error(`gate-focus journal UNREADABLE (${e.code || 'error'})`); process.exit(1); }
    const rec = j.records.find((r) => r.at === adjAt);
    if (!rec) { console.error(`no gate-focus record at ${adjAt}`); process.exit(1); }
    const rekey = readRekeys()?.get(adjAt) || null;
    const watched = (rekey && rekey.session) || rec.session || null;
    if (watched && String(watched).slice(0, 8) === by) {
      console.error(`REFUSED: ${by} is the session that was watched (${rekey ? rekey.how : 'record key'}) — self-adjudication is G12. A different session judges this one.`);
      process.exit(3);
    }
    const common = { at: new Date().toISOString(), gate: GATE, recordAt: adjAt, ...(rec.pid ? { recordPid: rec.pid } : {}), recordSession: watched, ...(rekey ? { rekeyHow: rekey.how } : {}) };
    const row = retract
      ? { v: 1, kind: 'adjudication-retraction', ...common, reason, retractedBy: by, method: 'transcript-read' }
      : abstain
        ? { v: 1, kind: 'adjudication-abstention', ...common, reason, adjudicatedBy: by, method: 'transcript-read' }
        : { v: 1, kind: 'adjudication', ...common, class: cls === 'none' ? null : cls, truth: cls === 'none' ? 'false-alarm' : 'true-alarm', basis: reason, adjudicatedBy: by, method: 'transcript-read' };
    const w = appendRecord(adjudicationsPath(), row);
    if (!w.ok) { console.error(`adjudication write FAILED (${w.error})`); process.exit(1); }
    console.log(`gate-focus: ${retract ? 'retracted judgement on' : abstain ? 'abstained on' : `${cls} recorded for`} ${adjAt} (watched ${watched ?? 'unknown'}, by ${by}) → ${w.path}`);
    process.exit(0);
  }

  if (args.includes('--tally')) {
    let j;
    try { j = readJournal(GATE); }
    catch (e) { console.error(`gate-focus journal UNREADABLE (${e.code || 'error'}) — a tally cannot be computed, and unreadable is never zero`); process.exit(1); }
    // Judgements live in the adjudications ledger, joined by recordAt; a retraction withdraws one.
    let judged = new Map();
    let abstained = new Set();
    try {
      const a = readAdjudications().records.filter((r) => r.gate === GATE);
      const retracted = retractionsFrom(a);
      // retractionsFrom().has takes the JUDGEMENT record (gate + recordAt + method), not a key.
      for (const r of a) {
        if (r.kind === 'adjudication' && !retracted.has(r)) judged.set(r.recordAt, r.class || 'none');
        if (r.kind === 'adjudication-abstention' && !retracted.has(r)) abstained.add(r.recordAt);
      }
    } catch { judged = null; abstained = null; }
    const t = tally(j.records, { judged, abstained });
    if (args.includes('--json')) { console.log(JSON.stringify({ absent: j.absent, ...t, torn: j.torn, chain: j.chain }, null, 2)); process.exit(0); }
    if (j.absent) {
      console.log('gate-focus: ABSENT — the sensor has never written. Not "no avoidance": no measurement.');
      process.exit(0);
    }
    console.log(`gate-focus: ${t.firings} firing(s), max streak ${t.maxStreak}, last ${t.lastAt || 'n/a'}`);
    for (const [k, n] of Object.entries(t.byRepo).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
    if (t.unreadable) console.log(`  state-unreadable: ${t.unreadable} (the sensor could not see — counted, never silent)`);
    console.log(t.firings
      ? (t.classified === null
        ? `  adjudications ledger UNREADABLE — how many of ${t.firings} carry a W class is unknown, not zero`
        : `  ${t.classified}/${t.firings} carry a W class${t.classified ? ` (${Object.entries(t.byClass).sort().map(([k, v]) => `${k} ${v}`).join(', ')})` : ''} · ${t.falseAlarms} judged false alarms · ${t.abstained ?? '?'} abstained (looked at, unjudgeable) · ${t.firings - t.classified - t.falseAlarms - (t.abstained || 0)} UNADJUDICATED, which is unknown, not clean`)
      : '  no firings recorded; with 0 adjudications the base rate is UNKNOWN');
    process.exit(0);
  }

  const statePath = argOf(args, '--from-state');
  if (statePath) {
    const s = readFocusState(statePath);
    if (s.state === 'absent') process.exit(3);                     // never fired in this session yet
    if (s.state === 'unreadable') {
      // ok:false — an attempted-and-failed measurement is evidence; raw bytes still digest.
      fire(provenanced(focusRecord({ streak: null, repo, verdict: 'state-unreadable', detail: s.detail }),
        measuredFromArtifact(statePath, s.raw, { ok: false })), session);
      console.error(`focus state UNREADABLE (${s.detail}) — recorded as its own state, not as quiet`);
      process.exit(1);
    }
    if (s.streak < minStreak()) process.exit(3);                   // below threshold: no alarm, no record
    const w = fire(provenanced(focusRecord({ streak: s.streak, prompts: s.prompts, repo }),
      measuredFromArtifact(statePath, s.raw)), session);
    if (!w.ok) { console.error(`gate-focus write FAILED (${w.error})`); process.exit(1); }
    console.log(`gate-focus: refocus-fired (streak ${s.streak}) → ${w.path}`);
    process.exit(0);
  }

  if (args.includes('--fire')) {
    // --state-unreadable is the hook's path for turning sensor blindness into a record.
    if (args.includes('--state-unreadable')) {
      // prompts survives an unreadable state file and distinguishes a run of blindness from one corrupt write.
      const promptsSeen = Number(argOf(args, '--prompts'));
      const w = fire(provenanced(focusRecord({
        streak: null, repo, verdict: 'state-unreadable', detail: 'hook-unparseable',
        prompts: Number.isFinite(promptsSeen) ? promptsSeen : null,
      }), measuredInProcess('argv:get-focused-hook',
        JSON.stringify({ stateUnreadable: true, prompts: Number.isFinite(promptsSeen) ? promptsSeen : null }),
        { ok: false, detail: 'state file unreadable at the hook' })), session);
      if (!w.ok) { console.error(`gate-focus write FAILED (${w.error})`); process.exit(1); }
      console.error('focus state UNREADABLE at the hook — recorded as its own state, not as quiet');
      process.exit(1);
    }
    const streak = Number(argOf(args, '--streak'));
    if (!Number.isFinite(streak)) { console.error('usage: --fire --streak <n> [--prompts <n>] [--repo <name>] [--session <id>]'); process.exit(2); }
    const promptsRaw = argOf(args, '--prompts');
    const prompts = promptsRaw !== null && Number.isFinite(Number(promptsRaw)) ? Number(promptsRaw) : null;
    // The hook relayed values; provenance is an `argv:` source, not a fabricated artifact read.
    const w = fire(provenanced(focusRecord({ streak, prompts, repo }),
      measuredInProcess('argv:get-focused-hook', JSON.stringify({ streak, prompts }))), session);
    if (!w.ok) { console.error(`gate-focus write FAILED (${w.error})`); process.exit(1); }
    console.log(`gate-focus: refocus-fired (streak ${streak}) → ${w.path}`);
    process.exit(0);
  }

  console.error('usage: focus-journal.mjs --from-state <path> | --fire --streak <n> | --tally [--json]');
  process.exit(2);
}
