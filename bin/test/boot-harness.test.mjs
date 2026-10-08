// The four runtime lanes have scanned 0 of 100 repos because none has a live URL, and a lane that
// never runs is indistinguishable from one that runs clean. This harness boots a repo so they have
// a target — which makes it the only lane that EXECUTES the scanned project's application code.
//
// The states it must keep apart, because collapsing any two manufactures a wrong conclusion:
//   bootable:false                 a library or CLI. Normal. NOT a scan failure, and ~90 of 100
//                                  repos are here — measured: 4 declare a root compose, 20 a root
//                                  Dockerfile, several of those being CLI tools.
//   bootable:true needsConfig      declares a way to run, needs secrets it correctly does not ship.
//                                  Would boot for its maintainer. The dominant failure.
//   bootable:true booted:false     declared a way to run and did not. A real problem.
//   booted:true                    a target exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'boot-harness.sh');
const T = mkdtempSync(join(tmpdir(), 'cw-boot-'));

// A BOUND ON THE SPAWN ITSELF, deliberately redundant with the `timeout` wrappers inside
// boot-harness.sh. The house rule is a second witness that cannot share the first's failure mode:
// those wrappers fail if a docker call is added later without one, this fails whatever the cause.
//
// It is not hypothetical. Measured 2026-09-04: a wedged docker daemon made `docker info` block
// rather than fail, and because spawnSync freezes the entire event loop, the runner printed every
// test and never reached its summary. gate-tests read the truncated output as "no tally" on 27.8%
// of 526 firings, and 46 orphaned `docker info` processes had piled up, one per suite run.
// `--test-timeout=0` is in the runner's flags, so node's own per-test timeout can never rescue it.
// A synchronous spawn with no timeout is an unbounded hold on the whole process — never write one.
const SPAWN = { encoding: 'utf8', timeout: 120_000, killSignal: 'SIGKILL' };

// A LIVE DAEMON IS A PRECONDITION, AND ITS ABSENCE IS A SKIP — NOT A FAILURE.
// Two of these tests drive the script far enough to need docker running. Bounding the hang above
// turned "the suite freezes" into "these two tests fail", which is better but still wrong: a red
// here says the harness is broken when the truth is that this box has no daemon. That is the same
// explicit uncertainty rule the fleet applies to scan lanes, owed to our own suite.
// Probed ONCE, bounded, and the reason is carried into the skip so a reader is never left guessing
// whether the lane was exercised. The tests that only read the script's source need no daemon and
// keep running either way.
const DOCKER = (() => {
  const r = spawnSync('docker', ['info'], { encoding: 'utf8', timeout: 15_000, killSignal: 'SIGKILL' });
  if (r.error) return { up: false, why: `docker could not be executed: ${r.error.code || r.error.message}` };
  if (r.signal) return { up: false, why: `docker info was killed (${r.signal}) — the daemon is wedged, not merely down` };
  return r.status === 0
    ? { up: true, why: '' }
    : { up: false, why: `docker info exited ${r.status} — daemon not running` };
})();
const needsDocker = DOCKER.up ? {} : { skip: `needs a responsive docker daemon: ${DOCKER.why}` };

