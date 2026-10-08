#!/usr/bin/env node
// bin/launchlist.mjs — run the launch checklist against fleet repositories and render the page.
//
// usage:
//   node bin/launchlist.mjs run [--project a,b | --all] [--history] [--tests] [--json]
//   node bin/launchlist.mjs render [--out <file>]
//   node bin/launchlist.mjs status [--project a,b]
//   node bin/launchlist.mjs tick <project> <item> [--state done|na|open] [--note <text>]
//   node bin/launchlist.mjs add <project> --id <id> --title <t> --section <s> --severity HARD|SHOULD|LATER
//                               --owner <o> --size S|M|L [--why ..] [--how ..] [--evidence ..] [--source ..]
//   node bin/launchlist.mjs import <project> <items.json>
//
// --history adds a full-history secrets scan; --tests runs each project's declared publicTest from a
// clean export (it executes that repository's code, so it is opt-in per run and per project).
//
// exit: 0 no open HARD item · 1 open HARD items · 2 could not complete

import { readFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import {
  loadSpec, loadConfig, loadState, withState, saveResults, loadResults, carryForward, buildModel, itemsFor,
  recordTick, addItem, projectsInStore, nowISO, safeSlug,
} from '../lib/launchlist.mjs';
import { runChecks, repoFacts } from '../lib/launchlist-checks.mjs';
import { renderPage } from '../lib/launchlist-render.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLEET_ROOT = () => process.env.CW_FLEET_ROOT || resolve(REPO, '..');
export const htmlOut = () => process.env.CW_LAUNCHLIST_HTML || join(REPO, 'reports', 'launchlist', 'index.html');
const who = () => process.env.CW_LAUNCHLIST_BY || `cli:${userInfo().username}`;

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { cmd, positional: [], flags: {} };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) { opts.positional.push(a); continue; }
    const k = a.slice(2);
    if (['all', 'history', 'tests', 'json', 'help'].includes(k)) { opts.flags[k] = true; continue; }
    const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) return { error: `--${k} needs a value` };
    opts.flags[k] = v;
    i++;
  }
  return opts;
}

export async function fleetRepos() {
  try {
    const { loadRegistry } = await import('../monitor/registry.mjs');
    const { resolveRepos } = await import('../monitor/discover.mjs');
    return resolveRepos(loadRegistry({ quiet: true }), { selfRoot: REPO }).repos.map((r) => ({ name: r.name, path: r.path }));
  } catch { return []; }
}

export function repoPathFor(project, config, fleet) {
  const p = (config.projects || {})[project];
  if (p && p.repo) return isAbsolute(p.repo) ? p.repo : resolve(FLEET_ROOT(), p.repo);
  const hit = fleet.find((r) => r.name === project);
  return hit ? hit.path : null;
}

async function cmdRun(opts) {
  const spec = loadSpec();
  const config = loadConfig();
  const state = loadState();
  const fleet = await fleetRepos();
  let projects;
  if (opts.flags.all) projects = [...new Set([...Object.keys(config.projects), ...fleet.map((r) => r.name)])].sort();
  else if (opts.flags.project) projects = String(opts.flags.project).split(',').map((s) => s.trim()).filter(Boolean);
  else projects = Object.keys(config.projects).sort();
  if (!projects.length) { console.error('launchlist: no projects — declare them in the config or pass --project / --all'); return 2; }
  let incomplete = 0;
  const summaries = [];
  for (const project of projects) {
    safeSlug(project);
    const repo = repoPathFor(project, config, fleet);
    if (!repo) { console.error(`launchlist: ${project}: no repository path (config repo, or a fleet registry entry)`); incomplete++; continue; }
    let facts;
    try { facts = repoFacts(repo); } catch (e) { console.error(`launchlist: ${project}: ${repo} is not a readable git repository (${e.message.split('\n')[0]})`); incomplete++; continue; }
    const cfg = (config.projects || {})[project] || {};
    const ctx = {
      project, repo, repoName: basename(repo), cfg, accounts: config.accounts || {},
      fleetNames: fleet.map((r) => r.name), flags: { history: !!opts.flags.history, tests: !!opts.flags.tests },
    };
    const items = itemsFor(project, { spec, config, state });
    const t0 = Date.now();
    const results = carryForward(await runChecks(ctx, items), loadResults(project), { items, flags: ctx.flags });
    saveResults(project, { project, measuredAt: nowISO(), repo: { path: repo, ...facts }, flags: ctx.flags, results });
    const vals = Object.values(results);
    const line = `${project}: ${vals.filter((r) => r.status === 'pass').length} pass, ${vals.filter((r) => r.status === 'fail').length} fail, `
      + `${vals.filter((r) => r.status === 'warn').length} warn, ${vals.filter((r) => r.status === 'unmeasured').length} unmeasured (${((Date.now() - t0) / 1000).toFixed(1)}s)`;
    summaries.push(line);
    if (!opts.flags.json) console.log(line);
  }
  const out = renderTo(htmlOut());
  if (opts.flags.json) console.log(JSON.stringify({ projects: summaries, html: out }, null, 2));
  else console.log(`launchlist: page written to ${out}`);
  if (incomplete) return 2;
  return exitFor(buildModel({ projects }));
}

