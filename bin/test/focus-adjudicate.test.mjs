// focus-journal --adjudicate / --abstain / --retract: the W class is a judgement that enters from a
// rater outside the watched session, joins the firing by recordAt, and can be withdrawn. The tally
// reads the adjudications ledger and reports classified / abstained / unadjudicated as three numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'focus-journal.mjs');
const AT1 = '2026-09-01T10:00:01.000Z'; const AT2 = '2026-09-01T11:00:00.400Z';

function fx(t) {
  const d = mkdtempSync(join(tmpdir(), 'cw-focus-adj-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeFileSync(join(d, 'gate-focus.jsonl'), [
    { v: 1, gate: 'gate-focus', at: AT1, session: '12345678', verdict: 'refocus-fired', streak: 2, prompts: 2, repo: 'commitwork' },
    { v: 1, gate: 'gate-focus', at: AT2, session: 'bbbbbbbb', verdict: 'refocus-fired', streak: 3, prompts: 5, repo: 'commitwork' },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  // A re-key says the first firing was really session aaaaaaaa.
  writeFileSync(join(d, 'gate-focus-rekey.jsonl'), JSON.stringify({ v: 1, kind: 'focus-rekey', at: AT1, gate: 'gate-focus', recordAt: AT1, recordSession: '12345678', how: 'timestamp-join', session: 'aaaaaaaa' }) + '\n');
  return d;
}
const run = (d, args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, CW_VERDICT_DIR: d, CW_NOW: '2026-09-11T00:00:00.000Z' } });

test('a rater outside the watched session records a class; the watched session is REFUSED (G12), via the re-key', (t) => {
  const d = fx(t);
  const self = run(d, ['--adjudicate', AT1, '--class', 'W2', '--by', 'aaaaaaaa', '--reason', 'x']);
  assert.equal(self.status, 3, self.stderr);
  assert.match(self.stderr, /self-adjudication is G12/);
  const selfRaw = run(d, ['--adjudicate', AT2, '--class', 'W2', '--by', 'bbbbbbbb', '--reason', 'x']);
  assert.equal(selfRaw.status, 3, 'without a re-key the record key itself is the watched session');
  const ok = run(d, ['--adjudicate', AT1, '--class', 'W2', '--by', 'cccccccc', '--reason', 'handoff written with 3 tasks open']);
  assert.equal(ok.status, 0, ok.stderr);
  const rows = readFileSync(join(d, 'adjudications.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'adjudication'); assert.equal(rows[0].class, 'W2'); assert.equal(rows[0].recordSession, 'aaaaaaaa'); assert.equal(rows[0].rekeyHow, 'timestamp-join');
});

test('tally joins the ledger: classified, abstained and unadjudicated are three numbers; a retraction withdraws', (t) => {
  const d = fx(t);
  assert.equal(run(d, ['--adjudicate', AT1, '--class', 'W4', '--by', 'cccccccc', '--reason', 'no state change in 4 turns']).status, 0);
  assert.equal(run(d, ['--abstain', AT2, '--by', 'cccccccc', '--reason', 'pooled counter']).status, 0);
  let tal = run(d, ['--tally']).stdout;
  assert.match(tal, /1\/2 carry a W class \(W4 1\) · 0 judged false alarms · 1 abstained .* · 0 UNADJUDICATED/);
  assert.equal(run(d, ['--retract', AT1, '--by', 'cccccccc', '--reason', 'misread the turn']).status, 0);
  tal = run(d, ['--tally']).stdout;
  assert.match(tal, /0\/2 carry a W class · 0 judged false alarms · 1 abstained .* · 1 UNADJUDICATED/);
  const j = JSON.parse(run(d, ['--tally', '--json']).stdout);
  assert.equal(j.classified, 0); assert.equal(j.abstained, 1);
});

test('`--class none` is a false alarm of the sensor: adjudicated, counted apart, never a W', (t) => {
  const d = fx(t);
  assert.equal(run(d, ['--adjudicate', AT1, '--class', 'none', '--by', 'cccccccc', '--reason', 'the turn before shipped a commit; the nudge was impatience']).status, 0);
  const rows = readFileSync(join(d, 'adjudications.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows[0].class, null); assert.equal(rows[0].truth, 'false-alarm');
  assert.match(run(d, ['--tally']).stdout, /0\/2 carry a W class · 1 judged false alarms · 0 abstained .* · 1 UNADJUDICATED/);
});

test('bad inputs are refused before anything is written', (t) => {
  const d = fx(t);
  assert.equal(run(d, ['--adjudicate', AT1, '--class', 'W9', '--by', 'cccccccc', '--reason', 'x']).status, 2);
  assert.equal(run(d, ['--adjudicate', AT1, '--class', 'W1', '--by', 'cccccccc']).status, 2, 'a judgement without evidence is refused');
  assert.equal(run(d, ['--adjudicate', '2020-01-01T00:00:00.000Z', '--class', 'W1', '--by', 'cccccccc', '--reason', 'x']).status, 1, 'no such record');
  assert.equal(readFileSync(join(d, 'gate-focus.jsonl'), 'utf8').split('\n').filter(Boolean).length, 2, 'the journal is untouched');
});
