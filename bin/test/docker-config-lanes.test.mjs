import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO, 'bin');

const CALLS_DOCKER = /(^|[^\w-])docker\s+(run|info|inspect|ps|pull|build|image|version)\b/m;

function lanes() {
  return readdirSync(BIN)
    .filter((f) => f.endsWith('.sh'))
    .map((f) => [f, readFileSync(join(BIN, f), 'utf8')])
    .filter(([, body]) => CALLS_DOCKER.test(body));
}

test('the lane census finds lanes at all', () => {
  // Without this, every assertion below passes vacuously the day the regex stops matching.
  assert.ok(lanes().length >= 5, `expected several docker lanes, found ${lanes().length}`);
});

test('every shell lane that calls docker sources the scoped config', () => {
  const missing = lanes()
    .filter(([, body]) => !body.includes('lib/docker-config.sh'))
    .map(([name]) => name);
  assert.deepEqual(missing, [], 'these lanes would run against ~/.docker and raise the App Data prompt');
});

test('it is sourced BEFORE the first docker call, not merely present', () => {
  for (const [name, body] of lanes()) {
    const sourced = body.indexOf('lib/docker-config.sh');
    const firstCall = body.search(CALLS_DOCKER);
    assert.ok(sourced < firstCall, `${name}: sources the config after it has already called docker`);
  }
});

test('the resolved config declares no credsStore', () => {
  // The effect, not the wiring: a config carrying credsStore would satisfy every assertion above
  // and still exec docker-credential-desktop on the first remote image ref.
  const dir = execFileSync('node', [join(BIN, 'docker-config-path.mjs')], { encoding: 'utf8' }).trim();
  assert.ok(dir, 'docker-config-path.mjs printed nothing');
  assert.notEqual(dir, join(homedir(), '.docker'));
  assert.equal(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).credsStore, undefined);
});

// The script path travels in the environment, never inside the shell text.
const DOCKER_CONFIG_SH = join(BIN, 'lib', 'docker-config.sh');

test('a lane that already has DOCKER_CONFIG keeps it', () => {
  // Overriding a caller's registry identity turns an authenticated scan into an anonymous one,
  // which reports FEWER findings — a quieter result that reads as a cleaner one.
  const r = spawnSync('bash', ['-c', 'set -uo pipefail; . "$DOCKER_CONFIG_SH"; echo "$DOCKER_CONFIG"'],
    { encoding: 'utf8', env: { ...process.env, DOCKER_CONFIG_SH, DOCKER_CONFIG: '/tmp/cw-theirs' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '/tmp/cw-theirs');
});

test('an unresolvable helper leaves the lane runnable rather than unset under set -u', () => {
  const r = spawnSync('bash', ['-c', 'set -uo pipefail; . "$DOCKER_CONFIG_SH"; echo "ran:${DOCKER_CONFIG:-none}"'],
    { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, DOCKER_CONFIG_SH } });
  assert.equal(r.status, 0, `the lane died when node was unreachable: ${r.stderr}`);
  assert.match(r.stdout, /^ran:/m);
});
