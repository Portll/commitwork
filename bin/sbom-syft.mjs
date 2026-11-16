#!/usr/bin/env node
// sbom-syft.mjs — run syft over a checkout as the REPOSITORY, not the disk it sits on.
//
// syft scans the directory, so git-ignored local tooling lands in the SBOM as if the product shipped
// it — measured 2026-10-21 on one scanned repository: 552 of 897 components came from two ignored CLI binaries under
// .tools/. A repo's .syft.yaml cannot fix that, because the --exclude flags this check passes
// override the config's list rather than adding to it. So every path git ignores is excluded here,
// and what was excluded is written to sbom-syft-scope.json: left out is stated, never silent.
//
// Usage (cwd = the repo): node bin/sbom-syft.mjs <reportDir>
// Writes sbom-syft.json (CycloneDX), sbom-syft-native.json and sbom-syft-scope.json, then runs
// bin/sbom-enrich.mjs over the pair. Exit code is syft's (127 when syft cannot be run); the check's
// command records it as sbom-syft.json.exit, so a runner that crashes is recorded as well.

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collapseRemote } from '../monitor/sbom-remote.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { scannedGitOut } from './lib/git-env.mjs';
import { SCAN_EXCLUDE_ROOTS } from '../monitor/worktree-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// commitwork's own output dirs, and every nested-checkout root (agent worktrees, checkouts under .git)
export const BASE_EXCLUDES = ['./reference/**', './reports/**', ...SCAN_EXCLUDE_ROOTS.map((r) => `./${r}/**`)];

/** syft exclude globs for everything git ignores under `repo` -> { git, excludes, ignored }. */
export function ignoredExcludes(repo) {
  let out;
  try {
    out = scannedGitOut(repo, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], { maxBuffer: 64 << 20 });
  } catch { return { git: false, excludes: [], ignored: [] }; }
  const ignored = out.split('\0').filter(Boolean).sort();
  return { git: true, ignored, excludes: ignored.map((p) => (p.endsWith('/') ? `./${p}**` : `./${p}`)) };
}

/** One component per remote package (monitor/sbom-remote.mjs); the sidecar says whether it ran. */
export function collapseRemoteIn(cdxPath, nativePath, reportPath) {
  let cdx; let native;
  try { cdx = JSON.parse(readFileSync(cdxPath, 'utf8')); native = JSON.parse(readFileSync(nativePath, 'utf8')); } catch (e) {
    writeAtomic(reportPath, `${JSON.stringify({ ran: false, unknown: true, detail: `unreadable: ${e.message}` }, null, 2)}\n`);
    return null;
  }
  const { report } = collapseRemote(cdx, native);
  if (report.ran) writeAtomic(cdxPath, `${JSON.stringify(cdx, null, 2)}\n`);
  writeAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function run(reportDir, { cwd = process.cwd() } = {}) {
  mkdirSync(reportDir, { recursive: true });
  const cdx = join(reportDir, 'sbom-syft.json'); const native = join(reportDir, 'sbom-syft-native.json');
  const scope = ignoredExcludes(cwd);
  writeAtomic(join(reportDir, 'sbom-syft-scope.json'), `${JSON.stringify({
    base: BASE_EXCLUDES, gitIgnored: scope.git ? scope.ignored : null,
    note: scope.git ? 'paths git ignores were excluded: they are on this disk, not in the repository'
      : 'not a git checkout, so nothing could be classed as ignored; the whole directory was scanned',
  }, null, 2)}\n`);
  const args = ['scan', 'dir:.', ...[...BASE_EXCLUDES, ...scope.excludes].flatMap((e) => ['--exclude', e]),
    '-o', `cyclonedx-json=${cdx}`, '-o', `json=${native}`];
  const r = spawnSync('syft', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
  const code = r.error ? 127 : r.status ?? 1;
  // always: the enricher writes its sidecar even over a failed scan, so "never ran" stays distinguishable
  spawnSync(process.execPath, [join(HERE, 'sbom-enrich.mjs'), cdx, native, '--report', join(reportDir, 'sbom-syft-provenance.json')], { stdio: 'inherit' });
  collapseRemoteIn(cdx, native, join(reportDir, 'sbom-syft-remote.json'));
  return code;
}

if (isMainModule(import.meta.url)) {
  if (!process.argv[2]) { process.stderr.write('usage: node bin/sbom-syft.mjs <reportDir>\n'); process.exit(2); }
  process.exitCode = run(resolve(process.argv[2]));
}
