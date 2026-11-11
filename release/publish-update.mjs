#!/usr/bin/env node
// release/publish-update.mjs — publish a commitwork tarball as a portll-update@1 release through
// spine's publisher, which signs the manifest with the Keychain key and uploads to R2 (and, with
// --github, to the GitHub release). This file builds nothing and signs nothing itself.
//
// usage: node release/publish-update.mjs --channel stable|beta [--version X.Y.Z] [--file <tgz>]
//                                        [--notes <file>] [--github|--no-github] [--dry-run]
//   --version  default package.json's version
//   --file     default dist/commitwork-<version>.tgz, as release.yml's `npm pack` writes it
//   --github   default on for stable, off for beta. A stable release already exists by then
//              (release.yml creates it from the v* tag), and the publisher adds portll-update.json
//              to it. A beta build is every main commit; a GitHub release for each would mint a
//              v<patch> tag, which bin/release-tag.mjs refuses and bin/releases-atom.mjs would
//              list as a release
//   --dry-run  print the publisher command and exit
// exit: 0 published (or printed) · 2 usage · 21 the tarball or the publisher is missing ·
//       otherwise the publisher's own exit code
// env, read at call time: SPINE_DIR (the spine checkout, default ../spine beside this repository)

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const spineDir = (env = process.env) => resolve(env.SPINE_DIR || join(REPO, '..', 'spine'));

/** { opts } or { error }. */
export function parsePublishArgs(argv, { version } = {}) {
  const o = { channel: null, version: version ?? null, file: null, notes: null, github: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    try {
      if (a === '--channel') o.channel = next();
      else if (a === '--version') o.version = next();
      else if (a === '--file') o.file = next();
      else if (a === '--notes') o.notes = next();
      else if (a === '--github') o.github = true;
      else if (a === '--no-github') o.github = false;
      else if (a === '--dry-run') o.dryRun = true;
      else return { error: `unknown argument ${JSON.stringify(a)}` };
    } catch (e) { return { error: e.message }; }
  }
  if (o.channel !== 'stable' && o.channel !== 'beta') return { error: '--channel takes stable or beta' };
  if (!o.version) return { error: 'no --version, and package.json has none' };
  if (o.github === null) o.github = o.channel === 'stable';
  if (!o.file) o.file = join(REPO, 'dist', `commitwork-${o.version}.tgz`);
  return { opts: o };
}

/** The publisher argv: node <spine>/updates/publish.mjs --product commitwork ... */
export function publisherArgv(o, spine) {
  return [process.execPath, join(spine, 'updates', 'publish.mjs'), '--product', 'commitwork', '--channel', o.channel,
    '--version', o.version, '--file', resolve(o.file), ...(o.notes ? ['--notes', resolve(o.notes)] : []), ...(o.github ? ['--github'] : [])];
}

export function main(argv, { env = process.env, exists = existsSync, run = spawnSync, log = (m) => process.stderr.write(`${m}\n`), version } = {}) {
  const pkgVersion = version ?? JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version;
  const p = parsePublishArgs(argv, { version: pkgVersion });
  if (p.error) { log(`publish-update: ${p.error}`); return 2; }
  const spine = spineDir(env);
  const argvOut = publisherArgv(p.opts, spine);
  if (p.opts.dryRun) { log(argvOut.join(' ')); return 0; }
  if (!exists(p.opts.file)) { log(`publish-update: ${p.opts.file} does not exist; npm pack --ignore-scripts --pack-destination dist writes it`); return 21; }
  if (!exists(argvOut[1])) { log(`publish-update: ${argvOut[1]} does not exist; set SPINE_DIR to a spine checkout that has updates/publish.mjs`); return 21; }
  const r = run(argvOut[0], argvOut.slice(1), { stdio: 'inherit' });
  return r.status ?? 1;
}

if (isMainModule(import.meta.url)) process.exitCode = main(process.argv.slice(2));
