import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scannerEnv, llmEnv, laneEnv, dockerPassByName } from '../lib/scanner-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const SAMPLE = {
  PATH: '/usr/bin', HOME: '/h', CW_TARGET_URL: 'http://x', LD_LIBRARY_PATH: '/l', SOCKET_CLI_ORG_SLUG: 'o',
  VELD_API_KEY: 'k', CLAUDE_CODE_MESSAGING_TOKEN: 't', ANTHROPIC_API_KEY: 'a', SUBSTRATE_TASKS_DB: 'd',
  SPINE_AGENT: 's', MCP_X: 'm',
};

test('harness, memory-store and orchestrator credentials never reach a scanner', () => {
  assert.deepEqual(Object.keys(scannerEnv(SAMPLE)).sort(), ['CW_TARGET_URL', 'HOME', 'LD_LIBRARY_PATH', 'PATH', 'SOCKET_CLI_ORG_SLUG']);
});

test('a headless model keeps only its own key and is told nobody can answer an ask', () => {
  const env = llmEnv(SAMPLE);
  assert.deepEqual(Object.keys(env).sort(), ['ANTHROPIC_API_KEY', 'CW_GUARD_UNATTENDED', 'CW_TARGET_URL', 'HOME', 'LD_LIBRARY_PATH', 'PATH', 'SOCKET_CLI_ORG_SLUG']);
  assert.equal(env.CW_GUARD_UNATTENDED, '1');
  assert.equal(llmEnv({ PATH: '/p' }).ANTHROPIC_API_KEY, undefined, 'an absent key is not invented');
});

