// The turn gate, exercised through its REAL entry point as a subprocess.
//
// WHY THIS EXISTS SEPARATELY FROM turn-gate.test.mjs. Run over six real transcripts the gate
// returned six passes, and six passes is the reading that proves least: a gate that never fires is
// indistinguishable from a gate that CANNOT fire. The unit tests show the core blocks on
// constructed turn objects, which is not the same claim as "the installed command blocks on a file
// shaped like a real transcript". Everything between those two — argv parsing, the reader, the
// fold, the exit code — is unproven by the core's own tests, and that gap is where a gate quietly
// stops working.
//
// So: plant a transcript whose truth this file constructed, run the command the way an operator
// would, and score the process exit. Both directions are asserted, because only one of them is the
// direction that lies to you.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO, 'bin', 'turn-gate.mjs');

const usage = (output) => ({ input_tokens: 1, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
const prompt = (uuid) => ({ type: 'user', uuid, sessionId: 's', message: { content: 'go' } });
const say = (text) => ({ type: 'assistant', uuid: 'a', sessionId: 's', message: { content: [{ type: 'text', text }], usage: usage(10) } });
const call = (name) => ({ type: 'assistant', uuid: 'a', sessionId: 's', message: { content: [{ type: 'tool_use', name, input: {} }], usage: usage(10) } });
const result = () => ({ type: 'user', uuid: 'r', message: { content: [{ type: 'tool_result', content: 'ok' }] } });

const plant = (records) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-turn-gate-'));
  const p = join(dir, 'planted.jsonl');
  writeFileSync(p, records.map((r) => JSON.stringify(r)).join('\n'));
  return { dir, p };
};

/** Run the real CLI. Returns {code, out} — a non-zero exit is data here, not a throw. */
function run(args, env = {}) {
  const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } };
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], opts);
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

