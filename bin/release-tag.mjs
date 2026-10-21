#!/usr/bin/env node
// usage: release-tag.mjs [--ref <rev>] [--tag] [--json]
// exit: 0 ok · 1 the tag already exists · 2 no taggable version (fail closed)
// env, read at call time: CW_REPO_ROOT, CW_PACKAGE_JSON, CW_RELEASE_TAG_PREFIX
// output: the tag this ref would carry, and with --tag an annotated tag creating it
//
// pins: the tag is `v` + the version package.json carries AT THE REF
// guard: the version is read from the commit, never from the working tree
// guard: an existing tag is refused, never moved
// guard: a non-semver version is refused, so the retired 0.<count> series cannot be re-minted
// guard: a patch version is never tagged, because every commit carries one

import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = () => process.env.CW_REPO_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));

// pins: a repo-RELATIVE path, because the version is read out of a commit and not off disk
const manifestPath = () => process.env.CW_PACKAGE_JSON || 'package.json';

export const tagPrefix = () => process.env.CW_RELEASE_TAG_PREFIX || 'v';

const git = (args, cwd = REPO()) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20_000 });
  if (r.error) throw new Error(`git could not be run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args[0]} exited ${r.status}: ${String(r.stderr || '').trim().slice(0, 160)}`);
  return String(r.stdout || '').trim();
};

// fact: a shape test, and plan() REFUSES anything it rejects / the counted series passes every other check and only its shape tells it apart from a hand-set version (expiry: never, prev: wrong)
export const isSemver = (v) => /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(v);

/**
 * The version package.json carries at `ref`.
 * @returns {string} / throws, never a default, when the commit has no readable version
 */
export function readVersionAt(ref = 'HEAD', cwd = REPO(), path = manifestPath()) {
  const raw = git(['show', `${ref}:${path}`], cwd);
  let pkg;
  try { pkg = JSON.parse(raw); } catch (e) {
    throw new Error(`${path} at ${ref} is not JSON (${e.message.slice(0, 80)}) -- the version is UNKNOWN, not 0`);
  }
  const v = pkg && pkg.version;
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${path} at ${ref} carries no version string`);
  return v.trim();
}

// fact: commit-phase bumps the patch on every commit, so a patch version names a commit, not a release / versionOrigin() reads set-here on every such commit and cannot tell them apart (expiry: never, prev: missing)
/** @returns {'major'|'minor'|'patch'} which part of a semver version is the one that moved */
export const versionKind = (v) => {
  const [major, minor, patch] = v.split(/[-+]/)[0].split('.').map(Number);
  return patch !== 0 ? 'patch' : minor !== 0 || major === 0 ? 'minor' : 'major';
};

export const tagFor = (version, prefix = tagPrefix()) => `${prefix}${version}`;

export function tagExists(tag, cwd = REPO()) {
  const r = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { cwd, encoding: 'utf8' });
  return r.status === 0;
}

// guard: undetermined is its own value, never folded into "inherited"
/** @returns {'set-here'|'inherited'|'unknown'} whether THIS commit set the version */
export function versionOrigin(ref, version, cwd = REPO()) {
  let parent;
  try { parent = git(['rev-parse', '--verify', `${ref}^{commit}^`], cwd); } catch { return 'set-here'; }
  try { return readVersionAt(parent, cwd) === version ? 'inherited' : 'set-here'; } catch (e) {
    return /exited/.test(e.message) ? 'set-here' : 'unknown';
  }
}

export function plan({ ref = 'HEAD', cwd = REPO() } = {}) {
  const sha = git(['rev-parse', ref], cwd);
  const version = readVersionAt(ref, cwd);
  if (!isSemver(version)) {
    throw new Error(`version ${JSON.stringify(version)} at ${ref} is not semver -- the counted 0.<n> series is retired and is never re-minted`);
  }
  const tag = tagFor(version);
  return { ref, sha, version, tag, kind: versionKind(version), origin: versionOrigin(ref, version, cwd), exists: tagExists(tag, cwd) };
}

function main(argv) {
  const at = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  const ref = at('--ref') || 'HEAD';

  let p;
  try { p = plan({ ref }); } catch (e) {
    console.error(`release-tag: ${e.message} -- nothing tagged`);
    process.exit(2);
  }

  if (argv.includes('--json')) console.log(JSON.stringify(p, null, 2));
  else {
    const note = p.origin === 'inherited' ? ' [version INHERITED, not set by this commit]'
      : p.origin === 'unknown' ? ' [whether this commit set the version is UNDETERMINED]' : '';
    const kind = p.kind === 'patch' ? ' [patch version: a commit, not a release]' : ` [${p.kind} release]`;
    console.log(`release-tag: ${ref} (${p.sha.slice(0, 8)}) carries ${p.version} -> ${p.tag}${kind}${p.exists ? ' [already tagged]' : ''}${note}`);
  }

  if (!argv.includes('--tag')) return;
  if (p.kind === 'patch') {
    console.error(`release-tag: ${p.version} is a patch version, which every commit carries -- a release is a commit that sets the minor or major by hand (docs/RELEASING.md); nothing tagged`);
    process.exit(2);
  }
  if (p.exists) {
    console.error(`release-tag: ${p.tag} already exists and is NEVER moved -- a moved tag changes what a published feed entry points at`);
    process.exit(1);
  }
  git(['tag', '-a', p.tag, p.sha, '-m', `commitwork ${p.version}`]);
  console.log(`release-tag: created ${p.tag} at ${p.sha.slice(0, 8)} -- push it with: git push origin ${p.tag}`);
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
