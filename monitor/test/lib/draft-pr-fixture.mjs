// Fixture for the remediation-draft-pr suites: a git host of bare repositories on disk
// (CW_GIT_HOST_URL), a fake gh (CW_GH_BIN, a .mjs) that logs every call and answers from STUB_*
// variables, an issue store holding one depsGo issue, and Go seams that edit go.mod instead of
// running the toolchain. No network, no real gh, no real push.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { emptyIssuesDoc, mintIssue, saveIssues, withIssuesLock } from '../../issue-store.mjs';

export const AT = '2026-10-22T03:00:00.000Z';
export const FLEET_REPO = 'fleet-widgets';
export const adv = (slug, over = {}) => ({
  id: 'GO-2026-0001', package: 'example.test/dep', ecosystem: 'Go', currentVersion: 'v1.0.0', fixed: 'v1.2.0',
  reachable: true, bump: null, upstream: { repo: slug, defaultBranch: '' }, repo: FLEET_REPO, ...over,
});

const GH = [
  "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  'const a = process.argv.slice(2), e = process.env;',
  "appendFileSync(e.STUB_LOG, JSON.stringify(a) + '\\n');",
  "const cmd = a.slice(0, 2).join(' '), opt = (k) => { const i = a.indexOf(k); return i < 0 ? null : a[i + 1]; };",
  "const fail = (m) => { console.error(m); process.exit(1); };",
  "if (cmd === 'api user') console.log(e.STUB_LOGIN);",
  "else if (a[0] === 'api' && a[1].startsWith('repos/')) {",
  "  const m = join(e.STUB_DIR, 'forked-' + a[1].split('/').pop());",
  "  if (existsSync(m)) console.log(readFileSync(m, 'utf8')); else fail('HTTP 404: Not Found'); }",
  "else if (cmd === 'repo fork') writeFileSync(join(e.STUB_DIR, 'forked-' + a[2].split('/')[1]), a[2]);",
  "else if (cmd === 'repo view' && a.includes('viewerPermission')) { if (e.STUB_PERM) console.log(e.STUB_PERM); else fail('HTTP 403'); }",
  "else if (cmd === 'label list') { if (e.STUB_LABELS_FAIL) fail('HTTP 500'); console.log(e.STUB_LABELS || '[]'); }",
  "else if (cmd === 'pr list' && opt('--search')) { if (e.STUB_SEARCH_FAIL) fail('HTTP 502'); console.log(e.STUB_PR_SEARCH || '[]'); }",
  "else if (cmd === 'issue list') console.log(e.STUB_ISSUE_SEARCH || '[]');",
  "else if (cmd === 'pr list') console.log('[]');",
  "else if (cmd === 'pr create') { if (e.STUB_CREATE_FAIL) fail('HTTP 422: Validation Failed'); console.log('https://github.test/' + (opt('--repo') || 'own') + '/pull/7'); }",
  "else if (cmd === 'pr view') console.log(e.STUB_PR_VIEW || '{}');",
  "else if (cmd === 'auth git-credential') {}",
  "else fail('stub gh: ' + cmd);",
].join('\n') + '\n';

