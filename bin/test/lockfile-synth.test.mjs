// A repo that declares dependencies without pinning them reports zero CVEs and reads exactly like a
// clean one — 19 of the 100randomrepos corpus are in that state. This lane resolves a version set so
// the CVE lane has something to match, and every way it can decline must say so rather than look
// like success.
//
// The docker-dependent path is not exercised here (it needs a registry and a container). What IS
// pinned is every state the script reaches BEFORE docker, because those are the ones that could
// quietly claim work they did not do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lockfile-synth.sh');
const T = mkdtempSync(join(tmpdir(), 'cw-locksynth-'));

function run(files) {
  const src = mkdtempSync(join(T, 'src-'));
  const out = mkdtempSync(join(T, 'out-'));
  for (const [name, body] of Object.entries(files)) {
    const p = join(src, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  const r = spawnSync('bash', [SCRIPT, src], { encoding: 'utf8', env: { ...process.env, CW_REPORT_DIR: out } });
  let json = null;
  try { json = JSON.parse(readFileSync(join(out, 'lockfile-synth.json'), 'utf8')); } catch { /* asserted */ }
  return { r, json, src, out };
}

test('an already-pinned tree is declined explicitly — never a silent success', () => {
  const { json } = run({ 'package.json': '{"name":"x"}', 'package-lock.json': '{"lockfileVersion":3}' });
  assert.ok(json, 'a summary is always written');
  assert.equal(json.ran, true);
  assert.equal(json.synthesised, false, 'nothing was synthesised and the flag says so');
  assert.match(json.reason, /already present/);
});

test('each lockfile flavour is recognised, not just npm\'s', () => {
  for (const lf of ['npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']) {
    const { json } = run({ 'package.json': '{"name":"x"}', [lf]: 'x' });
    assert.equal(json.synthesised, false, `${lf} should count as pinned`);
    assert.match(json.reason, new RegExp(lf.replace('.', '\\.')));
  }
});

test('no package.json is a SKIP with a reason, not a success with zero packages', () => {
  const { json } = run({ 'README.md': '# x' });
  assert.equal(json.ran, false);
  assert.equal(json.skipped, true);
  assert.match(json.reason, /no package\.json/);
});

test('a missing source directory is refused rather than resolved as empty', () => {
  const out = mkdtempSync(join(T, 'out-'));
  const r = spawnSync('bash', [SCRIPT, join(T, 'does-not-exist')], { encoding: 'utf8', env: { ...process.env, CW_REPORT_DIR: out } });
  const json = JSON.parse(readFileSync(join(out, 'lockfile-synth.json'), 'utf8'));
  assert.equal(json.ran, false);
  assert.match(json.reason, /does not exist/);
  assert.equal(r.status, 0, 'a skip is not a crash — the sweep continues');
});

test('the summary always parses as JSON, whatever the outcome', () => {
  // Every exit path writes the summary through one emit(), because a lane whose failure produces an
  // unparseable file turns a declined run into an unreadable one.
  for (const files of [{ 'package.json': '{"name":"x"}', 'yarn.lock': 'x' }, { 'README.md': '#' }]) {
    const { json } = run(files);
    assert.ok(json && typeof json.ran === 'boolean', 'ran is always present and boolean');
  }
});

test('the script REFUSES the host — resolution is container-only by construction', async () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /docker info >\/dev\/null 2>&1 \|\| skip/, 'no docker, no run');
  assert.match(src, /--ignore-scripts/, 'lifecycle scripts must never execute for an untrusted manifest');

  // The isolation is no longer written here: since 2026-08-26 both container phases take their
  // flags from bin/lib/sandbox.mjs, so that this lane and the four others are reviewed in one
  // place. Asserting the literal `--cap-drop ALL` in this file would now assert that the flags
  // were RE-DERIVED, which is the thing the shared definition exists to stop. So assert the
  // effect instead, and derive the expected flags from the library rather than restating them.
  const postures = [...src.matchAll(/sandbox\.mjs"?\s+--posture\s+(\w+)/g)].map((m) => m[1]);
  assert.equal(postures.length, 2, 'both the python and the npm phase must go through the sandbox');
  assert.deepEqual([...new Set(postures)], ['resolve'],
    'both phases must ask for `resolve` — the posture that allows egress and forbids a source mount');

  const { buildSandbox, POSTURES } = await import('../lib/sandbox.mjs');
  // `resolve` declares hostUser, and buildSandbox refuses outright where the platform exposes no
  // uid:gid — correct, and it took this assertion down on Windows even though nothing here is about
  // uid. Same stub, and same reasoning, as bin/test/sandbox.test.mjs, which also pins the refusal
  // itself: an ordinary id (never 0, which would trip the genuine root warning), restored after.
  const realIds = { uid: process.getuid, gid: process.getgid };
  if (typeof process.getuid !== 'function') { process.getuid = () => 1000; process.getgid = () => 1000; }
  let args;
  try { ({ args } = buildSandbox({ posture: 'resolve', name: 'cw-test', mounts: [{ host: '/w', path: '/work', mode: 'rw' }] })); }
  finally {
    if (realIds.uid) process.getuid = realIds.uid; else delete process.getuid;
    if (realIds.gid) process.getgid = realIds.gid; else delete process.getgid;
  }
  assert.ok(args.includes('--cap-drop') && args.includes('ALL'), 'the posture this script asks for must drop caps');
  assert.ok(args.includes('no-new-privileges'), 'and block privilege escalation');
  assert.equal(POSTURES.resolve.allowSourceMount, false,
    'and structurally refuse the source tree — this is what makes the assertion below unfalsifiable by accident');

  // The source tree is never mounted into the resolving container at all — only a copy of the
  // manifest is. A scanner that edits the repository it is scanning is a defect this fleet has
  // already paid for once.
  assert.ok(!/-v "\$SRC_ABS"/.test(src), 'the source directory must not be mounted into the container');
  assert.ok(!/--mount-source/.test(src), 'nor may it arrive through the sandbox');
});

test('a python manifest is recognised, and npm wins when a repo declares both', () => {
  // Every fixture here pairs the manifest with a lockfile so the script exits at the already-pinned
  // check. A bare pyproject.toml would send it into a CONTAINER and out to PyPI — a unit test that
  // spins docker and hits the network is slow, flaky, and not testing what it claims to.
  const py = run({ 'pyproject.toml': '[project]\nname="x"\n', 'uv.lock': 'x' });
  assert.ok(py.json, 'a summary is always written');
  assert.ok(!/no package\.json, pyproject/.test(py.json.reason || ''), 'pyproject must be a recognised manifest');

  // A polyglot repo resolves ONE manifest per run by design; npm is evaluated first so the choice is
  // deterministic rather than filesystem-order dependent.
  const both = run({ 'package.json': '{"name":"x"}', 'pyproject.toml': '[project]\nname="x"\n', 'yarn.lock': 'x' });
  assert.match(both.json.reason, /yarn\.lock already present/, 'the npm side is evaluated first');

  // requirements.txt recognition is asserted against the source, for the same reason.
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /-f "\$SRC_ABS\/requirements\.txt"/, 'requirements.txt must be a recognised entry point');
});

test('an existing python lockfile counts as pinned — nothing to synthesise', () => {
  for (const lf of ['uv.lock', 'poetry.lock', 'Pipfile.lock']) {
    const { json } = run({ 'pyproject.toml': '[project]\nname="x"\n', [lf]: 'x' });
    assert.equal(json.synthesised, false, `${lf} means the tree is already pinned`);
    assert.match(json.reason, new RegExp(lf.replace('.', '\\.')));
  }
});

test('the python path declares whether third-party build code ran', () => {
  // pip-compile reads sdist metadata by EXECUTING that package's build backend. Wheel-only
  // resolution avoids it; permissive resolution does not. A consumer that cannot tell the two apart
  // is being asked to trust them equally, and they are not equal.
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /--only-binary=:all:/, 'pass 1 must be wheel-only');
  assert.match(src, /buildBackendsExecuted/, 'and the result must say which pass produced it');
  // Forbid it being PASSED, not mentioned — the script's comment names it as the wrong flag, and a
  // test that cannot tell a warning from a use forbids documenting the trap it guards. Second time
  // this exact over-strictness has bitten in one session.
  assert.ok(!/pyrun\s+'[^']*no-build-isolation/.test(src) && !/pip-compile[^\n]*--no-build-isolation/.test(src),
    '--no-build-isolation is the OPPOSITE flag — it makes builds LESS isolated, and must never be passed');
  // setup.py is not copied: copying it is the difference between resolving a manifest and running one.
  assert.ok(!/cp "\$SRC_ABS\/setup\.py"/.test(src), 'setup.py must never enter the scratch dir');
});

test('the synthesised lockfile keeps the CANONICAL name — osv-scanner selects by filename', () => {
  // A valid npm lockfile named package-lock.synth.json is rejected with "could not determine
  // extractor suitable to this file". The synthetic-ness is carried by the directory instead.
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /lockfile-synth\/package-lock\.json/, 'canonical filename inside a synth directory');
  // Forbid the renamed form being USED as a path, not merely mentioned — the script's own comment
  // names it as the shape that fails, and a test that cannot tell a citation from a use would
  // forbid explaining the bug it guards.
  assert.ok(!/(cp|>|")\s*"?\$\{?OUT\}?\/package-lock\.synth\.json/.test(src),
    'the renamed lockfile must not be written as an output path — osv-scanner parses it as nothing');
});