const exitFor = (model) => (model.projects.some((p) => p.summary.openHard > 0) ? 1 : 0);

export function renderTo(out) {
  const model = buildModel();
  mkdirSync(dirname(out), { recursive: true });
  writeAtomic(out, renderPage(model, { interactive: false }).html);
  return out;
}

function cmdStatus(opts) {
  const config = loadConfig();
  const state = loadState();
  const list = opts.flags.project ? String(opts.flags.project).split(',') : projectsInStore(config, state);
  const model = buildModel({ config, state, projects: list });
  if (opts.flags.json) { console.log(JSON.stringify(model, null, 2)); return exitFor(model); }
  for (const p of model.projects) {
    console.log(`${p.project}  HARD ${p.summary.openHard} · SHOULD ${p.summary.openShould} · LATER ${p.summary.openLater} open · ${p.summary.done}/${p.summary.total} done · measured ${p.measuredAt || 'never'}`);
    for (const r of p.rows.filter((x) => !x.done && x.severity === 'HARD')) {
      console.log(`  [ ] ${r.id.padEnd(28)} ${r.result ? r.result.status.toUpperCase().padEnd(10) : 'TODO'.padEnd(10)} ${r.title}`);
    }
  }
  return exitFor(model);
}

function cmdTick(opts) {
  const [project, item] = opts.positional;
  if (!project || !item) { console.error('usage: launchlist tick <project> <item> [--state done|na|open] [--note text]'); return 2; }
  const spec = loadSpec();
  const config = loadConfig();
  const out = withState((state) => recordTick(state, project, item, { state: opts.flags.state || 'done', note: opts.flags.note || '', by: who(), spec, config }), { label: 'launchlist-cli' });
  if (!out.ok) { console.error(`launchlist: not recorded (${out.refused}): ${(out.errors || [out.error]).join('; ')}`); return 2; }
  console.log(`launchlist: ${project} ${item} → ${out.tick.state}${out.tick.evidenceDigest ? ` (bound to evidence ${out.tick.evidenceDigest})` : ''}`);
  renderTo(htmlOut());
  return 0;
}

function cmdAdd(opts) {
  const [project] = opts.positional;
  if (!project) { console.error('usage: launchlist add <project> --id … --title … --section … --severity … --owner … --size …'); return 2; }
  const f = opts.flags;
  const item = { id: f.id, title: f.title, section: f.section, severity: f.severity, owner: f.owner, size: f.size, why: f.why, how: f.how, evidence: f.evidence, source: f.source, profile: f.profile };
  const spec = loadSpec();
  const out = withState((state) => addItem(state, project, item, { spec, by: who() }), { label: 'launchlist-cli' });
  if (!out.ok) { console.error(`launchlist: not added (${out.refused}): ${(out.errors || [out.error]).join('; ')}`); return 2; }
  console.log(`launchlist: ${project} ${out.item.id} recorded`);
  return 0;
}

function cmdImport(opts) {
  const [project, file] = opts.positional;
  if (!project || !file) { console.error('usage: launchlist import <project> <items.json>'); return 2; }
  const items = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(items)) { console.error('launchlist: import file must hold a JSON array of items'); return 2; }
  const spec = loadSpec();
  const out = withState((state) => {
    const errors = [];
    for (const it of items) {
      const r = addItem(state, project, it, { spec, by: who() });
      if (!r.ok) errors.push(`${it.id || '(no id)'}: ${r.errors.join('; ')}`);
    }
    return errors.length ? { ok: false, refused: 'invalid', errors } : { ok: true, n: items.length };
  }, { label: 'launchlist-cli' });
  if (!out.ok) { console.error(`launchlist: nothing imported (${out.refused}):\n  ${(out.errors || [out.error]).join('\n  ')}`); return 2; }
  console.log(`launchlist: ${out.n} item(s) recorded for ${project}`);
  renderTo(htmlOut());
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.error) { console.error(`launchlist: ${opts.error}`); return 2; }
  if (!opts.cmd || opts.cmd === '--help' || opts.cmd === '-h' || opts.flags.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  try {
    switch (opts.cmd) {
      case 'run': return await cmdRun(opts);
      case 'render': console.log(`launchlist: page written to ${renderTo(opts.flags.out || htmlOut())}`); return 0;
      case 'status': return cmdStatus(opts);
      case 'tick': return cmdTick(opts);
      case 'add': return cmdAdd(opts);
      case 'import': return cmdImport(opts);
      default: console.error(`launchlist: unknown command ${opts.cmd} (run with --help)`); return 2;
    }
  } catch (e) {
    console.error(`launchlist: ${e.message}`);
    return 2;
  }
}

if (isMainModule(import.meta.url)) main().then((code) => { process.exitCode = code; });
