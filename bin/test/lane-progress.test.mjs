// The per-lane progress line, tested from both ends of the wire it exists to be.
//
// The failure this guards is not "the format is wrong" — it is that the emitter and the parser stop
// agreeing and nobody notices, because a panel whose lanes never move looks exactly like a panel
// with no sweep running. Both live in one module and are exercised against each other here; the
// runner is then executed for real, because a grammar both sides agree on is still worth nothing if
// the thing that is supposed to write it never does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { laneProgress, parseLaneProgress, LANE_TAG } from '../../monitor/lane-progress.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** laneProgress writes to stdout; capture it rather than asserting on a return value alone. */
function emitted(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { fn(); } finally { console.log = orig; }
  return lines;
}

test('OFF unless asked — a human at a terminal sees exactly what they saw before', () => {
  const prev = process.env.CW_LANE_PROGRESS;
  delete process.env.CW_LANE_PROGRESS;
  try {
    assert.deepEqual(emitted(() => laneProgress('start', { repo: 'r', check: 'sast' })), [],
      'the default must print nothing: these lines are for a machine and would be noise in a console');
  } finally { if (prev === undefined) delete process.env.CW_LANE_PROGRESS; else process.env.CW_LANE_PROGRESS = prev; }
});

test('the switch is read at CALL time, not at import', () => {
  // A `const ON = process.env.X` at module load would pin the answer before any caller could set
  // it — and every test that sets it afterwards would pass while proving nothing.
  const prev = process.env.CW_LANE_PROGRESS;
  try {
    delete process.env.CW_LANE_PROGRESS;
    assert.equal(emitted(() => laneProgress('start', { check: 'a' })).length, 0);
    process.env.CW_LANE_PROGRESS = '1';
    assert.equal(emitted(() => laneProgress('start', { check: 'a' })).length, 1,
      'the module was imported while the flag was unset; flipping it must still take effect');
  } finally { if (prev === undefined) delete process.env.CW_LANE_PROGRESS; else process.env.CW_LANE_PROGRESS = prev; }
});

test('round trip: every field the emitter writes is the field the parser reads', () => {
  const prev = process.env.CW_LANE_PROGRESS;
  process.env.CW_LANE_PROGRESS = '1';
  try {
    const [line] = emitted(() => laneProgress('end', { repo: 'client-d', check: 'deps-osv', status: 'pass', ms: 1234 }));
    assert.deepEqual(parseLaneProgress(line),
      { event: 'end', repo: 'client-d', check: 'deps-osv', status: 'pass', ms: 1234 });
  } finally { if (prev === undefined) delete process.env.CW_LANE_PROGRESS; else process.env.CW_LANE_PROGRESS = prev; }
});

test('an unrecorded duration stays null and never becomes zero', () => {
  const prev = process.env.CW_LANE_PROGRESS;
  process.env.CW_LANE_PROGRESS = '1';
  try {
    const [line] = emitted(() => laneProgress('end', { repo: 'r', check: 'c', status: 'skipped', ms: null }));
    const p = parseLaneProgress(line);
    assert.equal(p.ms, null, 'Number("") is 0 — publishing "nobody timed it" as "it took no time" is '
      + 'the unsupported-pass swap, in the one field a timing graph reads');
    assert.notEqual(p.ms, 0);
    // and a real zero survives as a zero, so the distinction is carried in both directions
    const [z] = emitted(() => laneProgress('end', { repo: 'r', check: 'c', status: 'pass', ms: 0 }));
    assert.equal(parseLaneProgress(z).ms, 0);
  } finally { if (prev === undefined) delete process.env.CW_LANE_PROGRESS; else process.env.CW_LANE_PROGRESS = prev; }
});

test('ordinary console output is not mistaken for a lane line', () => {
  for (const junk of ['', '  ', 'x', '[sweep] 42 repos', '[lane]', `${LANE_TAG}\tbogus\tr\tc`,
    `${LANE_TAG}\tstart`, 'INFO [lane] start r c', null, undefined, 42, {}]) {
    assert.equal(parseLaneProgress(junk), null, `parsed a lane line out of ${JSON.stringify(junk)}`);
  }
});

test('a colourised stream still parses — the child runs with FORCE_COLOR', () => {
  // serve.mjs spawns with FORCE_COLOR=3 so the live console renders a themed run. The emitter
  // writes no colour, but a reset sequence trailing the previous line arrives on this one.
  const line = `[0m${LANE_TAG}\tend\tclient-d\tsast\tpass\t900[0m`;
  const p = parseLaneProgress(line);
  assert.equal(p && p.check, 'sast');
  assert.equal(p.ms, 900);
});

test('a check id containing a space does not shift every field after it', () => {
  const prev = process.env.CW_LANE_PROGRESS;
  process.env.CW_LANE_PROGRESS = '1';
  try {
    const [line] = emitted(() => laneProgress('end', { repo: 'my repo', check: 'sast codeql', status: 'pass', ms: 5 }));
    const p = parseLaneProgress(line);
    assert.equal(p.repo, 'my repo');
    assert.equal(p.check, 'sast codeql', 'tab-separated on purpose: a space grammar would read this as four fields');
    assert.equal(p.ms, 5);
  } finally { if (prev === undefined) delete process.env.CW_LANE_PROGRESS; else process.env.CW_LANE_PROGRESS = prev; }
});

