// The agents' macOS privacy identity, which is a property of the GENERATED plist and nothing else.
//
// Both things asserted here were invisible for as long as they were wrong. A TCC grant filed
// against a resolved node path still runs the job correctly — it only fails when somebody opens
// System Settings and finds a row that says "node", or upgrades node and gets re-prompted. And a
// credential helper firing on every remote image ref costs nothing measurable either; it just
// raises a dialog no one can attribute. Neither shows up in a sweep's exit code, so neither has a
// natural second witness. This file is it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { AGENTS, plist, LAUNCH_PREFIX, NODE } from '../install-agents.mjs';
import { dockerConfigDir } from '../../lib/docker-config.mjs';

// Parse via plutil rather than a regex over the XML: a regex would share a failure mode with the
// generator's own string templating, and both would agree on a plist launchd cannot read.
function parsed(xml) {
  const f = join(mkdtempSync(join(tmpdir(), 'cw-plist-')), 'a.plist');
  writeFileSync(f, xml);
  return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', f], { encoding: 'utf8' }));
}

const sample = () => AGENTS[0];

// fact: plutil ships only with macOS, where launchd reads these plists; elsewhere nothing could load them
const NEEDS_PLUTIL = spawnSync('plutil', ['-help'], { stdio: 'ignore' }).error?.code === 'ENOENT'
  ? { skip: 'plutil is absent (macOS-only), so the generated plists cannot be parsed the way launchd reads them' }
  : {};

test('every generated agent is readable by plutil — the generator templates XML by hand', NEEDS_PLUTIL, () => {
  for (const agent of AGENTS) {
    assert.doesNotThrow(() => parsed(plist(agent)), `${agent.label}: launchd could not parse this`);
  }
});

test('every generated agent points DOCKER_CONFIG away from ~/.docker', NEEDS_PLUTIL, () => {
  // ~/.docker sets credsStore: desktop, so anything resolving a remote image ref execs
  // docker-credential-desktop and reads Docker.app's container. Asserting merely that the key is
  // SET would pass on the value that caused the problem, so assert what it must not be.
  const dotDocker = join(homedir(), '.docker');
  for (const agent of AGENTS) {
    const env = parsed(plist(agent)).EnvironmentVariables;
    assert.ok(env.DOCKER_CONFIG, `${agent.label}: no DOCKER_CONFIG — falls back to ~/.docker`);
    assert.notEqual(env.DOCKER_CONFIG, dotDocker,
      `${agent.label}: DOCKER_CONFIG is the operator's own docker config, which is the thing being avoided`);
    assert.equal(env.DOCKER_CONFIG, dockerConfigDir());
  }
});

test('the launcher is PREPENDED — it must not displace the interpreter or the script', NEEDS_PLUTIL, () => {
  // The bundle exists to own the TCC identity, not to change what runs. A prefix that replaced
  // argv[0] would still produce a loadable plist and a named prompt, and would run nothing.
  const argv = parsed(plist(sample())).ProgramArguments;
  const nodeAt = argv.indexOf(NODE);
  assert.ok(nodeAt >= 0, `the node binary disappeared from ProgramArguments: ${JSON.stringify(argv)}`);
  assert.ok(argv.length > nodeAt + 1, 'the script argument disappeared from ProgramArguments');
  assert.equal(argv.slice(0, nodeAt).length, LAUNCH_PREFIX.length,
    'exactly the launcher prefix may precede the interpreter');
  assert.deepEqual(argv.slice(0, nodeAt), LAUNCH_PREFIX);
});

test('when a launcher is present it is an app BUNDLE, not a bare binary or a script', () => {
  // TCC keys a bundled, signed app on its bundle id — that is the whole point. A bare executable
  // goes back to identifier_type=Path, and a script bundle runs the interpreter's signature
  // instead. On a box where the bundle was never built LAUNCH_PREFIX is empty and there is
  // nothing to check; that is the documented absent-safe path, not a silent skip of a real case.
  if (!LAUNCH_PREFIX.length) return;
  const [launcher] = LAUNCH_PREFIX;
  assert.match(launcher, /\.app\/Contents\/MacOS\/[^/]+$/,
    `launcher is not inside an app bundle, so TCC will file it by path again: ${launcher}`);
  // codesign reports on STDERR. Reading stdout alone returns '' for a correctly signed bundle as
  // readily as for an unsigned one — a check that cannot go positive, which is how it first ran.
  const r = spawnSync('codesign', ['-dvv', launcher.replace(/\/Contents\/MacOS\/.*$/, '')],
    { encoding: 'utf8' });
  const info = `${r.stdout || ''}${r.stderr || ''}`;
  assert.ok(info.includes('Identifier='),
    `codesign produced no identifier line at all — the check would pass vacuously: ${JSON.stringify(info)}`);
  assert.match(info, /Identifier=com\.portll\.commitwork-job/,
    'the bundle is unsigned or carries a different identifier — the grant would not be keyed as expected');
});
