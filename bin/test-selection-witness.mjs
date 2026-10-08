#!/usr/bin/env node
// usage: node bin/test-selection-witness.mjs [--sample N] [--concurrency N] [--only a.test.mjs,...]
// exit: 0 no module a test executed fails to select that test · 1 misses found · 2 could not measure
//
// The second witness for bin/lib/test-selection.mjs, sharing none of its extractors. Each test file
// runs alone under NODE_V8_COVERAGE, which V8 honours in every node child the test spawns, so the
// coverage records name every repo module the test actually executed, whether by import, spawn or
// composed path. A module the test executed whose change would not select that test is a miss.
//
// Blind to data files (V8 records scripts, not JSON reads) and to tests that fail to start.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, relative, resolve, dirname } from 'node:path';
import { tmpdir, availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { planSelection } from './lib/test-selection.mjs';
import { moduleIndex, suiteTests } from './test-select.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };

export function executedModules(coverageDir, repo) {
  const out = new Set();
  for (const f of readdirSync(coverageDir)) {
    if (!f.endsWith('.json')) continue;
    let doc;
    try { doc = JSON.parse(readFileSync(join(coverageDir, f), 'utf8')); } catch { continue; }
    for (const { url } of doc.result || []) {
      if (!url?.startsWith('file://')) continue;
      const rel = relative(repo, fileURLToPath(url.replace(/\?.*$/, '')));
      if (!rel.startsWith('..') && !rel.includes('node_modules/') && /\.m?js$/.test(rel)) out.add(rel);
    }
  }
  return out;
}

function runCovered(test) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-selwit-'));
  return new Promise((done) => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', test], {
      cwd: REPO, stdio: 'ignore', env: { ...process.env, NODE_V8_COVERAGE: dir },
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 600_000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      let modules = null;
      try { modules = executedModules(dir, REPO); } catch { modules = null; }
      rmSync(dir, { recursive: true, force: true });
      done({ test, code, signal, modules });
    });
  });
}

async function main() {
  const modules = await moduleIndex(REPO);
  const tests = suiteTests(REPO);
  const only = arg('--only', null);
  let chosen = only ? only.split(',') : tests;
  const sample = Number(arg('--sample', 0));
  if (sample > 0) chosen = chosen.filter((_, i) => i % Math.max(1, Math.floor(chosen.length / sample)) === 0).slice(0, sample);
  const concurrency = Number(arg('--concurrency', Math.max(1, Math.floor(availableParallelism() / 4))));

  const plans = new Map();
  const planFor = (f) => {
    if (!plans.has(f)) plans.set(f, planSelection({ changed: [f], modules, tests }));
    return plans.get(f);
  };

  const misses = [];
  const unmeasured = [];
  let edges = 0;
  const queue = [...chosen];
  const worker = async () => {
    while (queue.length) {
      const r = await runCovered(queue.shift());
      if (!r.modules || r.modules.size === 0) { unmeasured.push(`${r.test} (exit ${r.code ?? r.signal}, no coverage)`); continue; }
      for (const f of r.modules) {
        if (f === r.test) continue;
        edges++;
        const plan = planFor(f);
        if (plan.mode === 'selective' && !plan.tests.includes(r.test)) misses.push(`${f} -> ${r.test}`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  console.log(`test-selection-witness: ${chosen.length} test file(s), ${edges} executed module edge(s), ${misses.length} miss(es), ${unmeasured.length} unmeasured`);
  for (const m of misses.sort()) console.log(`  MISS ${m}`);
  for (const u of unmeasured.sort()) console.log(`  UNMEASURED ${u}`);
  if (edges === 0) process.exit(2);
  process.exit(misses.length ? 1 : 0);
}

if (isMainModule(import.meta.url)) main().catch((e) => { console.error(`test-selection-witness: ${e.message}`); process.exit(2); });
