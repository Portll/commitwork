// The one command that runs C1..C5 and prints the measurement.
//
// The runtime commands default to a SMALL, read-only set on purpose. docs/TRAPS.md records that
// several tools in this tree do real work when merely asked a question — monitor/rollup.mjs
// republishes over an area's directory when run with no argument, monitor/sweep.mjs treats an
// unknown first argument as a whole-fleet sweep — so the second witness is pointed only at commands
// whose safety has been checked. Coverage is therefore narrow, and the reconciliation says so
// rather than presenting a small comparison as a whole-repo verdict.

import { relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyseRepo, repoRoot } from './static.mjs';
import { observe } from './runtime.mjs';
import { reconcile, formatReport as fmtReconcile } from './reconcile.mjs';
import { orphans, formatReport as fmtOrphans } from './orphans.mjs';
import { liveness, formatReport as fmtLiveness } from './liveness.mjs';
import { storePath, writeJson } from './store.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// Checked read-only. Anything added here must be verified not to publish.
export const DEFAULT_COMMANDS = [
  ['bin/docs-doctor.mjs'],
  ['flow/static.mjs'],
];

export async function run({ root, env = process.env, commands = DEFAULT_COMMANDS } = {}) {
  const repo = root || repoRoot();

  const graph = await analyseRepo({ root: repo, env });

  // Union the runs. A module entered by any of them is in coverage.
  const coverage = new Set();
  const observations = [];
  const runs = [];
  let usable = 0;
  for (const cmd of commands) {
    const r = observe(cmd, { root: repo, env: { ...env, CW_HARNESS_STORE: '/tmp/flow-runtime-scratch' } });
    runs.push({ cmd: cmd.join(' '), state: r.state, exit: r.status, observations: r.observations.length, coverage: r.coverage.length, reason: r.reason });
    if (r.state !== 'usable') continue;
    usable += 1;
    for (const c of r.coverage) coverage.add(c);
    observations.push(...r.observations);
  }
  const runtime = usable === 0
    ? { state: 'unusable', reason: 'no traced command produced a usable trace', coverage: [], observations: [] }
    : { state: 'usable', coverage: [...coverage], observations };

  const rec = reconcile(graph, runtime);
  const orp = orphans(graph);
  const liv = liveness(graph, { root: repo, env });

  writeJson(storePath('flow.json', env), graph);
  writeJson(storePath('flow-reconcile.json', env), { ...rec, runs });
  writeJson(storePath('flow-orphans.json', env), orp);
  writeJson(storePath('flow-liveness.json', env), liv);

  const s = graph.summary;
  const lines = [
    '── flow ─────────────────────────────────────────────────────────────',
    `C1 static      ${s.analysed}/${s.filesInput} modules analysed, ${s.unanalysable} unanalysable ${JSON.stringify(s.unanalysableByReason)}`,
    `               nodes ${graph.nodes.length}  edges ${graph.edges.length}`,
    `               FALSE NEG  v8 specifiers missed ${s.falseNegative.specifiersMissing.length}  unaccounted path-runs ${s.falseNegative.unaccounted.length}`,
    `               FALSE POS FLOOR  mask rejected ${s.falsePositiveFloor.maskRejected.length}  lexer bailed ${s.falsePositiveFloor.lexerBailed.length}`,
    `C2 runtime     ${runs.filter((r) => r.state === 'usable').length}/${runs.length} traced commands usable, coverage ${runtime.coverage.length} modules`,
    ...runs.map((r) => `               ${r.state.padEnd(8)} exit ${String(r.exit).padEnd(4)} obs ${String(r.observations).padEnd(5)} ${r.cmd}${r.reason ? `  (${r.reason})` : ''}`),
    fmtReconcile(rec).split('\n').map((l, i) => (i === 0 ? `C3 ${l.replace('flow/reconcile: ', '').padStart(0)}` : l)).join('\n'),
    fmtOrphans(orp),
    fmtLiveness(liv),
    `               -> ${relative(repo, storePath('flow.json', env))} (+ reconcile, orphans, liveness)`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  return { graph, runtime, reconcile: rec, orphans: orp, liveness: liv, runs };
}

if (isMainModule(import.meta.url)) {
  const vm = await import('node:vm');
  if (typeof vm.SourceTextModule !== 'function') {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath,
      ['--experimental-vm-modules', resolve(dirname(fileURLToPath(import.meta.url)), 'report.mjs'), ...process.argv.slice(2)],
      { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  await run();
}
