#!/usr/bin/env node
// usage: node bin/test-select.mjs [--json] [--changed a,b,...]
// exit: 0 a plan was produced (selective, full or none) · 2 the module index could not be built
//
// Prints which test files the working tree's changes can affect (bin/lib/test-selection.mjs).
// Without --changed, the change set is every path that differs from HEAD plus untracked files.
// env, read at call time: CW_TEST_SELECT_ROOT, CW_TEST_SELECT_EXTRA_DIRS (default ~/.claude/hooks)

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { planSelection, resolveDeps } from './lib/test-selection.mjs';
import { relativeDependenciesOf, stripComments } from './lib/tracked-imports.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = () => resolve(process.env.CW_TEST_SELECT_ROOT || join(HERE, '..'));
const extraDirs = () => (process.env.CW_TEST_SELECT_EXTRA_DIRS ?? join(homedir(), '.claude', 'hooks')).split(',').filter(Boolean);
const TEST_DIRS = ['admin', 'bin', 'lib', 'monitor', 'sitemap', 'cra', 'map', 'chunk-diff', 'flow', 'mcp'];
const SOURCE = /\.(mjs|js|sh)$/;

const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
const lines = (s) => s.split('\n').filter(Boolean);

export function changedPaths(repo) {
  return [...new Set([...lines(git(repo, 'diff', '--name-only', 'HEAD')), ...lines(git(repo, 'ls-files', '--others', '--exclude-standard'))])];
}

export function suiteTests(repo) {
  const out = [];
  for (const d of TEST_DIRS) {
    let entries;
    try { entries = readdirSync(join(repo, d), { recursive: true }); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    for (const rel of entries) {
      const p = String(rel);
      if (p.endsWith('.test.mjs') && !p.includes('node_modules')) out.push(join(d, p));
    }
  }
  return out.sort();
}

export async function moduleIndex(repo) {
  const files = lines(git(repo, 'ls-files', '--cached', '--others', '--exclude-standard'))
    .filter((f) => SOURCE.test(f) && !f.includes('node_modules/') && existsSync(join(repo, f)));
  const present = new Set(files);
  const modules = new Map();
  for (const f of files) {
    const text = readFileSync(join(repo, f), 'utf8');
    if (!/\.m?js$/.test(f)) { modules.set(f, { deps: [], text }); continue; }
    let deps;
    try { deps = resolveDeps(f, await relativeDependenciesOf(text, f), (p) => present.has(p)); } catch { deps = null; }
    // A module that only DESCRIBES a file in a comment does not consume it, and following that
    // mention through the importer closure selected 227 tests for a change two tests reach.
    modules.set(f, { deps, text: stripComments(text).join('\n'), raw: text });
  }
  // Hooks a test runs from outside the repo still name the repo scripts they execute.
  for (const dir of extraDirs()) {
    let entries;
    try { entries = readdirSync(dir); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    for (const name of entries.filter((n) => SOURCE.test(n))) {
      const text = readFileSync(join(dir, name), 'utf8');
      modules.set(join(dir, name), { deps: [], text, raw: text });
    }
  }
  return modules;
}

async function main() {
  if (typeof vm.SourceTextModule !== 'function') {
    // The import extractor refuses to fall back to its unsound regex path without the V8 parser.
    const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(r.status ?? 2);
  }
  const repo = root();
  const argAt = process.argv.indexOf('--changed');
  let plan;
  try {
    const changed = argAt > 0 ? process.argv[argAt + 1].split(',') : changedPaths(repo);
    plan = planSelection({ changed, modules: await moduleIndex(repo), tests: suiteTests(repo) });
  } catch (e) {
    console.error(`test-select: could not build the module index: ${e.message}`);
    process.exit(2);
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ ...plan, why: plan.why ? Object.fromEntries(plan.why) : undefined })}\n`);
    return;
  }
  if (plan.mode !== 'selective') { console.log(`${plan.mode}: ${plan.reason}`); return; }
  console.log(`selective: ${plan.tests.length} test file(s)`);
  for (const t of plan.tests) console.log(`  ${t}  (${plan.why.get(t)})`);
}

if (isMainModule(import.meta.url)) {
  main().catch((e) => { console.error(`test-select: ${e.message}`); process.exit(2); });
}
