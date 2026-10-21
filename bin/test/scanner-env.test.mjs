import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scannerEnv, llmEnv, laneEnv, dockerPassByName, declaresCredential, withheldCredentials, isCredentialKey, GH_STORE } from '../lib/scanner-env.mjs';

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

test('an analyser lane keeps the inherited env less the harness, the two operator switches and every credential-shaped name it did not declare', () => {
  const env = laneEnv({ id: 'reads-it' }, HOSTILE);
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'NPM_TOKEN', 'OPENAI_API_KEY', 'CW_BEARER_A',
    'CW_SANDBOX', 'COMMITWORK_TRUST_REPO_MANIFEST', 'VELD_API_KEY', 'ANTHROPIC_API_KEY']) assert.equal(env[k], undefined, `${k} reached an undeclared analyser lane`);
  for (const k of ['PATH', 'HOME', 'SSH_AUTH_SOCK', 'LD_LIBRARY_PATH', 'SOCKET_CLI_ORG_SLUG', 'CW_REPORT_DIR', 'HTTPS_PROXY']) assert.equal(env[k], HOSTILE[k], `${k} was dropped`);
  assert.deepEqual(laneEnv({ executesRepoCode: false }, HOSTILE), env);
});

test('an analyser lane holds a credential it declares: requires.secrets, envPassthrough, or the gh names with the gh store', () => {
  assert.equal(laneEnv({ id: 'bola', envPassthrough: ['CW_BEARER_A'] }, HOSTILE).CW_BEARER_A, 'b');
  assert.equal(laneEnv({ id: 'bola', envPassthrough: ['CW_BEARER_A'] }, HOSTILE).CW_BEARER_B, undefined, 'B was not declared');
  assert.equal(laneEnv({ id: 'socket', requires: { secrets: ['NPM_TOKEN'] } }, HOSTILE).NPM_TOKEN, 'n');
  const gh = laneEnv({ id: 'scorecard', sandboxExtraReads: [GH_STORE] }, HOSTILE);
  assert.deepEqual([gh.GH_TOKEN, gh.GITHUB_TOKEN, gh.NPM_TOKEN], ['g', 'g2', undefined]);
  const both = { requires: { secrets: ['A_TOKEN'] }, envPassthrough: ['B_SECRET', 'CW_BEARER*'], sandboxExtraReads: [GH_STORE] };
  for (const k of ['A_TOKEN', 'B_SECRET', 'GH_TOKEN', 'GITHUB_TOKEN', 'CW_BEARER_A', 'CW_BEARER_ANYTHING']) assert.ok(declaresCredential(both, k), k);
  for (const k of ['C_TOKEN', 'CW_BEAR', 'NPM_TOKEN']) assert.ok(!declaresCredential(both, k), k);
  assert.ok(declaresCredential({ envPassthrough: ['*'] }, 'WHATEVER_TOKEN'), '* keeps every credential, for a lane whose names come from its own input');
  assert.equal(laneEnv({ id: 'bola-run', envPassthrough: ['*'] }, HOSTILE).AWS_SECRET_ACCESS_KEY, 's');
});

test('the credential rule covers the names lanes and tools read, and leaves configuration alone', () => {
  for (const k of ['GH_TOKEN', 'X_SECRET', 'DB_PASSWORD', 'PGPASSWORD', 'MYSQL_PWD', 'STRIPE_API_KEY', 'MY_APIKEY', 'AWS_ACCESS_KEY_ID', 'CW_BEARER_A', 'GOOGLE_CREDENTIALS',
    'DJANGO_SECRET_KEY', 'GITHUB_PAT', 'GH_PAT', 'DENO_AUTH_TOKENS', 'DOCKER_AUTH_CONFIG', 'CODEQL_REGISTRIES_AUTH', 'DATABASE_URL', 'SENTRY_DSN', 'NODE_AUTH_TOKEN']) assert.ok(isCredentialKey(k), k);
  for (const k of ['CW_SECRETS_ROOT', 'CW_SECRETS_MAX_BYTES', 'MAX_TOKENS', 'CTX_WARN_TOKENS', 'TOKENIZER', 'SOCKET_CLI_ORG_SLUG', 'PATH', 'PWD', 'OLDPWD', 'CW_LLM_MAX_TOKEN', 'HOME']) assert.ok(!isCredentialKey(k), `${k} is configuration, not a credential`);
  assert.equal(laneEnv({ id: 'reads-it' }, { ...HOSTILE, PWD: '/w', OLDPWD: '/o' }).PWD, '/w', 'the working directory is not a password');
});

test('withheldCredentials names what an analyser lane loses, never a value, and is empty for a repo-code lane', () => {
  const names = withheldCredentials({ id: 'reads-it', envPassthrough: ['NPM_TOKEN'] }, HOSTILE);
  assert.deepEqual(names, ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'CW_BEARER_A', 'GH_TOKEN', 'GITHUB_TOKEN', 'OPENAI_API_KEY']);
  assert.ok(!names.some((n) => Object.values(HOSTILE).includes(n) && !(n in HOSTILE)), 'names, never values');
  assert.deepEqual(withheldCredentials({ id: 'builds', executesRepoCode: true }, HOSTILE), []);
});

test('every check whose wrapper reads an ambient credential declares it, and no other check is handed one it never reads', () => {
  const expect = {
    'manifests/security-baseline.json': { 'dast-authz-bola': ['CW_BEARER_A', 'CW_BEARER_B'], 'posture-scorecard': ['SCORECARD_GITHUB_TOKEN'], 'cspm-github': ['PROWLER_GITHUB_TOKEN'] },
    // bola-run's credential names come from the BOLA manifest it is given (tokenEnv, valueEnv, ${ENV:X}), so a fixed list cannot name them
    'manifests/runtime.json': { 'authz-bola': ['CW_BEARER_A', 'CW_BEARER_B'], 'bola-run': ['CW_BEARER', 'CW_API_KEY', 'SUPABASE_ANON_KEY', 'ANY_MANIFEST_NAMED_TOKEN'], 'cspm-github': ['PROWLER_GITHUB_TOKEN'] },
  };
  for (const [file, lanes] of Object.entries(expect)) {
    const by = Object.fromEntries(JSON.parse(src(file)).checks.map((c) => [c.id, c]));
    for (const [id, names] of Object.entries(lanes)) {
      assert.ok(by[id], `${id} is not in ${file}`);
      const kept = laneEnv(by[id], Object.fromEntries(names.map((n) => [n, 'v'])));
      for (const n of names) assert.equal(kept[n], 'v', `${file} ${id} no longer receives ${n}`);
    }
    // renovate's local mode and the config validator read no token, so neither declares one
    for (const id of ['deps-updates', 'deps-renovate']) if (by[id]) assert.equal(laneEnv(by[id], { RENOVATE_TOKEN: 'v' }).RENOVATE_TOKEN, undefined, `${file} ${id} is handed RENOVATE_TOKEN it never reads`);
  }
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
  // set inside the lane, never inherited: codeql exports the first two to the build it runs, and the
  // Swift lane's own command assigns CW_SWIFT_PLAN in front of codeql
  const SET_INSIDE = new Set(['CODEQL_EXTRACTOR_GO_ROOT', 'CODEQL_PLATFORM', 'CW_SWIFT_PLAN']);
  const lost = [...read].filter((k) => !(k in kept) && !SET_INSIDE.has(k));
  assert.deepEqual(lost, [], `read by a repo-code wrapper but dropped by laneEnv: ${lost.join(', ')}`);
});
