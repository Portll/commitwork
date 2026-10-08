// Three MCP defects from the 2026-10-07 agent and MCP security review, each driven through the
// server over stdio (and repoForRun directly for the path rules).
//   D7  run_checks accepted `/`, `~/.ssh` and relative paths: existsSync was the only check.
//   D11 issue_close let an agent close as `accepted` and recorded no closer.
//   D12 manifests that cannot run were advertised, and a group-less one let `group` reach the runner as a flag.
// Every call that would get past the target check names a path that is refused, so no scanner runs here.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(REPO, 'mcp', 'server.mjs');
const T = realpathSync(mkdtempSync(join(tmpdir(), 'cw-mcp-review-')));
const HOME = join(T, 'home');
const GITREPO = join(T, 'work', 'repo');

before(() => {
  for (const d of ['.ssh', '.gnupg', '.aws', '.config/gh']) mkdirSync(join(HOME, d), { recursive: true });
  mkdirSync(GITREPO, { recursive: true });
  execFileSync('git', ['init', '-q', GITREPO]);
  execFileSync('git', ['init', '-q', join(HOME, '.config', 'gh')]);
  execFileSync('git', ['init', '-q', HOME]);
  symlinkSync(join(HOME, '.ssh'), join(T, 'innocent-link'));
});
after(() => rmSync(T, { recursive: true, force: true }));

function call(name, args, env = {}) {
  const out = execFileSync(process.execPath, [SERVER], {
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024, env: { ...process.env, HOME, ...env },
  });
  for (const line of out.split('\n').filter(Boolean)) {
    const m = JSON.parse(line);
    if (m.id === 1) return { isError: !!m.result?.isError, text: m.result?.content?.[0]?.text ?? '' };
  }
  throw new Error(`no response frame: ${out.slice(0, 300)}`);
}
const toolsList = () => JSON.parse(execFileSync(process.execPath, [SERVER], {
  input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
}).split('\n').filter(Boolean)[0]).result.tools;

describe('D7: run_checks targets an absolute git work tree, resolved, outside the credential dirs', () => {
  test('/, the home dir, credential dirs, a symlink into one, a relative path and a non-repo are refused', () => {
    const cases = [
      ['/', /filesystem root|not the top of a git work tree/],
      [HOME, /home directory itself/],
      [join(HOME, '.ssh'), /under ~\/\.ssh/],
      [join(HOME, '.gnupg'), /under ~\/\.gnupg/],
      [join(HOME, '.aws'), /under ~\/\.aws/],
      [join(HOME, '.config', 'gh'), /under ~\/\.config/],
      [join(T, 'innocent-link'), /under ~\/\.ssh/],
      ['.', /absolute path/],
      ['work/repo', /absolute path/],
      [join(T, 'work'), /not the top of a git work tree/],
    ];
    for (const [repo, why] of cases) {
      const r = call('run_checks', { repo, manifest: 'quality-gates', group: 'boot-pass' });
      assert.equal(r.isError, true, `${repo} was accepted: ${r.text.slice(0, 200)}`);
      assert.match(r.text, why, repo);
    }
  });

  test('NOT VACUOUS: a git work tree passes, and the runner is handed its realpath', () => {
    // a fake `node` on PATH stands in for the runner and records its argv; nothing is scanned
    const fake = join(T, 'fakebin');
    mkdirSync(fake, { recursive: true });
    writeFileSync(join(fake, 'node'), `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(join(T, 'runner-argv.txt'))}\n`);
    chmodSync(join(fake, 'node'), 0o755);
    symlinkSync(GITREPO, join(T, 'repo-link'));
    const r = call('run_checks', { repo: join(T, 'repo-link'), manifest: 'quality-gates', group: 'boot-pass' }, { PATH: `${fake}:${process.env.PATH}`, CW_REPORT_DIR: join(T, 'reports') });
    assert.equal(r.isError, false, r.text);
    const argv = readFileSync(join(T, 'runner-argv.txt'), 'utf8').split('\n');
    assert.equal(argv[argv.indexOf('--repo') + 1], GITREPO, 'the runner got the link, not what it resolves to');
    assert.equal(JSON.parse(r.text).gate, 'ERROR', 'the fake runner wrote no checks-status.json, so nothing passed');
  });
});

describe('D12: only runnable manifests, only declared groups', () => {
  test('the advertised manifests are exactly the ones that validate and declare a group', () => {
    const t = toolsList().find((x) => x.name === 'run_checks');
    const listed = t.inputSchema.properties.manifest.description.split('One of: ')[1].split(', ');
    assert.deepEqual(listed.sort(), ['build-health', 'hermetic-tests', 'quality-gates', 'runtime', 'security-baseline']);
  });

  test('a data file is refused as a manifest even with a flag-shaped group, before the repo is touched', () => {
    for (const manifest of ['tool-pins', 'llm-hosts', 'install-catalog']) {
      const r = call('run_checks', { repo: GITREPO, manifest, group: '--act' });
      assert.equal(r.isError, true, `${manifest} reached the runner: ${r.text.slice(0, 200)}`);
      assert.match(r.text, /bundled/);
    }
  });

  test('a group the manifest does not declare is refused, a leading dash included', () => {
    for (const group of ['--act', '-x', 'nope']) {
      const r = call('run_checks', { repo: GITREPO, manifest: 'quality-gates', group });
      assert.equal(r.isError, true, `group ${group} was accepted`);
      assert.match(r.text, /is not defined in manifest 'quality-gates'/);
    }
  });
});

describe('D11: issue_close over MCP', () => {
  const store = join(T, 'issues.json');
  let id;
  before(() => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { emptyIssuesDoc, mintIssue, saveIssues, withIssuesLock } from ${JSON.stringify(pathToFileURL(join(REPO, 'monitor', 'issue-store.mjs')).href)};
      const doc = emptyIssuesDoc();
      const { id } = mintIssue(doc, { area: 'mcparea', title: 'fixture', severity: 'med', repo: null, kind: 'task', body: 'b', remediation: 'r', class: 'F',
        source: { kind: 'manual', key: null, tool: null, rule: null } }, '2026-08-01T00:00:00.000Z');
      withIssuesLock(() => saveIssues(doc, { path: ${JSON.stringify(store)} }), { path: ${JSON.stringify(store)} });
      process.stdout.write(id);`], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    id = r.stdout.trim();
  });

  test('`accepted` is neither offered nor taken: accepting a risk is a human act', () => {
    const t = toolsList().find((x) => x.name === 'issue_close');
    assert.equal(t.inputSchema.properties.as.enum.includes('accepted'), false);
    const r = call('issue_close', { id, as: 'accepted', evidence: 'looks fine to me' }, { CW_ISSUES: store });
    assert.equal(r.isError, true);
    const doc = JSON.parse(readFileSync(store, 'utf8'));
    assert.equal(doc.issues[id].state, 'open', 'the issue was closed anyway');
  });

  test('a close over MCP is recorded as a machine close on the mcp channel', () => {
    const r = call('issue_close', { id, as: 'refuted', evidence: 'the rule matched a comment', sessionId: 'sess-1' }, { CW_ISSUES: store });
    assert.equal(r.isError, false, r.text);
    const doc = JSON.parse(readFileSync(store, 'utf8'));
    assert.equal(doc.issues[id].closedAs, 'refuted');
    const ev = doc.events.filter((e) => e.type === 'issue-closed' && e.issueId === id).at(-1);
    assert.deepEqual(ev.data.by, { whoKind: 'machine', channel: 'mcp', tool: 'issue_close', sessionId: 'sess-1' });
  });
});
