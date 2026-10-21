// The launchd job com.portll.commitwork-daily, as monitor/install-agents.mjs DECLARES it: the
// generator is run in its default dry-run mode (never --write, never --load) with HOME in tmp and a
// fixture registry that has no paused area — so no launchctl query is made and nothing is written.
// The printed plist is linted and parsed by plutil, and its fields are asserted structurally:
// label, the program it runs and that the program exists and takes --all, the 30-minute interval,
// no run-at-load, the scheduled-caller guard, logs, working directory. Also pinned: a registry that
// cannot be read refuses before anything is printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'monitor', 'install-agents.mjs');
const LABEL = 'com.portll.commitwork-daily';
const DARWIN = process.platform === 'darwin';

function sandbox(t, mutate = (r) => r) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-install-agents-daily-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const reg = JSON.parse(readFileSync(join(CW, 'monitor', 'projects.example.json'), 'utf8'));
  // A paused area makes the generator ask launchd whether its retired agents are loaded; drop it.
  const paused = new Set(reg.areas.filter((a) => a.paused).map((a) => a.slug));
  reg.areas = reg.areas.filter((a) => !paused.has(a.slug));
  reg.projects = (reg.projects || []).filter((p) => !paused.has(p.area));
  const registry = join(dir, 'projects.json');
  writeFileSync(registry, JSON.stringify(mutate(reg), null, 2));
  return { dir, registry, home: join(dir, 'home') };
}

function dryRun(s) {
  const env = { ...process.env, HOME: s.home, CW_REGISTRY: s.registry };
  for (const k of ['CW_DOCKER_CONFIG', 'SOCKET_CLI_ORG_SLUG', 'CW_CLOUDFLARE_ZONE_ID', 'CW_REGISTRY_REQUIRE_REAL']) delete env[k];
  const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8', env });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** The one plist body the dry run prints for `label`. */
function block(out, label) {
  const head = `--- would write `;
  const parts = out.split(head).slice(1);
  const mine = parts.find((p) => p.split('\n')[0].endsWith(`/${label}.plist`));
  assert.ok(mine, `no plist printed for ${label}`);
  const [target, ...body] = mine.split('\n');
  return { target, xml: body.join('\n').replace(/\n\(dry run[\s\S]*$/, '\n').trimEnd() + '\n' };
}

test('the daily job is declared as a 30-minute interval running daily-run --all, and the dry run writes nothing', { skip: !DARWIN && 'launchd is macOS-only' }, (t) => {
  const s = sandbox(t);
  const r = dryRun(s);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /\n\(dry run — pass --write to install, --write --load to also start them\)\n$/);
  const { target, xml } = block(r.out, LABEL);
  assert.equal(target, join(s.home, 'Library', 'LaunchAgents', `${LABEL}.plist`));
  assert.equal(existsSync(join(s.home, 'Library')), false, 'a dry run created the LaunchAgents dir');

  const file = join(s.dir, `${LABEL}.plist`);
  writeFileSync(file, xml);
  execFileSync('/usr/bin/plutil', ['-lint', '-s', file]);   // throws on a malformed plist
  const p = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }));

  assert.equal(p.Label, LABEL);
  assert.equal(p.ProgramArguments.length, 3, 'no launcher bundle exists under this HOME, so no prefix');
  const [node, script, flag] = p.ProgramArguments;
  assert.equal(realpathSync(node), realpathSync(process.execPath), 'the interpreter is this node, by a stable path or its own');
  assert.equal(script, join(CW, 'bin', 'daily-run.mjs'));
  assert.ok(existsSync(script), 'the declared program exists in this checkout');
  assert.equal(flag, '--all');
  assert.match(readFileSync(script, 'utf8'), /argv\.includes\('--all'\)/, 'and it reads the flag it is given');
  assert.equal(p.StartInterval, 1800);
  assert.equal(p.StartCalendarInterval, undefined);
  assert.equal(p.KeepAlive, undefined);
  assert.equal(p.RunAtLoad, false);
  assert.equal(p.WorkingDirectory, CW);
  assert.equal(p.StandardOutPath, '/tmp/commitwork-daily.log');
  assert.equal(p.StandardErrorPath, '/tmp/commitwork-daily.err');
  const env = p.EnvironmentVariables;
  assert.equal(env.CW_REGISTRY_REQUIRE_REAL, '1', 'a scheduled caller must refuse the example fleet');
  assert.equal(env.DOCKER_CONFIG, join(s.home, '.config', 'commitwork', 'docker'));
  assert.ok(env.PATH && !env.PATH.includes('~'), 'launchd expands no ~');
  for (const d of env.PATH.split(':')) assert.ok(existsSync(d), `PATH names a dir that does not exist: ${d}`);
  assert.deepEqual(Object.keys(env).sort(), ['CW_REGISTRY_REQUIRE_REAL', 'DOCKER_CONFIG', 'PATH'], 'the daily job declares no other env');
});

test('the daily job is declared exactly once among the generated agents', { skip: !DARWIN && 'launchd is macOS-only' }, (t) => {
  const s = sandbox(t);
  const r = dryRun(s);
  assert.equal(r.code, 0, r.err);
  const labels = [...r.out.matchAll(/<key>Label<\/key><string>([^<]+)<\/string>/g)].map((m) => m[1]);
  assert.equal(labels.filter((l) => l === LABEL).length, 1);
  assert.ok(labels.length > 1, 'the fixture generated the rest of the set too');
});

test('a registry that cannot be read refuses before any plist is printed', { skip: !DARWIN && 'launchd is macOS-only' }, (t) => {
  const s = sandbox(t);
  rmSync(s.registry);
  const r = dryRun(s);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /registry unreadable at .*projects\.json/);
  assert.doesNotMatch(r.out, /would write/);
});

test('off macOS the generator refuses (exit 2) rather than emit a plist nothing can load', { skip: DARWIN && 'covers the non-darwin refusal' }, (t) => {
  const s = sandbox(t);
  const r = dryRun(s);
  assert.equal(r.code, 2);
  assert.match(r.err, /launchd is macOS-only/);
});
