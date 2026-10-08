// action.yml, the GitHub Action: its pins, its shell hygiene, the CLI surface it calls, and its steps
// executed by bash over a copy of the dirty canary with no scanner on PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow, repoOf } from '../pin-actions.mjs';
import { decide, readSarifSummary, annotation, report, FAIL_ON } from '../lib/github-action.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ACTION = readFileSync(join(CW, 'action.yml'), 'utf8');
const LINES = ACTION.split(/\r?\n/);
const posix = { skip: process.platform === 'win32' && 'the steps are bash scripts' };

// Each `name:` under a top-level section, with its quoted default when it has one.
function declared(section) {
  const out = {};
  let cur = null;
  for (let i = LINES.indexOf(`${section}:`) + 1; i > 0 && i < LINES.length && !/^\S/.test(LINES[i]); i++) {
    const n = LINES[i].match(/^ {2}([a-z][a-z-]*):$/);
    if (n) { cur = out[n[1]] = {}; continue; }
    const d = LINES[i].match(/^ {4}default:\s*'(.*)'$/);
    if (d && cur) cur.default = d[1];
  }
  return out;
}

// The composite steps: scalar keys, the env and with maps, and the run script.
function steps() {
  const raw = [];
  for (let i = LINES.indexOf('  steps:') + 1; i > 0 && i < LINES.length && !/^\S/.test(LINES[i]); i++) {
    const m = LINES[i].match(/^ {4}- (.*)$/);
    if (m) raw.push([`      ${m[1]}`]);
    else if (raw.length) raw[raw.length - 1].push(LINES[i]);
  }
  return raw.map((ls) => {
    const step = { env: {}, with: {}, run: null };
    for (let j = 0; j < ls.length; j++) {
      const k = ls[j].match(/^ {6}([a-z-]+):\s*(.*)$/);
      if (!k) continue;
      if (k[1] === 'run') {
        const body = [];
        for (j++; j < ls.length && (ls[j].trim() === '' || /^ {8}/.test(ls[j])); j++) body.push(ls[j].slice(8));
        step.run = `${body.join('\n').trimEnd()}\n`;
        j--;
      } else if (k[1] === 'env' || k[1] === 'with') {
        for (j++; j < ls.length && /^ {8}\S/.test(ls[j]); j++) {
          const e = ls[j].match(/^ {8}([A-Za-z_][\w-]*):\s*(.*)$/);
          step[k[1]][e[1]] = e[2];
        }
        j--;
      } else step[k[1]] = k[2].replace(/^'(.*)'$/, '$1');
    }
    return step;
  });
}
const STEPS = steps();
const INPUTS = declared('inputs');
const stepNamed = (name) => STEPS.find((s) => s.name === name) || assert.fail(`no step named ${name}`);

