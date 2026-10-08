// The fleet driver's resource behaviour. Source properties are pinned where running the driver
// would spawn real sweeps; the per-area runner itself (monitor/area-child.mjs) is exercised for
// real against children that flood stdout, hang, and leave an orphan holding their output.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'sweep.mjs'), 'utf8');
const RUNNER_SRC = readFileSync(join(HERE, '..', 'area-child.mjs'), 'utf8');
// the fan-out block only — everything from the fleet branch to the fleet summary
const DRIVER_SRC = (() => {
  const a = SRC.indexOf('if (sweepAll && !process.env.CW_SWEEP_CHILD)');
  assert.ok(a > -1, 'the fleet driver block was not found in sweep.mjs — this test needs updating');
  const b = SRC.indexOf('fleet-wide finalise, ONCE', a);
  assert.ok(b > a, 'the end of the fan-out block was not found');
  return SRC.slice(a, b);
})();
// comments stripped before asserting — the block's own comments name the refused constructs, so
// an un-stripped search reports the fix as the bug
// split(/\r?\n/): on a CRLF checkout `//.*$` strips NOTHING (`.` does not match `\r`, `$` without
// `m` is end-of-string), so the comment removal this test depends on silently did not happen. It
// passes today only because sweep.mjs's driver comments happen not to contain `execFile(` or
// `maxBuffer` — i.e. by luck. The comment two lines up states the failure mode exactly: an
// un-stripped search reports the fix as the bug. Latent, not yet firing, and fixed while it is
// still cheap.
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/)
  .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
const DRIVER = strip(DRIVER_SRC);
const RUNNER = strip(RUNNER_SRC);