export function makeFixture() {
  const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'cw-draft-pr-')));
  const HOST = join(TMP, 'host'), STUB = join(TMP, 'stub'), LOG = join(TMP, 'gh.log');
  mkdirSync(STUB, { recursive: true });
  writeFileSync(join(TMP, 'gh.mjs'), GH);
  const gitconfig = join(TMP, 'gitconfig');
  writeFileSync(gitconfig, '[user]\n\tname = Test Operator\n\temail = operator@example.test\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n');
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (/^(GIT_|GH_|CW_GH_BIN|CW_NOW)/.test(k)) delete base[k];
  Object.assign(base, { GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' });
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: base });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  let n = 0;
  return {
    TMP, HOST, git,
    env: (over = {}) => ({ ...base, CW_GH_BIN: join(TMP, 'gh.mjs'), CW_GIT_HOST_URL: HOST, CW_NOW: AT, STUB_LOG: LOG, STUB_DIR: STUB, STUB_LOGIN: 'tester', ...over }),
    calls: () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    resetCalls: () => writeFileSync(LOG, ''),
    /** a bare repository at HOST/<slug>.git holding go.mod plus `files` on main */
    repo(slug, files = {}) {
      const bare = join(HOST, `${slug}.git`), work = join(TMP, `work-${++n}`);
      mkdirSync(bare, { recursive: true }); mkdirSync(work);
      git(bare, 'init', '--bare', '-q', '-b', 'main');
      git(work, 'init', '-q', '-b', 'main');
      for (const [p, text] of Object.entries({ 'go.mod': 'module example.test/widgets\n\nrequire example.test/dep v1.0.0\n', ...files })) {
        mkdirSync(dirname(join(work, p)), { recursive: true }); writeFileSync(join(work, p), text);
      }
      git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'init'); git(work, 'push', '-q', bare, 'main');
      return bare;
    },
    emptyBare(slug) { const bare = join(HOST, `${slug}.git`); mkdirSync(bare, { recursive: true }); git(bare, 'init', '--bare', '-q', '-b', 'main'); return bare; },
    ref: (bare, ref) => { const r = spawnSync('git', ['-C', bare, 'rev-parse', '--verify', '-q', ref], { encoding: 'utf8', env: base }); return r.status === 0 ? r.stdout.trim() : null; },
    message: (bare, ref) => git(bare, 'log', '-1', '--format=%B', ref),
    /** an issue store holding one depsGo issue for adv(); returns { path, issueId } */
    store(events = []) {
      const path = join(TMP, `issues-${++n}.json`);
      const doc = Object.assign(emptyIssuesDoc(), { organisation: 'TEST' });
      const { id } = mintIssue(doc, {
        area: 'fleet', repo: FLEET_REPO, kind: 'vuln', severity: 'high', title: 'example.test/dep GO-2026-0001', class: 'S',
        source: { kind: 'scanner-row', key: `sc:${FLEET_REPO}|depsGo|id=GO-2026-0001|package=example.test/dep`, tool: 'depsGo', rule: null },
      }, AT);
      for (const ev of events) ev(doc, id);
      withIssuesLock(() => saveIssues(doc, { path }), { path });
      return { path, issueId: id };
    },
  };
}

/** Go seams: the bump edits go.mod; every result is the one asked for. */
export function goStub({ fixed = false, applyOk = true, verifyOk = true, buildOk = true } = {}) {
  return {
    probe: () => ({ fixed, reason: fixed === false ? 'still-reachable-upstream' : 'analysed-advisory-absent', trace: ['example.test/widgets/cmd.main', 'example.test/dep.Parse'] }),
    apply: (a, dir) => {
      if (!applyOk) return { ok: false, steps: [], reason: 'go get example.test/dep@v1.2.0 exited 1' };
      writeFileSync(join(dir, 'go.mod'), 'module example.test/widgets\n\nrequire example.test/dep v1.2.0\n');
      return { ok: true, versions: [{ module: 'example.test/dep', before: 'v1.0.0', after: 'v1.2.0' }],
        steps: [{ cmd: 'go get example.test/dep@v1.2.0', status: 0, result: 'applied' }, { cmd: 'go mod tidy', status: 0, result: 'applied' }] };
    },
    verify: (a) => {
      const build = { cmd: 'go build ./...', status: buildOk ? 0 : 1, result: buildOk ? 'passed' : 'undefined: dep.Parse' };
      if (!buildOk) return { ok: false, steps: [build], reason: 'build-failed' };
      const scan = { cmd: 'govulncheck -format json ./...', status: 0, result: verifyOk ? `${a.id} no longer reported (analysis complete)` : `${a.id} not cleared (still-reachable-upstream)` };
      return verifyOk ? { ok: true, steps: [build, scan] } : { ok: false, steps: [build, scan], reason: 'advisory-check-failed:still-reachable-upstream' };
    },
  };
}
