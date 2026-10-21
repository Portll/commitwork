// com.portll.commitwork-docker-gc — the weekly image-retention launchd job, tested as a DECLARATION.
// Only the generator is exercised (AGENTS, plist(), agentPlan()); nothing is written under
// ~/Library/LaunchAgents and launchctl is never invoked. A snapshot of the real agent dir is
// asserted unchanged at the end, so an escape from the isMain gate is a red test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, plist, agentPlan, CW, NODE, AGENT_DIR } from '../install-agents.mjs';

const LABEL = 'com.portll.commitwork-docker-gc';
const MODULE = fileURLToPath(new URL('../install-agents.mjs', import.meta.url));
const agent = AGENTS.find((a) => a.label === LABEL);
const snap = () => { try { return readdirSync(AGENT_DIR).sort().map((n) => `${n} ${statSync(join(AGENT_DIR, n)).mtimeMs}`).join('\n'); } catch (e) { return `<${e.code}>`; } };
let before0;
before(() => { before0 = snap(); });
after(() => { assert.equal(snap(), before0, 'the real LaunchAgents directory changed during a generate-only test'); });

// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
const key = (xml, k) => new RegExp(`<key>${k}</key>\\s*<string>([^<]*)</string>`).exec(xml)?.[1];

test('the agent is declared, exactly once', () => {
  assert.ok(agent, `${LABEL} is no longer in AGENTS`);
  assert.equal(AGENTS.filter((a) => a.label === LABEL).length, 1);
});

test('the plist carries label, program arguments and working directory', () => {
  const xml = plist(agent);
  assert.equal(key(xml, 'Label'), LABEL);
  assert.equal(key(xml, 'WorkingDirectory'), CW);
  const args = [...(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)?.[1] || '').matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
  const script = join(CW, 'bin', 'docker-gc.mjs');
  assert.equal(args[args.length - 1], script, 'the last program argument is the docker-gc script');
  assert.ok(existsSync(script), 'the script the job runs does not exist');
  assert.ok(args.every(isAbsolute), `launchd expands no ~ or PATH lookup, so every argument must be absolute: ${args}`);
  assert.ok(args.includes(NODE), 'the resolved node binary is not in ProgramArguments');
  assert.ok(!args.some((a) => /~|\$\{?HOME/.test(a)), 'an unexpanded home reference reached ProgramArguments');
});

test('the schedule is weekly: Sunday 04:30, and not run at load', () => {
  const xml = plist(agent);
  const cal = /<key>StartCalendarInterval<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(xml)?.[1];
  assert.ok(cal, 'no StartCalendarInterval — the job would never run');
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
  const get = (k) => Number(new RegExp(`<key>${k}</key><integer>(\\d+)</integer>`).exec(cal)?.[1]);
  assert.deepEqual({ Weekday: get('Weekday'), Hour: get('Hour'), Minute: get('Minute') }, { Weekday: 0, Hour: 4, Minute: 30 });
  assert.doesNotMatch(xml, /<key>StartInterval<\/key>/, 'a StartInterval alongside the calendar would make it more than weekly');
  assert.match(xml, /<key>RunAtLoad<\/key><false\/>/, 'an image prune must not fire every time the agent is loaded');
});

test('logs go to /tmp (launchd creates no missing directories) and the environment is declared', () => {
  const xml = plist(agent);
  assert.equal(key(xml, 'StandardOutPath'), '/tmp/commitwork-docker-gc.log');
  assert.equal(key(xml, 'StandardErrorPath'), '/tmp/commitwork-docker-gc.err');
  assert.equal(key(xml, 'CW_REGISTRY_REQUIRE_REAL'), '1');
  assert.ok(key(xml, 'DOCKER_CONFIG'), 'DOCKER_CONFIG must be declared: launchd inherits no shell');
  assert.ok(key(xml, 'PATH'), 'PATH must be declared');
});

test('generating twice is byte-identical', () => {
  assert.equal(plist(agent), plist(agent));
});

test('paths are derived: DOCKER_CONFIG follows CW_DOCKER_CONFIG at call time, not module load', () => {
  const saved = process.env.CW_DOCKER_CONFIG;
  try {
    process.env.CW_DOCKER_CONFIG = '/nonexistent/probe-a';
    assert.equal(key(plist(agent), 'DOCKER_CONFIG'), '/nonexistent/probe-a');
    process.env.CW_DOCKER_CONFIG = '/nonexistent/probe-b';
    assert.equal(key(plist(agent), 'DOCKER_CONFIG'), '/nonexistent/probe-b');
  } finally { if (saved === undefined) delete process.env.CW_DOCKER_CONFIG; else process.env.CW_DOCKER_CONFIG = saved; }
});

test('the home-derived parts follow HOME, so nothing is pinned to one machine', () => {
  const fake = mkdtempSync(join(tmpdir(), 'cw-gc-home-'));
  try {
    const code = 'import(process.argv[1]).then((m) => process.stdout.write(m.plist(m.AGENTS.find((a) => a.label === process.argv[2]))))';
    const run = () => spawnSync(process.execPath, ['-e', code, MODULE, LABEL], {
      encoding: 'utf8', env: { ...process.env, HOME: fake, CW_DOCKER_CONFIG: '', CW_SELF_SWEEP: '0' },
    });
    const a = run();
    assert.equal(a.status, 0, a.stderr);
    assert.equal(key(a.stdout, 'DOCKER_CONFIG'), join(fake, '.config', 'commitwork', 'docker'));
    assert.equal(key(a.stdout, 'WorkingDirectory'), CW, 'the working directory is the checkout, wherever HOME points');
    assert.equal(a.stdout, run().stdout, 'two processes disagree on the same inputs');
  } finally { rmSync(fake, { recursive: true, force: true }); }
});

test('the job is in the install plan, with a stable plist filename', () => {
  const plan = agentPlan({ isInstalled: () => false });
  const hit = plan.install.find((p) => p.agent.label === LABEL);
  assert.ok(hit, 'the plan would not install the docker-gc job');
  assert.equal(plan.retire.find((r) => r.label === LABEL), undefined);
});

test('the generated body is well-formed XML property list (plutil -lint, read-only)', (t) => {
  const probe = spawnSync('plutil', ['-help'], { encoding: 'utf8' });
  if (probe.error) return t.skip('plutil is not on PATH (non-macOS): cannot lint the plist');
  const dir = mkdtempSync(join(tmpdir(), 'cw-gc-lint-'));
  try {
    const f = join(dir, `${LABEL}.plist`);
    writeFileSync(f, plist(agent));
    assert.match(execFileSync('plutil', ['-lint', f], { encoding: 'utf8' }), /OK/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
