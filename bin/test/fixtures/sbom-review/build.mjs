// Synthetic group for bin/sbom-review.mjs: three git repos plus a reports batch holding their SBOMs.
// Every package, version and advisory here is sample data, chosen so each section of the review has
// something to show. The test builds it in a temp dir; `node build.mjs <outDir>` renders the sample.
//
//   storefront   npm + workflows; a git-ignored tool binary; an installed tree; osv result present
//   billing-api  Go + npm; SBOM older than a go.mod change; a tracked lockfile the SBOM never read
//   docs-site    no SBOM at all

import { mkdirSync, writeFileSync, utimesSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isMainModule } from '../../../../lib/is-main.mjs';

const put = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
const git = (repo, args, date) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore',
  env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
const commit = (repo, msg, date) => { git(repo, ['add', '-A'], date); git(repo, ['commit', '-q', '-m', msg], date); };
const init = (repo) => { mkdirSync(repo, { recursive: true }); git(repo, ['init', '-q', '-b', 'main'], '2026-09-01T00:00:00Z'); };

const syftProps = (foundBy, loc) => [
  { name: 'syft:package:foundBy', value: foundBy },
  { name: 'syft:location:0:path', value: `/${loc}` },
];
const npm = (name, version, loc, licence) => ({ type: 'library', name, version, purl: `pkg:npm/${name.replaceAll('@', '%40')}@${version}`,
  ...(licence ? { licenses: [{ license: { id: licence } }] } : {}), properties: syftProps('javascript-lock-cataloger', loc) });
const gomod = (name, version, loc, foundBy = 'go-module-file-cataloger', licence) => ({ type: 'library', name, version, purl: `pkg:golang/${name}@${version}`,
  ...(licence ? { licenses: [{ license: { id: licence } }] } : {}), properties: syftProps(foundBy, loc) });
const action = (name, version, loc) => ({ type: 'library', name, version, purl: `pkg:github/${name}@${version}`, properties: syftProps('github-actions-usage-cataloger', loc) });
const cdx = (timestamp, components, dependencies = []) => JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', serialNumber: 'urn:uuid:00000000-0000-4000-8000-000000000000',
  metadata: { timestamp, tools: { components: [{ type: 'application', name: 'syft', version: '1.49.0' }] }, component: { type: 'file', name: '.' } }, components, dependencies }, null, 2);

const osvPkg = (ecosystem, name, version, advisories) => ({
  package: { name, version, ecosystem },
  vulnerabilities: advisories.map((a) => ({ id: a.id, summary: a.summary, aliases: a.aliases,
    affected: [{ package: { name, ecosystem }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, ...(a.fixed ? [{ fixed: a.fixed }] : [])] }] }] })),
  groups: advisories.map((a) => ({ ids: [a.id], aliases: [a.id, ...a.aliases], max_severity: a.score })),
});

export const FIXED_NOW = '2026-10-21T00:00:00.000Z';