describe('the fleet driver does not buffer a child sweep into memory', () => {
  test('it spawns rather than execFile-ing the per-area children', () => {
    assert.match(DRIVER, /runAreaChild\(/, 'the driver hands each area to the shared runner');
    assert.match(RUNNER, /spawn\(/, 'children must be spawned so their output can be streamed');
    assert.doesNotMatch(DRIVER, /execFile\(/,
      'execFile accumulates the whole child output in RAM before resolving — with --jobs N that is N x maxBuffer');
  });

  test('no maxBuffer ceiling remains — exceeding one KILLS the child rather than truncating', () => {
    assert.doesNotMatch(DRIVER, /maxBuffer/,
      'a maxBuffer in the fan-out means a verbose area can be terminated by its own logging');
  });

  test('output is streamed to a per-area log file, with only a bounded tail kept in memory', () => {
    assert.match(RUNNER, /createWriteStream\(/, 'the full output belongs on disk, not in a variable');
    assert.match(RUNNER, /TAIL_BYTES/, 'the in-memory retention must be an explicit bound');
    assert.match(RUNNER, /slice\(-TAIL_BYTES\)/, 'the tail must be truncated as it accumulates, not at the end');
  });
});

describe('a hung area cannot hold its worker slot forever', () => {
  test('there is a timeout, and it is env-overridable with a floor', () => {
    assert.match(DRIVER, /CW_SWEEP_AREA_TIMEOUT_MS/, 'the timeout must be overridable per the CW_* convention');
    assert.match(DRIVER, /Math\.max\(\s*60_000/, 'a floor stops a typo setting an unusably short timeout');
  });

  test('the kill escalates SIGTERM -> SIGKILL so the child can release its lock first', () => {
    assert.match(RUNNER, /'SIGTERM'/, 'SIGTERM first — the child holds an area lock');
    assert.match(RUNNER, /'SIGKILL'/, 'SIGKILL after a grace period, for a child that will not go');
  });

  test('a timed-out area is reported as PARTIAL, distinctly from a non-zero exit', () => {
    // "we stopped looking" and "the area failed" are different facts
    assert.match(DRIVER, /timedOut/, 'the timeout must travel with the result');
    assert.match(RUNNER, /timedOut/, 'the runner reports it');
    assert.match(SRC, /TIMED OUT/, 'and be visible in the fleet summary');
    assert.match(SRC, /PARTIAL/, 'and be named as partial coverage, not merely a failure');
  });
});

// ── the streaming primitive itself, exercised for real against a child that floods stdout ──────
describe('the stream-and-tail shape holds against a child that floods stdout', () => {
  test('memory stays bounded while the full output still reaches disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-sweep-'));
    try {
      const script = join(dir, 'flood.mjs');
      // 8 MB of output — far past the 256 KB tail, and past what a test should hold in memory
      writeFileSync(script, `
        const line = 'x'.repeat(1023) + '\\n';
        for (let i = 0; i < 8192; i++) process.stdout.write(line);
        process.stdout.write('FINAL-MARKER\\n');
      `);
      const logPath = join(dir, 'out.log');
      const TAIL_BYTES = 256 * 1024;
      const out = await new Promise((res) => {
        const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
        const sink = createWriteStream(logPath);
        let tail = '';
        const absorb = (buf) => { const s = String(buf); sink.write(s); tail = (tail + s).slice(-TAIL_BYTES); };
        child.stdout.on('data', absorb);
        child.stderr.on('data', absorb);
        child.on('close', (code) => { sink.end(() => res({ code, tail })); });
      });
      assert.equal(out.code, 0);
      assert.ok(out.tail.length <= TAIL_BYTES,
        `the retained tail must never exceed the cap, got ${out.tail.length}`);
      assert.match(out.tail, /FINAL-MARKER/,
        'the tail must hold the END of the output — that is where a failure summary is');
      const onDisk = readFileSync(logPath, 'utf8');
      assert.ok(onDisk.length > 8 * 1024 * 1024,
        `the FULL output must reach disk (${onDisk.length} bytes) even though only the tail was kept`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ── the per-area runner, run for real ─────────────────────────────────────────────────────────
// Measured 2026-09-18: a fleet sweep waited 7h on an area whose child had been killed at the
// 4h timeout, because a grandchild (verdict-journal --anchor, deadlocked in Node teardown) was
// reparented to launchd still holding the inherited stdout. These reproduce both halves.
import { runAreaChild } from '../area-child.mjs';
import { pidAlive } from '../../lib/pid-alive.mjs';

// A killed process nothing reaps stays a zombie that kill(0) still finds; pidAlive reads it dead.
const alive = (pid) => pidAlive(pid);

describe('an area cannot outlive its own exit or its timeout through a descendant', () => {
  test('a child that exits leaving a grandchild on its stdout resolves after the grace, and the orphan is killed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-area-'));
    try {
      const pidFile = join(dir, 'grandchild.pid');
      const script = join(dir, 'leaves-orphan.mjs');
      // The grandchild inherits stdout and sleeps; the child exits at once.
      writeFileSync(script, `
        import { spawn } from 'node:child_process';
        import { writeFileSync } from 'node:fs';
        const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
        writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
        console.log('child done');
        process.exit(0);
      `);
      const t0 = Date.now();
      const out = await runAreaChild({ command: process.execPath, args: [script], env: process.env,
        logPath: join(dir, 'out.log'), timeoutMs: 60_000, stdioGraceMs: 1_000 });
      const grandchild = Number(readFileSync(pidFile, 'utf8'));
      assert.ok(Date.now() - t0 < 20_000, `must resolve after the grace, not wait on close (${Date.now() - t0}ms)`);
      assert.equal(out.code, 0);
      assert.equal(out.stdioHeld, true, 'a descendant holding the output is reported, not silently waited on');
      assert.equal(out.timedOut, false);
      assert.match(out.tail, /PARTIAL/, 'the slice is named partial in its own log');
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(alive(grandchild), false, 'the orphan holding the pipe is killed with the group');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a timeout kills the whole process group, including a grandchild the child is blocked on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-area-'));
    try {
      const pidFile = join(dir, 'grandchild.pid');
      const script = join(dir, 'blocked.mjs');
      // The shape of the real hang: the child blocks in execFileSync on a grandchild that never exits.
      writeFileSync(script, `
        import { execFileSync } from 'node:child_process';
        execFileSync(process.execPath, ['-e', 'require("fs").writeFileSync(' + JSON.stringify(${JSON.stringify(pidFile)}) + ', String(process.pid)); setTimeout(() => {}, 600000)'], { stdio: 'inherit' });
      `);
      const t0 = Date.now();
      const out = await runAreaChild({ command: process.execPath, args: [script], env: process.env,
        logPath: join(dir, 'out.log'), timeoutMs: 2_000, killGraceMs: 1_000, stdioGraceMs: 1_000 });
      assert.ok(Date.now() - t0 < 20_000, `must resolve soon after the timeout (${Date.now() - t0}ms)`);
      assert.equal(out.timedOut, true);
      const grandchild = Number(readFileSync(pidFile, 'utf8'));
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(alive(grandchild), false, 'killing only the direct child is what left the 2026-09-18 orphan');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
