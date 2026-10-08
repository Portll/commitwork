// focus-journal — the avoidance sensor's ledger path. The property under test is the three-way
// split a sensor is most tempted to collapse: FIRED / below-threshold / CANNOT SEE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFocusState, focusRecord, tally } from '../focus-journal.mjs';
import { GATE_ROSTER, journalHealth } from '../lib/verdict-journal-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'focus-journal.mjs');
const AT = '2026-08-12T00:00:00.000Z';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-focus-'));
  return { root, verdicts: join(root, 'verdicts'), state: join(root, 'focus.json') };
}

function run(fx, args, extraEnv = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, CW_VERDICT_DIR: fx.verdicts, CW_NOW: AT, ...extraEnv },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

const records = (fx) => {
  const p = join(fx.verdicts, 'gate-focus.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
};

test('a firing writes one chained record, and the sensor does NOT assign a class', () => {
  const fx = fixture();
  const r = run(fx, ['--fire', '--streak', '3', '--repo', 'commitwork']);
  assert.equal(r.code, 0);
  const rec = records(fx);
  assert.equal(rec.length, 1);
  assert.equal(rec[0].gate, 'gate-focus');
  assert.equal(rec[0].verdict, 'refocus-fired');
  assert.equal(rec[0].streak, 3);
  assert.equal(rec[0].repo, 'commitwork');
  assert.equal(rec[0].family, 'W');
  assert.equal(rec[0].class, null, 'which avoidance pattern was operating is a judgement, not a reading');
  assert.equal(rec[0].at, AT, 'CW_NOW is honoured at call time');
  assert.equal(rec[0].prev, 'genesis');
});

test('the prompt text is never stored — the sensor is passed a count and nothing else', () => {
  const fx = fixture();
  run(fx, ['--fire', '--streak', '2']);
  const line = readFileSync(join(fx.verdicts, 'gate-focus.jsonl'), 'utf8');
  for (const k of ['prompt', 'text', 'message', 'content']) {
    assert.ok(!Object.hasOwn(JSON.parse(line), k), `record must not carry a "${k}" field`);
  }
});

test('an ABSENT state file is a state, not a streak of zero: exit 3, nothing written', () => {
  const fx = fixture();
  const r = run(fx, ['--from-state', join(fx.root, 'never-written.json')]);
  assert.equal(r.code, 3);
  assert.equal(records(fx).length, 0, 'absent must not manufacture a record either');
});

test('a CORRUPT state file records state-unreadable and exits 1 — it never reads as quiet', () => {
  const fx = fixture();
  writeFileSync(fx.state, '{"nudgeStreak": 4,,,');
  const r = run(fx, ['--from-state', fx.state]);
  assert.equal(r.code, 1);
  const rec = records(fx);
  assert.equal(rec.length, 1);
  assert.equal(rec[0].verdict, 'state-unreadable');
  assert.equal(rec[0].detail, 'unparseable');
  assert.equal(rec[0].streak, null, 'a streak the sensor could not read is null, never 0');
});

test('a state file missing the streak field is unreadable, not empty', () => {
  const s = readFocusState('/dev/null');
  assert.equal(s.state, 'unreadable');
  assert.equal(s.streak, null);
});

test('below the threshold there is no alarm and no record; at the threshold there is both', () => {
  const fx = fixture();
  writeFileSync(fx.state, JSON.stringify({ nudgeStreak: 1, prompts: 9 }));
  assert.equal(run(fx, ['--from-state', fx.state]).code, 3);
  assert.equal(records(fx).length, 0);

  writeFileSync(fx.state, JSON.stringify({ nudgeStreak: 2, prompts: 11 }));
  assert.equal(run(fx, ['--from-state', fx.state]).code, 0);
  const rec = records(fx);
  assert.equal(rec.length, 1);
  assert.equal(rec[0].streak, 2);
  assert.equal(rec[0].prompts, 11, 'the denominator travels with the alarm');
});

test('CW_FOCUS_MIN_STREAK is read at call time, so the threshold is a fixture knob', () => {
  const fx = fixture();
  writeFileSync(fx.state, JSON.stringify({ nudgeStreak: 1 }));
  assert.equal(run(fx, ['--from-state', fx.state], { CW_FOCUS_MIN_STREAK: '1' }).code, 0);
  assert.equal(records(fx).length, 1);
});

test('--tally on an absent journal says ABSENT and refuses to call it clean', () => {
  const fx = fixture();
  const r = run(fx, ['--tally']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /ABSENT/);
  assert.match(r.stdout, /no measurement/, 'absence of firings must not render as absence of avoidance');
});

test('--tally separates populations by repo and reports the unadjudicated remainder', () => {
  const fx = fixture();
  run(fx, ['--fire', '--streak', '2', '--repo', 'commitwork']);
  run(fx, ['--fire', '--streak', '5', '--repo', 'internal-d']);
  run(fx, ['--fire', '--streak', '2', '--repo', 'commitwork']);
  const r = run(fx, ['--tally', '--json']);
  const t = JSON.parse(r.stdout);
  assert.equal(t.firings, 3);
  assert.equal(t.maxStreak, 5);
  assert.deepEqual(t.byRepo, { commitwork: 2, 'internal-d': 1 });
  assert.equal(t.classified, 0);
  assert.equal(t.chain.broken, 0, 'three appends leave the hash chain intact');
});

test('tally() counts state-unreadable separately from firings — a blind sensor is not a quiet one', () => {
  const t = tally([
    { verdict: 'refocus-fired', streak: 2, repo: 'a', at: '1' },
    { verdict: 'state-unreadable', at: '2' },
  ]);
  assert.equal(t.firings, 1);
  assert.equal(t.unreadable, 1);
});

test('focusRecord never invents a class, whatever it is handed', () => {
  assert.equal(focusRecord({ streak: 9, repo: 'x' }).class, null);
  assert.equal(focusRecord({ streak: 'nonsense' }).streak, null);
});

test('gate-focus is on the roster, so a sensor that has never written renders ABSENT', () => {
  const fx = fixture();
  assert.ok(GATE_ROSTER.some((g) => g.gate === 'gate-focus'));
  const h = journalHealth({ dir: fx.verdicts }).find((g) => g.gate === 'gate-focus');
  assert.equal(h.state, 'absent-not-running');
  assert.equal(h.entries, 0);
});

test('the tally reads across a rotation — a rotated journal is not a shorter one', () => {
  const fx = fixture();
  // Force a rotation by capping the journal at a size two records exceed.
  run(fx, ['--fire', '--streak', '2', '--repo', 'a'], { CW_VERDICT_MAX_BYTES: '1' });
  run(fx, ['--fire', '--streak', '3', '--repo', 'b'], { CW_VERDICT_MAX_BYTES: '1' });
  assert.ok(existsSync(join(fx.verdicts, 'gate-focus.jsonl.1')), 'the fixture must actually rotate');
  const t = JSON.parse(run(fx, ['--tally', '--json']).stdout);
  assert.equal(t.firings, 2, 'both records are counted, not only the live file');
  assert.equal(t.maxStreak, 3);
  assert.deepEqual(t.byRepo, { a: 1, b: 1 });
});

test('the session key matches the touch ledger width, or no join is possible', () => {
  const fx = fixture();
  run(fx, ['--fire', '--streak', '2', '--session', '00000000-0000-4000-8000-000000000001']);
  const rec = records(fx)[0];
  assert.equal(rec.session, '00000000', 'the touch ledger stores 8 chars; a wider key joins to nothing');
});

test('--fire --state-unreadable records sensor blindness on the path the hook actually takes', () => {
  const fx = fixture();
  const r = run(fx, ['--fire', '--streak', '0', '--state-unreadable', '--repo', 'commitwork']);
  assert.equal(r.code, 1);
  const rec = records(fx);
  assert.equal(rec.length, 1);
  assert.equal(rec[0].verdict, 'state-unreadable');
  assert.equal(rec[0].streak, null, 'a corrupt file yields no streak, never 0');
  assert.equal(rec[0].detail, 'hook-unparseable');
  assert.equal(tally(rec).firings, 0, 'blindness is never counted as a firing');
});

// ── MEASUREMENT PROVENANCE (P1-EXTEND, cw-adjudication-integrity task 10) ───────────────────────
// The two paths obtain their reading differently and the provenance must say which: --from-state
// READS the state file (artifact read), --fire is HANDED the hook's values on argv.
test('a --from-state firing carries artifact provenance over the state file it read', () => {
  const fx = fixture();
  const raw = JSON.stringify({ nudgeStreak: 3, prompts: 12 });
  writeFileSync(fx.state, raw);
  assert.equal(run(fx, ['--from-state', fx.state]).code, 0);
  const rec = records(fx)[0];
  assert.ok(rec.measured, 'a record with no measured block cannot prove the state was read');
  assert.equal(rec.measured.source, `artifact:${fx.state}`, 'a file read must name the file');
  assert.match(rec.measured.digest, /^sha256:[0-9a-f]{16}$/);
  assert.equal(rec.measured.ok, true);
  assert.ok(Object.hasOwn(rec, 'headSha'),
    'headSha travels with provenance — real sha or honest null, but never missing');
});

test('a --fire firing says the reading was RELAYED, and its digest tracks the relayed values', () => {
  const fx = fixture();
  run(fx, ['--fire', '--streak', '2', '--prompts', '9']);
  run(fx, ['--fire', '--streak', '2', '--prompts', '9']);
  run(fx, ['--fire', '--streak', '4', '--prompts', '11']);
  const rec = records(fx);
  assert.equal(rec.length, 3);
  for (const r of rec) {
    assert.ok(r.measured);
    assert.match(r.measured.source, /^argv:/, 'the source must admit this process read no file');
    assert.match(r.measured.digest, /^sha256:[0-9a-f]{16}$/);
  }
  assert.equal(rec[0].measured.digest, rec[1].measured.digest, 'same relayed values digest equal');
  assert.notEqual(rec[1].measured.digest, rec[2].measured.digest, 'a moved reading moves the digest');
});

test('state-unreadable records carry provenance with ok:false — blindness is a failed measurement', () => {
  const fx = fixture();
  writeFileSync(fx.state, '{"nudgeStreak": 4,,,');
  run(fx, ['--from-state', fx.state]);
  const fromState = records(fx)[0];
  assert.ok(fromState.measured, 'the attempt is evidence');
  assert.equal(fromState.measured.ok, false, 'the sensor could not see — that is not a fine run');
  assert.match(fromState.measured.digest ?? '', /^sha256:/,
    'the unparseable bytes WERE read, so they have a digest — two identical corrupt states compare equal');

  const fx2 = fixture();
  run(fx2, ['--fire', '--state-unreadable', '--prompts', '7']);
  const relayed = records(fx2)[0];
  assert.ok(relayed.measured);
  assert.equal(relayed.measured.ok, false);
});

test('a verdict kind the tally does not know is counted, never skipped', () => {
  const t = tally([
    { verdict: 'refocus-fired', streak: 2, repo: 'a', at: '1' },
    { verdict: 'state-unreadable', at: '2' },
    { verdict: 'some-future-kind', at: '3' },
  ]);
  assert.equal(t.firings, 1);
  assert.equal(t.unreadable, 1);
  assert.equal(t.other, 1, 'an unrecognised record must appear in some total');
});
