#!/usr/bin/env node
// bin/release-terms.mjs — count the denied terms in a tree, the same check the release gate applies.
//
// usage:
//   node bin/release-terms.mjs [--ref <rev> | --root <dir>] [--json] [--show-paths]
//     --ref <rev>   scan `git archive <rev>` of this repository, which honours export-ignore (default HEAD)
//     --root <dir>  scan a directory as it is
//     --json        print the summary as JSON
//     --show-paths  print paths unmasked; the default masks every denied term in a path
//
// env: CW_RELEASE_TERMS · CW_SIDECAR · CW_RELEASE_NAMES_SIDECAR_REF
//
// exit: 0 no denied term · 20 denied terms found · 21 cannot check (no list, an unreadable list, or no
//   text file examined) · 22 usage
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { loadTerms, scanTree, summarise } from './lib/release-terms.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EXIT = Object.freeze({ CLEAN: 0, FOUND: 20, CANNOT_CHECK: 21, USAGE: 22 });

export function parseArgs(argv) {
  const o = { ref: null, root: null, json: false, showPaths: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ref' || a === '--root') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) return { error: `${a} needs a value` };
      o[a.slice(2)] = v;
    } else if (a === '--json') o.json = true;
    else if (a === '--show-paths') o.showPaths = true;
    else return { error: `unknown argument ${a}` };
  }
  if (o.ref && o.root) return { error: '--ref and --root are alternatives' };
  return o;
}

function exportRef(ref) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-release-terms-'));
  const tar = join(dir, '.tree.tar');
  writeFileSync(tar, execFileSync('git', ['-C', REPO, 'archive', '--format=tar', ref], { maxBuffer: 1 << 30 }));
  execFileSync('tar', ['-xf', tar, '-C', dir]);
  rmSync(tar);
  return dir;
}

export function main(argv = process.argv.slice(2), { load = loadTerms, out = console.log, err = console.error } = {}) {
  const o = parseArgs(argv);
  if (o.error) { err(`release-terms: ${o.error}`); return EXIT.USAGE; }
  let list;
  try { list = load(); } catch (e) { err(`release-terms: the denied-term list cannot be read (${e.message})`); return EXIT.CANNOT_CHECK; }
  if (!list) { err('release-terms: no denied-term list; set CW_RELEASE_TERMS or commit monitor/release-terms.json to the sidecar'); return EXIT.CANNOT_CHECK; }
  const root = o.root ? resolve(o.root) : exportRef(o.ref || 'HEAD');
  let s;
  try { s = summarise(scanTree(root, list), o.showPaths ? { rules: [] } : list); }
  finally { if (!o.root) rmSync(root, { recursive: true, force: true }); }
  if (o.json) out(JSON.stringify({ list: list.fingerprint, target: o.root ? root : `ref:${o.ref || 'HEAD'}`, ...s }, null, 2));
  else {
    out(`release-terms: ${s.hitCount} denied term(s) in ${s.offendingFiles} file(s); ${s.examined} text file(s) examined, ${s.skipped.binary} binary, ${s.skipped.link} link(s) read by path only`);
    for (const [id, r] of Object.entries(s.byRule)) out(`  rule ${id}: ${r.hits} in ${r.files} file(s)`);
    for (const [dir, r] of Object.entries(s.byDir)) out(`  dir  ${dir}: ${r.hits} in ${r.files} file(s)`);
  }
  if (!s.examined) { err('release-terms: no text file was examined; an empty tree is not a clean one'); return EXIT.CANNOT_CHECK; }
  return s.hitCount ? EXIT.FOUND : EXIT.CLEAN;
}

if (isMainModule(import.meta.url)) process.exitCode = main();
