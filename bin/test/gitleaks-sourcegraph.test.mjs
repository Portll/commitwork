// Both shipped gitleaks configs exempt a git object id in a repository URL path from
// sourcegraph-access-token, and still catch the token. The default rule matches any 40-hex string
// once "sourcegraph" appears in the fragment, and a history scan reads a whole patch as one
// fragment: on 2026-10-04 a govulncheck fixture's go.googlesource.com commit ids scored three rows.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const has = spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).status === 0;
const TMP = mkdtempSync(join(tmpdir(), 'cw-gl-sg-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

// Fixed values, built at run time so this source carries no token-shaped literal for a secret
// scan of the repository to report.
const hex40 = (from) => Array.from({ length: 40 }, (_, i) => '0123456789abcdef'[(from + i) % 16]).join('');
const TOKEN = `sgp_${hex40(0)}`;
const LEGACY = hex40(5);
const OBJECT = hex40(9);
const LINES = [
  'sourcegraph access, credited once as in a vulnerability report',
  `token = "${TOKEN}"`,
  `legacy sourcegraph = "${LEGACY}"`,
  `"url": "https://go.googlesource.com/go/+/${OBJECT}"`,
  `see https://github.com/org/repo/commit/${OBJECT}`,
];

function scan(config) {
  const repo = join(TMP, `repo-${config.replaceAll('/', '-')}`);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'report.txt'), `${LINES.join('\n')}\n`);
  const g = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.email=f@example.com', '-c', 'user.name=f', '-c', 'commit.gpgsign=false', ...a]);
  g('add', '-A');
  g('commit', '-q', '-m', 'report');
  const report = join(TMP, `${config.replaceAll('/', '-')}.json`);
  const r = spawnSync('gitleaks', ['git', repo, '--config', join(CW, config), '--no-banner', '--report-format', 'json', '--report-path', report, '--exit-code', '0'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${config}: gitleaks did not run:\n${r.stderr}`);
  return JSON.parse(readFileSync(report, 'utf8')).filter((f) => f.RuleID === 'sourcegraph-access-token').map((f) => f.StartLine).sort();
}

for (const config of ['.gitleaks.toml', 'manifests/gitleaks.toml']) {
  test(`${config}: the token and bare hex beside the keyword still match; a commit id in a URL path does not`, (t) => {
    if (!has) return t.skip('SKIPPED (not a silent pass): gitleaks is not installed on this machine');
    assert.deepEqual(scan(config), [2, 3]);
  });
}