// The body of a top-level function in a source file, from its declaration to the next one.
function fnBody(src, name) {
  const at = src.search(new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm'));
  assert.ok(at >= 0, `no function ${name}`);
  const rest = src.slice(at + 1);
  const end = rest.search(/^(?:export )?(?:async )?function |^\/\/ ──/m);
  return src.slice(at, end < 0 ? undefined : at + 1 + end);
}

test('the action declares its inputs and outputs, and trust-repo-manifest defaults to false', () => {
  assert.deepEqual(Object.keys(INPUTS), ['checks', 'path', 'sarif', 'upload-sarif', 'fail-on', 'fail-on-unmeasured', 'install-tools', 'trust-repo-manifest']);
  assert.equal(INPUTS['trust-repo-manifest'].default, 'false');
  assert.equal(INPUTS['install-tools'].default, 'false');
  assert.equal(INPUTS.checks.default, 'fast');
  assert.ok(FAIL_ON.includes(INPUTS['fail-on'].default));
  assert.deepEqual(Object.keys(declared('outputs')), ['sarif', 'report-dir', 'exit-code', 'results', 'unmeasured', 'failed']);
  assert.match(ACTION, /^ {2}using: composite$/m);
});

test('every uses: is pinned to a full commit SHA, the same one the repository\'s own workflows pin', () => {
  const raw = LINES.filter((l) => /^\s*(?:-\s+)?uses:/.test(l));
  const pins = parseWorkflow(ACTION);
  assert.ok(raw.length >= 2);
  assert.equal(pins.length, raw.length, 'a uses: line the pin parser skipped is a pin nobody checks');
  const wf = join(CW, '.github', 'workflows');
  const elsewhere = new Map(readdirSync(wf).filter((f) => f.endsWith('.yml'))
    .flatMap((f) => parseWorkflow(readFileSync(join(wf, f), 'utf8'))).map((p) => [repoOf(p.action), p.ref]));
  for (const p of pins) {
    assert.match(p.ref, /^[0-9a-f]{40}$/, `${p.action} is not pinned to a commit`);
    assert.match(p.comment || '', /^v\d+\.\d+\.\d+$/, `${p.action} names no release`);
    if (elsewhere.has(repoOf(p.action))) assert.equal(p.ref, elsewhere.get(repoOf(p.action)), `${p.action} is pinned differently in .github/workflows`);
  }
});

test('no expression is interpolated into a script; every input reaches one through env, quoted', () => {
  const scripted = STEPS.filter((s) => s.run);
  assert.equal(scripted.length, 4);
  for (const s of scripted) {
    assert.doesNotMatch(s.run, /\$\{\{/, `${s.name} interpolates an expression into its script`);
    assert.equal(s.shell, 'bash', `${s.name} names no shell`);
    assert.match(s.run, /^set -euo pipefail$/m, `${s.name} does not stop on the first failure`);
    const unquoted = s.run.split('\n').filter((l) => !/^\s*#/.test(l))
      .filter((l) => [...l.matchAll(/\$\{?INPUT_[A-Z_]+/g)].some((m) => (l.slice(0, m.index).match(/"/g) || []).length % 2 === 0));
    assert.deepEqual(unquoted, [], `${s.name} expands an input outside double quotes`);
  }
  const used = new Set([...ACTION.matchAll(/\binputs\.([a-z-]+)/g)].map((m) => m[1]));
  assert.deepEqual([...used].sort(), Object.keys(INPUTS).sort(), 'an input is declared and never read, or read and never declared');
  for (const s of STEPS) for (const v of Object.values(s.env)) assert.match(v, /^\$\{\{ [a-z_.-]+ \}\}(\/[\w./-]+)?$/, `env value ${v} is not one plain expression`);
});

test('--trust-repo-manifest is passed only when the input is true, and an inherited trust variable is cleared', () => {
  const run = stepNamed('Run the baseline').run;
  const flagLines = run.split('\n').filter((l) => l.includes('--trust-repo-manifest'));
  assert.deepEqual(flagLines, ['if [ "$INPUT_TRUST_REPO_MANIFEST" = true ]; then args+=(--trust-repo-manifest); fi']);
  const unset = run.indexOf('unset COMMITWORK_TRUST_REPO_MANIFEST');
  assert.ok(unset >= 0 && unset < run.indexOf('node "$CLI_PATH" "${args[@]}"'), 'the trust variable is cleared before the run');
  assert.match(run, /--manifest security-baseline /, 'only the bundled baseline runs');
});

test('every commitwork command the action runs is one the CLI parses and its usage documents', () => {
  const cli = readFileSync(join(CW, 'bin', 'commitwork.mjs'), 'utf8');
  const main = fnBody(cli, 'main');
  const usage = fnBody(cli, 'usage');
  const commands = new Set([...main.matchAll(/cmd === '([a-z-]+)'|case '([a-z-]+)':/g)].map((m) => m[1] || m[2]));
  const flagsOf = { setup: new Set([...fnBody(readFileSync(join(CW, 'bin', 'setup.mjs'), 'utf8'), 'parseSetupArgs').matchAll(/'(--[a-z-]+)'/g)].map((m) => m[1])) };
  const general = new Set([...fnBody(cli, 'parseArgs').matchAll(/a === '(--[a-z-]+)'/g)].map((m) => m[1]));
  const helperModes = new Set([...readFileSync(join(CW, 'bin', 'lib', 'github-action.mjs'), 'utf8').matchAll(/mode === '([a-z]+)'/g)].map((m) => m[1]));
  const calls = [];
  for (const s of STEPS.filter((x) => x.run)) {
    for (const l of s.run.split('\n')) {
      const direct = l.match(/node "\$CLI_PATH" ([a-z-]+)(.*)$/);
      const array = l.match(/^\s*args=\(([a-z-]+)(.*)\)$/);
      if (direct || array) { const [, cmd, rest] = direct || array; calls.push({ cmd, flags: [...rest.matchAll(/(--[a-z][a-z-]*)/g)].map((m) => m[1]) }); }
      const added = l.match(/args\+=\((--[a-z-]+)\)/);
      if (added) calls.find((c) => c.cmd === 'run').flags.push(added[1]);
      const helper = l.match(/node "\$HELPER_PATH" ([a-z]+)/);
      if (helper) assert.ok(helperModes.has(helper[1]), `bin/lib/github-action.mjs has no mode ${helper[1]}`);
    }
  }
  assert.deepEqual(calls.map((c) => c.cmd).sort(), ['run', 'sarif', 'setup']);
  for (const { cmd, flags } of calls) {
    assert.ok(commands.has(cmd), `commitwork dispatches no ${cmd}`);
    assert.match(usage, new RegExp(`commitwork ${cmd}\\b`), `usage() does not document ${cmd}`);
    for (const f of flags) {
      assert.ok((flagsOf[cmd] || general).has(f), `commitwork ${cmd} does not parse ${f}`);
      assert.ok(usage.includes(f), `usage() does not document ${f}`);
    }
  }
  assert.deepEqual(calls.flatMap((c) => c.flags).sort(), ['--from', '--manifest', '--no-fail-fast', '--only', '--out', '--repo', '--trust-repo-manifest', '--yes']);
});

// ── the steps, executed ──────────────────────────────────────────────────────

// The workspace is the fixture's copy when one is named, as the checkout is with the default path.
function sandbox(fixture = null) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-action-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node'));
  mkdirSync(join(dir, 'runner'));
  if (fixture) cpSync(fixture, join(dir, 'ws'), { recursive: true });
  else mkdirSync(join(dir, 'ws'));
  return { dir, bin, runner: join(dir, 'runner'), ws: join(dir, 'ws') };
}

// fact: GitHub runs a composite `shell: bash` step as `bash --noprofile --norc -eo pipefail <file>` (expiry: if GitHub changes it, prev: unknown)
function runStep(step, sb, { inputs = {}, env = {}, outputs = {} } = {}) {
  const ctx = { 'github.action_path': CW, 'github.workspace': sb.ws, 'runner.temp': sb.runner };
  for (const [k, v] of Object.entries(INPUTS)) ctx[`inputs.${k}`] = k in inputs ? inputs[k] : (v.default ?? '');
  for (const [k, v] of Object.entries(outputs)) ctx[`steps.run.outputs.${k}`] = v;
  const stepEnv = Object.fromEntries(Object.entries(step.env).map(([k, v]) => [k, v.replace(/\$\{\{ ([^}]+?) \}\}/g, (_, e) => {
    assert.ok(e in ctx, `the test does not know the expression ${e}`);
    return ctx[e];
  })]));
  const script = join(sb.dir, `${step.id || 'step'}-${Date.now()}.sh`);
  writeFileSync(script, step.run);
  const files = { GITHUB_OUTPUT: join(sb.dir, 'github-output'), GITHUB_STEP_SUMMARY: join(sb.dir, 'step-summary.md') };
  for (const f of Object.values(files)) writeFileSync(f, '');
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
    encoding: 'utf8', timeout: 300_000, cwd: sb.ws,
    env: { PATH: [sb.bin, '/usr/bin', '/bin'].join(delimiter), HOME: process.env.HOME, NO_COLOR: '1',
      CW_SCAN_CONFIG: join(sb.dir, 'no-scan-config.json'), ...files, ...stepEnv, ...env },
  });
  const out = Object.fromEntries(readFileSync(files.GITHUB_OUTPUT, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out, summary: readFileSync(files.GITHUB_STEP_SUMMARY, 'utf8') };
}

const treeHash = (dir) => {
  const h = createHash('sha256');
  const walk = (d) => { for (const e of readdirSync(d).sort()) { const p = join(d, e); const s = statSync(p); h.update(`${p.slice(dir.length)}|${s.size}\n`); if (s.isDirectory()) walk(p); else h.update(readFileSync(p)); } };
  walk(dir);
  return h.digest('hex');
};
const onPath = (tool, sb) => spawnSync('sh', ['-c', 'command -v "$1"', 'sh', tool], { env: { PATH: [sb.bin, '/usr/bin', '/bin'].join(delimiter) } }).status === 0;

test('the input check refuses a flag where a check belongs and every malformed value', posix, () => {
  const sb = sandbox();
  const step = stepNamed('Check the inputs');
  assert.equal(runStep(step, sb).status, 0, 'the defaults pass');
  assert.equal(runStep(step, sb, { inputs: { 'install-tools': 'gitleaks,semgrep' } }).status, 0);
  for (const inputs of [{ checks: '--trust-repo-manifest' }, { checks: 'fast all' }, { path: '-x' }, { 'fail-on': 'high' },
    { 'upload-sarif': 'yes' }, { 'trust-repo-manifest': '1' }, { 'fail-on-unmeasured': '' }, { 'install-tools': 'a;b' }, { 'install-tools': 'a,,b' }, { sarif: '--out' }]) {
    const r = runStep(step, sb, { inputs });
    assert.equal(r.status, 2, `${JSON.stringify(inputs)} was accepted`);
    assert.match(r.stdout, /^::error::commitwork: /m);
  }
});

test('the run step over the dirty canary with no scanner installed: a SARIF that names every lane that did not measure', posix, () => {
  const sb = sandbox(join(CW, 'fixtures', 'scan-canary', 'dirty'));
  const before = treeHash(sb.ws);
  const r = runStep(stepNamed('Run the baseline'), sb);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(treeHash(sb.ws), before, 'the scanned checkout was modified');
  assert.equal(r.out['exit-code'], '0');
  assert.equal(dirname(r.out.sarif), dirname(dirname(r.out['report-dir'])), 'the default SARIF is beside the run, under the runner temp directory');
  assert.ok(r.out.sarif.startsWith(`${sb.runner}/commitwork.`));
  const sarif = JSON.parse(readFileSync(r.out.sarif, 'utf8'));
  assert.equal(sarif.version, '2.1.0');
  const notes = sarif.runs[0].invocations[0].toolExecutionNotifications;
  const warned = new Set(notes.filter((n) => n.level === 'warning').map((n) => n.descriptor.id));
  assert.equal(r.out.unmeasured, String(warned.size));
  assert.equal(r.out.results, String(sarif.runs[0].results.length));
  // Two records of one fact: every lane the run recorded as void is named in the SARIF.
  const status = JSON.parse(readFileSync(join(r.out['report-dir'], 'checks-status.json'), 'utf8'));
  const voided = status.filter((s) => s.status === 'noscan').map((s) => s.check);
  assert.ok(voided.length > 0);
  for (const id of voided) assert.ok(warned.has(id), `${id} did not measure and the SARIF does not say so`);
  for (const [lane, tool] of [['secrets-gitleaks', 'gitleaks'], ['sast', 'semgrep'], ['actions-zizmor', 'zizmor']]) {
    if (!onPath(tool, sb)) assert.ok(notes.some((n) => n.descriptor.id === lane && n.message.text.includes(`tool:${tool}`)), `${lane} without ${tool} is not named`);
  }
  assert.equal(sarif.runs[0].invocations[0].executionSuccessful, false);
  assert.match(r.summary, /Did not measure, so neither clean nor a finding/);
  assert.match(r.stdout, /^::warning::commitwork: /m);
});

test('a repo-supplied script runs only when trust-repo-manifest is true, whatever the environment says', posix, () => {
  const sb = sandbox();
  mkdirSync(join(sb.ws, 'app', 'security'), { recursive: true });
  writeFileSync(join(sb.ws, 'app', 'security', 'authz-isolation-test.sh'), '#!/bin/sh\necho \'{"ran":"repo script"}\'\n');
  chmodSync(join(sb.ws, 'app', 'security', 'authz-isolation-test.sh'), 0o755);
  const step = stepNamed('Run the baseline');
  const held = runStep(step, sb, { inputs: { path: 'app', checks: 'authz-test' }, env: { COMMITWORK_TRUST_REPO_MANIFEST: '1' } });
  assert.equal(held.status, 0, held.stderr);
  assert.ok(!existsSync(join(held.out['report-dir'], 'authz.json')), 'the script ran without the input');
  const note = JSON.parse(readFileSync(held.out.sarif, 'utf8')).runs[0].invocations[0].toolExecutionNotifications.find((n) => n.descriptor.id === 'authz-test');
  assert.match(note.message.text, /--trust-repo-manifest/);
  const trusted = runStep(step, sb, { inputs: { path: 'app', checks: 'authz-test', 'trust-repo-manifest': 'true' } });
  assert.equal(trusted.status, 0, trusted.stderr);
  assert.match(readFileSync(join(trusted.out['report-dir'], 'authz.json'), 'utf8'), /repo script/);
});

test('the run step reports a check the baseline lacks as could-not-run, and the verdict step fails on it', posix, () => {
  const sb = sandbox();
  mkdirSync(join(sb.ws, 'app'));
  // An earlier run's log at the same path must not be judged as this run's.
  writeFileSync(join(sb.ws, 'stale.sarif'), JSON.stringify({ version: '2.1.0', runs: [{ results: [] }] }));
  const r = runStep(stepNamed('Run the baseline'), sb, { inputs: { path: 'app', checks: 'no-such-group', sarif: 'stale.sarif' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out['exit-code'], '2');
  assert.equal(r.out.failed, 'true');
  assert.equal(r.out.sarif, '', 'a SARIF path is offered for upload when none was written');
  assert.match(r.stdout, /::error::commitwork: commitwork run exited 2/);
  const verdict = stepNamed('Apply fail-on');
  assert.equal(runStep(verdict, sb, { outputs: { failed: 'true' } }).status, 1);
  assert.equal(runStep(verdict, sb, { outputs: { failed: 'false' } }).status, 0);
  assert.equal(runStep(verdict, sb, { outputs: { failed: '' } }).status, 1, 'no verdict is not a pass');
});

test('tools lists the catalogued scanners the selected lanes require, and refuses an unknown selection', () => {
  const tools = (target) => spawnSync(process.execPath, [join(CW, 'bin', 'lib', 'github-action.mjs'), 'tools', target],
    { encoding: 'utf8', env: { ...process.env, CW_REPORT_DIR: mkdtempSync(join(tmpdir(), 'cw-action-tools-')) } });
  assert.equal(tools('sast').stdout.trim(), 'semgrep');
  const fast = tools('fast');
  assert.equal(fast.status, 0, fast.stderr);
  const names = fast.stdout.trim().split(',');
  for (const t of ['gitleaks', 'semgrep', 'trufflehog', 'zizmor']) assert.ok(names.includes(t), `fast needs ${t}`);
  assert.ok(!names.includes('node'), 'node is not in the install catalogue');
  assert.match(fast.stderr, /not in the install catalogue.*\bnode\b/);
  assert.equal(tools('no-such-group').status, 2);
});

// ── the verdict, from a SARIF ────────────────────────────────────────────────

const doc = (levels, notes = []) => ({ version: '2.1.0', runs: [{
  results: levels.map((level, i) => ({ ruleId: `r${i}`, level, message: { text: 'x' } })),
  invocations: [{ toolExecutionNotifications: notes.map(([id, level, text]) => ({ descriptor: { id }, level, message: { text } })) }],
  properties: { commitwork: { undetermined: [{ ruleId: 'u' }] } },
}] });
const summaryOf = (d) => {
  const p = join(mkdtempSync(join(tmpdir(), 'cw-action-sarif-')), 'x.sarif');
  writeFileSync(p, JSON.stringify(d));
  return readSarifSummary(p);
};

test('fail-on fails the step at its level and above, never below', () => {
  const s = summaryOf(doc(['error', 'warning', 'note']));
  const failed = (failOn) => decide({ runExit: 0, exportExit: 0, sarif: s, failOn, failOnUnmeasured: false }).failed;
  assert.deepEqual(FAIL_ON.map(failed), [true, true, true, false]);
  const onlyNotes = summaryOf(doc(['note', 'note']));
  assert.deepEqual(FAIL_ON.map((f) => decide({ runExit: 0, exportExit: 0, sarif: onlyNotes, failOn: f, failOnUnmeasured: false }).failed), [false, false, true, false]);
  assert.equal(s.undetermined, 1);
});

test('an unmeasured lane is a warning, or a failure when asked; never a pass and never a result', () => {
  const s = summaryOf(doc([], [['sast', 'warning', 'sast: did not measure — tool:semgrep (not on PATH)'], ['deps-osv', 'note', 'deps-osv: ran with reduced coverage']]));
  assert.equal(s.results, 0);
  assert.equal(s.unmeasured.length, 1);
  assert.equal(s.reduced.length, 1);
  const soft = decide({ runExit: 0, exportExit: 0, sarif: s, failOn: 'error', failOnUnmeasured: false });
  assert.deepEqual([soft.failed, soft.warnings], [false, ['sast: did not measure — tool:semgrep (not on PATH)']]);
  const hard = decide({ runExit: 0, exportExit: 0, sarif: s, failOn: 'none', failOnUnmeasured: true });
  assert.deepEqual([hard.failed, hard.reasons], [true, ['1 lane(s) did not measure']]);
});

test('a lane that failed, a run that could not run, a failed export and a missing or unreadable SARIF all fail the step', () => {
  const clean = summaryOf(doc([]));
  const v = (o) => decide({ runExit: 0, exportExit: 0, sarif: clean, failOn: 'none', failOnUnmeasured: false, ...o });
  assert.equal(v({}).failed, false);
  for (const o of [{ runExit: 1 }, { runExit: 2 }, { runExit: 134 }, { exportExit: 2 }]) assert.equal(v(o).failed, true, JSON.stringify(o));
  const dir = mkdtempSync(join(tmpdir(), 'cw-action-sarif-'));
  assert.equal(readSarifSummary(join(dir, 'absent.sarif')).state, 'absent');
  writeFileSync(join(dir, 'torn.sarif'), '{"runs": [');
  assert.equal(readSarifSummary(join(dir, 'torn.sarif')).state, 'unreadable');
  assert.equal(v({ sarif: readSarifSummary(join(dir, 'torn.sarif')) }).failed, true);
});

test('report writes one-line outputs, and scanner text cannot open a second workflow command', () => {
  assert.equal(annotation('warning', 'a%b\r\n::error::x'), '::warning::a%25b%0D%0A::error::x');
  const dir = mkdtempSync(join(tmpdir(), 'cw-action-report-'));
  const p = join(dir, 'x.sarif');
  writeFileSync(p, JSON.stringify(doc(['error'], [['lane', 'warning', 'line one\n::add-mask::secret']])));
  const env = { GITHUB_OUTPUT: join(dir, 'out'), GITHUB_STEP_SUMMARY: join(dir, 'summary') };
  const logged = [];
  report({ sarifPath: p, runExit: 0, exportExit: 0, failOn: 'error', failOnUnmeasured: false, env, log: (l) => logged.push(l) });
  assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), `sarif=${p}\nresults=1\nunmeasured=1\nfailed=true\n`);
  assert.ok(logged.every((l) => !l.includes('\n')), 'an annotation spans two lines');
  assert.ok(!readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8').includes('\n::add-mask::'));
});
