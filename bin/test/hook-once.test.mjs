// The say-once suppressor for the Stop-hook gates. Every "stays quiet" assertion is paired with
// a "speaks again" one — a suppressor quiet on MOVED facts is a silently disabled gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { shouldEmit, forget, silenceNote } from '../hook-once.mjs';
import { adjudicationsPath, readJournalFile } from '../lib/verdict-journal-core.mjs';

// CW_HOOK_STATE is read at CALL time, and names a DIRECTORY: one record per key, which is what
// makes concurrent gates safe (see below).
const T = mkdtempSync(join(tmpdir(), 'cw-hookonce-'));
process.env.CW_HOOK_STATE = join(T, 'state');
// Sandbox the C-5 fatigue ledger too — repeats here must not write into the real .claude/verdicts.
// The threshold is parked out of reach; the streak tests set/restore their own small N.
process.env.CW_VERDICT_DIR = join(T, 'verdicts');
process.env.CW_HOOK_STREAK_THRESHOLD = '100000';
const recordFor = (key) => join(process.env.CW_HOOK_STATE, `${key}.json`);
const labelsFor = (target) => readJournalFile(adjudicationsPath()).records.filter((r) => r.kind === 'suppression-label' && r.target === target);

test('first showing speaks; an identical repeat does not', () => {
  forget();
  const a = shouldEmit('k', '56 → 61 anchors drifted');
  assert.equal(a.changed, true, 'the first time a thing is said it must be said');
  for (let i = 0; i < 5; i++) {
    assert.equal(shouldEmit('k', '56 → 61 anchors drifted').changed, false,
      'an unchanged message must not repeat — this is the twenty-turn wall');
  }
});

test('a CHANGED message speaks immediately — suppression is never a mute button', () => {
  forget();
  shouldEmit('k', '56 → 61 anchors drifted');
  shouldEmit('k', '56 → 61 anchors drifted');
  const moved = shouldEmit('k', '56 → 74 anchors drifted');
  assert.equal(moved.changed, true, 'the numbers moved — staying quiet here would disable the gate');
  // Two calls with the same text = one showing + one suppressed, so exactly 1 turn was swallowed.
  assert.equal(moved.silenced, 1, 'and it reports how many turns the previous state held');
});

test('the silence is accounted for, so a quiet stretch is never an unexplained gap', () => {
  forget();
  shouldEmit('k', 'A');
  shouldEmit('k', 'A');
  shouldEmit('k', 'A');
  const b = shouldEmit('k', 'B');
  assert.match(silenceNote(b.silenced), /held for 2 more turns/);
  assert.equal(silenceNote(0), '', 'a first showing gets no suffix');
  assert.match(silenceNote(1), /1 more turn\b/, 'and the singular is not "1 turns"');
});

test('keys are independent — one gate going quiet cannot mute another', () => {
  forget();
  shouldEmit('gate-ratchet', 'ratchet says X');
  assert.equal(shouldEmit('gate-tests', 'tests say X').changed, true,
    'same TEXT under a different key is a different gate speaking for the first time');
  assert.equal(shouldEmit('gate-ratchet', 'ratchet says X').changed, false);
});

// Both gates fire on the SAME Stop event; a shared JSON map lost the loser's record. Asserting on
// the BYTES makes this deterministic — one-file-per-key cannot clobber.
test('recording one key leaves another key\'s record byte-identical', () => {
  forget();
  shouldEmit('gate-ratchet', 'ratchet says X');
  const before = readFileSync(recordFor('gate-ratchet'));

  shouldEmit('gate-tests', 'tests say Y');   // the concurrent writer, serialised for determinism
  const after = readFileSync(recordFor('gate-ratchet'));

  assert.deepEqual(after, before, 'writing one gate\'s record must not touch another\'s');
  assert.equal(shouldEmit('gate-ratchet', 'ratchet says X').changed, false,
    'and the untouched gate must still be suppressed — a clobbered record re-blocks forever');
  assert.equal(shouldEmit('gate-tests', 'tests say Y').changed, false);
});

