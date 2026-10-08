// The execution boundary wired into scanner records: probe evidence reduced to measured effects,
// the per-command threat model built from declarations and those effects, the host effects harness
// (with injected spawns for every outcome, and live where the host can confine), its listener and
// scratch lifecycle, and the runner writing the model onto checks-status rows and scan cells.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BOUNDARY_PROBES, EGRESS_PROBE_ADDRESS, LISTENER_MARK, PHASES, THREATS, THREAT_STATUS, checkScratchBase, closeLoopbackListener, compactBoundaries, laneBoundary,
  laneWriteRoots, loopbackFromProbes, loopbackListener, measureHostEffects, measuredFromProbes, probePosture, resetBoundaryProbes, scratchBase, sweepStaleScratch, threatModel,
} from '../lib/isolation.mjs';
import { buildSandbox, hostSandboxArgv, probeHostSandbox } from '../lib/sandbox.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ISOLATION_URL = pathToFileURL(join(ROOT, 'bin', 'lib', 'isolation.mjs')).href;
const POSIX_HOST = process.platform === 'darwin' || process.platform === 'linux';
const NOT_POSIX = 'the host sandbox spec takes POSIX paths and exists only on darwin and linux';

const probes = (over = {}) => BOUNDARY_PROBES.map((probe) => ({
  probe,
  outcome: over[probe] ?? (['permitted-read', 'network-control', 'loopback-control'].includes(probe) ? 'allowed' : 'denied'),
  reason: null,
}));
const SPEC = {
  egress: 'none', repoPath: '/work/repo', reportDir: '/work/reports/r1', platform: 'darwin', cwRoot: '/opt/commitwork',
  nodePrefix: '/opt/node', tmpDir: '/work/tmp', home: '/Users/user', developerDir: null,
};
const lane = (over = {}) => ({ id: 'lane-x', local: ['semgrep scan --config auto .'], requires: { tools: ['semgrep'] }, executesRepoCode: true, ...over });
const host = (over = {}, effects = { probes: probes() }, spec = SPEC) => threatModel({ check: lane(over), adapter: 'host-sandbox', spec, effects });
const threat = (cmd, name) => cmd.threats.find((t) => t.threat === name);
const alivePid = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const childrenOf = (pid) => spawnSync('ps', ['-A', '-o', 'pid=,ppid=,stat='], { encoding: 'utf8' }).stdout.split('\n')
  .map((l) => l.trim().split(/\s+/)).filter((c) => c[1] === String(pid));
const gone = (pid, ms = 5000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') return true; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return false;
};

describe('measured effects come only from well-formed probe evidence', () => {
  test('positive control: the read control ran and every denial is evidenced', () => {
    assert.deepEqual(measuredFromProbes(probes()), { ran: true, credentialReadDenied: true, writeEscapeDenied: true, egressDenied: true });
  });

  test('a denied egress counts only beside a network control that connected', () => {
    for (const control of ['denied', 'error', 'not-run']) {
      const m = measuredFromProbes(probes({ 'network-control': control }));
      assert.equal('egressDenied' in m, false, control);
    }
    const m = measuredFromProbes(probes({ 'network-control': 'error', egress: 'allowed' }));
    assert.equal(m.egressDenied, false, 'a connection that happened is a breach whatever the control did');
  });

  test('a failed positive control is not a run, and an errored one is no evidence of a run', () => {
    assert.equal(measuredFromProbes(probes({ 'permitted-read': 'denied' })).ran, false);
    for (const o of ['error', 'not-run']) assert.equal('ran' in measuredFromProbes(probes({ 'permitted-read': o })), false, o);
  });

  test('malformed, unknown and conflicting probe records are not evidence', () => {
    for (const bad of [undefined, null, 'probes', { 0: probes()[0] }, 7]) assert.equal(measuredFromProbes(bad), undefined);
    assert.deepEqual(measuredFromProbes([]), {});
    assert.deepEqual(measuredFromProbes([{ probe: 'permitted-read', outcome: 'yes' }, { probe: 'other', outcome: 'allowed' }, null, ['x']]), {});
    const conflicted = [...probes(), { probe: 'write-escape', outcome: 'allowed', reason: null }];
    assert.equal('writeEscapeDenied' in measuredFromProbes(conflicted), false, 'a probe reported both ways is no evidence either way');
    const repeated = [...probes(), { probe: 'write-escape', outcome: 'denied', reason: null }];
    assert.equal(measuredFromProbes(repeated).writeEscapeDenied, true);
  });

  test('loopback is kept from the lane only beside a control that reached it, after a run that is evidenced', () => {
    assert.equal(loopbackFromProbes(probes()), true);
    assert.equal(loopbackFromProbes(probes({ loopback: 'allowed' })), false);
    for (const control of ['denied', 'error', 'not-run']) assert.equal(loopbackFromProbes(probes({ 'loopback-control': control })), undefined, control);
    assert.equal(loopbackFromProbes(probes({ 'permitted-read': 'error', loopback: 'allowed' })), undefined, 'no evidenced run, no evidence either way');
    assert.equal(loopbackFromProbes(null), undefined);
  });

  test('the reduction does not depend on probe order', () => {
    const p = probes({ egress: 'allowed' });
    assert.deepEqual(measuredFromProbes([...p].reverse()), measuredFromProbes(p));
  });
});

