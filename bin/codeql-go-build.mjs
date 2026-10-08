#!/usr/bin/env node
// What CodeQL runs to extract Go, in place of its autobuilder.
//
// CodeQL refuses build-mode none for Go (measured 2026-09-18, CLI 2.27.0), and its autobuilder runs
// the scanned repository's own make / ninja / ./build / ./build.sh before extracting: repo-authored
// code executing inside a scan. So this is the manual build command instead.
//
// IT RUNS THE EXTRACTOR, NOT A BUILD, and that is the second version of this file. The first ran
// `go build` per module and relied on CodeQL's build TRACER to observe the compiler. Two measured
// failures killed that: `go build` is incremental, so a warm cache compiles nothing and the tracer
// sees no work ("CodeQL detected code written in Go but this run didn't build any of it" on a
// 1,823-file repository, 187s, no SARIF); and under the host sandbox the tracer cannot relocate the
// binary it injects into, because it reaches install_name_tool through `xcodebuild -find`, which the
// profile denies (measured by a peer 2026-10-04: exit 34304, and the same seed extracts with
// CW_SANDBOX=off). Forcing a real compile with a private GOCACHE fixed the first and not the second,
// at 3 minutes and 1.8 GB of cache for a 290-file repository.
//
// go-extractor is what CodeQL's own go/tools/index.sh runs. It loads packages and writes TRAP
// directly, so no compilation and no tracing are involved, and neither failure can recur. It runs
// once per module, because a repo's go.mod is often not at its root.
//
// usage: codeql-go-build.mjs [root]   (exit 0 when at least one module extracted, 1 when none)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { walkGoModules } from './lib/go-modules.mjs';
import { isMainModule } from '../lib/is-main.mjs';

/** CodeQL sets these for the command it runs; without them we are not being run by CodeQL. */
export function extractorPath(env = process.env) {
  const root = env.CODEQL_EXTRACTOR_GO_ROOT;
  const platform = env.CODEQL_PLATFORM;
  if (!root || !platform) return null;
  return join(root, 'tools', platform, 'go-extractor');
}

export function buildModules(root, { env = process.env, run = spawnSync, maxDepth = 4 } = {}) {
  const { modules, unexplored } = walkGoModules(root, maxDepth);
  const extractor = extractorPath(env);
  const rows = [];
  rows.unexplored = unexplored.map((d) => relative(root, d) || '.');
  rows.extractor = extractor;
  if (!extractor) return rows;
  for (const dir of modules) {
    // GOTOOLCHAIN=local: a go.mod toolchain directive must not fetch a toolchain mid-scan.
    const r = run(extractor, ['./...'], {
      cwd: dir,
      env: { ...env, GOTOOLCHAIN: 'local', GOFLAGS: `${env.GOFLAGS ? `${env.GOFLAGS} ` : ''}-buildvcs=false` },
      encoding: 'utf8',
    });
    rows.push({ module: relative(root, dir) || '.', status: r.status, stderr: String(r.error ? r.error.message : r.stderr || '').trim().split('\n').slice(-3).join(' / ') });
  }
  return rows;
}

if (isMainModule(import.meta.url)) {
  const root = process.argv[2] || process.cwd();
  const rows = buildModules(root);
  if (!rows.extractor) {
    process.stderr.write('codeql-go-build: CODEQL_EXTRACTOR_GO_ROOT/CODEQL_PLATFORM are unset — this runs as CodeQL\'s build command and cannot extract on its own\n');
    process.exit(1);
  }
  if (rows.unexplored.length) process.stderr.write(`codeql-go-build: walk stopped at max depth; not searched below: ${rows.unexplored.join(', ')}\n`);
  if (!rows.length) {
    process.stderr.write('codeql-go-build: no go.mod at any depth — nothing to build, so nothing will be extracted\n');
    process.exit(1);
  }
  for (const r of rows) {
    process.stderr.write(r.status === 0
      ? `codeql-go-build: ${r.module} extracted\n`
      : `codeql-go-build: ${r.module} did not extract (exit ${r.status}): ${r.stderr}\n`);
  }
  const built = rows.filter((r) => r.status === 0).length;
  if (!built) {
    process.stderr.write(`codeql-go-build: 0 of ${rows.length} modules extracted — nothing was read, which is not a scan\n`);
    process.exit(1);
  }
  process.exit(0);
}