export function buildFixture(root) {
  const repos = join(root, 'repos'); const reports = join(root, 'reports'); const batch = join(reports, 'sweep-20261015000000');

  const sf = join(repos, 'storefront'); init(sf);
  put(join(sf, '.gitignore'), '.tools/\nnode_modules/\n');
  put(join(sf, 'package-lock.json'), '{"lockfileVersion":3}\n');
  put(join(sf, '.github/workflows/ci.yml'), 'on: push\njobs:\n  ci:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a\n');
  put(join(sf, '.tools/protoc-gen-api.exe'), 'MZ');
  put(join(sf, 'node_modules/react/package.json'), JSON.stringify({ name: 'react', version: '18.2.0', license: 'MIT' }));
  put(join(sf, 'node_modules/mystery-lib/package.json'), JSON.stringify({ name: 'mystery-lib', version: '1.0.0' }));
  put(join(sf, 'node_modules/fast-glob/.github/workflows/ci.yml'), 'on: push\n');
  commit(sf, 'storefront', '2026-10-01T00:00:00Z');
  put(join(batch, 'storefront/sbom-syft.json'), cdx('2026-10-15T00:00:00Z', [
    npm('express', '4.17.1', 'package-lock.json', 'MIT'),
    npm('lodash', '4.17.20', 'package-lock.json', 'MIT'),
    npm('lodash', '4.17.21', 'package-lock.json', 'MIT'),
    npm('react', '18.2.0', 'package-lock.json'),
    npm('left-pad', '1.3.0', 'package-lock.json', 'WTFPL'),
    npm('chart-kit', '2.0.0', 'package-lock.json', 'GPL-3.0-only'),
    npm('dompurify', '3.1.0', 'package-lock.json', '(MPL-2.0 OR Apache-2.0)'),
    npm('font-loader', '1.2.0', 'package-lock.json', 'LGPL-2.1-or-later'),
    npm('mystery-lib', '1.0.0', 'package-lock.json'),
    npm('next', '15.0.0-rc.1', 'package-lock.json', 'MIT'),
    action('actions/checkout', 'v4', '.github/workflows/ci.yml'),
    action('actions/setup-node', '1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a', '.github/workflows/ci.yml'),
    action('actions/checkout', 'v2', 'node_modules/fast-glob/.github/workflows/ci.yml'),
    gomod('golang.org/x/net', 'v0.17.0', '.tools/protoc-gen-api.exe', 'go-module-binary-cataloger'),
    gomod('google.golang.org/protobuf', 'v1.33.0', '.tools/protoc-gen-api.exe', 'go-module-binary-cataloger'),
    { type: 'application', name: 'protoc-gen-api', version: 'UNKNOWN', properties: syftProps('pe-binary-package-cataloger', '.tools/protoc-gen-api.exe') },
  ]));
  put(join(batch, 'storefront/sbom-syft-provenance.json'), JSON.stringify({ ran: true, enriched: 0 }));
  const osvPath = join(batch, 'storefront/osv.json');
  put(osvPath, JSON.stringify({ results: [{ source: { path: 'sbom.cdx.json', type: 'lockfile' }, packages: [
    osvPkg('npm', 'lodash', '4.17.20', [{ id: 'GHSA-35jh-r3h4-6jhm', aliases: ['CVE-2021-23337'], score: '7.2', fixed: '4.17.21', summary: 'Command injection in lodash template' }]),
    osvPkg('npm', 'express', '4.17.1', [
      { id: 'GHSA-rv95-896h-c2vc', aliases: ['CVE-2024-29041'], score: '6.1', fixed: '4.19.2', summary: 'Open redirect in malformed URLs' },
      { id: 'GHSA-qw6h-vgh9-j6wx', aliases: ['CVE-2024-43796'], score: '5.0', fixed: '4.20.0', summary: 'XSS via response.redirect()' }]),
    osvPkg('Go', 'golang.org/x/net', 'v0.17.0', [{ id: 'GO-2024-2687', aliases: ['CVE-2023-45288'], score: '', fixed: '0.23.0', summary: 'HTTP/2 CONTINUATION flood' }]),
  ] }] }, null, 2));
  utimesSync(osvPath, new Date('2026-10-15T00:05:00Z'), new Date('2026-10-15T00:05:00Z'));

  const ba = join(repos, 'billing-api'); init(ba);
  put(join(ba, 'go.mod'), 'module example.invalid/billing\n');
  put(join(ba, 'web/package-lock.json'), '{"lockfileVersion":3}\n');
  put(join(ba, 'scripts/requirements.txt'), 'requests==2.31.0\n');
  // SHA-pinned, but syft reports it by the trailing comment's version
  put(join(ba, '.github/workflows/release.yml'), 'on: push\njobs:\n  release:\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0\n');
  commit(ba, 'billing-api', '2026-09-01T00:00:00Z');
  put(join(ba, 'go.mod'), 'module example.invalid/billing\n\ngo 1.23\n');
  commit(ba, 'bump go.mod', '2026-09-20T00:00:00Z');
  put(join(batch, 'billing-api/sbom-syft.json'), cdx('2026-09-10T00:00:00Z', [
    gomod('github.com/gin-gonic/gin', 'v1.9.0', 'go.mod', undefined, 'MIT'),
    gomod('github.com/lib/pq', 'v1.10.9', 'go.mod', undefined, 'MIT'),
    gomod('golang.org/x/crypto', 'v0.0.0-20220314234659-1baeb1ce4c0b', 'go.mod', undefined, 'BSD-3-Clause'),
    npm('lodash', '4.17.21', 'web/package-lock.json', 'MIT'),
    npm('react', '18.3.1', 'web/package-lock.json', 'MIT'),
    action('actions/checkout', 'v4.4.0', '.github/workflows/release.yml'),
  ], [{ ref: 'pkg:golang/github.com/gin-gonic/gin@v1.9.0', dependsOn: ['pkg:golang/golang.org/x/crypto@v0.0.0-20220314234659-1baeb1ce4c0b'] }]));

  const ds = join(repos, 'docs-site'); init(ds);
  put(join(ds, 'README.md'), '# docs\n');
  commit(ds, 'docs-site', '2026-09-01T00:00:00Z');

  return { reports, repos: [sf, ba, ds] };
}

// `node build.mjs <outDir>` — render the sample review, with the temp path replaced by <fixture>.
if (isMainModule(import.meta.url)) {
  const out = resolve(process.argv[2] || 'sbom-review-sample');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const tmp = mkdtempSync(join(tmpdir(), 'sbom-review-'));
  try {
    const fx = buildFixture(tmp);
    process.env.CW_NOW = FIXED_NOW;
    const { main } = await import('../../../sbom-review.mjs');
    await main(['--group', 'sample', '--label', 'Sample group (synthetic data)', '--reports', fx.reports, '--out', out, ...fx.repos.flatMap((r) => ['--repo', r])]);
    const fwd = tmp.replaceAll('\\', '/');
    for (const d of readdirSync(out, { withFileTypes: true })) {
      if (!d.isFile()) continue;
      const p = join(out, d.name);
      let s = readFileSync(p, 'utf8');
      for (const v of [JSON.stringify(tmp).slice(1, -1), tmp, fwd]) s = s.split(v).join('<fixture>');
      writeFileSync(p, s);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