test('forget(key) restores speech — this is what --baseline relies on', () => {
  forget();
  shouldEmit('gate-ratchet', 'same');
  assert.equal(shouldEmit('gate-ratchet', 'same').changed, false);
  forget('gate-ratchet');
  assert.equal(shouldEmit('gate-ratchet', 'same').changed, true,
    'after accepting a baseline the gate must confirm the new floor, not stay mute');
});

test('forget(key) is surgical — it must not silence-reset every other gate', () => {
  forget();
  shouldEmit('gate-ratchet', 'r');
  shouldEmit('gate-tests', 't');
  forget('gate-ratchet');
  assert.equal(shouldEmit('gate-tests', 't').changed, false,
    'one gate accepting a baseline cannot make an unrelated gate start repeating itself');
});

test('a key can never escape the state directory', () => {
  forget();
  shouldEmit('../../etc/passwd', 'nice try');
  // both the record AND its event journal flatten the key
  const written = readdirSync(process.env.CW_HOOK_STATE).filter((f) => f.startsWith('.._')).sort();
  assert.deepEqual(written, ['.._.._etc_passwd.events.jsonl', '.._.._etc_passwd.json'],
    'a path-shaped key is flattened, not followed');
});

test('an unreadable or corrupt state file fails OPEN — it speaks, never swallows', () => {
  // a bad byte on disk must never read as "already reported"
  forget();
  mkdirSync(process.env.CW_HOOK_STATE, { recursive: true });
  writeFileSync(recordFor('gate-ratchet'), 'not json at all');
  assert.equal(shouldEmit('gate-ratchet', 'anything').changed, true);
});

test('state is written atomically and leaves no tmp behind', () => {
  forget();
  shouldEmit('k', 'v');
  assert.ok(existsSync(recordFor('k')), 'the record lands at its own per-key path');
  const leftovers = readdirSync(process.env.CW_HOOK_STATE).filter((f) => f.includes('.tmp-'));
  assert.deepEqual(leftovers, [], `tmp files survived a write: ${leftovers.join(', ')}`);
});

// ── C-5 fatigue ledger: a suppression STREAK earns exactly one label, at the threshold ──────────

test('a streak crossing CW_HOOK_STREAK_THRESHOLD appends exactly one suppression-label — not one per firing', () => {
  forget();
  process.env.CW_HOOK_STREAK_THRESHOLD = '3';
  try {
    shouldEmit('streak-a', 'same message');   // shown, silenced 0 — below threshold, no label
    shouldEmit('streak-a', 'same message');   // silenced 1
    shouldEmit('streak-a', 'same message');   // silenced 2
    shouldEmit('streak-a', 'same message');   // silenced 3 — crosses, labels ONCE
    shouldEmit('streak-a', 'same message');   // silenced 4 — past threshold, no new label
    shouldEmit('streak-a', 'same message');   // silenced 5 — still no new label
  } finally { process.env.CW_HOOK_STREAK_THRESHOLD = '100000'; }
  const ls = labelsFor('streak-a');
  assert.equal(ls.length, 1, 'one label at the crossing, not one per firing past it');
  assert.equal(ls[0].count, 3);
  assert.equal(ls[0].action, 'silence');
  assert.equal(ls[0].who, 'hook-once');
});

test('a fresh streak after a CHANGED message earns its own label — events are events', () => {
  forget();
  process.env.CW_HOOK_STREAK_THRESHOLD = '2';
  try {
    shouldEmit('streak-b', 'A'); shouldEmit('streak-b', 'A'); shouldEmit('streak-b', 'A'); // crosses at silenced=2
    shouldEmit('streak-b', 'B'); shouldEmit('streak-b', 'B'); shouldEmit('streak-b', 'B'); // new streak, crosses again
  } finally { process.env.CW_HOOK_STREAK_THRESHOLD = '100000'; }
  const ls = labelsFor('streak-b');
  assert.equal(ls.length, 2, 'a new streak starting from a changed message is its own suppression event');
});

