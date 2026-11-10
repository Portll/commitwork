// lib/claude-spawn.mjs — the one builder for a `claude` child. What it must refuse, what every
// profile carries, and a census that no other source builds a claude argv by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { claudeArgs, claudeSpawnPlan, PROFILES, EMPTY_MCP_CONFIG, SETTING_SOURCES, ISSUE_LOOP_TOOLS } from '../claude-spawn.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// guarded profiles write their guard settings file: keep it, and the posture's store, out of ~/.commitwork
const ISO = mkdtempSync(join(tmpdir(), 'cw-cs-iso-'));
process.env.CW_SETTINGS = join(ISO, 'settings.json');
process.env.CW_CLAUDE_GUARD_DIR = join(ISO, 'guard');
process.on('exit', () => rmSync(ISO, { recursive: true, force: true }));

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

// A SECOND WITNESS FOR THE SAME CLAIM, AND IT MUST NOT SHARE THE FIRST'S FAILURE MODE.
// The census above matches the literal `'claude', [`, so it is blind to every spawn whose binary
// arrived in a VARIABLE — which is how bin/security-work-queue.mjs starts one
// (`launcher.resolveBinary('claude')`), and that spawn has been invisible to it the whole time.
// This witness reads the FLAGS instead: `--setting-sources`, `--mcp-config`, `--permission-mode`
// and the rest are the Claude Code CLI's alone, so a source outside the builder that spells one is
// either building an argv by hand or talking about one.
//
// A RATCHET, NOT A GATE. Every file that spells a confinement flag is listed with the reason, the
// assertion is EQUALITY, and lib/claude-spawn.mjs is in the list as the positive control — a regex
// that matched nothing would otherwise pass here forever. Closing the open row below fails this
// test, which is how you are told to delete the row.
const CONFINEMENT_FLAG = /--(?:setting-sources|permission-prompts|permission-mode|strict-mcp-config|mcp-config|allowed-?[tT]ools|dangerously-skip-permissions|bare|restricted)\b/;
const SPELLS_A_CONFINEMENT_FLAG = Object.freeze({
  'lib/claude-spawn.mjs': 'the builder itself — the positive control for this regex',
  'monitor/settings.mjs': 'setting descriptions naming the flags the posture adds; no spawn',
  'monitor/agent-run-judge.mjs': 'reads a recorded argv out of an agent transcript; never builds one',
  'bin/hooks/guard-destructive.mjs': 'the header records what was MEASURED about an answered ask, naming the flags that decide it; a hook spawns no agent',
  // OPEN DEFECT, measured 2026-10-24 and not fixed here. localDraft() in bin/security-work-queue.mjs
  // spells its own argv and passes `launched.env`, which spine-qwen's servingHostEnv() builds from
  // the whole of process.env, so VELD_API_KEY and anything else exported reaches the child. Two
  // things block routing it through the builder, and neither is a line of glue: `--plugin-dir`
  // (which spine's launchEnv returns in `args`) is in OWNED and the builder refuses it, and llmEnv
  // strips the CLAUDE_CONFIG_DIR that points the child at the local-model profile.
  'bin/security-work-queue.mjs': 'OPEN: builds a claude argv by hand and inherits the raw parent env; needs a builder profile that can carry --plugin-dir and CLAUDE_CONFIG_DIR',
});

test('a confinement flag is spelled only by the builder, by prose, or by a listed open defect', () => {
  const files = execFileSync('git', ['-C', CW, 'ls-files', '*.mjs', '*.js'], { encoding: 'utf8' }).split('\n')
    .filter((f) => f && !/(^|\/)test\//.test(f));
  const hits = [];
  for (const f of files) {
    let s;
    try { s = readFileSync(join(CW, f), 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (CONFINEMENT_FLAG.test(s)) hits.push(f);
  }
  assert.deepEqual(hits.sort(), Object.keys(SPELLS_A_CONFINEMENT_FLAG).sort(),
    'a source outside lib/claude-spawn.mjs spells a Claude Code confinement flag. Route its spawn through claudeSpawnPlan, or add it to SPELLS_A_CONFINEMENT_FLAG with the reason it is not a spawn.');
  assert.ok(hits.includes('lib/claude-spawn.mjs'), 'the positive control is missing: this regex now matches nothing');
});

test('the issue-loop profile is a closed tool list with no shell and accepted edits; a widening permission mode is refused', () => {
  const a = claudeArgs({ ...PROFILES.issueLoop, env: {} });
  const at = (f) => a[a.indexOf(f) + 1];
  assert.equal(at('--tools'), ISSUE_LOOP_TOOLS);
  assert.deepEqual(ISSUE_LOOP_TOOLS.split(','), ['Read', 'Edit', 'Write', 'Grep', 'Glob']);
  assert.equal(at('--permission-mode'), 'acceptEdits');
  assert.equal(at('--output-format'), 'stream-json');
  assert.ok(a.includes('--verbose'));
  assert.ok(!a.includes('--allowedTools'), 'no allow rule is added; the tool list is the whole grant');
  assert.equal(a.at(-1), '--strict-mcp-config');
  assert.throws(() => claudeArgs({ tools: '', permissionMode: 'bypassPermissions' }), /permission mode/);
});