test('a field carrying a newline cannot forge a second line', () => {
  const prev = process.env.CW_LANE_PROGRESS;
  process.env.CW_LANE_PROGRESS = '1';
  try {
    const [line] = emitted(() => laneProgress('end',
      { repo: `r\n${LANE_TAG}\tend\tvictim\tsast\tpass\t1`, check: 'c', status: 'pass', ms: 1 }));
    assert.equal(line.split('\n').length, 1,
      'a repo name is scanned-tree data; if it could carry a newline it could inject a lane result '
      + 'for a lane that never ran');
    assert.equal(parseLaneProgress(line).check, 'c');
  } finally { if (prev === undefined) delete process.env.CW_LANE_PROGRESS; else process.env.CW_LANE_PROGRESS = prev; }
});

// ── THE SECOND WITNESS ──────────────────────────────────────────────────────────────────────────
// Everything above is the two halves of one module agreeing with each other, which they would do
// even if the runner never emitted a line. These two assert the other end.

test('every result the run loop pushes announces its lane — there is no bare results.push', () => {
  // Three of the loop's exits predate the announcement and a fourth added later would leave the
  // panel spinning a lane forever. One call site does both, and this is what keeps it that way.
  const src = readFileSync(join(CW, 'bin', 'commitwork.mjs'), 'utf8');
  const at = src.indexOf('function cmdRun(');
  assert.ok(at > -1, 'cmdRun not found — this guard is anchored to it');
  const loopAt = src.search(/for \(const (?:\[ix, check\]|check) of checks(?:\.entries\(\))?\) \{/);
  assert.ok(loopAt > -1, 'the run loop not found');
  const body = src.slice(loopAt, src.indexOf('\n  printSummary(results);', loopAt));
  const bare = body.split('\n')
    .map((l, i) => [i, l])
    .filter(([, l]) => /results\.push\(/.test(l) && !/^\s*\/\//.test(l) && !/finish = /.test(l));
  // the one legitimate occurrence is inside finish() itself
  assert.equal(bare.length, 1, `these push a result without announcing the lane:\n${bare.map(([i, l]) => `  +${i}: ${l.trim()}`).join('\n')}`);
  assert.match(bare[0][1], /^\s*results\.push\(r\);\s*$/, 'the single push must be finish()\'s own');
});

test('the runner really emits the lines — executed, not read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-lane-'));
  const repo = join(dir, 'subject');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# subject\n');
  const manifest = join(dir, 'commitwork.json');
  writeFileSync(manifest, JSON.stringify({
    repo: repo,
    checks: [
      { id: 'always-runs', local: ['true'] },
      // a lane that cannot apply here: it must still announce a start AND an end, or the panel
      // shows it spinning for the rest of the sweep
      { id: 'never-applies', local: ['true'], appliesIfExists: ['nothing-here.toml'] },
    ],
  }));
  let out;
  try {
    out = execFileSync('node', [join(CW, 'bin', 'commitwork.mjs'), 'run', '--manifest', manifest, '--repo', repo],
      { cwd: CW, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, CW_LANE_PROGRESS: '1', NO_COLOR: '1' } });
  } catch (e) {
    // a non-zero exit is fine — a failing check still has to announce itself. An unreadable run
    // is not: an empty capture would let this test pass on a runner that printed nothing at all.
    out = `${e.stdout || ''}${e.stderr || ''}`;
    assert.ok(out.trim(), `the runner produced no output at all (status ${e.status}) — nothing was measured here`);
  }
  const lanes = out.split('\n').map(parseLaneProgress).filter(Boolean);
  assert.ok(lanes.length >= 4, `expected a start and an end for each of 2 lanes, got ${lanes.length}:\n${out}`);
  for (const id of ['always-runs', 'never-applies']) {
    const mine = lanes.filter((l) => l.check === id);
    assert.ok(mine.some((l) => l.event === 'start'), `${id} never announced a start`);
    assert.ok(mine.some((l) => l.event === 'end'),
      `${id} announced a start and never an end — the panel would spin this lane forever`);
  }
  assert.equal(lanes[0].repo, 'subject', 'the repo name travels, so a fleet sweep can say which subject a lane is on');
});

test('and prints none of them when the flag is unset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-lane-off-'));
  const repo = join(dir, 'subject');
  mkdirSync(repo, { recursive: true });
  const manifest = join(dir, 'commitwork.json');
  writeFileSync(manifest, JSON.stringify({ repo: repo, checks: [{ id: 'always-runs', local: ['true'] }] }));
  let out;
  try {
    out = execFileSync('node', [join(CW, 'bin', 'commitwork.mjs'), 'run', '--manifest', manifest, '--repo', repo],
      { cwd: CW, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, CW_LANE_PROGRESS: '', NO_COLOR: '1' } });
  } catch (e) { out = `${e.stdout || ''}${e.stderr || ''}`; }
  assert.equal(out.split('\n').map(parseLaneProgress).filter(Boolean).length, 0,
    'the flag is the whole contract with everyone who runs this in a terminal');
});