test('a key that never reaches the threshold labels nothing', () => {
  forget();
  process.env.CW_HOOK_STREAK_THRESHOLD = '10';
  try {
    for (let i = 0; i < 5; i++) shouldEmit('streak-c', 'below threshold');
  } finally { process.env.CW_HOOK_STREAK_THRESHOLD = '100000'; }
  assert.deepEqual(labelsFor('streak-c'), []);
});

test('a path-shaped key is flattened in the label target too, matching its state-file key', () => {
  forget();
  process.env.CW_HOOK_STREAK_THRESHOLD = '1';
  try {
    shouldEmit('../../etc/streak-d', 'x');
    shouldEmit('../../etc/streak-d', 'x'); // silenced 1 — crosses immediately
  } finally { process.env.CW_HOOK_STREAK_THRESHOLD = '100000'; }
  const ls = labelsFor('.._.._etc_streak-d');
  assert.equal(ls.length, 1, 'the label target is the same safeKey-flattened string as the state file name');
});

// ── the verdict-journal extension: the suppressor's record must SAY what it suppresses ──────────

const eventsFor = (key) => join(process.env.CW_HOOK_STATE, `${key}.events.jsonl`);
const readEvents = (key) => readFileSync(eventsFor(key), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('the record carries the message verbatim — suppression is no longer a hash preimage problem', () => {
  forget('gate-ratchet');
  shouldEmit('gate-ratchet', '56 → 61 anchors drifted');
  const rec = JSON.parse(readFileSync(recordFor('gate-ratchet'), 'utf8'));
  assert.equal(rec.message, '56 → 61 anchors drifted');
  shouldEmit('gate-ratchet', '56 → 61 anchors drifted'); // suppressed turn
  const rec2 = JSON.parse(readFileSync(recordFor('gate-ratchet'), 'utf8'));
  assert.equal(rec2.message, '56 → 61 anchors drifted', 'a suppressed turn preserves the message');
  assert.equal(rec2.at, rec.at, '`at` is preserved on suppression — it IS first-shown-at, no second field');
});

test('transition events: shown on first and on change, NOTHING on a suppressed turn', () => {
  forget();
  rmSync(eventsFor('ev'), { force: true });
  shouldEmit('ev', 'A');
  shouldEmit('ev', 'A');   // suppressed — must not append
  shouldEmit('ev', 'A');   // suppressed — must not append
  shouldEmit('ev', 'B');   // changed — appends, carrying how long A held
  const events = readEvents('ev');
  assert.equal(events.length, 2, 'transitions only — per-turn events would be double bookkeeping');
  assert.equal(events[0].event, 'shown');
  assert.equal(events[0].silencedBefore, 0);
  assert.equal(events[1].event, 'shown');
  assert.equal(events[1].silencedBefore, 2, 'the new showing records how many turns the old state held');
});

test('forget(key, reason) appends a forgotten event with its reason', () => {
  forget();
  rmSync(eventsFor('gate-ratchet'), { force: true });
  shouldEmit('gate-ratchet', 'debt');
  forget('gate-ratchet', 'baseline-accepted');
  const events = readEvents('gate-ratchet');
  assert.equal(events.at(-1).event, 'forgotten');
  assert.equal(events.at(-1).reason, 'baseline-accepted');
  assert.equal(shouldEmit('gate-ratchet', 'debt').changed, true, 'and speech is restored');
});

test('keyless forget() preserves every event journal — history survives the reset ritual', () => {
  forget();
  rmSync(eventsFor('keep'), { force: true });
  shouldEmit('keep', 'evidence');
  assert.ok(existsSync(recordFor('keep')));
  assert.ok(existsSync(eventsFor('keep')));
  forget();   // the keyless nuke — records go, history stays
  assert.equal(existsSync(recordFor('keep')), false, 'records are reset');
  assert.ok(existsSync(eventsFor('keep')), 'event journals are durable history, not resettable state');
});
