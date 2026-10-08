// gate-tests' selective turn, end to end: the real script over a canned plan (CW_GATE_TESTS_SELECT_CMD),
// a canned tally (CW_GATE_TESTS_CMD) and a scratch last-full-run record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE = join(REPO, 'bin', 'gate-tests.mjs');

function scene({ plan, tally, lastFull = { at: new Date().toISOString(), names: ['old failure'], fail: 1, tests: 10 } }) {
  const T = mkdtempSync(join(tmpdir(), 'gate-sel-'));
  const planFile = join(T, 'plan.json');
  writeFileSync(planFile, JSON.stringify(plan));
  const tallyFile = join(T, 'tally.mjs');
  writeFileSync(tallyFile, [
    ...tally.names.map((n) => `console.log(${JSON.stringify(`✖ ${n} (1ms)`)});`),
    `console.log('\\u2139 tests ${tally.pass + tally.fail}');`,
    `console.log('\\u2139 pass ${tally.pass}');`,
    `console.log('\\u2139 fail ${tally.fail}');`,
  ].join('\n'));
  if (lastFull) writeFileSync(join(T, 'gate-tests-last-names.json'), JSON.stringify(lastFull));
  writeFileSync(join(T, 'baseline.json'), JSON.stringify({ fail: 1, pass: 9, tests: 10, at: new Date().toISOString() }));
  const r = spawnSync(process.execPath, [GATE], {
    cwd: REPO, encoding: 'utf8', timeout: 120_000, input: JSON.stringify({ session_id: 'e2e00002-0000-4000-8000-000000000000' }),
    env: {
      ...process.env,
      CW_GATE_TESTS_SELECT_CMD: `${JSON.stringify(process.execPath)} -e "process.stdout.write(require('fs').readFileSync(${JSON.stringify(planFile).replace(/"/g, '\\"')},'utf8'))"`,
      CW_GATE_TESTS_CMD: `${JSON.stringify(process.execPath)} ${JSON.stringify(tallyFile)}`,
      CW_GATE_TESTS_BASELINE: join(T, 'baseline.json'),
      CW_GATE_TESTS_NOLOCK: '1',
      CW_HOOK_STATE: join(T, 'hook-emit'),
      CW_VERDICT_DIR: join(T, 'verdicts'),
    },
  });
  const journal = existsSync(join(T, 'verdicts', 'gate-tests.jsonl'))
    ? readFileSync(join(T, 'verdicts', 'gate-tests.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  return { r, T, journal, last: journal.at(-1), baseline: () => JSON.parse(readFileSync(join(T, 'baseline.json'), 'utf8')), names: () => JSON.parse(readFileSync(join(T, 'gate-tests-last-names.json'), 'utf8')) };
}

test('a selective run whose failures were already failing reports the narrower claim and moves nothing', () => {
  const s = scene({ plan: { mode: 'selective', tests: ['bin/test/a.test.mjs', 'bin/test/b.test.mjs'] }, tally: { pass: 4, fail: 1, names: ['old failure'] } });
  assert.equal(s.r.status, 0, s.r.stderr);
  assert.match(s.r.stdout, /\(selective\): 4 passing, 1 failing in the 2 test file\(s\).*The other test files were not run/);
  assert.equal(s.last.verdict, 'selective-steady');
  assert.equal(s.baseline().pass, 9, 'the floor is a full-run population and a selective run must not write it');
  assert.deepEqual(s.names().names, ['old failure'], 'the last-full record is untouched');
});

test('a failure the last full run did not record falls through to the FULL run, and the journal says why', () => {
  const s = scene({ plan: { mode: 'selective', tests: ['bin/test/a.test.mjs'] }, tally: { pass: 9, fail: 1, names: ['new failure'] } });
  assert.notEqual(s.last.verdict, 'selective-steady');
  assert.match(s.last.fullBecause, /found 1 failure\(s\) the last full run did not record/);
});

test('with no full run on record, the turn runs the full suite', () => {
  const s = scene({ plan: { mode: 'selective', tests: ['bin/test/a.test.mjs'] }, tally: { pass: 9, fail: 1, names: ['old failure'] }, lastFull: null });
  assert.match(s.last.fullBecause, /no full run is on record/);
});

test('nothing differing from HEAD runs nothing and says the last full run stands', () => {
  const s = scene({ plan: { mode: 'none', reason: 'nothing differs from HEAD' }, tally: { pass: 0, fail: 0, names: [] } });
  assert.equal(s.r.status, 0);
  assert.match(s.r.stdout, /not run this turn — nothing differs from HEAD\. The last full run .* stands/);
  assert.equal(s.last.verdict, 'selective-skip');
});

test('a selection that cannot be computed runs the full suite rather than nothing', () => {
  const s = scene({ plan: 'not json at all', tally: { pass: 9, fail: 1, names: ['old failure'] } });
  assert.match(s.last.fullBecause, /could not be computed/);
});