// guard: every check or model spawn is named here
test('the runner spawns checks and act with the stripped environment', () => {
  const s = src('bin/commitwork.mjs');
  assert.match(s, /const env = \{ \.\.\.\(bound && bound\.check \? laneEnv\(bound\.check, process\.env\) : scannerEnv\(process\.env\)\), \.\.\.\(extraEnv \|\| \{\}\) \};/);
  // both lane paths hand runShell the check, so neither falls back to the denylist for a repo-code lane
  assert.equal((s.match(/Bound = \{ check, |const bound = \{ check, /g) || []).length, 2);
  assert.match(s, /spawnSync\('act', args, \{[^}]*env: scannerEnv\(process\.env\)/);
  assert.doesNotMatch(s, /\.\.\.process\.env, \.\.\.extraEnv/);
});

test('the MCP server uses the same filter', () => {
  const s = src('mcp/server.mjs');
  assert.match(s, /from '\.\.\/bin\/lib\/scanner-env\.mjs'/);
  // run_checks (sync) and run_checks_start (job) share one env builder, and it starts from the filter
  assert.match(s, /const runEnv = \(reportDir\) => \(\{\s*\.\.\.scannerEnv\(process\.env\),/);
  const spawns = s.match(/\bspawn(Sync)?\(\s*'node',[^\n]*/g) || [];
  assert.equal(spawns.length, 2, `expected the sync and the job spawn, found: ${spawns.join(' | ')}`);
  for (const call of spawns) assert.match(call, /env: runEnv\(reportDir\)/, call);
  assert.doesNotMatch(s, /\bspawn(Sync)?\([^\n]*\.\.\.process\.env/);
  assert.doesNotMatch(s, /const HARNESS_ENV =/, 'a second copy of the filter drifts from the first');
  // the job queue schedules; it must not grow a spawn of its own that bypasses runEnv
  assert.doesNotMatch(src('mcp/jobs.mjs'), /node:child_process|\bspawn(Sync)?\(/);
});

// The argv and env are built by lib/claude-spawn.mjs; lib/test/claude-spawn-callers.test.mjs pins
// what the child actually receives against a stub claude.
test('the CodeQL remediation lane spawns claude through the builder: llmEnv and a closed tool list', () => {
  const s = src('admin/routes/codeql-remediation.mjs');
  assert.match(s, /claudeSpawnPlan\(PROFILES\.codeql\b/);
  assert.match(s, /spawn\(argv\[0\], argv\.slice\(1\), \{[^}]*env: plan\.env/);
  const b = src('lib/claude-spawn.mjs');
  assert.match(b, /codeql: Object\.freeze\(\{[^}]*tools: 'Read,Grep,Glob'/);
  assert.match(b, /env: llmEnv\(env\)/);
  assert.match(b, /'--strict-mcp-config'/);
});

// ── laneEnv: what a lane's shell starts from ─────────────────────────────────────────────────────
const HOSTILE = {
  ...SAMPLE, GH_TOKEN: 'g', GITHUB_TOKEN: 'g2', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's', NPM_TOKEN: 'n',
  OPENAI_API_KEY: 'o', COMMITWORK_TRUST_REPO_MANIFEST: '1', CW_SANDBOX: 'off', CW_BEARER_A: 'b', SSH_AUTH_SOCK: '/tmp/a',
  TMPDIR: '/t', LANG: 'C', LC_ALL: 'C', JAVA_HOME: '/j', GOPATH: '/go', CARGO_HOME: '/c', RUSTUP_HOME: '/r',
  npm_config_cache: '/nc', CW_REPORT_DIR: '/rep', CW_ROOT: '/cw', CW_DEPSCAN_IMAGE: 'img', HTTPS_PROXY: 'http://p',
};
const REPO_CODE = { id: 'builds-it', executesRepoCode: true };

test('a lane that runs repo code gets the allowlist: no token, cloud key or operator switch survives', () => {
  const env = laneEnv(REPO_CODE, HOSTILE);
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'NPM_TOKEN', 'OPENAI_API_KEY',
    'COMMITWORK_TRUST_REPO_MANIFEST', 'CW_SANDBOX', 'CW_BEARER_A', 'SSH_AUTH_SOCK', 'VELD_API_KEY', 'ANTHROPIC_API_KEY',
    'SOCKET_CLI_ORG_SLUG', 'LD_LIBRARY_PATH']) assert.equal(env[k], undefined, `${k} reached a repo-code lane`);
  for (const k of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'JAVA_HOME', 'GOPATH', 'CARGO_HOME', 'RUSTUP_HOME', 'npm_config_cache',
    'CW_REPORT_DIR', 'CW_ROOT', 'CW_TARGET_URL', 'CW_DEPSCAN_IMAGE', 'HTTPS_PROXY']) assert.equal(env[k], HOSTILE[k], `${k} was dropped`);
});

test('a repo-code lane keeps the secrets it declares, and the names BH_DOCKER_ARGS forwards by name', () => {
  const env = laneEnv({ ...REPO_CODE, requires: { secrets: ['NPM_TOKEN'] } },
    { ...HOSTILE, BH_DOCKER_ARGS: '--network n -e SPRING_DATASOURCE_PASSWORD -e A=inline --env=MQ_PASS', SPRING_DATASOURCE_PASSWORD: 'p', MQ_PASS: 'q', A: 'x' });
  assert.equal(env.NPM_TOKEN, 'n');
  assert.equal(env.SPRING_DATASOURCE_PASSWORD, 'p');
  assert.equal(env.MQ_PASS, 'q');
  assert.equal(env.A, undefined, '-e A=inline carries its own value; A itself is not forwarded');
  assert.equal(env.GH_TOKEN, undefined);
  assert.deepEqual(dockerPassByName('--network n -e X -e Y=1 --env Z --env=W -v a:b'), ['X', 'Z', 'W']);
});

test('an analyser lane keeps the inherited env less the harness and the two operator switches', () => {
  const env = laneEnv({ id: 'reads-it' }, HOSTILE);
  assert.equal(env.GH_TOKEN, 'g', 'a github lane authenticates with the inherited token');
  assert.equal(env.CW_BEARER_A, 'b', 'the BOLA matrix reads its bearer tokens from the env');
  for (const k of ['CW_SANDBOX', 'COMMITWORK_TRUST_REPO_MANIFEST', 'VELD_API_KEY', 'ANTHROPIC_API_KEY']) assert.equal(env[k], undefined, k);
  assert.deepEqual(laneEnv({ executesRepoCode: false }, HOSTILE), env);
});

// fact: the allowlist is checked against what the wrappers of every repo-code lane actually read / a name a wrapper reads and the list lacks silently falls back to its default inside the lane (expiry: never, prev: missing)
test('every CW_/BH_/toolchain name a repo-code lane\'s own wrapper reads survives the allowlist', () => {
  const scripts = new Set();
  for (const f of ['manifests/build-health.json', 'manifests/hermetic-tests.json', 'manifests/security-baseline.json']) {
    for (const c of JSON.parse(src(f)).checks || []) {
      if (c.executesRepoCode !== true) continue;
      for (const cmd of c.local || []) for (const m of cmd.matchAll(/\$CW_ROOT\/bin\/([\w.-]+\.(?:mjs|sh))/g)) scripts.add(`bin/${m[1]}`);
    }
  }
  assert.ok(scripts.has('bin/build-health.mjs') && scripts.has('bin/hermetic-test.mjs') && scripts.has('bin/depscan-scan.sh'), [...scripts].join(' '));
  const read = new Set();
  for (const p of scripts) {
    const text = src(p);
    const re = p.endsWith('.sh') ? /\$\{?((?:CW|BH)_[A-Z0-9_]+)/g : /\b(?:process\.)?env\.([A-Z][A-Z0-9_]+)/g;
    for (const m of text.matchAll(re)) read.add(m[1]);
  }
  assert.ok(read.size > 10, `the extractor found ${read.size} names; this would pass vacuously`);
  const probe = Object.fromEntries([...read].map((k) => [k, 'v']));
  const kept = laneEnv(REPO_CODE, probe);
  // codeql exports these to the build command it runs inside the lane; the lane's own shell never had them
  const SET_INSIDE = new Set(['CODEQL_EXTRACTOR_GO_ROOT', 'CODEQL_PLATFORM']);
  const lost = [...read].filter((k) => !(k in kept) && !SET_INSIDE.has(k));
  assert.deepEqual(lost, [], `read by a repo-code wrapper but dropped by laneEnv: ${lost.join(', ')}`);
});