function run(files) {
  const src = mkdtempSync(join(T, 'src-'));
  const out = mkdtempSync(join(T, 'out-'));
  for (const [name, body] of Object.entries(files)) {
    const p = join(src, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  const r = spawnSync('bash', [SCRIPT, src], { ...SPAWN, env: { ...process.env, CW_REPORT_DIR: out } });
  let json = null;
  try { json = JSON.parse(readFileSync(join(out, 'boot-harness.json'), 'utf8')); } catch { /* asserted */ }
  return { r, json };
}

test('a library with no compose and no Dockerfile is NOT-BOOTABLE, not a failure', needsDocker, () => {
  const { r, json } = run({ 'package.json': '{"name":"lib"}', 'README.md': '# lib' });
  assert.ok(json);
  assert.equal(json.ran, true);
  assert.equal(json.bootable, false, 'declaring no way to run itself is normal for a library');
  assert.match(json.reason, /NOT a scan failure/);
  assert.equal(r.status, 0, 'and it must not fail the sweep');
});

test('a missing source directory is a SKIP, distinct from a repo that cannot boot', () => {
  const out = mkdtempSync(join(T, 'out-'));
  const r = spawnSync('bash', [SCRIPT, join(T, 'nope')], { ...SPAWN, env: { ...process.env, CW_REPORT_DIR: out } });
  const json = JSON.parse(readFileSync(join(out, 'boot-harness.json'), 'utf8'));
  assert.equal(json.ran, false, 'the harness did not run at all — different from running and finding nothing to boot');
  assert.equal(json.skipped, true);
  assert.equal(r.status, 0);
});

test('every compose filename spelling is recognised', needsDocker, () => {
  // A repo using compose.yaml must not be reported as declaring no way to run itself.
  for (const f of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const { json } = run({ [f]: 'services: {}\n' });
    assert.notEqual(json.bootable, false, `${f} should be recognised as a declared boot path`);
  }
});

test('the harness refuses the host and tears down unconditionally', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /docker info >\/dev\/null 2>&1 \|\| skip/, 'no docker, no boot — this lane runs the project');
  assert.match(src, /trap cleanup EXIT INT TERM/, 'teardown on success, failure AND interrupt');
  assert.match(src, /docker rm -f "\$STAMP"/);
  assert.match(src, /docker network rm "\$STAMP-net"/);
  // The trap is registered BEFORE anything is created, or an early failure leaks a container.
  assert.ok(src.indexOf('trap cleanup') < src.indexOf('docker network create'),
    'the trap must be registered before the first resource is created');
});

test('EVERY docker invocation is bounded — an unbounded one froze the suite for 27.8% of gate firings', () => {
  // The assertions above match a SUBSTRING, so they keep passing if the `timeout` prefix is
  // removed again. This one asserts the property instead of the marker.
  //
  // A wedged daemon does not fail, it BLOCKS. Measured 2026-09-04: `docker info` returned rc=124
  // under `timeout 8`, 46 orphaned `docker info` processes had accumulated, and because this
  // script is invoked with spawnSync the block froze the whole runner — every test printed, no
  // summary, read downstream as "no tally". The long calls were guarded from the start; the
  // liveness probe and the teardown calls were not, which is the wrong way round: teardown is in
  // an EXIT trap, so a block there wedges cleanup and leaks the next orphan.
  const src = readFileSync(SCRIPT, 'utf8');
  const unbounded = [];
  src.split('\n').forEach((line, i) => {
    const l = line.trim();
    if (l.startsWith('#')) return;                       // a comment naming docker invokes nothing
    // `command -v docker` tests existence and cannot block on the daemon.
    if (!/(^|[|&;(]\s*|\$\()\s*docker\s/.test(l)) return;
    if (/command -v docker/.test(l)) return;
    if (/\btimeout\s+("?\$\w+"?|\d+)\s+docker\b/.test(l)) return;
    unbounded.push(`${i + 1}: ${l.slice(0, 80)}`);
  });
  assert.deepEqual(unbounded, [],
    'every docker call must be wrapped in `timeout` — an unbounded one is an unbounded hold on any caller that spawns this script synchronously');
});

test('the source tree is COPIED, never mounted — a compose file may bind-mount its own source', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /cp -R "\$SRC_ABS\/\." "\$CTX\/"/, 'build context is a copy');
  assert.ok(!/-v "\$SRC_ABS"/.test(src), 'the real source directory must never be mounted into a running container');
});

test('needs-config is its own state and does not invent credentials', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /needsConfig/, 'the dominant failure has its own flag');
  assert.match(src, /will not invent credentials/,
    'supplying a fabricated .env would boot something the maintainer never runs');
});

test('a published port that does not answer is NOT a target', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /nothing answered within/,
    'pointing a scanner at a dead port would report a clean scan of nothing — the false clean this fleet exists to refuse');
});
