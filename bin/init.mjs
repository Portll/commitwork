#!/usr/bin/env node
// commitwork init — first-run state for a fresh clone: the private store directory, a fleet
// registry naming only what the caller declares, and the ~/.commitwork directory the panel's
// credential stores are written into. Scanners are `setup`'s job, not this one's.
//
// Never copies an example record into a live store. An absent exemption list, owner map or image
// acceptance has a defined meaning (nothing exempt, no owner, nothing accepted); a copied example
// would change results while reading as configuration.
//
// usage: commitwork init [--private-dir <dir>] [--root <dir>]... [--repo <path>]... [--dry-run] [--json]
// exit: 0 ready · 1 refused (existing state init would not have created) · 2 usage

import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import {
  privateDir, registryPathFor, authStorePath, annotationsPathFor, gateExemptionsPathFor,
  stubAllowlistPathFor, imageAcceptancePathFor, ownerMapPathFor, programWorklistPathFor,
  bolaManifestDirFor, craProductsPathFor, credentialScopePathFor, configCorrectnessLedgerPathFor,
  disregardedWarningsPathFor,
} from '../monitor/store-paths.mjs';
import { loadRegistry, validateRegistry, validateAgainstSchema } from '../monitor/registry.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = () => resolve(process.env.CW_INIT_ROOT || REPO);
const SCHEMA = () => join(REPO, 'schema', 'projects.schema.json');
const PANEL_LOCAL_PORT = () => +(process.env.CW_ADMIN_LOCAL_PORT || (+(process.env.CW_ADMIN_PORT || 7878) + 1));

export const OPTIONAL_RECORDS = [
  { env: 'CW_ANNOTATIONS', at: annotationsPathFor, absent: 'no waivers or scanner adjudications', example: 'monitor/annotations.example.json' },
  { env: 'CW_GATE_EXEMPTIONS', at: gateExemptionsPathFor, absent: 'no gate exemption in force', example: 'monitor/gate-exemptions.example.json' },
  { env: 'CW_STUB_ALLOWLIST', at: stubAllowlistPathFor, absent: 'no stub is allowed', example: 'monitor/stub-allowlist.example.json' },
  { env: 'CW_IMAGE_ACCEPTANCE', at: imageAcceptancePathFor, absent: 'no image CVE is accepted', example: 'monitor/image-acceptance.example.json' },
  { env: 'CW_OWNER_MAP', at: ownerMapPathFor, absent: 'findings carry no owner default', example: 'monitor/owner-map.example.json' },
  { env: 'CW_PROGRAM_WORKLIST', at: programWorklistPathFor, absent: 'no modernisation programmes', example: 'monitor/program-worklist.example.json' },
  { env: 'CW_CRED_SCOPE', at: credentialScopePathFor, absent: 'credential blast radius reported as unknown', example: 'monitor/credential-scope.example.json' },
  { env: 'CW_CONFIG_CORRECTNESS_LEDGER', at: configCorrectnessLedgerPathFor, absent: 'no ledger (no runtime reader)', example: 'monitor/config-correctness-ledger.example.json' },
  { env: 'CW_DISREGARDED_WARNINGS', at: disregardedWarningsPathFor, absent: 'no warning has been set aside', example: 'monitor/disregarded-warnings.example.json' },
  { env: 'CW_PRODUCTS', at: craProductsPathFor, absent: 'CRA tools refuse with "not configured"', example: 'cra/products.example.json' },
  { env: 'CW_BOLA_MANIFEST_DIR', at: bolaManifestDirFor, absent: 'the BOLA lane has no manifests to run', example: 'manifests/bola/example.json' },
];

export function parseInitArgs(argv) {
  const opts = { privateDir: null, roots: [], repos: [], dryRun: false, json: false };
  const value = (i, flag) => { const v = argv[i]; if (!v || v.startsWith('--')) throw new Error(`${flag} needs a value`); return v; };
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--private-dir') opts.privateDir = resolve(value(++i, a));
      else if (a === '--root') opts.roots.push(resolve(value(++i, a)));
      else if (a === '--repo') opts.repos.push(resolve(value(++i, a)));
      else if (a === '--dry-run') opts.dryRun = true;
      else if (a === '--json') opts.json = true;
      else if (a === '--help' || a === '-h') opts.help = true;
      else return { error: `unknown argument: ${a}` };
    }
  } catch (e) { return { error: e.message }; }
  return opts;
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

// monitor/private must be a directory or a DIRECTORY symlink: the stores under it are written by
// rename(), and rename() onto a file symlink replaces the link and orphans its target.
export function planPrivateDir(root, wanted) {
  const link = privateDir(root);
  let st = null;
  try { st = lstatSync(link); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!st) {
    if (!wanted || wanted === link) return { path: link, action: 'create-dir' };
    if (existsSync(wanted) && !isDir(wanted)) return { path: link, action: 'refuse', reason: `${wanted} exists and is not a directory` };
    return { path: link, target: wanted, action: existsSync(wanted) ? 'link' : 'create-and-link' };
  }
  if (!isDir(link)) return { path: link, action: 'refuse', reason: `${link} exists and is not a directory` };
  if (wanted && wanted !== link && (!existsSync(wanted) || realpathSync(link) !== realpathSync(wanted))) {
    return { path: link, action: 'refuse', reason: `${link} already resolves to ${realpathSync(link)}, not ${wanted}` };
  }
  return { path: link, action: 'keep' };
}

