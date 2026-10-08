// lib/claude-spawn.mjs — the one builder for a `claude` child. What it must refuse, what every
// profile carries, and a census that no other source builds a claude argv by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { claudeArgs, claudeSpawnPlan, PROFILES, EMPTY_MCP_CONFIG, SETTING_SOURCES } from '../claude-spawn.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the empty MCP config is a file holding no server', () => {
  assert.deepEqual(JSON.parse(readFileSync(EMPTY_MCP_CONFIG, 'utf8')), { mcpServers: {} });
});

test('tools must be explicit: an omitted list is refused, never the CLI default', () => {
  assert.throws(() => claudeArgs({}), /tools must be explicit/);
  assert.deepEqual(claudeArgs({ tools: '' }).slice(-5), ['--tools', '', '--mcp-config', EMPTY_MCP_CONFIG, '--strict-mcp-config']);
});

test('project and local setting sources are refused: both are read from the cwd', () => {
  for (const s of ['project', 'local', 'user,project', 'project,local']) assert.throws(() => claudeArgs({ tools: '', settingSources: s }), /refused/);
  assert.deepEqual([...SETTING_SOURCES], ['', 'user']);
});

test('a flag the builder owns cannot be passed through extra', () => {
  for (const f of ['--setting-sources', '--mcp-config', '--tools', '--allowedTools', '--add-dir', '--permission-mode', '--dangerously-skip-permissions', '--settings', '--setting-sources=project']) {
    assert.throws(() => claudeArgs({ tools: '', extra: [f, 'x'] }), /set by the builder/, f);
  }
  assert.ok(claudeArgs({ tools: '', extra: ['--max-budget-usd', '1'] }).includes('--max-budget-usd'));
});

test('every profile loads no project settings, names its tools and ends on a boolean flag', () => {
  for (const [name, p] of Object.entries(PROFILES)) {
    const a = claudeArgs(p);
    assert.ok(SETTING_SOURCES.includes(a[a.indexOf('--setting-sources') + 1]), name);
    assert.equal(typeof a[a.indexOf('--tools') + 1], 'string', name);
    assert.equal(a.at(-1), '--strict-mcp-config', `${name}: a trailing prompt would be swallowed by a variadic flag`);
  }
});

test('an analysis plan runs in its own realpath\'d scratch, reads repos via --add-dir, and cleans up', () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cw-cs-repo-')));
  try {
    const plan = claudeSpawnPlan(PROFILES.codeql, { readDirs: [repo], env: { PATH: '/p', HOME: '/h', VELD_API_KEY: 'k', CLAUDE_CODE_SSE_PORT: '1', ANTHROPIC_API_KEY: 'a' } });
    assert.notEqual(plan.cwd, repo);
    assert.equal(plan.cwd, realpathSync(plan.cwd));
    assert.ok(existsSync(plan.cwd));
    assert.equal(plan.args[plan.args.indexOf('--add-dir') + 1], repo);
    assert.deepEqual(plan.env, { PATH: '/p', HOME: '/h', ANTHROPIC_API_KEY: 'a', CW_GUARD_UNATTENDED: '1' });
    plan.cleanup();
    assert.equal(existsSync(plan.cwd), false);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('an edit plan runs in the repo and refuses a missing or relative one', () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cw-cs-edit-')));
  try {
    const plan = claudeSpawnPlan(PROFILES.issueLoop, { repo });
    assert.equal(plan.cwd, repo);
    assert.equal(plan.scratch, null);
    assert.ok(!plan.args.includes('--add-dir'));
    for (const bad of [null, 'relative/repo', join(repo, 'absent')]) assert.throws(() => claudeSpawnPlan(PROFILES.issueLoop, { repo: bad }), /existing absolute repo/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// guard: a census over HEAD-tracked sources, so a new hand-built claude argv is caught where it lands
test('no source outside the builder spells a claude argv by hand', () => {
  const files = execFileSync('git', ['-C', CW, 'ls-files', '*.mjs', '*.js'], { encoding: 'utf8' }).split('\n')
    .filter((f) => f && !/(^|\/)test\//.test(f) && f !== 'lib/claude-spawn.mjs');
  // `claude --version` is a probe, not an agent
  const HAND = [/['"]claude['"]\s*,\s*\[(?!\s*['"]--version['"]\s*\])/, /\[\s*['"]claude['"]\s*,\s*['"]-/];
  const hits = [];
  for (const f of files) {
    let s;
    try { s = readFileSync(join(CW, f), 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    for (const re of HAND) if (re.test(s)) hits.push(`${f}: ${re}`);
  }
  assert.deepEqual(hits, []);
});