describe('the per-command threat model', () => {
  test('positive control: a confined lane with every control measured is a pass, and the record has its shape', () => {
    const r = host();
    assert.equal(r.state, 'pass');
    assert.equal(r.reason, 'required-controls-held');
    assert.equal(r.findingSource, null);
    assert.deepEqual(Object.keys(r), ['schemaVersion', 'check', 'scanner', 'adapter', 'executesRepoCode', 'executesRepoCodeBasis', 'probes', 'state', 'reason', 'findingSource', 'commands']);
    assert.equal(r.schemaVersion, 1);
    assert.equal(r.scanner, 'semgrep');
    assert.equal(r.adapter, 'host-sandbox');
    assert.deepEqual(r.probes.map((p) => p.probe), [...BOUNDARY_PROBES]);
    const [c] = r.commands;
    assert.deepEqual(Object.keys(c), ['command', 'posture', 'phase', 'state', 'reason', 'declarationRejected', 'declared', 'measured', 'controls', 'violations', 'unknowns', 'threats']);
    assert.equal(c.phase, 'execute');
    assert.deepEqual(c.declared.writeRoots, ['/@report', '/@tmp', '/tmp']);
    assert.ok(c.declared.readRoots.includes('/@repo'));
    assert.deepEqual(c.declared.credentialsMounted, []);
    assert.deepEqual(c.threats.map((t) => t.threat), [...THREATS]);
    assert.ok(c.threats.every((t) => t.status === 'mitigated'), JSON.stringify(c.threats));
    for (const t of c.threats) assert.ok(THREAT_STATUS.includes(t.status));
  });

  test('negative control: a forbidden credential read is a measured finding', () => {
    const r = host({}, { probes: probes({ 'credential-read': 'allowed' }) });
    assert.equal(r.state, 'finding');
    assert.equal(r.findingSource, 'measured');
    assert.deepEqual(r.commands[0].violations.map((v) => v.kind), ['credential-read']);
    assert.equal(threat(r.commands[0], 'credential-theft').status, 'exposed');
  });

  test('negative control: a write escape is a measured finding', () => {
    const r = host({}, { probes: probes({ 'write-escape': 'allowed' }) });
    assert.equal(r.state, 'finding');
    assert.equal(r.findingSource, 'measured');
    assert.equal(threat(r.commands[0], 'write-outside-roots').status, 'exposed');
  });

  test('negative control: egress that connected under network none is a finding on both egress threats', () => {
    const r = host({}, { probes: probes({ egress: 'allowed' }) });
    assert.equal(r.state, 'finding');
    assert.equal(threat(r.commands[0], 'exfiltration').status, 'exposed');
    assert.equal(threat(r.commands[0], 'repo-code-with-network').status, 'exposed');
  });

  test('allowed-network control: a declared networked lane that runs no repo code passes with egress accepted', () => {
    const r = host({ executesRepoCode: false }, { probes: probes({ egress: 'allowed' }) }, { ...SPEC, egress: 'registry' });
    assert.equal(r.state, 'pass');
    const c = r.commands[0];
    assert.equal(c.declared.network, 'open');
    assert.equal(c.phase, 'read');
    assert.equal(threat(c, 'exfiltration').status, 'accepted');
    assert.equal(threat(c, 'repo-code-with-network').status, 'not-applicable');
  });

  test('negative control: repo code that reached a loopback listener is a measured finding; an analyser that did is accepted', () => {
    const r = host({}, { probes: probes({ loopback: 'allowed' }) }, { ...SPEC, platform: 'linux', egress: 'registry' });
    assert.equal(r.state, 'finding');
    assert.equal(r.findingSource, 'measured');
    assert.ok(r.commands[0].violations.some((v) => v.kind === 'repo-code-reaches-loopback'));
    assert.deepEqual(threat(r.commands[0], 'local-service-reach'), { threat: 'local-service-reach', control: 'loopback', declared: 'not-filtered', measured: 'not-denied', status: 'exposed' });
    const a = host({ executesRepoCode: false }, { probes: probes({ loopback: 'allowed', egress: 'allowed' }) }, { ...SPEC, platform: 'linux', egress: 'registry' });
    assert.equal(a.state, 'pass');
    assert.equal(threat(a.commands[0], 'local-service-reach').status, 'accepted');
  });

  test('the loopback a profile grants is declared per platform and class', () => {
    const decl = (over) => threat(host({}, { probes: probes() }, { ...SPEC, ...over }).commands[0], 'local-service-reach').declared;
    assert.equal(decl({}), 'none');
    assert.equal(decl({ egress: 'registry' }), 'denied');
    assert.equal(decl({ egress: 'target', loopbackPorts: [8080] }), 'target-ports-only');
    assert.equal(decl({ egress: 'registry', platform: 'linux' }), 'not-filtered');
    assert.equal(threat(host({}, { probes: probes({ 'loopback-control': 'denied' }) }).commands[0], 'local-service-reach').status, 'unmeasured');
  });

  test('blocked egress without a working network control is unmeasured, not a pass', () => {
    const r = host({}, { probes: probes({ 'network-control': 'denied' }) });
    assert.equal(r.state, 'unmeasured');
    assert.equal(threat(r.commands[0], 'exfiltration').status, 'unmeasured');
  });

  test('build-executing lanes: a command that builds the tree executes repo code whatever the declaration', () => {
    const undeclared = threatModel({ check: lane({ executesRepoCode: undefined, local: ['cargo clippy --all-targets'] }), adapter: 'host-sandbox', spec: { ...SPEC, egress: 'registry' }, effects: { probes: probes({ egress: 'allowed' }) }, buildsTree: true });
    assert.equal(undeclared.executesRepoCode, true);
    assert.equal(undeclared.executesRepoCodeBasis, 'command-builds-tree');
    assert.equal(undeclared.state, 'finding');
    assert.equal(undeclared.findingSource, 'declared', 'open egress for repo code is a declaration, not a measured breach');
    assert.deepEqual(undeclared.commands[0].violations.map((v) => v.kind), ['repo-code-with-open-egress']);
    assert.equal(threat(undeclared.commands[0], 'repo-code-with-network').status, 'exposed');
    const contradicted = threatModel({ check: lane({ executesRepoCode: false }), adapter: 'host-sandbox', spec: SPEC, effects: { probes: probes() }, buildsTree: true });
    assert.equal(contradicted.executesRepoCodeBasis, 'contradicted-by-command');
    assert.equal(contradicted.commands[0].phase, 'execute');
    assert.equal(contradicted.state, 'pass', 'confined with every control measured, so building is contained');
  });

  test('an undeclared lane that does not build stays unmeasured rather than read as non-executing', () => {
    const r = host({ executesRepoCode: undefined });
    assert.equal(r.executesRepoCodeBasis, 'undeclared');
    assert.equal(r.state, 'unmeasured');
    assert.ok(r.commands[0].unknowns.some((u) => u.field === 'declared.executesRepoCode'));
    assert.equal(r.commands[0].phase, null);
  });

  test('warm/execute phase separation is declared per posture, per command', () => {
    const check = lane({
      requires: { docker: true },
      local: ['x=$(node bin/sandbox.mjs --posture fetch --name w) && docker run $x img pull', 'y=$(node bin/sandbox.mjs --posture analyse --name s) && docker run $y img scan'],
    });
    const r = threatModel({ check, adapter: 'container' });
    assert.deepEqual(r.commands.map((c) => [c.posture, c.phase, c.declared.network, c.declared.executesRepoCode]), [
      ['fetch', 'warm', 'open', false],
      ['analyse', 'execute', 'none', true],
    ]);
    assert.equal(threat(r.commands[0], 'repo-code-with-network').status, 'not-applicable');
    assert.equal(r.state, 'unmeasured', 'postures are declarations; nothing was measured for this run');
    assert.throws(() => buildSandbox({ posture: 'fetch', name: 'w', mounts: [{ host: '/work/repo', path: '/src', source: true }] }), /forbids mounting repo source/);
  });

  test('a posture that runs repo code with open egress is a declared finding; the proxied one needs its egress probe', () => {
    const boot = threatModel({ check: lane({ local: ['node bin/sandbox.mjs --posture boot --name b'] }), adapter: 'container' });
    assert.equal(boot.state, 'finding');
    assert.equal(boot.findingSource, 'declared');
    assert.equal(threat(boot.commands[0], 'repo-code-with-network').status, 'exposed');
    const proxied = threatModel({ check: lane({ local: ['node bin/sandbox.mjs --posture build-resolve --name j'] }), adapter: 'container' });
    assert.equal(proxied.commands[0].declared.network, 'restricted');
    assert.equal(proxied.state, 'unmeasured');
    assert.equal(threat(proxied.commands[0], 'repo-code-with-network').status, 'unmeasured');
  });

  test('a container posture measured breaching is a finding even with its mounts undeclared', () => {
    const check = lane({ local: ['node bin/sandbox.mjs --posture analyse --name a'] });
    const r = threatModel({ check, adapter: 'container', effects: { byPosture: { analyse: { probes: probes({ egress: 'allowed' }) } } } });
    assert.equal(r.state, 'finding');
    assert.equal(r.findingSource, 'measured');
    const ok = threatModel({ check, adapter: 'container', effects: { byPosture: { analyse: { probes: probes() } } } });
    assert.equal(ok.state, 'unmeasured', 'read and write roots are not in the command text');
  });

  test('a lane with no enforcement adapter is unmeasured, never a finding, even when it runs repo code', () => {
    for (const executesRepoCode of [true, false, undefined]) {
      const r = threatModel({ check: lane({ executesRepoCode }), adapter: null, effects: { probes: probes({ egress: 'allowed' }) } });
      assert.equal(r.state, 'unmeasured', String(executesRepoCode));
      assert.equal(r.reason, 'no-enforcement-adapter');
      assert.deepEqual(r.commands[0].violations, []);
    }
  });

  test('missing evidence is unmeasured', () => {
    for (const effects of [null, undefined, {}, { probes: [] }, { probes: 'all denied' }]) {
      const r = threatModel({ check: lane(), adapter: 'host-sandbox', spec: SPEC, effects });
      assert.equal(r.state, 'unmeasured', String(JSON.stringify(effects)));
      assert.ok(r.commands[0].threats.every((t) => t.status === 'unmeasured' || t.status === 'not-applicable'));
    }
    assert.equal(host({}, { probes: probes() }, null).state, 'unmeasured', 'no spec, no declared roots');
    assert.equal(host({}, { probes: probes({ 'permitted-read': 'not-run' }) }).state, 'unmeasured');
    const forged = host({}, { probes: probes({ 'permitted-read': 'error' }), measured: { ran: true, egressDenied: true, writeEscapeDenied: true, credentialReadDenied: true } });
    assert.equal(forged.state, 'unmeasured', 'a supplied measured section is ignored; only probes count');
    const claimed = { ran: true, egressDenied: true, writeEscapeDenied: true, credentialReadDenied: true };
    assert.equal(host({}, { measured: claimed }).state, 'unmeasured', 'a measured section with no probes behind it is a claim');
    const posture = threatModel({ check: lane({ local: ['node bin/sandbox.mjs --posture analyse --name a'] }), adapter: 'container', effects: { byPosture: { analyse: { measured: { ...claimed, egressDenied: false } } } } });
    assert.equal(posture.state, 'unmeasured', 'a claimed breach with no probes behind it is not a finding either');
  });

  test('malformed input is unmeasured', () => {
    for (const input of [null, undefined, 'lane', [], {}, { check: null }, { check: { id: '' } }, { check: { id: 5 } }]) {
      const r = threatModel(input);
      assert.equal(r.state, 'unmeasured');
      assert.equal(r.reason, 'malformed-input');
    }
    assert.equal(threatModel({ check: lane(), adapter: 'docker' }).reason, 'malformed-input');
    assert.equal(threatModel({ check: lane({ local: 'semgrep' }), adapter: 'host-sandbox', spec: SPEC, effects: { probes: probes() } }).reason, 'no-commands');
    const badCmd = threatModel({ check: lane({ local: [42] }), adapter: 'host-sandbox', spec: SPEC, effects: { probes: probes() } });
    assert.equal(badCmd.state, 'unmeasured');
    assert.equal(badCmd.commands[0].command, null);
    const badRoot = host({}, { probes: probes() }, { ...SPEC, extraReads: ['/work/a:b'] });
    assert.equal(badRoot.state, 'unmeasured', 'a root the boundary cannot normalise is not silently dropped');
  });

  test('a readable credential store is accepted for a lane that runs no repo code and exposed for one that does', () => {
    const read = host({ executesRepoCode: false }, { probes: probes() }, { ...SPEC, extraReads: ['~/.config/gh'] });
    assert.deepEqual(read.commands[0].declared.credentialsMounted, ['~/.config/gh']);
    assert.equal(threat(read.commands[0], 'credential-theft').declared, 'declarable-stores-readable');
    assert.equal(threat(read.commands[0], 'credential-theft').status, 'accepted');
    assert.equal(read.state, 'pass');
    const cargo = threatModel({ check: lane({ id: 'lint-rust-clippy', local: ['cargo clippy'], requires: { tools: ['cargo'] } }), adapter: 'host-sandbox',
      spec: { ...SPEC, toolPrefixes: ['/Users/user/.cargo'] }, effects: { probes: probes() }, buildsTree: true });
    assert.deepEqual(cargo.commands[0].declared.credentialsMounted, ['~/.cargo/credentials', '~/.cargo/credentials.toml']);
    assert.equal(cargo.state, 'finding');
    assert.equal(cargo.findingSource, 'declared');
    assert.deepEqual(cargo.commands[0].violations.map((v) => v.kind), ['repo-code-with-readable-credentials']);
    assert.equal(threat(cargo.commands[0], 'credential-theft').status, 'exposed');
  });

  test('boundary cases: the home directory and a host-equivalent root', () => {
    const home = host({}, { probes: probes() }, { ...SPEC, extraReads: ['~/'] });
    assert.equal(home.state, 'finding');
    assert.equal(home.commands[0].declarationRejected, true);
    assert.equal(threat(home.commands[0], 'credential-theft').status, 'exposed');
    const etc = host({}, { probes: probes() }, { ...SPEC, extraReads: ['/etc'] });
    assert.equal(etc.state, 'finding');
    assert.deepEqual(etc.commands[0].violations.map((v) => v.reason), ['host-equivalent']);
    const repoIsHome = host({}, { probes: probes() }, { ...SPEC, repoPath: '/Users/user' });
    assert.equal(repoIsHome.commands[0].declarationRejected, true, 'a scanned tree that is the home directory is not hidden behind a token');
  });

  test('a forbidden repository or report root is judged on its absolute path, then shown as its token', () => {
    const etc = host({}, { probes: probes() }, { ...SPEC, repoPath: '/etc/app' });
    assert.equal(etc.state, 'finding');
    assert.deepEqual(etc.commands[0].violations.map((v) => [v.reason, v.path]), [['host-equivalent', '/@repo']]);
    const other = host({}, { probes: probes() }, { ...SPEC, reportDir: '/Users/x' });
    assert.equal(other.state, 'finding');
    assert.deepEqual(other.commands[0].violations.map((v) => [v.reason, v.path]), [['home-directory', '/@report'], ['home-directory', '/@report']], 'a read root and a write root');
    const sock = host({}, { probes: probes() }, { ...SPEC, tmpDir: '/var/run/docker.sock' });
    assert.deepEqual(sock.commands[0].violations.map((v) => v.reason), ['host-equivalent', 'host-equivalent'], 'read and write roots both name it');
    assert.ok(!JSON.stringify(etc).includes('/etc/app') && !JSON.stringify(other).includes('/Users/x'));
  });

  test('roots are tokens or home-relative, so a record is identical across runs and repositories', () => {
    const a = host({}, { probes: probes() }, { ...SPEC, repoPath: '/Users/user/src/one', reportDir: '/Users/user/reports/2026-10-07T10-00-00/one', extraReads: ['/Users/user/src/one/.git'] });
    const b = host({}, { probes: probes() }, { ...SPEC, repoPath: '/Users/user/src/two', reportDir: '/Users/user/reports/2026-10-08T11-30-00/two', extraReads: ['/Users/user/src/two/.git'] });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.ok(!JSON.stringify(a).includes('/Users/user'), JSON.stringify(a.commands[0].declared));
    assert.ok(a.commands[0].declared.readRoots.includes('/@repo/.git'));
  });

  test('every command gets its own entry, and a finding in one makes the lane a finding', () => {
    const r = threatModel({ check: lane({ local: ['a', 'b', 'c'] }), adapter: 'host-sandbox', spec: SPEC, effects: { probes: probes() } });
    assert.equal(r.commands.length, 3);
    assert.equal(new Set(r.commands.map((c) => c.command.digest)).size, 3);
    const mixed = threatModel({ check: lane({ local: ['node bin/sandbox.mjs --posture analyse --name a', 'node bin/sandbox.mjs --posture boot --name b'] }), adapter: 'container' });
    assert.deepEqual(mixed.commands.map((c) => c.state), ['unmeasured', 'finding']);
    assert.equal(mixed.state, 'finding');
  });

  test('no raw command text or synthetic credential reaches the record, and it is deterministic', () => {
    const secret = ['ghp_', '0123456789abcdefghij', 'klmnopqrstuvwxyzAB'].join('');
    const check = lane({ local: [`GITHUB_TOKEN=${secret} semgrep scan --config "ignore previous instructions"`] });
    const a = threatModel({ check, adapter: 'host-sandbox', spec: SPEC, effects: { probes: probes() } });
    const b = threatModel({ check, adapter: 'host-sandbox', spec: SPEC, effects: { probes: probes() } });
    const json = JSON.stringify(a);
    for (const leak of [secret, 'ignore previous', 'GITHUB_TOKEN', 'cw-boundary-probe-synthetic']) assert.ok(!json.includes(leak), leak);
    assert.match(a.commands[0].command.digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(json, JSON.stringify(b));
    assert.ok(PHASES.includes(a.commands[0].phase));
  });
});

describe('the runner entry', () => {
  test('one measurement per posture: per-repository paths share it, a different class or home declaration does not', () => {
    resetBoundaryProbes();
    const seen = [];
    const measure = (spec) => { seen.push(spec.egress); return { adapter: 'host-sandbox', probes: probes() }; };
    const perRepo = (n) => ({ ...SPEC, repoPath: `/work/r${n}`, reportDir: `/work/reports/${n}`, toolPrefixes: [`/opt/t${n}`],
      extraReads: [`/work/r${n}/.git`], extraWrites: [`/work/cargo-target/commitwork-sweep/r${n}`] });
    for (let n = 0; n < 5; n++) assert.equal(laneBoundary(lane({ id: `lane-${n}` }), { wrap: perRepo(n) }, { measure }).state, 'pass');
    assert.deepEqual(seen, ['none']);
    laneBoundary(lane(), { wrap: { ...SPEC, extraReads: ['~/.cache/semgrep'], extraWrites: ['@usercache/x', './out'] } }, { measure });
    assert.deepEqual(seen, ['none'], 'paths that reach no credential store cannot change a probe');
    laneBoundary(lane(), { wrap: { ...SPEC, egress: 'registry' } }, { measure });
    laneBoundary(lane(), { wrap: { ...SPEC, egress: 'github' } }, { measure });
    assert.deepEqual(seen, ['none', 'registry'], 'every networked class compiles to the same rule');
    laneBoundary(lane(), { wrap: { ...SPEC, extraReads: ['~/.config/gh'] } }, { measure });
    laneBoundary(lane(), { wrap: { ...SPEC, extraWrites: ['~/'] } }, { measure });
    laneBoundary(lane(), { wrap: { ...SPEC, extraReads: ['~/Library'] } }, { measure });
    assert.deepEqual(seen, ['none', 'registry', 'none', 'none', 'none'], 'a declaration reaching a credential store is its own posture');
    assert.deepEqual(probePosture({ ...SPEC, extraReads: ['~/.config/gh/', '~/.cache/x', '/abs'] }).extraReads, ['~/.config/gh']);
    assert.deepEqual(probePosture(perRepo(1)), probePosture(perRepo(2)));
    assert.equal(laneBoundary(lane(), { wrap: null, isolation: 'none' }, { measure }).reason, 'no-enforcement-adapter');
    assert.equal(laneBoundary(lane({ local: ['node bin/sandbox.mjs --posture analyse --name a'] }), { wrap: null, isolation: 'full' }, { measure, container: true }).adapter, 'container');
    assert.equal(seen.length, 5);
    resetBoundaryProbes();
  });

  test('a harness that throws leaves the lane unmeasured rather than failing it', () => {
    resetBoundaryProbes();
    const r = laneBoundary(lane(), { wrap: SPEC }, { measure: () => { throw new Error('boom'); } });
    assert.equal(r.state, 'unmeasured');
    assert.equal(r.reason, 'boundary-error');
    assert.equal(r.check, 'lane-x');
    resetBoundaryProbes();
  });

  test('the build predicate reaches the model', () => {
    resetBoundaryProbes();
    const r = laneBoundary(lane({ executesRepoCode: undefined }), { wrap: SPEC }, { measure: () => ({ probes: probes() }), buildsTree: true });
    assert.equal(r.executesRepoCodeBasis, 'command-builds-tree');
    resetBoundaryProbes();
  });
});

const BASE = POSIX_HOST ? scratchBase() : null;
const noBase = !POSIX_HOST ? NOT_POSIX : BASE ? false : 'no scratch base outside /tmp on this host';

describe('the listener and the scratch outlive nothing', { skip: noBase }, () => {
  test('one listener per process, reused by every measurement, so a loop that never yields leaves no zombie', () => {
    const a = loopbackListener();
    if (!a) { assert.fail('the listener did not start within its wait; egress would be unmeasured'); }
    for (let i = 0; i < 20; i++) assert.equal(loopbackListener().pid, a.pid);
    const fake = (bin, args, opts) => ({ status: 0, stdout: opts.env && args.join(' ').includes('CW_PROBE_JS') ? 'CW-NET-ERR EPERM\n' : 'CW-READ-OK\nCW-CRED-END\nCW-WRITE-DENIED\n' });
    for (let i = 0; i < 10; i++) measureHostEffects({ ...SPEC, platform: 'darwin' }, { spawn: fake, base: BASE });
    const kids = childrenOf(process.pid);
    assert.deepEqual(kids.filter((c) => /Z/.test(c[2] || '')), [], `zombies under a synchronous loop: ${JSON.stringify(kids)}`);
    assert.ok(kids.filter((c) => c[0] === String(a.pid)).length === 1, 'the one listener is alive');
    closeLoopbackListener();
    const b = loopbackListener();
    assert.ok(b && b.pid !== a.pid, 'a closed listener is replaced');
    closeLoopbackListener();
  });

  test('the listener dies with its parent, whether the parent exits or is killed', () => {
    for (const end of ['process.exit(0)', "process.kill(process.pid, 'SIGKILL')"]) {
      const js = `import(${JSON.stringify(ISOLATION_URL)}).then((m) => { const l = m.loopbackListener(); console.log(l ? l.pid : 'none'); ${end}; })`;
      const r = spawnSync(process.execPath, ['-e', js], { encoding: 'utf8', timeout: 30_000 });
      const pid = Number(String(r.stdout).trim());
      assert.ok(pid > 0, `${end}: no listener pid: ${r.stdout}${r.stderr}`);
      assert.ok(gone(pid), `${end}: listener ${pid} outlived its parent`);
    }
  });

  test('an interrupted measurement leaves scratch only until the next one sweeps it, and a stale one goes after ten minutes', () => {
    const base = realpathSync(mkdtempSync(join(BASE, 'cw-sweep-')));
    try {
      const js = `import(${JSON.stringify(ISOLATION_URL)}).then((m) => m.measureHostEffects(${JSON.stringify({ ...SPEC })}, { base: ${JSON.stringify(base)}, listen: () => null, spawn: () => process.kill(process.pid, 'SIGKILL') }))`;
      spawnSync(process.execPath, ['-e', js], { encoding: 'utf8', timeout: 30_000 });
      const scratch = () => readdirSync(base).filter((n) => n.startsWith('.cw-boundary-'));
      assert.equal(scratch().length, 1, 'a SIGKILL leaves the scratch behind');
      assert.equal(sweepStaleScratch(base), 1, 'its pid is dead, so the next sweep removes it');
      assert.deepEqual(scratch(), []);
      const exiting = `import(${JSON.stringify(ISOLATION_URL)}).then((m) => m.measureHostEffects(${JSON.stringify({ ...SPEC })}, { base: ${JSON.stringify(base)}, listen: () => null, spawn: () => process.exit(0) }))`;
      spawnSync(process.execPath, ['-e', exiting], { encoding: 'utf8', timeout: 30_000 });
      assert.deepEqual(scratch(), [], 'an exit mid-measurement removes its own scratch');
      mkdirSync(join(base, `.cw-boundary-${process.pid}-fresh`));
      const old = join(base, `.cw-boundary-${process.pid}-old`); mkdirSync(old);
      const then = (Date.now() - 11 * 60_000) / 1000; utimesSync(old, then, then);
      writeFileSync(join(base, 'unrelated'), 'x');
      assert.equal(sweepStaleScratch(base), 1, 'the stale one only');
      assert.deepEqual(readdirSync(base).sort(), [`.cw-boundary-${process.pid}-fresh`, 'unrelated']);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });

  test('a dead helper is replaced, and closing its stdin alone ends it', async () => {
    const a = loopbackListener();
    assert.ok(a, 'the listener did not start');
    process.kill(a.pid, 'SIGKILL');
    for (let i = 0; i < 40 && childrenOf(process.pid).some((c) => c[0] === String(a.pid) && !/Z/.test(c[2] || '')); i++) await new Promise((r) => setTimeout(r, 25));
    const b = loopbackListener();
    assert.ok(b && b.pid !== a.pid, 'a killed helper is replaced on the next call');
    closeLoopbackListener({ kill: false });
    let ended = false;
    for (let i = 0; i < 200 && !ended; i++) {
      await new Promise((r) => setTimeout(r, 25));
      try { process.kill(b.pid, 0); } catch (e) { ended = e.code === 'ESRCH'; }
    }
    if (!ended) { try { process.kill(b.pid, 'SIGKILL'); } catch { /* gone */ } }
    assert.ok(ended, 'the helper kept running after its stdin closed');
  });

  test('the scratch base is a 0700 directory of ours in the cache dir, hidden, and never under a temp dir', () => {
    const b = scratchBase();
    const cache = process.platform === 'linux' && (process.env.XDG_CACHE_HOME || '').startsWith('/') ? process.env.XDG_CACHE_HOME : join(homedir(), '.cache');
    assert.equal(b, realpathSync(join(cache, 'commitwork', 'boundary')));
    assert.equal(checkScratchBase(b), null);
    assert.equal(statSync(b).mode & 0o777, 0o700);
    assert.ok(!readdirSync(homedir()).includes('commitwork-boundary'), 'nothing visible is left in HOME');
    assert.ok(!laneWriteRoots({ ...SPEC, home: homedir(), reportDir: '/r', tmpDir: realpathSync(tmpdir()) }).some((r) => b === r || b.startsWith(`${r}/`)));
  });

  test('a linked, shared, foreign-moded or missing base is refused', () => {
    const d = realpathSync(mkdtempSync(join(BASE, 'cw-chk-')));
    try {
      const real = join(d, 'real'); mkdirSync(real, { mode: 0o700 });
      const link = join(d, 'link'); symlinkSync(real, link);
      assert.equal(checkScratchBase(real), null);
      assert.equal(checkScratchBase(link), 'scratch-base-unsafe', 'the base is a symlink');
      const viaLink = join(d, 'via'); symlinkSync(d, viaLink);
      assert.equal(checkScratchBase(join(viaLink, 'real')), 'scratch-base-unsafe', 'a link on the way');
      const open = join(d, 'open'); mkdirSync(open); chmodSync(open, 0o755);
      assert.equal(checkScratchBase(open), 'scratch-base-unsafe', 'readable by others');
      assert.equal(checkScratchBase(real, { uid: process.getuid() + 1 }), 'scratch-base-unsafe', 'owned by another user');
      assert.equal(checkScratchBase(join(d, 'absent')), 'no-scratch');
      assert.ok(measureHostEffects(SPEC, { base: link, spawn: () => assert.fail('a probe ran on an unsafe base'), listen: () => null }).probes.every((p) => p.reason === 'scratch-base-unsafe'));
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('the host harness, with an injected spawn', { skip: noBase }, () => {
  const fixture = () => realpathSync(mkdtempSync(join(BASE, 'cw-eff-')));
  const listen = () => ({ port: 9 });
  // Answers each probe by its marker; a leak mode does what a broken sandbox would let the command do.
  const fake = (mode = {}) => (bin, args, opts) => {
    const cmd = args[args.length - 1];
    const env = opts.env;
    const profile = args.join(' ');
    if (cmd.includes('CW_PROBE_READ')) return { status: 0, stdout: mode.read ?? 'CW-READ-OK\n' };
    if (cmd.includes('CW_PROBE_CREDENTIALS')) {
      const leaked = mode.cred === 'leak' ? readFileSync(env.CW_PROBE_CREDENTIALS.split('\n')[0], 'utf8') : '';
      return { status: 0, stdout: `${leaked}CW-CRED-END\n` };
    }
    if (cmd.includes('CW_PROBE_ESCAPE')) {
      if (mode.write === 'leak') { writeFileSync(env.CW_PROBE_ESCAPE, 'x'); return { status: 0, stdout: 'CW-WRITE-OK\n' }; }
      if (mode.write === 'silent') return { status: 1, stdout: '' };
      return { status: 1, stdout: 'CW-WRITE-DENIED\n' };
    }
    // Mirrors the macOS profile: none denies all; a networked class permits a remote address and
    // denies loopback except on a declared target port.
    // mode.egress names what a lane posture's egress connect ends in when the sandbox lets it through.
    if (cmd.includes('CW_PROBE_JS')) {
      const open = profile.includes('(allow network*)');
      const answer = (t) => {
        if (t.host === EGRESS_PROBE_ADDRESS) {
          if (t.name === 'egress' && mode.egress) return mode.egress === 'leak' ? 'TIMEOUT' : mode.egress;
          if (!open || (t.name === 'network-control' && mode.control === 'down')) return 'ERR EPERM';
          return 'TIMEOUT';
        }
        if (t.name === 'loopback' && mode.loopback === 'leak') return 'OK';
        return open && profile.includes(`localhost:${t.port}`) ? 'OK' : 'ERR EPERM';
      };
      return { status: 0, stdout: JSON.parse(env.CW_PROBE_TARGETS).map((t) => `CW-NET ${t.name} ${answer(t)}`).join('\n') + '\n' };
    }
    return { status: 127, stdout: '' };
  };
  const outcomes = (r) => Object.fromEntries(r.probes.map((p) => [p.probe, p.outcome]));

  test('every probe runs in the fixture, never on the lane repository or its home, and the scratch is removed', () => {
    const d = fixture();
    try {
      const calls = [];
      const spawn = (bin, args, opts) => { calls.push({ bin, args, opts }); return fake()(bin, args, opts); };
      const r = measureHostEffects(SPEC, { spawn, base: d, listen });
      assert.deepEqual(outcomes(r), { 'permitted-read': 'allowed', 'credential-read': 'denied', 'write-escape': 'denied', egress: 'denied', 'network-control': 'allowed', loopback: 'denied', 'loopback-control': 'allowed' });
      assert.equal(calls.length, 6, 'three file probes, one lane connect run, two control runs');
      assert.ok(calls.every((c) => c.bin === 'sandbox-exec'));
      assert.ok(calls.every((c) => c.opts.env.HOME.startsWith(d) && c.opts.env.CW_PROBE_READ.startsWith(d)), 'home and repository are fixtures');
      assert.ok(calls.every((c) => !c.args.join(' ').includes(SPEC.home) && !c.args.join(' ').includes(SPEC.repoPath)));
      assert.ok(calls[0].args.join(' ').includes('(deny network*)'));
      const targets = (c) => JSON.parse(c.opts.env.CW_PROBE_TARGETS).map((t) => `${t.name}@${t.host}`);
      assert.deepEqual(targets(calls[3]), [`egress@${EGRESS_PROBE_ADDRESS}`, 'loopback@127.0.0.1'], 'the lane posture runs both connects at once');
      assert.ok(calls[3].args.join(' ').includes('(deny network*)') && !calls[3].args.join(' ').includes('localhost:9'), 'under the lane posture, which declares no port');
      assert.deepEqual(targets(calls[4]), [`network-control@${EGRESS_PROBE_ADDRESS}`], 'egress is judged on a documentation address, never the internet');
      assert.ok(calls[4].args.join(' ').includes('(allow network*)'), 'the control is the same posture with network allowed');
      assert.deepEqual(targets(calls[5]), ['loopback-control@127.0.0.1']);
      assert.ok(calls[5].args.join(' ').includes('localhost:9'), 'the loopback control declares the listener port as a target');
      assert.ok(calls.every((c) => Object.keys(c.opts.env).every((k) => k === 'PATH' || k === 'HOME' || k.startsWith('CW_PROBE_'))), 'a probe gets a fixed env, never the lane or operator env');
      assert.deepEqual(readdirSync(d), []);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('negative controls: what a broken sandbox lets through is measured as allowed', () => {
    const d = fixture();
    try {
      const r = measureHostEffects(SPEC, { spawn: fake({ cred: 'leak', write: 'leak', egress: 'leak', loopback: 'leak' }), base: d, listen });
      assert.deepEqual(outcomes(r), { 'permitted-read': 'allowed', 'credential-read': 'allowed', 'write-escape': 'allowed', egress: 'allowed', 'network-control': 'allowed', loopback: 'allowed', 'loopback-control': 'allowed' });
      const m = threatModel({ check: lane(), adapter: 'host-sandbox', spec: SPEC, effects: r });
      assert.equal(m.state, 'finding');
      assert.equal(m.findingSource, 'measured');
      assert.deepEqual(m.commands[0].violations.map((v) => v.kind), ['credential-read', 'egress-not-denied', 'write-escape', 'repo-code-reaches-loopback']);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('the controls run once per process and are reused; a control that did not reach is measured again', () => {
    const d = fixture();
    try {
      const calls = [];
      const spawn = (bin, args, opts) => { calls.push(args); return fake()(bin, args, opts); };
      const a = measureHostEffects(SPEC, { spawn, base: d, listen });
      const b = measureHostEffects({ ...SPEC, egress: 'registry' }, { spawn, base: d, listen });
      assert.equal(calls.length, 6 + 4, 'the second posture runs no control');
      assert.deepEqual(outcomes(b), { ...outcomes(a), egress: 'allowed' });
      const down = []; const flaky = fake({ control: 'down' });
      const spawnDown = (bin, args, opts) => { down.push(args); return flaky(bin, args, opts); };
      measureHostEffects(SPEC, { spawn: spawnDown, base: d, listen });
      measureHostEffects(SPEC, { spawn: spawnDown, base: d, listen });
      assert.equal(down.length, 12, 'a refused control is not kept');
      resetBoundaryProbes();
      measureHostEffects(SPEC, { spawn, base: d, listen });
      assert.equal(calls.length, 10 + 6, 'a reset forgets the controls');
      measureHostEffects(SPEC, { spawn, base: d, listen: () => ({ port: 10 }) });
      assert.equal(calls.length, 16 + 6, 'a new listener port is a new loopback control');
      assert.ok(calls.at(-1).join(' ').includes('localhost:10'));
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('any connect result other than the sandbox refusal is egress allowed, so never a pass', () => {
    const d = fixture();
    try {
      for (const end of ['ERR ENETUNREACH', 'ERR EHOSTUNREACH', 'ERR ECONNREFUSED', 'ERR ECONNRESET', 'ERR ETIMEDOUT', 'ERR Error', 'TIMEOUT', 'OK']) {
        const r = measureHostEffects(SPEC, { spawn: fake({ egress: end }), base: d, listen });
        assert.equal(outcomes(r).egress, 'allowed', end);
        const m = threatModel({ check: lane(), adapter: 'host-sandbox', spec: SPEC, effects: r });
        assert.equal(m.state, 'finding', end);
        assert.ok(m.commands[0].violations.some((v) => v.kind === 'egress-not-denied'), end);
      }
      const ctl = measureHostEffects(SPEC, { spawn: fake({ control: 'down' }), base: d, listen });
      assert.equal(outcomes(ctl).egress, 'denied');
      assert.equal(outcomes(ctl)['network-control'], 'denied', 'an EPERM on the control is not the sandbox the lane runs under');
      assert.equal('egressDenied' in measuredFromProbes(ctl.probes), false);
      assert.equal(threatModel({ check: lane(), adapter: 'host-sandbox', spec: SPEC, effects: ctl }).state, 'unmeasured');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('an unmarked or inconsistent result is an error, never a denial', () => {
    const d = fixture();
    try {
      const r = measureHostEffects(SPEC, { spawn: fake({ read: '', write: 'silent' }), base: d, listen });
      assert.equal(outcomes(r)['permitted-read'], 'error');
      assert.equal(outcomes(r)['write-escape'], 'error');
      assert.equal(threatModel({ check: lane(), adapter: 'host-sandbox', spec: SPEC, effects: r }).state, 'unmeasured');
      const thrown = measureHostEffects(SPEC, { spawn: () => ({ error: { code: 'ENOENT' }, status: null }), base: d, listen });
      assert.ok(thrown.probes.every((p) => p.outcome === 'error'), JSON.stringify(thrown.probes));
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a network control the sandbox also refuses leaves egress unmeasured; no listener leaves loopback unmeasured', () => {
    const d = fixture();
    try {
      const down = measureHostEffects(SPEC, { spawn: fake({ control: 'down' }), base: d, listen });
      assert.equal('egressDenied' in measuredFromProbes(down.probes), false);
      const none = measureHostEffects(SPEC, { spawn: fake(), base: d, listen: () => null });
      assert.deepEqual(none.probes.filter((p) => p.outcome === 'not-run').map((p) => [p.probe, p.reason]), [['loopback', 'no-listener'], ['loopback-control', 'no-listener']]);
      const m = threatModel({ check: lane(), adapter: 'host-sandbox', spec: SPEC, effects: none });
      assert.equal(m.state, 'pass', 'the boundary controls were measured');
      assert.equal(threat(m.commands[0], 'local-service-reach').status, 'unmeasured');
      const linux = measureHostEffects({ ...SPEC, platform: 'linux' }, { spawn: fake(), base: d, listen: () => null });
      assert.deepEqual(linux.probes.filter((p) => p.outcome === 'not-run').map((p) => p.probe), ['egress', 'network-control', 'loopback', 'loopback-control'], 'Linux egress needs the listener');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a base the lane itself may write is refused, so planted fixtures cannot be measured', () => {
    const t = realpathSync(mkdtempSync('/tmp/cw-eff-'));
    const d = fixture();
    try {
      const noProbe = () => assert.fail('a probe ran on a base the lane can write');
      const writable = (spec, base) => measureHostEffects(spec, { spawn: noProbe, base, listen }).probes.every((p) => p.outcome === 'not-run' && p.reason === 'scratch-base-writable-by-lane');
      assert.ok(writable(SPEC, t), 'every profile lets a lane write /tmp');
      assert.ok(writable({ ...SPEC, tmpDir: dirname(d) }, d), 'the lane temp dir');
      assert.ok(writable({ ...SPEC, reportDir: d }, d), 'the lane report dir');
      assert.ok(writable({ ...SPEC, home: dirname(dirname(d)), extraWrites: [`~/${d.split('/').slice(-2, -1)[0]}`] }, d), 'a declared home write');
      assert.equal(threatModel({ check: lane(), adapter: 'host-sandbox', spec: SPEC, effects: measureHostEffects(SPEC, { spawn: noProbe, base: t, listen }) }).state, 'unmeasured');
    } finally { rmSync(t, { recursive: true, force: true }); rmSync(d, { recursive: true, force: true }); }
  });

  test('a fixture changed while a probe ran makes that probe an error, never a denial', () => {
    const d = fixture();
    try {
      const swapCred = (bin, args, opts) => {
        if (args[args.length - 1].includes('CW_PROBE_CREDENTIALS')) writeFileSync(opts.env.CW_PROBE_CREDENTIALS.split('\n')[0], 'replaced');
        return fake()(bin, args, opts);
      };
      const r = measureHostEffects(SPEC, { spawn: swapCred, base: d, listen });
      assert.deepEqual(r.probes.find((p) => p.probe === 'credential-read'), { probe: 'credential-read', outcome: 'error', reason: 'fixture-changed' });
      assert.equal('credentialReadDenied' in measuredFromProbes(r.probes), false);
      const swapOutside = (bin, args, opts) => {
        if (args[args.length - 1].includes('CW_PROBE_ESCAPE')) { const o = dirname(opts.env.CW_PROBE_ESCAPE); rmSync(o, { recursive: true }); symlinkSync(d, o); }
        return fake()(bin, args, opts);
      };
      const w = measureHostEffects(SPEC, { spawn: swapOutside, base: d, listen });
      assert.equal(w.probes.find((p) => p.probe === 'write-escape').reason, 'fixture-changed');
      assert.equal(threatModel({ check: lane(), adapter: 'host-sandbox', spec: SPEC, effects: w }).state, 'unmeasured');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a spec the wrapper refuses, a fixture that cannot be built or no scratch is not a measurement', () => {
    const d = fixture();
    try {
      const refused = measureHostEffects({ ...SPEC, egress: 'everything' }, { spawn: fake(), base: d, listen });
      const own = refused.probes.filter((p) => !p.probe.endsWith('-control'));
      assert.ok(own.every((p) => p.outcome === 'error' && p.reason === 'wrapper-refused'), JSON.stringify(refused.probes));
      assert.equal(threatModel({ check: lane(), adapter: 'host-sandbox', spec: { ...SPEC, egress: 'everything' }, effects: refused }).state, 'unmeasured', 'controls that ran prove nothing about a posture that did not');
      assert.ok(measureHostEffects(SPEC, { spawn: fake(), base: join(d, 'no', 'such'), listen }).probes.every((p) => p.reason === 'no-scratch'));
      assert.ok(measureHostEffects(SPEC, { spawn: fake(), base: null, listen }).probes.every((p) => p.reason === 'no-scratch'));
      assert.ok(measureHostEffects(null, { spawn: fake(), base: d, listen }).probes.every((p) => p.reason === 'malformed-spec'));
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

// ---- live: the probes against the real host sandbox, and against no sandbox at all ----
const sandbox = POSIX_HOST ? probeHostSandbox() : { available: false, why: `no host sandbox on ${process.platform}` };
const liveSkip = noBase || (sandbox.available ? false : `host sandbox unavailable (${sandbox.why}): containment is UNMEASURED here, not passed`);

describe('host effects, measured', { skip: liveSkip }, () => {
  const spec = (over = {}) => ({
    egress: 'none', repoPath: '/nonexistent/repo', reportDir: '/nonexistent/report', platform: process.platform, cwRoot: ROOT,
    nodePrefix: dirname(dirname(realpathSync(process.execPath))), tmpDir: realpathSync(tmpdir()), home: homedir(), developerDir: sandbox.developerDir ?? null, ...over,
  });
  const at = (r, n) => r.probes.find((p) => p.probe === n);
  // Under load the listener may not come up in its wait; that is unmeasured, never a pass.
  const egressUnmeasured = (r) => at(r, 'egress').reason === 'no-listener';
  const loopbackUnmeasured = (r) => at(r, 'loopback').reason === 'no-listener';
  const darwin = process.platform === 'darwin';
  const assertEgress = (r, expected) => {
    if (egressUnmeasured(r)) {
      assert.equal('egressDenied' in measuredFromProbes(r.probes), false);
      return;
    }
    assert.equal(at(r, 'egress').outcome, expected, JSON.stringify(r.probes));
    assert.equal(at(r, 'network-control').outcome, 'allowed', 'the loopback control must connect, or the egress denial proves nothing');
  };

  test('positive controls hold and every forbidden effect is denied under egress none', () => {
    const r = measureHostEffects(spec());
    assert.equal(at(r, 'permitted-read').outcome, 'allowed', JSON.stringify(r.probes));
    assert.equal(at(r, 'credential-read').outcome, 'denied');
    assert.equal(at(r, 'write-escape').outcome, 'denied');
    assertEgress(r, 'denied');
    if (!loopbackUnmeasured(r)) {
      assert.equal(at(r, 'loopback').outcome, 'denied');
      assert.equal(at(r, 'loopback-control').outcome, 'allowed', 'the loopback control must connect, or the denial proves nothing');
    }
    const m = threatModel({ check: lane(), adapter: 'host-sandbox', spec: spec(), effects: r });
    assert.equal(m.state, egressUnmeasured(r) ? 'unmeasured' : 'pass', JSON.stringify(m.commands[0].unknowns));
  });

  test('allowed-network control: a networked lane connects, and running repo code there is a finding', () => {
    const s = spec({ egress: 'registry' });
    const r = measureHostEffects(s);
    assert.equal(at(r, 'credential-read').outcome, 'denied');
    assertEgress(r, 'allowed');
    const m = threatModel({ check: lane(), adapter: 'host-sandbox', spec: s, effects: r });
    assert.equal(m.state, 'finding');
    if (!loopbackUnmeasured(r)) {
      // macOS denies a networked lane loopback; bwrap cannot, which upstream records as open.
      assert.equal(at(r, 'loopback').outcome, darwin ? 'denied' : 'allowed');
      assert.equal(m.findingSource, darwin ? 'declared' : 'measured');
    }
    if (!egressUnmeasured(r) && (darwin || loopbackUnmeasured(r))) assert.equal(threatModel({ check: lane({ executesRepoCode: false }), adapter: 'host-sandbox', spec: s, effects: r }).state, darwin ? 'pass' : 'unmeasured');
  });

  test('the credential deny holds when the whole home is declared readable', () => {
    const r = measureHostEffects(spec({ extraReads: ['~/'] }));
    assert.equal(at(r, 'permitted-read').outcome, 'allowed');
    assert.equal(at(r, 'credential-read').outcome, 'denied');
  });

  test('negative control: the same probes with the wrapper removed observe every breach', () => {
    const unwrapped = (bin, args, opts) => {
      const i = args.lastIndexOf('-c');
      return spawnSync(args[i - 1], args.slice(i), opts);
    };
    const r = measureHostEffects(spec(), { spawn: unwrapped });
    assert.equal(at(r, 'permitted-read').outcome, 'allowed');
    assert.equal(at(r, 'credential-read').outcome, 'allowed', 'a probe that cannot see an unconfined read is vacuous');
    assert.equal(at(r, 'write-escape').outcome, 'allowed');
    if (!egressUnmeasured(r)) assert.equal(at(r, 'egress').outcome, 'allowed');
    if (!loopbackUnmeasured(r)) assert.equal(at(r, 'loopback').outcome, 'allowed', 'an unconfined connect to the listener must be seen');
    assert.equal(threatModel({ check: lane(), adapter: 'host-sandbox', spec: spec(), effects: r }).state, 'finding');
  });

  test('cleanup', () => {
    closeLoopbackListener();
    assert.deepEqual(readdirSync(scratchBase()).filter((n) => n.startsWith(`.cw-boundary-${process.pid}-`) || n.startsWith(`.cw-listener-${process.pid}-`)), []);
    assert.deepEqual(readdirSync(homedir()).filter((n) => n.startsWith('.cw-boundary-') || n === 'commitwork-boundary'), []);
  });
});

// ---- no lane profile can write the scratch base: from every manifest, as text and under the real profile ----
describe('the scratch base is outside every lane write root', { skip: noBase }, () => {
  const manifestLanes = () => readdirSync(join(ROOT, 'manifests')).filter((n) => n.endsWith('.json')).flatMap((n) => {
    try { const m = JSON.parse(readFileSync(join(ROOT, 'manifests', n), 'utf8')); return Array.isArray(m.checks) ? m.checks.filter((c) => typeof c.egress === 'string') : []; } catch { return []; }
  });
  const laneSpec = (c, platform) => ({
    cmd: 'true', egress: c.egress, platform, repoPath: '/work/repo', reportDir: '/work/reports/r', tmpDir: realpathSync(tmpdir()), home: homedir(),
    cwRoot: ROOT, nodePrefix: dirname(dirname(realpathSync(process.execPath))), userCacheDir: '/var/folders/zz/C',
    extraWrites: [...(c.sandboxExtraWrites || []), join(homedir(), '.cargo-target-drive', 'commitwork-sweep', 'repo-0123456789')],
  });

  test('no manifest lane, on either platform, is granted a write that reaches the base', () => {
    const lanes = manifestLanes();
    assert.ok(lanes.length > 20, `only ${lanes.length} host lanes read`);
    for (const c of lanes) {
      const mac = hostSandboxArgv(laneSpec(c, 'darwin')).profile.split('\n').find((l) => l.startsWith('(allow file-write*'));
      const subpaths = [...mac.matchAll(/\(subpath "([^"]+)"\)/g)].map((m) => m[1]);
      assert.ok(subpaths.length > 0);
      for (const p of subpaths) assert.ok(!(BASE === p || BASE.startsWith(`${p}/`)), `${c.id}: macOS grants a write to ${p}`);
      const linux = hostSandboxArgv({ ...laneSpec(c, 'linux'), fs: { realpathSync: () => { const e = new Error('absent'); e.code = 'ENOENT'; throw e; }, statSync: () => ({}) } }).argv;
      const binds = linux.flatMap((a, i) => (a === '--bind' ? [linux[i + 2]] : []));
      for (const p of binds) assert.ok(!(BASE === p || BASE.startsWith(`${p}/`)), `${c.id}: Linux binds ${p} writable`);
      assert.ok(!laneWriteRoots(laneSpec(c, process.platform)).some((r) => BASE === r || BASE.startsWith(`${r}/`)), c.id);
    }
  });

  const writes = [...new Set(manifestLanes().flatMap((c) => c.sandboxExtraWrites || []).filter((w) => !w.startsWith('@')))];
  test('under a real profile granting every declared write, the base cannot be written or linked into; the report dir can (the control)', { skip: liveSkip }, () => {
    const report = realpathSync(mkdtempSync(join(tmpdir(), 'cw-base-ctl-')));
    try {
      const spec = { egress: 'none', repoPath: report, reportDir: report, platform: process.platform, cwRoot: ROOT, nodePrefix: dirname(dirname(realpathSync(process.execPath))),
        tmpDir: realpathSync(tmpdir()), home: homedir(), developerDir: sandbox.developerDir ?? null, extraWrites: writes };
      const run = (cmd) => { const { argv } = hostSandboxArgv({ ...spec, cmd }); return spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH, B: BASE, R: report } }); };
      assert.equal(run('mkdir "$R/x" && ln -s / "$R/l" && echo OK').stdout.trim(), 'OK', 'the control write failed, so a denial below proves nothing');
      for (const cmd of ['mkdir "$B/.cw-boundary-999999-planted"', 'ln -s / "$B/planted-link"', 'echo x > "$B/planted"']) {
        assert.notEqual(run(cmd).status, 0, cmd);
      }
      assert.deepEqual(readdirSync(BASE).filter((n) => n.includes('planted')), []);
    } finally { rmSync(report, { recursive: true, force: true }); }
  });
});

// ---- the producer and consumer: the runner writes the model onto rows and scan cells ----
describe('scanner records carry the boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-boundary-cli-'));
  const roots = join(dir, 'roots'); const repo = join(roots, 'repo'); const reports = join(dir, 'reports');
  mkdirSync(repo, { recursive: true }); mkdirSync(reports);
  spawnSync('git', ['init', '-q', repo]);
  const emit = (name) => `printf '{"tool":"${name}","summary":{"findings":0,"byRule":{},"filesScanned":1},"findings":[]}' > "$CW_REPORT_DIR/${name}.json"; echo 0 > "$CW_REPORT_DIR/${name}.json.exit"`;
  const ids = ['bnd-exec-none', 'bnd-build-open', 'bnd-unconfined', 'bnd-read-none'];
  const manifest = join(dir, 'm.json');
  const SECRET = ['cwfixture', 'token', '0123456789'].join('');
  writeFileSync(manifest, JSON.stringify({
    repo: 'fixture',
    groups: { probe: [...ids, 'bnd-timeout'] },
    checks: [
      { id: 'bnd-exec-none', description: 'fixture: executes repo code under egress none', local: [emit('bnd-exec-none')], report: { file: 'bnd-exec-none.json', format: 'rule-counts' }, groups: ['probe'], executesRepoCode: true, egress: 'none' },
      { id: 'bnd-build-open', description: 'fixture: a build command under a networked class', local: [`: cargo check; ${emit('bnd-build-open')}`], report: { file: 'bnd-build-open.json', format: 'rule-counts' }, groups: ['probe'], egress: 'registry' },
      { id: 'bnd-unconfined', description: 'fixture: executes repo code, declares no egress', local: [emit('bnd-unconfined')], report: { file: 'bnd-unconfined.json', format: 'rule-counts' }, groups: ['probe'], executesRepoCode: true },
      { id: 'bnd-read-none', description: 'fixture: reads the tree under egress none', local: [`: TOKEN=${SECRET}; ${emit('bnd-read-none')}`], report: { file: 'bnd-read-none.json', format: 'rule-counts' }, groups: ['probe'], executesRepoCode: false, egress: 'none' },
      { id: 'bnd-timeout', description: 'fixture: outlives its bound', local: ['sleep 20'], report: { file: 'bnd-timeout.json', format: 'rule-counts' }, groups: ['probe'], executesRepoCode: false, egress: 'none', timeoutSec: 1 },
    ],
  }));
  const env = () => {
    const e = { ...process.env, CW_REPORT_DIR: reports, CW_SKIP_SETUP: '1', CW_DOCKER: 'false' };
    delete e.CW_SANDBOX;
    return e;
  };
  const expectRows = (byId, where) => {
    for (const id of [...ids, 'bnd-timeout']) assert.ok(byId[id] && byId[id].boundary, `${where}: ${id} carries no boundary: ${JSON.stringify(byId[id])}`);
    const u = byId['bnd-unconfined'].boundary;
    assert.equal(u.adapter, null, where);
    assert.equal(u.state, 'unmeasured', where);
    assert.equal(u.reason, 'no-enforcement-adapter', where);
    assert.deepEqual(u.probes, [], 'an unconfined lane runs no probes');
    const confined = byId['bnd-exec-none'].isolation !== 'none';
    for (const id of ['bnd-exec-none', 'bnd-build-open', 'bnd-read-none']) {
      const b = byId[id].boundary;
      if (!confined) { assert.equal(b.state, 'unmeasured', `${where}: ${id} ran unconfined, so its boundary is unmeasured`); continue; }
      assert.equal(b.adapter, 'host-sandbox', `${where}: ${id}`);
      const egress = b.probes[3].reason === 'no-listener' ? 'not-run' : id === 'bnd-build-open' ? 'allowed' : 'denied';
      assert.deepEqual(b.probes.map((p) => p.outcome).slice(0, 4), ['allowed', 'denied', 'denied', egress], `${where}: ${id} ${JSON.stringify(b.probes)}`);
      if (process.platform === 'darwin' && b.probes[5].reason !== 'no-listener') assert.equal(b.probes[5].outcome, 'denied', `${where}: ${id} reached loopback`);
    }
    const build = byId['bnd-build-open'].boundary;
    assert.equal(build.executesRepoCodeBasis, 'command-builds-tree', where);
    if (confined) {
      assert.equal(build.state, 'finding', `${where}: ${JSON.stringify(build)}`);
      const reached = build.probes[5].outcome === 'allowed';
      assert.equal(build.findingSource, reached ? 'measured' : 'declared');
      assert.deepEqual(build.commands[0].violations.map((v) => v.kind), ['repo-code-with-open-egress', ...(reached ? ['repo-code-reaches-loopback'] : [])]);
      const listened = byId['bnd-exec-none'].boundary.probes[3].reason !== 'no-listener';
      assert.equal(byId['bnd-exec-none'].boundary.state, listened ? 'pass' : 'unmeasured', `${where}: ${JSON.stringify(byId['bnd-exec-none'].boundary)}`);
      assert.equal(byId['bnd-timeout'].boundary.adapter, 'host-sandbox', 'a timed-out lane keeps the boundary of the posture it ran under');
    }
    const json = JSON.stringify(Object.values(byId).map((r) => r.boundary));
    assert.ok(!json.includes(SECRET), 'raw command text reached the record');
    assert.ok(!json.includes(realpathSync(dir)) && !json.includes(dir), 'a per-run path reached the record');
  };

  test('checks-status rows: the model rides beside status, never moving it, on timed-out rows too', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'commitwork.mjs'), 'run', 'probe', '--manifest', manifest, '--repo', repo, '--no-fail-fast'], { encoding: 'utf8', env: env() });
    let rows;
    try { rows = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8')); } catch (e) { assert.fail(`checks-status.json unreadable (${e.message}); exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
    const byId = Object.fromEntries(rows.map((x) => [x.check, x]));
    expectRows(byId, 'run');
    assert.equal(new Set(ids.map((id) => byId[id].status)).size, 1, `boundary state moved a status: ${ids.map((id) => byId[id].status)}`);
    assert.equal(byId['bnd-timeout'].timedOut, true);
    assert.equal(byId['bnd-unconfined'].coverage, 'reduced', 'the isolation demotion is unchanged');
  });

  test('scan cells carry the same model', () => {
    const out = join(dir, 'scan-out');
    const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'commitwork.mjs'), 'scan', '--manifest', manifest, '--root', roots, '--out', out], { encoding: 'utf8', env: env() });
    let scan;
    try { scan = JSON.parse(readFileSync(join(out, 'scan.json'), 'utf8')); } catch (e) { assert.fail(`scan.json unreadable (${e.message}); exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
    const cells = scan.repos[0].cells;
    for (const c of Object.values(cells)) {
      assert.deepEqual(Object.keys(c.boundary).sort(), ['findingSource', 'ref', 'state']);
      assert.equal(scan.boundaries[c.boundary.ref].state, c.boundary.state);
    }
    expectRows(Object.fromEntries(Object.entries(cells).map(([id, c]) => [id, { ...c, boundary: scan.boundaries[c.boundary.ref] }])), 'scan');
    assert.equal(cells['bnd-timeout'].timedOut, true);
  });

  test('scan.json keeps each distinct model once', () => {
    const model = threatModel({ check: lane(), adapter: 'host-sandbox', spec: SPEC, effects: { probes: probes() } });
    const other = threatModel({ check: lane({ id: 'lane-y' }), adapter: null });
    const repos = [1, 2].map((n) => ({ repo: `/r${n}`, slug: `r${n}`, cells: { a: { sev: 'ok', boundary: model }, b: { sev: 'ok', boundary: other }, c: { sev: 'skip' } } }));
    const { boundaries, repos: out } = compactBoundaries(repos);
    assert.equal(Object.keys(boundaries).length, 2);
    assert.equal(out[0].cells.a.boundary.ref, out[1].cells.a.boundary.ref);
    assert.deepEqual(boundaries[out[0].cells.a.boundary.ref], model);
    assert.deepEqual(out[0].cells.a.boundary, { ref: out[0].cells.a.boundary.ref, state: 'pass', findingSource: null });
    assert.deepEqual(out[0].cells.c, { sev: 'skip' });
    assert.deepEqual(repos[0].cells.a.boundary, model, 'the input is not changed');
    assert.deepEqual(compactBoundaries('x'), { boundaries: {}, repos: [] });
  });

  // The container predicate needs a reachable docker to reach a row, so its wiring is held here.
  test('the runner passes the container predicate on both paths', () => {
    const s = readFileSync(join(ROOT, 'bin', 'commitwork.mjs'), 'utf8');
    assert.equal((s.match(/laneBoundary\(check, sb, \{ container: isContainerLane\(check\),/g) || []).length, 2);
  });

  test('cleanup', () => {
    rmSync(dir, { recursive: true, force: true });
    assert.ok(!existsSync(dir));
    assert.deepEqual(readdirSync(homedir()).filter((n) => n.startsWith('.cw-boundary-') || n === 'commitwork-boundary'), [], 'probe scratch left in HOME');
    const base = scratchBase();
    assert.deepEqual(readdirSync(base).filter((n) => /^\.cw-(boundary|listener)-/.test(n) && !alivePid(Number(n.split('-')[2]))), [], 'scratch of a finished run left in the base');
    const marked = spawnSync('ps', ['-A', '-o', 'ppid=,command='], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l.includes(LISTENER_MARK) && l.trim().startsWith('1 '));
    assert.deepEqual(marked, [], 'an orphaned listener');
  });
});