export function buildRegistry({ registryPath, roots = [], repos = [], schemaPath = SCHEMA() }) {
  const names = new Set();
  const projects = repos.map((p) => {
    let name = basename(p);
    for (let n = 2; names.has(name); n++) name = `${basename(p)}-${n}`;
    names.add(name);
    return { name, area: 'local', path: p, manifest: 'security-baseline' };
  });
  return {
    $schema: relative(dirname(registryPath), schemaPath),
    reportsRoot: 'reports',
    defaultManifest: 'security-baseline',
    // The empty prefix claims every name. Without it a root-discovered repo resolves to an area of
    // its own name, which no declared area's fan-out covers, so `--all` would list it and never scan it.
    areas: [{ slug: 'local', label: 'Local', out: 'local', primary: true, prefixes: [''],
      note: 'Every repository this machine declares or discovers. Split into more areas as the fleet grows.' }],
    roots: roots.map((path) => ({ path, maxDepth: 2 })),
    projects,
  };
}

export function registryErrors(reg, schemaPath = SCHEMA()) {
  return [...validateRegistry(reg).errors, ...validateAgainstSchema(reg, { path: schemaPath }).errors];
}

export function planInit(opts, { root = repoRoot() } = {}) {
  const steps = [];
  const problems = [];
  for (const p of opts.repos) if (!isDir(join(p, '.git')) && !existsSync(join(p, '.git'))) problems.push(`--repo ${p} is not a git repository`);
  for (const p of opts.roots) if (!isDir(p)) problems.push(`--root ${p} is not a directory`);
  if (problems.length) return { usage: problems, steps };

  steps.push({ what: 'private dir', ...planPrivateDir(root, opts.privateDir) });

  const registryPath = registryPathFor(root);
  if (existsSync(registryPath)) {
    try {
      loadRegistry({ path: registryPath, schemaPath: SCHEMA(), quiet: true });
      steps.push({ what: 'registry', path: registryPath, action: 'keep' });
    } catch (e) {
      steps.push({ what: 'registry', path: registryPath, action: 'refuse', reason: e.message });
    }
  } else {
    const reg = buildRegistry({ registryPath, roots: opts.roots, repos: opts.repos });
    const errors = registryErrors(reg);
    steps.push(errors.length
      ? { what: 'registry', path: registryPath, action: 'refuse', reason: errors.join('; ') }
      : { what: 'registry', path: registryPath, action: 'write', registry: reg });
  }

  const home = dirname(authStorePath());
  steps.push({ what: 'credential home', path: home, action: isDir(home) ? 'keep' : 'create-dir' });

  const records = OPTIONAL_RECORDS.map((r) => {
    const path = r.at(root);
    return { env: r.env, path, present: existsSync(path), absent: r.absent, example: r.example };
  });
  return { steps, records };
}

export function applyInit(plan) {
  for (const s of plan.steps) {
    if (s.action === 'create-dir') mkdirSync(s.path, { recursive: true, mode: 0o700 });
    else if (s.action === 'create-and-link' || s.action === 'link') {
      mkdirSync(s.target, { recursive: true, mode: 0o700 });
      mkdirSync(dirname(s.path), { recursive: true });
      symlinkSync(s.target, s.path, 'dir');
    } else if (s.action === 'write') {
      writeAtomic(s.path, `${JSON.stringify(s.registry, null, 2)}\n`, { mkdir: true });
    }
  }
}

function render(plan, { dryRun }) {
  const out = [`commitwork init${dryRun ? ' (dry run: nothing written)' : ''}`];
  for (const s of plan.steps) {
    const detail = s.action === 'refuse' ? `REFUSED: ${s.reason}` : s.target ? `${s.action} → ${s.target}` : s.action;
    out.push(`  ${s.what.padEnd(16)} ${s.path}  ${detail}`);
  }
  const reg = plan.steps.find((s) => s.what === 'registry' && s.registry)?.registry;
  if (reg && !reg.roots.length && !reg.projects.length) {
    out.push('  registry declares no repositories: add --root <dir> or --repo <path>, or edit it (schema/projects.schema.json)');
  }
  out.push('', 'Optional records (absent is a defined state, not an error):');
  for (const r of plan.records) {
    out.push(`  ${r.present ? 'present' : 'absent '}  ${r.env.padEnd(29)} ${r.present ? r.path : `${r.absent}; shape: ${r.example}`}`);
  }
  out.push('', 'Next:',
    '  commitwork setup --yes            install the scanners the lanes need',
    '  commitwork doctor                 confirm what is present',
    '  node monitor/sweep.mjs all --dry  resolve the fleet without running anything',
    `  node admin/serve.mjs              then create the operator account at http://127.0.0.1:${PANEL_LOCAL_PORT()}`);
  return out.join('\n');
}

export function runInit(opts) {
  if (opts.error) { console.error(`init: ${opts.error}`); return 2; }
  if (opts.help) { console.log('usage: commitwork init [--private-dir <dir>] [--root <dir>]... [--repo <path>]... [--dry-run] [--json]'); return 0; }
  const plan = planInit(opts);
  if (plan.usage) { for (const p of plan.usage) console.error(`init: ${p}`); return 2; }
  const refused = plan.steps.some((s) => s.action === 'refuse');
  if (!opts.dryRun && !refused) applyInit(plan);
  if (opts.json) console.log(JSON.stringify({ dryRun: opts.dryRun, refused, ...plan }, null, 2));
  else console.log(render(plan, opts));
  return refused ? 1 : 0;
}

if (isMainModule(import.meta.url)) process.exitCode = runInit(parseInitArgs(process.argv.slice(2)));
