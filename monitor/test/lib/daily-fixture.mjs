// A synthetic area for the /daily tests: one git repository with two commits, two complete sweep
// batches over it, their rollups, a registry declaring the area and a daily config. Nothing here
// names a real repository.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: GIT_ENV }).trim();
const write = (path, text) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };
const json = (path, value) => write(path, JSON.stringify(value, null, 2));

export const AREA = 'demo-area';
export const REPO = 'demo-repo';

/** Builds the fixture under a fresh temp dir; `rows(head)` gives each batch's scanner rows. */
export function dailyFixture({ previousRows, currentRows, previousStatus = 'pass', currentStatus = 'pass', toolVersions = ['1.0', '1.0'], secondBatch = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cw-daily-'));
  const repo = join(root, REPO);
  mkdirSync(repo);
  git(repo, 'init', '-q');
  write(join(repo, 'src', 'app.js'), Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'));
  write(join(repo, 'src', 'old.js'), 'a\nb\nc\n');
  write(join(repo, 'test', 'fixtures', 'bad.js'), 'eval(x)\n');
  write(join(repo, 'conf', 'keys.env'), 'TOKEN=not-a-real-secret-value\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'seed');
  const first = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'mv', 'src/old.js', 'src/renamed.js');
  write(join(repo, 'src', 'app.js'), Array.from({ length: 20 }, (_, i) => (i === 9 ? 'exec(userInput)' : `line ${i + 1}`)).join('\n'));
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'feat: run the input');
  const second = git(repo, 'rev-parse', 'HEAD');

  const reports = join(root, 'reports');
  const areaOut = join(reports, AREA);
  const batch = (stamp, sha, rows, status, toolVersion) => {
    const dir = join(reports, `sweep-${stamp}-${AREA}`);
    json(join(dir, 'batch-manifest.json'), { only: null, group: 'all', area: AREA, scope: { repos: [{ name: REPO, manifests: ['m'] }] }, anchors: { [REPO]: { path: repo, sha, dirty: false } } });
    json(join(dir, 'batch-verdict.json'), { rollup: 'published', repos: { resolved: 1, present: 1, scanned: 1, scans: [{ name: REPO, ran: true, code: 1 }] } });
    json(join(dir, REPO, 'checks-status.json'), [{ check: 'sast', status }, { check: 'secrets-gitleaks', status: 'pass' }, { check: 'sbom-syft', status: 'fail' }, { check: 'lint-go-golangci', status: 'skip' }, { check: 'sast-joern', status: 'noscan', coverageReason: 'the tool exited 2' }]);
    json(join(dir, REPO, 'tool-version-sast.json'), { tools: { semgrep: { version: toolVersion } } });
    json(join(areaOut, `rollup-sweep-${stamp}.json`), { sliceId: `sweep-${stamp}`, scannerFindings: rows, findings: [] });
  };
  if (secondBatch) batch('20261001000000', first, previousRows, previousStatus, toolVersions[0]);
  batch('20261002000000', second, currentRows, currentStatus, toolVersions[1]);

  const registry = join(root, 'projects.json');
  json(registry, {
    reportsRoot: reports,
    areas: [{ slug: AREA, label: 'demo', out: AREA, members: [REPO], primary: true }],
    projects: [{ name: REPO, path: repo, manifest: 'security-baseline', area: AREA }],
  });
  const config = { repos: { [REPO]: { dataPaths: ['test/fixtures/'], testCommands: ['node --test'] } }, maxItemsPerRepo: 40, contextLines: 2, maxDigestBytes: 300000, fileTodos: { p2PerDay: 1, p3: false }, retentionDays: { digest: 14, report: 90 } };
  const configPath = join(root, 'daily.json');
  json(configPath, { areas: { [AREA]: config } });
  return { root, repo, reports, areaOut, registry, configPath, config, first, second };
}

export const rows = {
  exec: { repo: REPO, rule: 'js.exec', file: 'src/app.js', line: 10, sev: 'high', message: 'exec of untrusted input', cwe: 'CWE-78' },
  execAgain: { repo: REPO, rule: 'js.exec', file: 'src/app.js', line: 14, sev: 'high', message: 'exec of untrusted input', cwe: 'CWE-78' },
  old: { repo: REPO, rule: 'js.weak', file: 'src/old.js', line: 2, sev: 'med', message: 'weak thing' },
  renamed: { repo: REPO, rule: 'js.weak', file: 'src/renamed.js', line: 2, sev: 'med', message: 'weak thing' },
  gone: { repo: REPO, rule: 'js.gone', file: 'src/app.js', line: 3, sev: 'low', message: 'fixed since' },
  fixture: { repo: REPO, rule: 'js.eval', file: 'test/fixtures/bad.js', line: 1, sev: 'high', message: 'eval' },
  secret: { repo: REPO, rule: 'generic-api-key', file: 'conf/keys.env', line: 1, sev: '', redacted: true },
};
