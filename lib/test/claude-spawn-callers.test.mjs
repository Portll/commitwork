// Every `claude` commitwork starts, run against a stub `claude` on PATH that records its argv, cwd,
// env and stdin. Review 2026-10-07 D2: a spawn whose cwd is a scanned repo and that reads project
// settings loads that repo's hooks and CLAUDE.md. D8: the envelope witness must run the argv the CodeQL
// lane runs. D10: the cobolwork reviewer had no flags, the shared tmpdir as cwd and the raw env.
//
// The seams that replace the whole argv (CW_*_CLAUDE_CMD, CW_ISSUE_AGENT_CMD) are left unset, so what
// is recorded is the production command. Nothing here imports lib/claude-spawn.mjs: the assertions are
// about what the child receives, whoever builds it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..', '..');
const T = realpathSync(mkdtempSync(join(tmpdir(), 'cw-claude-callers-')));
const BIN = join(T, 'bin');
const LOG = join(T, 'calls.jsonl');
const REPLY = join(T, 'reply.txt');
const REPO = join(T, 'scanned-repo');
const SAVED = { ...process.env };
const SEAMS = ['CW_CODEQL_CLAUDE_CMD', 'CW_ISSUE_AGENT_CMD', 'CW_COBOLWORK_CLAUDE_CMD', 'CW_CLAUDE_CWD', 'CW_ENVELOPE_CLAUDE_CMD', 'CW_HANDOFF_CMD'];

before(() => {
  mkdirSync(BIN, { recursive: true });
  mkdirSync(join(REPO, '.claude'), { recursive: true });
  // the attack D2 names: a scanned repo carrying its own hooks
  writeFileSync(join(REPO, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'touch /tmp/never' }] }] } }));
  const stub = join(BIN, 'claude');
  writeFileSync(stub, `#!${process.execPath}
const fs = require('node:fs');
let input = '';
let done = false;
const finish = () => {
  if (done) return;
  done = true;
  fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), input,
    env: { VELD_API_KEY: process.env.VELD_API_KEY ?? null, CLAUDE_CODE_SSE_PORT: process.env.CLAUDE_CODE_SSE_PORT ?? null, CW_GUARD_UNATTENDED: process.env.CW_GUARD_UNATTENDED ?? null } }) + '\\n');
  process.stdout.write(fs.readFileSync(${JSON.stringify(REPLY)}, 'utf8'));
  process.exit(0);
};
// a prompt-on-argv caller (execFile) never closes stdin, so silence stands for an empty one
const idle = setTimeout(finish, 1500);
process.stdin.on('data', (d) => { clearTimeout(idle); input += d; });
process.stdin.on('end', finish);
`);
  chmodSync(stub, 0o755);
  for (const k of SEAMS) delete process.env[k];
  Object.assign(process.env, { PATH: `${BIN}${delimiter}${SAVED.PATH}`, VELD_API_KEY: 'sk-veld-must-not-reach-claude', CLAUDE_CODE_SSE_PORT: '1' });
});
after(() => { process.env = SAVED; rmSync(T, { recursive: true, force: true }); });

const calls = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const reset = (reply) => { rmSync(LOG, { force: true }); writeFileSync(REPLY, reply); };
const after1 = (argv, flag) => argv[argv.indexOf(flag) + 1];

// What every spawn must carry, whoever built it.
function assertConfined(c, { tools, sources = '' }) {
  assert.ok(c.argv.includes('--setting-sources'), `no --setting-sources: ${c.argv.join(' ')}`);
  assert.equal(after1(c.argv, '--setting-sources'), sources);
  assert.ok(c.argv.includes('--strict-mcp-config'), 'no --strict-mcp-config');
  const mcp = after1(c.argv, '--mcp-config');
  assert.ok(c.argv.includes('--mcp-config') && existsSync(mcp), `no explicit MCP config file: ${mcp}`);
  assert.deepEqual(JSON.parse(readFileSync(mcp, 'utf8')), { mcpServers: {} });
  assert.equal(after1(c.argv, '--tools'), tools);
  assert.equal(c.env.VELD_API_KEY, null, 'a harness credential reached claude');
  assert.equal(c.env.CLAUDE_CODE_SSE_PORT, null, 'the parent session env reached claude');
  assert.equal(c.env.CW_GUARD_UNATTENDED, '1');
}