describe('turn gate CLI — the negative control fires', () => {
  test('NOT VACUOUS: a planted bad session BLOCKS and exits 1', () => {
    // Six turns of claiming an outcome with no tool call anywhere: unwitnessed claims over the
    // limit, a long toolless run, and a session that called nothing.
    const records = [];
    for (let i = 0; i < 6; i++) records.push(prompt(`p${i}`), say(`I verified step ${i} and all tests pass.`));
    const { dir, p } = plant(records);
    const r = run(['--transcript', p]);
    assert.equal(r.code, 1, `expected a block, got ${r.code}: ${r.out}`);
    assert.match(r.out, /BLOCK/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a planted GOOD session passes and exits 0 — the positive control', () => {
    const records = [];
    for (let i = 0; i < 6; i++) records.push(prompt(`p${i}`), call('Bash'), result(), say(`step ${i} done`));
    const { dir, p } = plant(records);
    const r = run(['--transcript', p]);
    assert.equal(r.code, 0, `expected a pass, got ${r.code}: ${r.out}`);
    assert.match(r.out, /PASS/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('the two controls are told apart by the SAME command, not by different flags', () => {
    const bad = plant(Array.from({ length: 6 }, (_, i) => [prompt(`p${i}`), say('verified, confirmed, all tests pass')]).flat());
    const good = plant(Array.from({ length: 6 }, (_, i) => [prompt(`p${i}`), call('Read'), result()]).flat());
    assert.equal(run(['--transcript', bad.p]).code, 1);
    assert.equal(run(['--transcript', good.p]).code, 0);
    rmSync(bad.dir, { recursive: true, force: true });
    rmSync(good.dir, { recursive: true, force: true });
  });
});

describe('turn gate CLI — an unanswerable run is never a pass', () => {
  test('an absent transcript exits 2, not 0', () => {
    const r = run(['--transcript', join(tmpdir(), 'cw-no-such-transcript.jsonl')]);
    assert.equal(r.code, 2, 'a missing session must not read as a clean one');
    assert.match(r.out, /absent/);
  });

  test('a corrupt transcript is vetoed to undetermined, and the suppressed findings still print', () => {
    const records = [];
    for (let i = 0; i < 6; i++) records.push(prompt(`p${i}`), say(`verified ${i}`));
    const { dir, p } = plant(records);
    writeFileSync(p, `${'{ broken json\n'}${records.map((r) => JSON.stringify(r)).join('\n')}`);
    const r = run(['--transcript', p]);
    assert.equal(r.code, 2, 'unparseable lines mean the denominator is unknown');
    assert.match(r.out, /vetoed by record-integrity/);
    assert.match(r.out, /BLOCK/, 'the vetoed rules must still be visible or unreadable looks clean');
    rmSync(dir, { recursive: true, force: true });
  });

  test('an empty transcript is undetermined, not a pass', () => {
    const { dir, p } = plant([]);
    writeFileSync(p, '');
    assert.equal(run(['--transcript', p]).code, 2);
    rmSync(dir, { recursive: true, force: true });
  });

  test('no arguments is a usage error, not a silent success', () => {
    const r = run([]);
    assert.equal(r.code, 2);
    assert.match(r.out, /usage:/);
  });
});

describe('turn gate CLI — a policy you did not choose is never applied', () => {
  test('malformed --policy REFUSES rather than falling back to the defaults', () => {
    const { dir, p } = plant([prompt('p1'), call('Bash')]);
    const r = run(['--transcript', p, '--policy', '{not json']);
    assert.equal(r.code, 2);
    assert.match(r.out, /refusing to run under thresholds you did not choose/);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a valid --policy changes the verdict, proving it is actually read', () => {
    const records = [prompt('p1'), say('a'), prompt('p2'), say('b')];
    const { dir, p } = plant(records);
    assert.equal(run(['--transcript', p]).code, 0, 'a run of 2 is under the default limit of 3');
    assert.equal(run(['--transcript', p, '--policy', '{"reportLoopRun":2}']).code, 1,
      'tightening the threshold must actually change the outcome, or the flag is decorative');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('turn gate CLI — journalling is opt-in and never carries session prose', () => {
  test('the ledger record carries uuids and counts, and NEVER the transcript text', async () => {
    const { ledgerRecord } = await import('../turn-gate.mjs');
    const r = {
      file: '/Users/someone/.claude/projects/x/abc.jsonl',
      outcome: 'block',
      reason: 'unwitnessed claims',
      vetoedBy: null,
      policy: { unwitnessedClaims: 1 },
      tokens: { turns: 6, totals: { output: 60 }, ruminationShare: 1 },
      verdicts: [{
        rule: 'unwitnessed-claim',
        verdict: 'block',
        evidence: { count: 2, turns: [{ openedByUuid: 'u1', text: 'the AWS key is AKIAIOSFODNN7EXAMPLE' }] },
      }],
    };
    const rec = ledgerRecord(r);
    const serialised = JSON.stringify(rec);
    assert.doesNotMatch(serialised, /AKIA/, 'session prose must never reach a durable, replicated ledger');
    assert.doesNotMatch(serialised, /Users\/someone/, 'a full path carries the operator home directory');
    assert.equal(rec.subject, 'abc.jsonl');
    assert.deepEqual(rec.rules[0].turns, ['u1'], 'the uuid is enough to go back to the transcript');
    assert.equal(rec.rules[0].count, 2);
  });

  test('a count-shaped rule records its count without an array', async () => {
    const { ledgerRecord } = await import('../turn-gate.mjs');
    const rec = ledgerRecord({
      file: '/tmp/a.jsonl', outcome: 'block', reason: 'x', verdicts: [
        { rule: 'toolless-session', verdict: 'block', evidence: { modelTurns: 7, toolCalls: 0 } },
      ],
    });
    assert.equal(rec.rules[0].count, 7);
    assert.equal(rec.rules[0].turns, null);
  });

  test('DRY BY DEFAULT: running without --record writes nothing to the ledger', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-turn-gate-ledger-'));
    const { dir: pd, p } = plant([prompt('p1'), call('Bash'), result()]);
    const r = run(['--transcript', p], { CW_VERDICT_DIR: dir });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.out, /journalled/);
    let entries = [];
    try { entries = readdirSync(dir); } catch { /* absent is fine */ }
    assert.equal(entries.length, 0, 'a tool must not write to the live ledger merely by being run');
    rmSync(dir, { recursive: true, force: true });
    rmSync(pd, { recursive: true, force: true });
  });
});

describe('turn gate CLI — machine output', () => {
  test('--json emits the policy it ran under alongside the results', () => {
    const { dir, p } = plant([prompt('p1'), call('Bash'), result()]);
    const r = run(['--transcript', p, '--json']);
    const parsed = JSON.parse(r.out);
    assert.ok(parsed.policy.reportLoopRun > 0);
    assert.equal(parsed.results.length, 1);
    assert.equal(parsed.results[0].outcome, 'pass');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('turn gate --hook — record-only at Stop', () => {
  const hookRun = (payload, env) => {
    const r = spawnSync(process.execPath, [CLI, '--hook'], { encoding: 'utf8', input: payload, env: { ...process.env, ...env } });
    return { code: r.status ?? -1, out: `${r.stdout || ''}${r.stderr || ''}` };
  };
  const readJournal = (dir) => readdirSync(dir).includes('turn-gate.jsonl')
    ? readFileSync(join(dir, 'turn-gate.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    : [];

  test('a blocking session exits 0 and is journalled under the PAYLOAD session id', () => {
    const records = [];
    for (let i = 0; i < 6; i++) records.push(prompt(`p${i}`), say(`I verified step ${i} and all tests pass.`));
    const { dir, p } = plant(records);
    const journal = mkdtempSync(join(tmpdir(), 'cw-turn-gate-journal-'));
    const r = hookRun(JSON.stringify({ transcript_path: p, session_id: 'hook-session-1' }), { CW_VERDICT_DIR: journal, CLAUDE_SESSION_ID: '' });
    assert.equal(r.code, 0, 'record-only: a block must not hold the turn');
    assert.equal(r.out, '', 'a successful record-only run is silent — the journal is the report');
    const rows = readJournal(journal);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'block');
    assert.equal(rows[0].session, 'hook-session-1');
    assert.ok(!JSON.stringify(rows[0]).includes('verified step'), 'transcript text never reaches the ledger');
    rmSync(dir, { recursive: true, force: true });
    rmSync(journal, { recursive: true, force: true });
  });

  test('a payload with no transcript_path assesses nothing, journals nothing, and still exits 0', () => {
    const journal = mkdtempSync(join(tmpdir(), 'cw-turn-gate-journal-'));
    for (const payload of ['{}', 'not json', '']) {
      const r = hookRun(payload, { CW_VERDICT_DIR: journal });
      assert.equal(r.code, 0);
      assert.match(r.out, /not a pass/);
    }
    assert.equal(readJournal(journal).length, 0);
    rmSync(journal, { recursive: true, force: true });
  });
});