const FINDING = { service: 'fixture-service', sarif: 'codeql.sarif', ruleId: 'js/fixture', ruleName: 'fixture rule', severity: 'error', securitySeverity: 7.5, message: 'a fixture finding', file: 'src/a.js', line: 3 };

let codeqlArgv = null;
test('codeql: analysis runs in a scratch cwd, reads the repo through --add-dir, loads no settings', async () => {
  reset(JSON.stringify({ result: JSON.stringify({ classification: 'needs-human' }) }));
  const { reviewFinding } = await import('../../admin/routes/codeql-remediation.mjs');
  const r = await reviewFinding(FINDING, { text: 'x', note: 'lines 1-1' }, { repo: REPO });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [c] = calls();
  assertConfined(c, { tools: 'Read,Grep,Glob' });
  assert.notEqual(c.cwd, REPO, 'the scanned repo is the cwd, so its settings and CLAUDE.md are in reach');
  assert.ok(!c.cwd.startsWith(`${REPO}/`));
  assert.equal(existsSync(c.cwd), false, 'the scratch cwd is removed after the run');
  assert.equal(after1(c.argv, '--add-dir'), REPO);
  assert.equal(after1(c.argv, '--permission-prompts'), 'none');
  assert.ok(c.input.startsWith(`Repository root (finding paths are relative to it; read it with Read, Grep and Glob): ${REPO}\n`), 'the agent is told where the repository is');
  codeqlArgv = c.argv;
});

test('envelope witness: its argv is the CodeQL argv apart from the declared differences (D8)', async () => {
  assert.ok(codeqlArgv, 'the codeql test above recorded no argv');
  const { claudeArgv } = await import('../../monitor/envelope-witness.mjs');
  const witness = claudeArgv({}).slice(1);
  // declared: stream-json for per-event judging, hook events, and no repository to add
  const strip = (argv, flags) => argv.filter((a, i) => !flags.includes(a) && !flags.includes(argv[i - 1]));
  const prod = strip(codeqlArgv, ['--add-dir']).map((a, i, xs) => (xs[i - 1] === '--output-format' ? 'stream-json' : a));
  assert.deepEqual(witness.filter((a) => a !== '--verbose' && a !== '--include-hook-events'), prod);
  assert.ok(witness.includes('--verbose') && witness.includes('--include-hook-events'));
});

test('finding-analysis: the analyst runs from an empty scratch with no settings and llmEnv', async () => {
  reset('VERDICT: false-positive\nCONFIDENCE: low\n');
  const { claudeCodeAnalyst } = await import('../../bin/finding-analysis.mjs');
  const r = await claudeCodeAnalyst({ timeoutMs: 30_000 })('PROMPT-MARKER');
  assert.equal(r.state, 'analysed', JSON.stringify(r));
  const [c] = calls();
  assertConfined(c, { tools: 'default' });
  assert.equal(c.argv.at(-1), 'PROMPT-MARKER', 'the prompt is the last argument, after every variadic flag');
  assert.ok(!c.cwd.startsWith(CW), `ran in ${c.cwd}`);
  assert.equal(r.cwd, c.cwd, 'the recorded cwd is the one used');
});

test('cobolwork reviewer: no tools, no settings, its own scratch cwd, llmEnv (D10)', async () => {
  reset(JSON.stringify({ result: JSON.stringify({ agrees: true, concerns: 'none' }) }));
  const { claudeReviewer } = await import('../cobolwork-remediation-engines.mjs');
  const r = await claudeReviewer()({ prompt: 'the drafted diff' });
  assert.equal(r.ok, true, r.error);
  const [c] = calls();
  assertConfined(c, { tools: '' });
  assert.equal(after1(c.argv, '--output-format'), 'json');
  assert.notEqual(c.cwd, realpathSync(tmpdir()), 'the shared tmpdir is not a private cwd');
  assert.equal(existsSync(c.cwd), false, 'the scratch cwd is removed after the review');
  assert.equal(c.input, 'the drafted diff\n');
});

test('daily-run: the scheduled model run gets the same confinement and llmEnv', async () => {
  const { runModel } = await import('../../bin/daily-run.mjs');
  let seen = null;
  const spawn = (file, args, opts) => { seen = { file, args, opts }; return { status: 0, stdout: JSON.stringify({ structured_output: { suggestions: [] }, usage: {} }) }; };
  const skill = join(T, 'skill.md');
  writeFileSync(skill, 'skill');
  runModel({ area: 'x' }, { skill, claudeBin: 'claude', spawn });
  assertConfined({ argv: seen.args, env: { VELD_API_KEY: seen.opts.env.VELD_API_KEY ?? null, CLAUDE_CODE_SSE_PORT: seen.opts.env.CLAUDE_CODE_SSE_PORT ?? null, CW_GUARD_UNATTENDED: seen.opts.env.CW_GUARD_UNATTENDED ?? null } }, { tools: '' });
});

test('issue-loop --apply: the editing agent runs in the repo with user settings only, never the repo\'s', (t) => {
  reset('done\n');
  const store = join(T, 'issues.json');
  const reg = join(T, 'projects.json');
  writeFileSync(reg, JSON.stringify({
    reportsRoot: join(T, 'reports'), defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'fixrepo', area: 'loop', path: REPO, manifest: 'security-baseline' }],
    areas: [{ slug: 'loop', label: 'Loop', out: 'loop', primary: true, members: ['fixrepo'] }],
  }));
  const seed = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { emptyIssuesDoc, mintIssue, saveIssues, withIssuesLock } from ${JSON.stringify(pathToFileURL(join(CW, 'monitor', 'issue-store.mjs')).href)};
    const doc = emptyIssuesDoc();
    mintIssue(doc, { area: 'loop', title: 'fixture', severity: 'high', repo: 'fixrepo', kind: 'task', body: 'b', remediation: 'r', class: 'F',
      source: { kind: 'manual', key: null, tool: null, rule: null } }, '2026-08-01T00:00:00.000Z');
    withIssuesLock(() => saveIssues(doc, { path: ${JSON.stringify(store)} }), { path: ${JSON.stringify(store)} });`], { encoding: 'utf8' });
  assert.equal(seed.status, 0, seed.stderr);
  const rollup = join(T, 'rollup.json');
  writeFileSync(rollup, JSON.stringify({ generated: '2026-08-02T10:00:00.000Z', sliceId: 'sweep-fixture', repos: [] }));
  const r = spawnSync(process.execPath, [join(CW, 'bin', 'issue-loop.mjs'), '--area', 'loop', '--apply'], {
    encoding: 'utf8',
    env: { ...process.env, CW_REGISTRY: reg, CW_ISSUES: store, CW_ROLLUP: rollup, CW_MONITOR_OUT: join(T, 'out'), CW_NOW: '2026-08-02T12:00:00.000Z', CW_AGENT_TAGS: join(T, 'tags.jsonl') },
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const [c] = calls();
  assert.ok(c, `the agent never ran: ${r.stdout}\n${r.stderr}`);
  assertConfined(c, { tools: 'default', sources: 'user' });
  assert.equal(c.cwd, REPO, 'the editing agent works in the repository it edits');
  assert.match(c.argv.at(-1), /handoff\/ISS-.*\.md$/, 'the handoff path is the last argument');
});

test('panel handoff, Terminal fallback: the attended session loads user settings only', async () => {
  const osa = join(BIN, 'osascript-rec');
  const rec = join(T, 'osa.txt');
  writeFileSync(osa, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(rec)}, process.argv[3]);\n`);
  chmodSync(osa, 0o755);
  // a closed port: the runner is unreachable, so the ladder falls through to Terminal
  Object.assign(process.env, { CW_SUBSTRATE_DISPATCH: 'http://127.0.0.1:9/api/v1/agents/dispatch', CW_OSASCRIPT: osa, CW_OPEN: '/usr/bin/true' });
  const { launchClaudeSession } = await import('../../admin/routes/remediation.mjs');
  const file = join(T, 'handoff.md');
  writeFileSync(file, 'x');
  const r = await launchClaudeSession({ file, cwd: REPO, prompt: 'x' });
  assert.equal(r.via, 'terminal+vscode', JSON.stringify(r));
  for (let i = 0; i < 100 && !existsSync(rec); i++) await new Promise((res) => setTimeout(res, 20));
  const script = readFileSync(rec, 'utf8');
  const shell = /do script "((?:[^"\\]|\\.)*)"/.exec(script)[1].replace(/\\(.)/g, '$1');
  assert.ok(shell.startsWith(`cd '${REPO}' && 'claude' `), shell);
  assert.match(shell, / '--setting-sources' 'user' /);
  assert.match(shell, / '--tools' 'default' /);
  assert.match(shell, / '--mcp-config' '[^']+claude-mcp-none\.json' '--strict-mcp-config' "\$\(cat '[^']+handoff\.md'\)"$/);
});
