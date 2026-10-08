#!/usr/bin/env node
// monitor/observables.mjs — the corpus. What the fleet's dependency manifests actually NAME.
//
// WHY THIS EXISTS. monitor/indicators.mjs can match an indicator set against a corpus and
// monitor/lookalike.mjs can compare a name against a declared-legitimate set, and on the day they
// were written neither had a corpus to be pointed at. A matcher with no input is the shape this
// repository names most often: built, tested, fed by nothing. This is the feeder, and the question
// it answers is deliberately narrow — what names, URLs, hosts and digests does this fleet's
// dependency graph assert?
//
// THE ANSWER IS INTERESTING ON ITS OWN, BEFORE ANY INDICATOR IS APPLIED. A lockfile's `resolved`
// field is a claim about where a byte-exact artifact came from. Across a fleet those claims should
// concentrate on a very small number of registry hosts, and every entry that does not is either a
// deliberate vendored dependency or the exact shape of a supply-chain substitution. Nothing here
// judges which; the host distribution is published and a human reads it.
//
// FAIL CLOSED, AND THE ECOSYSTEMS WITH NO EXTRACTOR ARE DECLARED RATHER THAN SILENT. A repo that
// yields zero observables because its ecosystem was never parsed is indistinguishable from one
// that genuinely declares nothing, unless somebody says which. So DECLARED_VOIDS names each
// unextracted ecosystem and why, every repo's voids travel in its result, and fleet coverage is a
// monitor/denominator.mjs claim.
//
// THE VOIDS LIST IS MEANT TO SHRINK, AND ARGUING WITH IT IS HOW. On 2026-08-26 four entries came
// off it. pnpm was there because YAML needs a parser this project will not take a dependency for —
// true of GENERAL YAML, and beside the point for a generated file whose dialect is narrow enough
// to read one section of and refuse the rest. build.gradle was there because resolution means
// execution — true of build.gradle, and misleading about the ecosystem, since 17 of 29 JVM repos
// commit an already-resolved gradle.lockfile. Gemfile.lock and composer.lock were there because
// nobody had written them. A void's reason has to survive being read again later; three of those
// four did not.
//
// What the list must never become is a place to park an ecosystem because reading it properly is
// awkward. The bar for half-reading one is set by what this project has already paid for: a
// scanner that read a v3 lockfile, found no top-level `dependencies`, extracted ZERO packages and
// exited 0 — 158 runs that recorded clean trees.
//
// THAT DEFECT IS THE REASON FOR THE NON-VACUITY ASSERTIONS. npm's three lockfile generations put
// the package graph in different places: v1 in `dependencies{}`, v3 in `packages{}`, v2 in both.
// An extractor that handles one and returns [] for the others does not fail — it succeeds
// quietly, which is worse. Every npm-lock fixture in the test file asserts a non-zero extraction.
//
// usage: node monitor/observables.mjs [--json] [--hosts] [--area <slug>] [repoDir ...]
//   env: CW_OBSERVABLES_OUT   artifact path (default reports/observables.json)
//        CW_OBSERVABLES_CAP   per-repo observable cap (default 5000; remainder COUNTED)
//        CW_NOW               pins `generated`

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './lockfile.mjs';
import { unknown } from './unknown.mjs';
import { OBSERVABLE } from './indicators.mjs';
import { claim, render as renderClaim } from './denominator.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const isMain = isMainModule(import.meta.url);

const DEFAULT_CAP = 5000;

/**
 * Ecosystems present in this fleet that this module deliberately does NOT extract, each with the
 * reason. Counted per repo and published; never silently skipped.
 *
 * The rule for adding one: an ecosystem belongs here when extracting it honestly would require
 * either a parser this project will not take a dependency for, or a resolution step (i.e. running
 * the ecosystem's own tooling) that turns a read into an execution. Both are real reasons. "It
 * would have been fiddly" is not, and neither is "it would have lowered the coverage number".
 */
export const DECLARED_VOIDS = Object.freeze({
  // pnpm-lock.yaml was here until 2026-08-26. It is now READ, by a restricted reader that refuses
  // rather than approximates — see the pnpm section above. The original objection stands for a
  // GENERAL YAML parser and was the right instinct; what it missed is that the file is generated,
  // so its dialect is narrow enough to target one section and refuse the rest.
  'build.gradle': 'declares dependency RANGES and repositories, not a resolved graph. Extracting '
    + 'names without versions yields observables that cannot be matched against a version-bearing '
    + 'advisory; resolving them means running gradle, which evaluates build logic. NOTE (2026-08-26): '
    + 'this is still true of build.gradle and was misleading about the ECOSYSTEM — 17 of the 29 JVM '
    + 'repos here commit a gradle.lockfile, which IS resolved and is now extracted. A repo listing '
    + 'this void without also yielding gradle.lockfile observables is one of the 12 that genuinely '
    + 'needs a resolver run.',
  'build.gradle.kts': 'the Kotlin DSL form of build.gradle, and the same objection: ranges plus '
    + 'repositories rather than a resolved graph, and resolving means executing the build script.',
  'pom.xml': 'the EFFECTIVE POM is what names versions, and producing it needs Maven to resolve '
    + 'parent POMs, dependencyManagement and property interpolation. A raw read of this file misses '
    + 'every inherited and managed version, which is most of them on a real project.',
  'pyproject.toml': 'TOML, no parser, and it declares ranges rather than a resolved set. Repos '
    + 'that also ship requirements.txt or a uv.lock are covered through those.',
  'Package.swift': 'Swift source that SwiftPM compiles and runs to produce the manifest — reading '
    + 'it is parsing a program, and it declares ranges. The resolved graph lives in '
    + 'Package.resolved, which IS read. All three fleet Swift repos carry this file without a '
    + 'Package.resolved (measured 2026-08-26): preflight classifies them blind, and this void row '
    + 'is the corroborating witness from the corpus side.',
  'CMakeLists.txt': 'a build program, not a dependency declaration — find_package() names '
    + 'system-resolved dependencies with no versions and no registry, and nothing in the world '
    + 'can match them to an advisory. The conan/vcpkg faces of a C++ tree are read; this one is '
    + 'the no-advisory-db fact the coverage manifest declares.',
  'cabal.project': 'declares source layout and OPTIONAL constraints, not a resolved set — the '
    + 'freeze file (cabal.project.freeze) is the resolved face and is read.',
  'conanfile.py': 'a Python program Conan executes to produce the dependency graph — reading it '
    + 'is parsing a program. conan.lock is the resolved face and is read; osv-scanner rejects '
    + 'this file too (probed 2026-08-26).',
});

// ── extractors ──────────────────────────────────────────────────────────────────────────────────
// Each takes (text, where) and returns { observables, note? } or an unknown(). None of them throws
// on malformed input: a manifest that will not parse is an unknown with a reason, because an
// exception here would take out the whole repo's extraction and read as a repo with no
// dependencies.

/**
 * PROVENANCE TIER. Every observable says how strongly this fleet knows it.
 *
 *   declared  read out of a file the repository COMMITTED. A lockfile entry is a claim its authors
 *             made and can be held to.
 *   derived   read out of an artifact a TOOL produced about the repository. A syft purl is an
 *             inference from whatever syft could see at scan time — real, useful, and a weaker
 *             thing than a committed claim.
 *
 * The tier exists so the two can never be summed into one number. Deriving observables from
 * scanner output is how the ecosystems nobody can parse directly get covered at all, and it would
 * be worth very little if the resulting corpus were indistinguishable from the lockfile-backed
 * one — "we know this package is here" and "a tool thought it saw this package" answer different
 * questions and a reader must be able to tell which they are getting.
 */
export const TIER = Object.freeze({ DECLARED: 'declared', DERIVED: 'derived' });

const obs = (type, value, where, tier = TIER.DECLARED) => ({ type, value, where, tier });

/** Hosts and package identity from a `resolved` URL, so a registry substitution is visible. */
function fromResolvedUrl(url, where, out) {
  if (typeof url !== 'string' || !url) return;
  // `file:` and bare paths are local links, not fetches — they name no host and assert no origin.
  if (/^(file:|link:|portal:)/.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url)) return;
  out.push(obs(OBSERVABLE.URL, url, where));
  try {
    const h = new URL(url).hostname;
    if (h) out.push(obs(OBSERVABLE.DOMAIN, h.toLowerCase(), where));
  } catch { /* an unparseable URL is still recorded above, as the URL it claims to be */ }
}

/**
 * PROVENANCE COUNTERS, and the measurement that forced them.
 *
 * A host distribution published without a denominator is the defect monitor/denominator.mjs exists
 * to prevent, and this module shipped with it. Measured on AlkaidLab_foundation-sunshine
 * 2026-08-26: 359 lock entries, of which 85 assert registry.npmjs.org, 47 assert
 * registry.npmmirror.com — and 227 assert NOTHING. No `resolved`, no `integrity`, just a version
 * and a licence. Sixty-three per cent of that lockfile pins no bytes at all, which is a larger
 * fact about it than which registry the other thirty-seven per cent names, and the module reported
 * only the latter.
 *
 * So every extractor now counts three things per manifest: how many packages it saw, how many
 * asserted an ORIGIN, and how many asserted a DIGEST. The two are separate on purpose — an origin
 * says where bytes came from and a digest says which bytes they were, and a lockfile can carry
 * either without the other.
 */
const newProv = (canOrigin = true, canDigest = true) => ({ packages: 0, withOrigin: 0, withDigest: 0, canOrigin, canDigest });

/**
 * CANNOT IS NOT DID-NOT, and the first version of this ranking got it wrong in the direction that
 * matters. Ranking repos by origin coverage put seventeen at 0.0% — every one of them a repo whose
 * only manifest is package.json, a format that carries no origin and no digest for anybody. They
 * are not badly provenanced; they are unprovenance-ABLE, and listing them as the worst offenders
 * buried AlkaidLab_foundation-sunshine at 34.9%, which is the one where a format that CAN pin
 * bytes did not.
 *
 * So coverage is computed over the provenance-capable population only, and the incapable one is
 * reported as its own number. Same rule as every other unknown here: an absence a format cannot
 * express is not a failure to express it.
 */
const capableOrigin = (p) => (p.canOrigin ? p.packages : 0);
const capableDigest = (p) => (p.canDigest ? p.packages : 0);

/** The aggregate shape. Distinct from newProv: a repo or a fleet has no single capability, it has
 *  a mix, so it carries the capable POPULATIONS rather than two booleans. */
const newAccum = () => ({ packages: 0, withOrigin: 0, withDigest: 0, originCapable: 0, digestCapable: 0 });

/** npm SRI: `sha512-<base64>`. The algorithm prefix is load-bearing; a bare digest loses it. */
function fromIntegrity(integrity, where, out) {
  if (typeof integrity !== 'string') return;
  for (const part of integrity.split(/\s+/).filter(Boolean)) {
    const m = /^(sha512|sha256|sha1)-(.+)$/.exec(part);
    if (!m) continue;
    const type = m[1] === 'sha512' ? OBSERVABLE.SHA512 : m[1] === 'sha256' ? OBSERVABLE.SHA256 : OBSERVABLE.SHA1;
    out.push(obs(type, m[2], where));
  }
}

/** The npm package name from a `node_modules/...` lock key, scopes preserved. */
export function npmNameFromPath(key) {
  const i = key.lastIndexOf('node_modules/');
  return i < 0 ? key : key.slice(i + 'node_modules/'.length);
}

/**
 * package-lock.json, ALL THREE generations.
 *   v1  the graph lives in `dependencies{}`, nested, keyed by name
 *   v3  the graph lives in `packages{}`, flat, keyed by install path
 *   v2  BOTH are present and describe the same graph
 * v2 is read through `packages` because it is the flat authoritative one; reading both would
 * double every observable and inflate every count that follows.
 */
export function extractNpmLock(text, where) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return unknown('unparseable', `${where}: ${e.message}`); }

  const out = [];
  const prov = newProv();              // npm locks can carry both, so a gap here is a real gap
  const version = Number(j.lockfileVersion ?? 0);
  // A `file:`/`link:` specifier is a local path, not an origin claim — counting it as one would
  // report a workspace as provenanced.
  const assertsOrigin = (u) => typeof u === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(u) && !/^(file:|link:|portal:)/.test(u);

  if (j.packages && typeof j.packages === 'object') {
    for (const [key, node] of Object.entries(j.packages)) {
      if (!node || typeof node !== 'object') continue;
      if (key === '') continue;                       // the root project, not a dependency
      const name = node.name || npmNameFromPath(key);
      if (name) { out.push(obs(OBSERVABLE.PACKAGE, name, where)); prov.packages += 1; }
      if (assertsOrigin(node.resolved)) prov.withOrigin += 1;
      if (typeof node.integrity === 'string' && node.integrity) prov.withDigest += 1;
      fromResolvedUrl(node.resolved, where, out);
      fromIntegrity(node.integrity, where, out);
    }
  } else if (j.dependencies && typeof j.dependencies === 'object') {
    // v1: recurse, because a transitive dependency is exactly what a squat hides in.
    const walk = (deps) => {
      for (const [name, node] of Object.entries(deps || {})) {
        if (!node || typeof node !== 'object') continue;
        out.push(obs(OBSERVABLE.PACKAGE, name, where));
        prov.packages += 1;
        if (assertsOrigin(node.resolved)) prov.withOrigin += 1;
        if (typeof node.integrity === 'string' && node.integrity) prov.withDigest += 1;
        fromResolvedUrl(node.resolved, where, out);
        fromIntegrity(node.integrity, where, out);
        if (node.dependencies) walk(node.dependencies);
      }
    };
    walk(j.dependencies);
  } else {
    // A lockfile with neither is either empty or a generation this function does not know. Those
    // are DIFFERENT, and the difference is the whole GuardDog lesson, so say which.
    return unknown('unstated',
      `${where}: lockfileVersion ${version || 'unstated'} has neither packages{} nor dependencies{} — `
      + 'this is not a tree with no dependencies, it is a shape this extractor does not read');
  }
  return { observables: out, provenance: prov, note: `lockfileVersion ${version || 'unstated'}` };
}

/** package.json — names only. No versions are resolved and no origin is asserted, so it feeds
 *  lookalike.mjs and contributes nothing an advisory could match. Said plainly in `note`. */
export function extractPackageJson(text, where) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return unknown('unparseable', `${where}: ${e.message}`); }
  const out = [];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = j[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const name of Object.keys(deps)) out.push(obs(OBSERVABLE.PACKAGE, name, where));
  }
  // Zero origin, zero digest, and that is a property of the FORMAT rather than of this project's
  // hygiene — package.json never carries either. The counters say so rather than leaving a reader
  // to infer it from a note.
  return {
    observables: out,
    // canOrigin/canDigest FALSE: package.json cannot express either, for anybody. See newProv.
    provenance: { packages: out.length, withOrigin: 0, withDigest: 0, canOrigin: false, canDigest: false },
    note: 'declared names only — no resolved version, no origin',
  };
}

/** go.mod `require` blocks and single-line requires. Module paths ARE hostnames plus a path, so
 *  the host is extracted too: `github.com/x/y` names github.com as the origin of that code. */
export function extractGoMod(text, where) {
  const out = [];
  const prov = newProv(true, false);   // the module path IS the origin; digests live in go.sum, unread
  let inBlock = false;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) continue;
    if (/^require\s*\($/.test(line)) { inBlock = true; continue; }
    if (inBlock && line === ')') { inBlock = false; continue; }
    const m = inBlock
      ? /^([^\s]+)\s+(v[^\s]+)/.exec(line)
      : /^require\s+([^\s]+)\s+(v[^\s]+)/.exec(line);
    if (!m) continue;
    const [, mod] = m;
    out.push(obs(OBSERVABLE.PACKAGE, mod, where));
    prov.packages += 1;
    const host = mod.split('/')[0];
    // A Go module path IS its origin — `github.com/x/y` names the host in the coordinate itself,
    // so origin coverage here is structural rather than a property of how carefully the file was
    // written. Digests live in go.sum, which this extractor does not read, so withDigest stays 0
    // and says so rather than implying Go modules are unpinned.
    if (host.includes('.')) { out.push(obs(OBSERVABLE.DOMAIN, host.toLowerCase(), where)); prov.withOrigin += 1; }
  }
  return { observables: out, provenance: prov, note: 'digests live in go.sum, which this extractor does not read' };
}

/** Cargo.lock — TOML, but the `[[package]]` block is regular enough to read line-wise without a
 *  parser. `source` names the registry; `checksum` is a sha256. */
export function extractCargoLock(text, where) {
  const out = [];
  const prov = newProv();
  let cur = null;
  const flush = () => {
    if (!cur || !cur.name) return;
    out.push(obs(OBSERVABLE.PACKAGE, cur.name, where));
    prov.packages += 1;
    if (cur.checksum) { out.push(obs(OBSERVABLE.SHA256, cur.checksum, where)); prov.withDigest += 1; }
    if (cur.source) { fromResolvedUrl(cur.source.replace(/^registry\+/, '').replace(/^git\+/, ''), where, out); prov.withOrigin += 1; }
    cur = null;
  };
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (line === '[[package]]') { flush(); cur = {}; continue; }
    if (line.startsWith('[') && line !== '[[package]]') { flush(); continue; }
    if (!cur) continue;
    const m = /^(name|source|checksum)\s*=\s*"(.*)"$/.exec(line);
    if (m) cur[m[1]] = m[2];
  }
  flush();
  // A path-only crate legitimately asserts neither, so a Cargo.lock is never expected to reach 100%.
  return { observables: out, provenance: prov };
}

/** requirements.txt — names, and any direct URL a line pins to. */
export function extractRequirements(text, where) {
  const out = [];
  // canOrigin FALSE, and this is a judgement rather than a fact about the grammar. PEP 508's
  // `name @ url` CAN pin an origin, but a requirements.txt names its index in configuration
  // (--index-url, pip.conf) rather than per requirement, so the form is rare. Marking it capable
  // put three ordinary Python repos at 0.0% and back at the top of the worst-first list — the same
  // burying that the package.json fix had just removed. Direct-URL requirements are still
  // extracted as URL observables; they are just not counted as a coverage denominator.
  const prov = newProv(false, false);
  for (const raw of String(text).split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line || /^-/.test(line)) continue;             // -r, -e, --index-url etc.
    const at = /^([A-Za-z0-9._-]+)\s*@\s*(\S+)$/.exec(line);
    if (at) {
      out.push(obs(OBSERVABLE.PACKAGE, at[1], where));
      prov.packages += 1; prov.withOrigin += 1;
      fromResolvedUrl(at[2], where, out);
      continue;
    }
    if (/^https?:\/\//.test(line)) { fromResolvedUrl(line, where, out); continue; }
    const m = /^([A-Za-z0-9._-]+)(\[[^\]]*\])?\s*(?:[=<>!~]{1,2}.*)?$/.exec(line);
    if (m) { out.push(obs(OBSERVABLE.PACKAGE, m[1], where)); prov.packages += 1; }
  }
  // A plain requirements.txt names an index in configuration, not per requirement, so origin
  // coverage is near zero by construction. `--hash=` pins exist but are rare and unread here.
  return { observables: out, provenance: prov, note: 'index is configuration, not per-requirement; --hash pins are not read' };
}

/**
 * yarn.lock v1. Berry (v2+) is YAML and is NOT read here — its entries look superficially similar,
 * which is exactly why the version is checked rather than assumed: silently reading half a Berry
 * lockfile would produce a partial corpus wearing a complete one's clothes.
 */
export function extractYarnLock(text, where) {
  const s = String(text);
  if (/^__metadata:/m.test(s)) {
    return unknown('unexaminable',
      `${where}: yarn Berry (v2+) lockfile — YAML, not the v1 format this reads. Declared unread `
      + 'rather than partially read.');
  }
  const out = [];
  const prov = newProv();
  for (const raw of s.split('\n')) {
    const line = raw.trim();
    const res = /^resolved\s+"?([^"\s]+)"?$/.exec(line);
    if (res) { fromResolvedUrl(res[1].split('#')[0], where, out); prov.withOrigin += 1; continue; }
    const integ = /^integrity\s+(\S+)$/.exec(line);
    if (integ) { fromIntegrity(integ[1], where, out); prov.withDigest += 1; continue; }
    // Entry headers: `"pkg@^1.0.0", "pkg@~1.2.0":` or `pkg@^1.0.0:`
    if (!raw.startsWith(' ') && raw.trimEnd().endsWith(':') && !raw.startsWith('#')) {
      // One ENTRY may list several specs for one package; provenance counts entries, because a
      // `resolved` line belongs to the entry rather than to each alias of it.
      prov.packages += 1;
      for (const spec of raw.trimEnd().slice(0, -1).split(',')) {
        const t = spec.trim().replace(/^"|"$/g, '');
        const at = t.lastIndexOf('@');
        if (at > 0) out.push(obs(OBSERVABLE.PACKAGE, t.slice(0, at), where));
      }
    }
  }
  return { observables: out, provenance: prov };
}

// ── SBOM-derived observables ────────────────────────────────────────────────────────────────────
//
// THE SECOND SOURCE, FOR THE ECOSYSTEMS NOBODY CAN PARSE DIRECTLY. gradle, maven and unlocked
// pyproject repos need their own resolver run to name a dependency, and running one means
// executing build logic. But the fleet ALREADY runs syft over every repo and writes
// `sbom-syft.json`, and syft has done exactly that resolution. Reading its output converts "we
// cannot read this ecosystem" into "we read it at lower provenance, through a tool that already
// resolved it".
//
// MEASURED BEFORE BEING BELIEVED, and the measurement is why this covers pypi and not maven.
// Across the fleet's SBOMs on 2026-08-26: reflex-dev_reflex pypi:187, langchain-ai_open-swe
// pypi:168, npm and golang well represented — and maven exactly 1 component, on the single repo
// that had any at all. So this closes the 19 pyproject.toml repos and does approximately nothing
// for the 29 gradle/maven ones, which stay a declared void. Presenting `maven:1` as JVM coverage
// would be the more comfortable claim and a false one.
//
// EVERYTHING FROM HERE IS TIER `derived`. See TIER above.

/** `pkg:npm/%40scope/name@1.0.0` -> { ecosystem, name }. Returns null for a purl it cannot read. */
export function parsePurl(purl) {
  const m = /^pkg:([a-zA-Z0-9._-]+)\/(.+?)(?:@([^?#]*))?(?:[?#].*)?$/.exec(String(purl || ''));
  if (!m) return null;
  const [, ecosystem, rawName] = m;
  let name = decodeURIComponent(rawName);
  // npm scopes arrive percent-encoded; a maven purl is group/artifact and joins with a colon,
  // matching the coordinate shape gradle.lockfile already produces so the two agree.
  if (ecosystem === 'maven') name = name.replace('/', ':');
  return { ecosystem: ecosystem.toLowerCase(), name };
}

/**
 * Ecosystems worth taking from an SBOM. `github` is excluded deliberately: those components are
 * GitHub Actions used by workflows, not dependencies of the software, and folding them into a
 * package corpus would put `actions/checkout` beside `left-pad` as though they were the same kind
 * of claim.
 */
// Widened 2026-08-27: pub/hex/swift/cocoapods/conan/hackage were being counted `excluded` and
// dropped, so syft's claimed Swift/Dart/Elixir/Haskell/C++ cataloger coverage reached nothing
// downstream — the corpus said "npm-family only" while the SBOMs on disk said otherwise. They
// arrive at tier `derived` like every SBOM observable, which is the tier that exists so they can
// never sum with `declared`. An ecosystem admitted here and never advisory-checked stays visible
// as such through coverage-manifest's rows, not through this set.
export const SBOM_ECOSYSTEMS = Object.freeze(new Set(['pypi', 'maven', 'golang', 'npm', 'gem', 'cargo', 'composer', 'nuget',
  'pub', 'hex', 'swift', 'cocoapods', 'conan', 'hackage']));

/**
 * Read a CycloneDX SBOM. Only components carrying a purl in a declared ecosystem are taken; a
 * component syft could not give a purl is counted as unnamed rather than guessed at from `name`.
 */
export function extractSyftSbom(text, where) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return unknown('unparseable', `${where}: ${e.message}`); }
  const components = j.components || j.artifacts;
  if (!Array.isArray(components)) {
    return unknown('unstated', `${where}: no components[] — not a CycloneDX document this reader knows`);
  }

  const out = [];
  const prov = newProv(false, false);   // an SBOM asserts neither an origin URL nor a digest here
  const byEcosystem = {};
  let unnamed = 0;
  let excluded = 0;

  for (const c of components) {
    const p = parsePurl(c && c.purl);
    if (!p) { unnamed += 1; continue; }
    if (!SBOM_ECOSYSTEMS.has(p.ecosystem)) { excluded += 1; continue; }
    out.push(obs(OBSERVABLE.PACKAGE, p.name, where, TIER.DERIVED));
    prov.packages += 1;
    byEcosystem[p.ecosystem] = (byEcosystem[p.ecosystem] || 0) + 1;
  }

  return {
    observables: out,
    provenance: prov,
    byEcosystem,
    unnamed,
    excluded,
    note: `tier=derived — syft's resolution, not a committed claim${unnamed ? `; ${unnamed} component(s) carried no purl` : ''}`,
  };
}

// ── declarative JSON lockfiles ──────────────────────────────────────────────────────────────────
//
// CAN THESE BE GENERATED RATHER THAN HAND-ROLLED? Partly, and the split is worth stating because
// it is not the split you would guess.
//
// It is NOT schema-driven. composer.lock has no published JSON Schema, and neither do most
// lockfiles; the ones that exist describe the file's shape, not which field is a package name and
// which is an origin. A schema cannot tell you that `dist.url` means provenance — that is a
// judgement about meaning, and it has to be written down by someone either way.
//
// What IS mechanisable is everything after that judgement. For a lockfile that is regular JSON —
// arrays of objects with a name field, an origin field and a digest field — the extractor is
// entirely determined by four paths. So those four paths are DATA here, and one generic function
// walks them. A new JSON lockfile becomes a table entry rather than a function, and every such
// format is then reviewable side by side instead of as five similar-looking loops.
//
// This is not speculative generality: composer.lock, Pipfile.lock and deno.lock all have this
// shape, and package-lock.json deliberately does NOT — its three generations put the graph in
// different places and nest it, which is exactly the kind of irregularity that a declarative table
// cannot express and should not pretend to. Formats that need real parsing (Gemfile.lock's
// indented grammar, Cargo's TOML, pnpm's YAML) keep their own functions and are longer for it.

/** Read a dotted path out of an object, returning undefined rather than throwing on a gap. */
const getPath = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * The declarative table. `arrays` are the top-level keys holding package arrays; `origin` and
 * `digest` are ordered candidate paths, first match wins.
 */
export const JSON_LOCK_SPECS = Object.freeze({
  'composer.lock': {
    arrays: ['packages', 'packages-dev'],
    name: 'name',
    // dist is the artifact actually installed; source is the repository it was built from. dist
    // first, because provenance means where the BYTES came from.
    origin: ['dist.url', 'source.url'],
    digest: [{ path: 'dist.shasum', algo: OBSERVABLE.SHA1 }],
    canOrigin: true,
    canDigest: true,
    // Composer writes `"shasum": ""` for most packages — an empty string is not a digest, and the
    // filter below drops it rather than counting a blank as coverage.
    note: 'dist.shasum is frequently empty in real files; blanks are not counted as digests',
  },
  // SwiftPM v2 (`pins` at top level). The v1 shape nests object.pins and this table cannot reach
  // it — a v1 file therefore reads `unstated`, which is the honest refusal, not a parse. The
  // pinned `state.revision` is the git commit actually resolved: a real 40-hex identity of the
  // bytes fetched, recorded as SHA1.
  'Package.resolved': {
    arrays: ['pins'],
    name: 'identity',
    origin: ['location'],
    digest: [{ path: 'state.revision', algo: OBSERVABLE.SHA1 }],
    canOrigin: true,
    canDigest: true,
    note: 'v2 pins only; a v1 object.pins file refuses as unstated rather than being half-read',
  },
});

/** One extractor for every entry in JSON_LOCK_SPECS. */
export function extractByJsonSpec(spec, text, where) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return unknown('unparseable', `${where}: ${e.message}`); }

  const present = spec.arrays.filter((k) => Array.isArray(j[k]));
  if (!present.length) {
    return unknown('unstated',
      `${where}: none of ${spec.arrays.join(', ')} is an array — this is a shape the declared spec does not describe, `
      + 'not a lockfile with no packages');
  }

  const out = [];
  const prov = newProv(spec.canOrigin, spec.canDigest);
  for (const key of present) {
    for (const node of j[key]) {
      if (!node || typeof node !== 'object') continue;
      const name = getPath(node, spec.name);
      if (!name) continue;
      out.push(obs(OBSERVABLE.PACKAGE, String(name), where));
      prov.packages += 1;

      for (const p of spec.origin || []) {
        const url = getPath(node, p);
        if (typeof url === 'string' && url) { fromResolvedUrl(url, where, out); prov.withOrigin += 1; break; }
      }
      for (const d of spec.digest || []) {
        const v = getPath(node, d.path);
        // An empty string is not a digest. Counting one would report provenance a file never made.
        if (typeof v === 'string' && v.trim()) { out.push(obs(d.algo, v.trim(), where)); prov.withDigest += 1; break; }
      }
    }
  }
  return { observables: out, provenance: prov, ...(spec.note ? { note: spec.note } : {}) };
}

/**
 * Gemfile.lock — and the counter-example to the paragraph above. It is a bespoke indented grammar,
 * so there is nothing to generate from and it gets a real parser:
 *
 *   GEM                          section type: GEM | GIT | PATH | PLUGIN
 *     remote: https://rubygems.org/     the section's ORIGIN, one per section
 *     specs:
 *       addressable (2.9.0)             4 spaces: a resolved package
 *         public_suffix (>= 2.0.2)      6 spaces: that package's CONSTRAINTS, not a resolution
 *
 * The indentation distinction is load-bearing. A six-space line names a dependency and a version
 * RANGE; reading it as a package mints entries like `public_suffix (>= 2.0.2, < 8.0)` and roughly
 * triples the count with things that were never resolved.
 *
 * canDigest is false: this format carries no checksums. Newer bundler can emit a CHECKSUMS section
 * and neither file in this fleet has one, so it is unread and unclaimed rather than assumed absent.
 */
export function extractGemfileLock(text, where) {
  const out = [];
  const prov = newProv(true, false);
  let remote = null;
  let inSpecs = false;

  for (const raw of String(text).split('\n')) {
    if (!raw.trim()) { inSpecs = false; continue; }
    if (/^\S/.test(raw)) { remote = null; inSpecs = false; continue; }   // a new section header

    const rem = /^ {2}remote:\s*(\S+)\s*$/.exec(raw);
    if (rem) { remote = rem[1]; continue; }
    if (/^ {2}specs:\s*$/.test(raw)) { inSpecs = true; continue; }
    if (!inSpecs) continue;

    // Exactly four spaces: a resolved gem. Five or more: its constraints.
    const spec = /^ {4}(\S+) \(([^)]+)\)\s*$/.exec(raw);
    if (!spec) continue;
    out.push(obs(OBSERVABLE.PACKAGE, spec[1], where));
    prov.packages += 1;
    if (remote) { fromResolvedUrl(remote, where, out); prov.withOrigin += 1; }
  }
  return { observables: out, provenance: prov, note: 'no checksums in this format; a CHECKSUMS section, if present, is unread' };
}

// ── pnpm ────────────────────────────────────────────────────────────────────────────────────────
//
// NOT A YAML PARSER, AND DELIBERATELY NOT ONE. YAML 1.2 is large — anchors, aliases, merge keys,
// block scalars, tags, multi-document streams, flow collections at arbitrary depth — and a general
// parser written to zero dependencies would be a large piece of subtle code whose failures are
// silent. What is actually needed here is one section of one generated file, so this reads THAT
// and refuses everything else.
//
// THE SUBSET WAS MEASURED, NOT ASSUMED, and measuring corrected it twice.
//   * A first survey for exotic constructs came back empty and would have justified a much looser
//     reader. It was wrong: it only matched line-LEADING flow, and pnpm uses 44,640 inline flow
//     mappings across this fleet — `resolution: {integrity: sha512-…}` is the payload, not an edge
//     case.
//   * Refusing flow SEQUENCES would have rejected every modern lockfile: `os: [linux]` and
//     `cpu: [x64]` appear 1,960 and 1,435 times. They are platform constraints this module does
//     not read, so they are tolerated and ignored rather than refused.
//   * Refusing a leading `---` would have rejected bluesky-social_atproto, a perfectly ordinary
//     v9 lockfile that happens to open with a document marker.
// Each of those would have been a defensible-sounding rule that silently lost real repos.
//
// WHAT IT REFUSES, AND WHY REFUSING IS THE POINT. Anchors, aliases, merge keys, block scalars, a
// SECOND document, and nested flow mappings all make the file mean something this reader cannot
// see. On any of them the whole file becomes an `unknown` and the repo joins the void list. That
// is the difference between this and an approximation: a construct it does not understand costs a
// declared gap, never a quietly shorter corpus.

const PNPM_UNSUPPORTED = [
  [/(^|\s):?\s*&[A-Za-z0-9_-]+(\s|$)/m, 'anchor'],
  [/(^|\s)\*[A-Za-z0-9_-]+\s*$/m, 'alias'],
  [/^\s*<<\s*:/m, 'merge key'],
  [/^%[A-Z]/m, 'directive'],
];

/**
 * Block scalars and multi-document streams are HANDLED rather than refused, because refusing them
 * cost two real repos out of fourteen and both losses were avoidable.
 *
 *   logseq_logseq            one `deprecated: |-` on line 4138. A block scalar on a field this
 *                            module never reads.
 *   bluesky-social_atproto   two `---` markers. A genuine multi-document stream.
 *
 * A blanket refusal was the right FIRST move — it is the safe direction, and it is how both files
 * were found at all rather than being silently half-read. But "we cannot read this" should cost a
 * repo only when it is true. A block scalar under a key we ignore changes nothing we consume; a
 * second document matters only if it, too, holds a `packages:` block.
 *
 * The narrow refusals remain: a block scalar as a `resolution` value would hide the payload, and
 * two documents both declaring `packages:` is genuinely ambiguous. Both still refuse.
 */
function stripBlockScalars(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)([^\s:][^:]*):\s*[|>][-+0-9]*\s*$/.exec(lines[i]);
    if (!m) { out.push(lines[i]); continue; }
    if (m[2].trim() === 'resolution') return null;     // would hide the payload — caller refuses
    const indent = m[1].length;
    out.push(`${m[1]}${m[2]}: ''`);                    // keep the key, drop the block
    // Consume the block: everything more-indented than the key, blanks included.
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || (lines[j].match(/^\s*/)[0].length > indent))) j += 1;
    i = j - 1;
  }
  return out;
}

/** A SINGLE-LEVEL inline flow mapping: `{a: b, c: d}`. Nested flow is refused, not flattened. */
export function parsePnpmFlowMapping(body) {
  if (body.includes('{')) return null;                 // nested — caller must refuse
  const out = {};
  for (const part of body.split(',')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    if (k) out[k] = v;
  }
  return out;
}

/**
 * A pnpm v9 packages key is `name@version`, optionally with a parenthesised peer suffix:
 *   '@babel/core@7.24.0'          -> @babel/core
 *   'foo@1.0.0(react@18.0.0)'     -> foo
 * The peer suffix is stripped FIRST — otherwise the last `@` lands inside it and the name comes
 * back as `foo@1.0.0(react`.
 */
export function pnpmPackageName(key) {
  const noPeer = String(key).replace(/\(.*\)$/, '');
  const at = noPeer.lastIndexOf('@');
  return at > 0 ? noPeer.slice(0, at) : noPeer;
}

/**
 * Read the `packages:` block of a pnpm-lock.yaml. Everything else in the file — importers,
 * snapshots, settings, catalogs — is skipped: `packages` is the one section that names a resolved
 * artifact and its integrity, which is what a corpus needs.
 */
export function extractPnpmLock(text, where) {
  const s = String(text);
  for (const [re, what] of PNPM_UNSUPPORTED) {
    if (re.test(s)) {
      return unknown('unexaminable',
        `${where}: uses a YAML ${what}, which this restricted reader does not implement. `
        + 'Declared unread rather than partially read.');
    }
  }
  // Select the document that declares `packages:`. One is the normal case; a leading `---` on a
  // single document is also normal (bluesky-social_atproto opens with one).
  const docs = s.split(/^---\s*$/m).filter((d) => d.trim());
  const withPackages = docs.filter((d) => /^packages:\s*$/m.test(d));
  if (withPackages.length > 1) {
    return unknown('unexaminable',
      `${where}: ${withPackages.length} documents each declare a \`packages:\` block — which one is authoritative is not this reader's call`);
  }
  const doc = withPackages[0] ?? docs[docs.length - 1] ?? s;

  const lines = stripBlockScalars(doc.split('\n'));
  if (lines === null) {
    return unknown('unexaminable', `${where}: a \`resolution\` is written as a block scalar — refused rather than half-read`);
  }
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  if (start < 0) {
    // v9 always emits it. Its absence means a generation or shape this reader does not know —
    // which is not the same as a lockfile with no packages, and must not read as one.
    return unknown('unstated',
      `${where}: no top-level \`packages:\` block — this reader targets pnpm v9 and this is a shape it does not know`);
  }

  const out = [];
  const prov = newProv(true, true);
  let current = null;

  for (let i = start + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    if (/^\S/.test(raw)) break;                        // back to column 0: the section ended

    const entry = /^ {2}(?:'([^']+)'|"([^"]+)"|([^\s:][^:]*)):\s*$/.exec(raw);
    if (entry) {
      current = entry[1] ?? entry[2] ?? entry[3];
      const name = pnpmPackageName(current);
      if (name) { out.push(obs(OBSERVABLE.PACKAGE, name, where)); prov.packages += 1; }
      continue;
    }
    if (!current) continue;

    const res = /^ {4}resolution:\s*\{(.*)\}\s*$/.exec(raw);
    if (!res) continue;
    const map = parsePnpmFlowMapping(res[1]);
    if (map === null) {
      return unknown('unexaminable',
        `${where}: nested flow mapping in a resolution — refused rather than flattened`);
    }
    if (map.integrity) { fromIntegrity(map.integrity, where, out); prov.withDigest += 1; }
    // `tarball` is how a non-registry origin appears — jsr, a private registry, a git tarball.
    // It is the only per-package origin claim pnpm makes; registry packages inherit theirs from
    // configuration, so they are digest-provenanced without being origin-provenanced.
    if (map.tarball) { fromResolvedUrl(map.tarball, where, out); prov.withOrigin += 1; }
  }

  return {
    observables: out,
    // canOrigin false: a registry package's origin lives in .npmrc, not the lockfile, so counting
    // its absence as a failure would mark every ordinary pnpm repo as unprovenanced — the same
    // mistake package.json and requirements.txt each produced once already.
    provenance: { ...prov, canOrigin: false },
    note: 'pnpm v9 packages block; origins appear only for tarball resolutions',
  };
}

/**
 * gradle.lockfile — Gradle's dependency locking output, and the reason the JVM void is much
 * smaller than build.gradle's presence suggests.
 *
 * MEASURED 2026-08-26: 29 JVM repos in this fleet, and 17 of them commit a gradle.lockfile
 * holding 4,006 resolved Maven coordinates between them — more than this module's entire Cargo,
 * requirements and yarn corpus combined. That is a RESOLVED graph, already in the tree, readable
 * with no execution at all. The DECLARED_VOIDS entry for build.gradle was correct about
 * build.gradle and wrong about the ecosystem, because it reasoned from the manifest that needs a
 * resolver instead of looking for the artifact that resolution already produced.
 *
 * Format: three comment lines, then one line per coordinate:
 *   group:artifact:version=configuration[,configuration…]
 * plus a terminal `empty=<configurations>` line naming configurations that resolved to nothing.
 * That last line is NOT a package and is excluded — reading it as one would mint a dependency
 * called `empty` in every JVM repo in the fleet.
 *
 * canDigest is FALSE: a lockfile pins versions, not bytes. Gradle's byte-level verification lives
 * in gradle/verification-metadata.xml, which is a separate file, and claiming digest coverage
 * from this one would assert a guarantee Gradle does not make here.
 */
export function extractGradleLockfile(text, where) {
  const out = [];
  const prov = newProv(true, false);
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const coord = line.slice(0, eq);
    // The `empty=` sentinel names configurations that resolved to nothing. It is a statement about
    // configurations, not a package, and it appears in most real lockfiles.
    if (coord === 'empty') continue;
    const parts = coord.split(':');
    if (parts.length !== 3) continue;
    const [group, artifact] = parts;
    if (!group || !artifact) continue;
    // Maven coordinates are group:artifact — the pair is the identity, and collapsing to the
    // artifact alone would merge unrelated projects that share a short name.
    out.push(obs(OBSERVABLE.PACKAGE, `${group}:${artifact}`, where));
    prov.packages += 1;
    // The origin is Gradle's declared repositories, which live in build.gradle and are NOT read
    // here. So a locked coordinate asserts a version, not a host: origin stays uncounted rather
    // than being attributed to Maven Central by assumption.
  }
  return {
    observables: out,
    provenance: { ...prov, canOrigin: false },
    note: 'versions pinned; repositories are declared in build.gradle and not read, so no origin is claimed',
  };
}

/** The dispatch table. A filename appears here or in DECLARED_VOIDS — never in neither, and the
 *  test beside this file asserts that every manifest kind observed in the fleet is in one of them. */
// ── the 2026-08-27 widening: every RESOLVED format the deps-osv gate fires on ───────────────────
// The deps-osv gate widened to these markers on 2026-08-24 and their extraction was probed
// per-format on 2026-08-26 against the exact image the sweep pulls. This module reading them too
// gives every corpus consumer (indicators, lookalike, advisory-reach, dep-provenance) the same
// breadth, and gives each format a SECOND reader that cannot share osv-scanner's failure mode.
// Only resolved sets are read — the declaring faces (Package.swift, CMakeLists.txt, cabal.project,
// conanfile.py) go to DECLARED_VOIDS with reasons, per the standing rule.

/**
 * NuGet packages.lock.json — nested objects (dependencies.<tfm>.<Name>), so the declarative
 * arrays-table cannot express it, same as package-lock.json. `contentHash` is base64 SHA-512 of
 * the package content (NuGet's own definition), recorded verbatim so an indicator can match the
 * form NuGet publishes. `type: "Project"` entries are project references, not packages.
 */
export function extractNugetLock(text, where) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return unknown('unparseable', `${where}: ${e.message}`); }
  const deps = j && typeof j.dependencies === 'object' && j.dependencies ? j.dependencies : null;
  if (!deps) {
    return unknown('unstated', `${where}: no dependencies{} — not a NuGet lock this reader knows`);
  }
  const out = [];
  const prov = newProv(false, true);   // no origin URL in this format; contentHash is a real digest
  const seen = new Set();              // one package may repeat per target framework
  for (const tfm of Object.values(deps)) {
    if (!tfm || typeof tfm !== 'object') continue;
    for (const [pkgName, node] of Object.entries(tfm)) {
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'Project') continue;
      if (seen.has(pkgName)) continue;
      seen.add(pkgName);
      out.push(obs(OBSERVABLE.PACKAGE, pkgName, where));
      prov.packages += 1;
      if (typeof node.contentHash === 'string' && node.contentHash.trim()) {
        out.push(obs(OBSERVABLE.SHA512, node.contentHash.trim(), where));
        prov.withDigest += 1;
      }
    }
  }
  return { observables: out, provenance: prov };
}

/**
 * conan.lock — both generations. v2 (Conan 2, `version: "0.5"`) lists `requires` as strings of
 * the form `name/version#recipe-revision%timestamp`; v1 nests `graph_lock.nodes.<n>.ref` in the
 * same ref syntax. The recipe revision is a Conan-internal hash of the RECIPE, not a digest of
 * the artifact bytes, so it is deliberately not recorded as one — counting it would report
 * provenance the format never asserted.
 */
export function extractConanLock(text, where) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return unknown('unparseable', `${where}: ${e.message}`); }
  const refs = [];
  if (Array.isArray(j.requires)) refs.push(...j.requires);
  if (Array.isArray(j.build_requires)) refs.push(...j.build_requires);
  const nodes = j.graph_lock && j.graph_lock.nodes;
  if (nodes && typeof nodes === 'object') {
    for (const n of Object.values(nodes)) if (n && typeof n.ref === 'string') refs.push(n.ref);
  }
  if (!refs.length && !Array.isArray(j.requires) && !nodes) {
    return unknown('unstated', `${where}: neither requires[] (v2) nor graph_lock.nodes (v1) — not a conan.lock this reader knows`);
  }
  const out = [];
  const prov = newProv(false, false);
  const seen = new Set();
  for (const ref of refs) {
    const m = typeof ref === 'string' && ref.match(/^([A-Za-z0-9_.+-]+)\/[^#%@\s]+/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push(obs(OBSERVABLE.PACKAGE, m[1], where));
    prov.packages += 1;
  }
  return { observables: out, provenance: prov, note: 'recipe revisions are Conan-internal recipe hashes, not artifact digests, and are not counted as provenance' };
}

/**
 * mix.lock — one Elixir term per line, regular enough for the Cargo.lock treatment. A :hex line
 * carries the package atom, the version, and (in modern lockfiles) an OUTER checksum — SHA-256 of
 * the registry tarball, the digest advisories and indicators can be matched against. A :git line
 * carries the clone URL (an origin) and a 40-hex revision.
 */
export function extractMixLock(text, where) {
  if (!/^%\{/m.test(text)) {
    return unknown('unstated', `${where}: no %{ map literal — not a mix.lock this reader knows`);
  }
  const out = [];
  const prov = newProv(true, true);
  for (const line of text.split('\n')) {
    const hex = line.match(/^\s*"([^"]+)":\s*\{:hex,\s*:[A-Za-z0-9_]+,\s*"([^"]+)"/);
    if (hex) {
      out.push(obs(OBSERVABLE.PACKAGE, hex[1], where));
      prov.packages += 1;
      const sums = [...line.matchAll(/"([0-9a-f]{64})"/g)].map((m) => m[1]);
      if (sums.length) {
        // The LAST 64-hex string is the outer checksum (registry tarball); the first is the inner
        // (contents) digest — both are real SHA-256s, the outer is the one registries serve.
        out.push(obs(OBSERVABLE.SHA256, sums[sums.length - 1], where));
        prov.withDigest += 1;
      }
      continue;
    }
    const git = line.match(/^\s*"([^"]+)":\s*\{:git,\s*"([^"]+)",\s*"([0-9a-f]{40})"/);
    if (git) {
      out.push(obs(OBSERVABLE.PACKAGE, git[1], where));
      prov.packages += 1;
      fromResolvedUrl(git[2], where, out);
      prov.withOrigin += 1;
      out.push(obs(OBSERVABLE.SHA1, git[3], where));
      prov.withDigest += 1;
    }
  }
  if (!prov.packages) {
    return unknown('unstated', `${where}: a %{ map with no :hex or :git entries this reader recognises — refused rather than read as empty`);
  }
  return { observables: out, provenance: prov };
}

/**
 * pubspec.lock — generated, narrow-dialect YAML, read by the same restricted
 * reader-that-refuses pattern proven on pnpm-lock.yaml. Only the `packages:` block is read:
 * two-space keys name packages; their `description:` block carries the registry `url:` (origin)
 * and, in Dart >=2.19 lockfiles, a `sha256:` of the archive.
 */
export function extractPubspecLock(text, where) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  if (start === -1) {
    return unknown('unstated', `${where}: no top-level \`packages:\` block — not a pubspec.lock this reader knows`);
  }
  const out = [];
  const prov = newProv(true, true);
  let current = null;
  let sawUrl = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;                       // the next top-level key ends the block
    const pkg = l.match(/^  ([A-Za-z0-9_]+):\s*$/);
    if (pkg) {
      current = pkg[1];
      sawUrl = false;
      out.push(obs(OBSERVABLE.PACKAGE, current, where));
      prov.packages += 1;
      continue;
    }
    if (!current) continue;
    const url = l.match(/^\s+url:\s*"?([^"\s]+)"?\s*$/);
    if (url && !sawUrl) { fromResolvedUrl(url[1], where, out); prov.withOrigin += 1; sawUrl = true; continue; }
    const sha = l.match(/^\s+sha256:\s*"?([0-9a-f]{64})"?\s*$/);
    if (sha) { out.push(obs(OBSERVABLE.SHA256, sha[1], where)); prov.withDigest += 1; }
  }
  if (!prov.packages) {
    return unknown('unstated', `${where}: a packages: block with no two-space package keys — a dialect this reader refuses rather than approximates`);
  }
  return { observables: out, provenance: prov };
}

/**
 * Podfile.lock — the PODS: section lists resolved pods as `  - Name (1.2.3)`. SPEC CHECKSUMS
 * digests the PODSPEC FILE, not the artifact installed, so those SHA-1s are emitted as
 * observables (an indicator can still hunt one) but never counted as artifact provenance —
 * counting them would report a provenance the format does not assert.
 */
export function extractPodfileLock(text, where) {
  if (!/^PODS:\s*$/m.test(text)) {
    return unknown('unstated', `${where}: no PODS: section — not a Podfile.lock this reader knows`);
  }
  const out = [];
  const prov = newProv(false, false);
  const seen = new Set();
  const podsBlock = text.split(/^PODS:\s*$/m)[1] || '';
  for (const line of podsBlock.split('\n')) {
    if (/^\S/.test(line) && line.trim()) break;      // next top-level section
    const m = line.match(/^  - "?([A-Za-z0-9_+./-]+)"? \(/);
    if (!m) continue;
    const name = m[1].split('/')[0];                 // Name/Subspec resolves to the pod Name
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(obs(OBSERVABLE.PACKAGE, name, where));
    prov.packages += 1;
  }
  for (const m of text.matchAll(/^ {2}([A-Za-z0-9_+.-]+): ([0-9a-f]{40})$/gm)) {
    out.push(obs(OBSERVABLE.SHA1, m[2], where));
  }
  if (!prov.packages) {
    return unknown('unstated', `${where}: a PODS: section with no pod entries this reader recognises`);
  }
  return { observables: out, provenance: prov, note: 'SPEC CHECKSUMS digest the podspec, not the artifact — emitted for matching, never counted as provenance' };
}

/**
 * stack.yaml.lock — generated YAML whose load-bearing lines are `hackage:
 * name-version@sha256:digest,size` under packages[]. The sha256 is the pantry key of the
 * package's cabal metadata — package-identifying, so it is recorded and counted.
 */
export function extractStackLock(text, where) {
  if (!/^packages:\s*$/m.test(text)) {
    return unknown('unstated', `${where}: no packages: block — not a stack.yaml.lock this reader knows`);
  }
  const out = [];
  const prov = newProv(false, true);
  for (const m of text.matchAll(/hackage:\s*([A-Za-z0-9-]+?)-(\d[\w.]*)@sha256:([0-9a-f]{64})/g)) {
    out.push(obs(OBSERVABLE.PACKAGE, m[1], where));
    prov.packages += 1;
    out.push(obs(OBSERVABLE.SHA256, m[3], where));
    prov.withDigest += 1;
  }
  if (!prov.packages) {
    return unknown('unstated', `${where}: a packages: block with no hackage: pins — snapshot-only lockfiles carry no package set to read`);
  }
  return { observables: out, provenance: prov };
}

/**
 * cabal.project.freeze — `constraints: any.name ==version, …`. Exact pins only: a constraint
 * that is not `==` (installed flags, ranges) names no resolved version and is skipped.
 */
export function extractCabalFreeze(text, where) {
  if (!/constraints:/.test(text)) {
    return unknown('unstated', `${where}: no constraints: — not a cabal freeze file this reader knows`);
  }
  const out = [];
  const prov = newProv(false, false);
  const seen = new Set();
  for (const m of text.matchAll(/any\.([A-Za-z0-9-]+)\s*==/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push(obs(OBSERVABLE.PACKAGE, m[1], where));
    prov.packages += 1;
  }
  if (!prov.packages) {
    return unknown('unstated', `${where}: constraints with no ==-pinned packages — a freeze of flags alone resolves nothing`);
  }
  return { observables: out, provenance: prov };
}

/**
 * vcpkg.json — NAMES WITHOUT VERSIONS, on purpose. The manifest declares dependency names and
 * resolves versions through a baseline commit, so a version claim here would be minted, not
 * read. Names are exactly what lookalike and the indicator matcher operate on, so name-only
 * still feeds two consumers honestly; the provenance counters say the rest (nothing has an
 * origin or a digest, and canOrigin/canDigest false say the FORMAT cannot express one).
 */
export function extractVcpkgManifest(text, where) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return unknown('unparseable', `${where}: ${e.message}`); }
  if (!Array.isArray(j.dependencies)) {
    return unknown('unstated', `${where}: no dependencies[] — not a vcpkg manifest this reader knows`);
  }
  const out = [];
  const prov = newProv(false, false);
  const seen = new Set();
  for (const d of j.dependencies) {
    const name = typeof d === 'string' ? d : (d && typeof d.name === 'string' ? d.name : null);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(obs(OBSERVABLE.PACKAGE, name, where));
    prov.packages += 1;
  }
  return { observables: out, provenance: prov, note: 'names only — vcpkg resolves versions via a baseline commit, so no version or digest exists in this file to read' };
}

export const EXTRACTORS = Object.freeze({
  'package-lock.json': extractNpmLock,
  'npm-shrinkwrap.json': extractNpmLock,
  'package.json': extractPackageJson,
  'go.mod': extractGoMod,
  'Cargo.lock': extractCargoLock,
  'requirements.txt': extractRequirements,
  'yarn.lock': extractYarnLock,
  'gradle.lockfile': extractGradleLockfile,
  'pnpm-lock.yaml': extractPnpmLock,
  'Gemfile.lock': extractGemfileLock,
  'packages.lock.json': extractNugetLock,
  'conan.lock': extractConanLock,
  'mix.lock': extractMixLock,
  'pubspec.lock': extractPubspecLock,
  'Podfile.lock': extractPodfileLock,
  'stack.yaml.lock': extractStackLock,
  'cabal.project.freeze': extractCabalFreeze,
  'vcpkg.json': extractVcpkgManifest,
  // Every JSON_LOCK_SPECS entry becomes an extractor here, so the table cannot drift out of the
  // dispatch: adding a spec adds a reader, and a spec nothing dispatches would be a lie.
  ...Object.fromEntries(Object.entries(JSON_LOCK_SPECS)
    .map(([file, spec]) => [file, (text, where) => extractByJsonSpec(spec, text, where)])),
});

// ── collection ──────────────────────────────────────────────────────────────────────────────────

/**
 * One repo. `repoDir` is read at the top level only — a recursive walk of 170 checkouts would take
 * minutes and pull in vendored third-party lockfiles under node_modules, which are not this repo's
 * declared dependencies and would flood the corpus with duplicates of what the top-level lock
 * already resolves.
 */
export function collectRepo(repoDir, { name = null } = {}) {
  let names;
  try {
    names = readdirSync(repoDir);
  } catch (e) {
    return {
      repo: name || repoDir, observables: [], sources: [], voids: [],
      ...unknown(e.code === 'ENOENT' ? 'absent' : 'not-permitted', `${repoDir}: ${e.code || e.message}`),
    };
  }
  const present = new Set(names);
  const observables = [];
  const sources = [];
  const voids = [];
  const prov = newAccum();

  for (const [file, fn] of Object.entries(EXTRACTORS)) {
    if (!present.has(file)) continue;
    const path = join(repoDir, file);
    const where = `${name || repoDir}/${file}`;
    let text;
    try { text = readFileSync(path, 'utf8'); } catch (e) {
      sources.push({ file, ...unknown('not-permitted', `${where}: ${e.code || e.message}`) });
      continue;
    }
    const r = fn(text, where);
    if (r.unknown) { sources.push({ file, ...r }); continue; }
    observables.push(...r.observables);
    const p = r.provenance || newProv();
    prov.packages += p.packages;
    prov.withOrigin += p.withOrigin;
    prov.withDigest += p.withDigest;
    prov.originCapable += capableOrigin(p);
    prov.digestCapable += capableDigest(p);
    sources.push({
      file, extracted: r.observables.length, provenance: p,
      ...(r.note ? { note: r.note } : {}),
    });
  }

  for (const [file, why] of Object.entries(DECLARED_VOIDS)) {
    if (present.has(file)) voids.push({ file, why });
  }

  return { repo: name || repoDir, observables, sources, voids, provenance: prov };
}

/**
 * The newest `sbom-syft.json` this fleet has written about `repoName`, or null. Batch dirs sort
 * lexically by their timestamp stamp, so the last match is the newest.
 *
 * THE PATH MUST NAME THE REPO, and the first version of this did not insist. It also accepted
 * `reports/<batch>/sbom-syft.json` — the older single-repo layout, where the batch dir IS the
 * repo — as a fallback for ANY repo name. The effect was immediate and would have been very hard
 * to see in the output: all 170 repos reported "has an SBOM", every one of them pointed at the
 * same file, and one repo's dependency list would have been attributed to the entire fleet. It
 * surfaced only because that particular file happens to hold nothing but GitHub Actions, so the
 * count came back 0 instead of plausible.
 *
 * A missing SBOM for a repo is a coverage gap and gets declared as one. A wrong SBOM for a repo is
 * a false statement about that repo, and the two are not close enough to trade.
 */
export function findSbom(reportsDir, repoName) {
  let batches = [];
  try { batches = readdirSync(reportsDir); } catch (e) { if (e.code !== 'ENOENT') throw e; return null; }
  const hits = [];
  for (const b of batches.sort()) {
    const p = join(reportsDir, b, repoName, 'sbom-syft.json');
    if (existsSync(p)) hits.push(p);
  }
  return hits.length ? hits[hits.length - 1] : null;
}

/**
 * Lockfiles bin/jvm-resolve.sh produced, read at tier `derived`.
 *
 * THE TIER IS THE WHOLE REASON THIS IS A SEPARATE FUNCTION. `extractGradleLockfile` reads a
 * gradle.lockfile out of the REPOSITORY and marks it `declared`, because a committed lockfile is a
 * claim the maintainers made. bin/jvm-resolve.sh produces byte-identical files, and if it wrote
 * them where a maintainer's would live, the corpus would launder this machine's resolution into a
 * maintainer's assertion with nothing able to tell the two apart.
 *
 * So the resolver writes only into the report directory, this reads only from there, and the two
 * paths can never be confused. What those files pin is what one box resolved at one moment through
 * a bounded proxy — a fact about a run.
 */
/**
 * Gradle's `verification-metadata.xml` — the PIN LIST bin/jvm-resolve.sh generates.
 *
 * WHY THIS IS READ AND NOT JUST THE LOCKFILE. A gradle.lockfile pins VERSIONS; this pins BYTES.
 * It is the only JVM source in this module that carries a digest at all — `extractGradleLockfile`
 * declares `canDigest: false` because a lockfile genuinely has none — so without this the entire
 * JVM half of the corpus is version-provenanced and byte-unprovenanced.
 *
 * The shape is regular enough to read without an XML parser:
 *   <component group="g" name="a" version="1.0">
 *     <artifact name="a-1.0.jar"><sha256 value="…"/></artifact>
 *   </component>
 * A `<component>` whose artifacts carry no sha256 is counted but contributes no digest, because an
 * entry that pins nothing is not a pin.
 */
export function extractGradleVerificationMetadata(text, where) {
  const s = String(text);
  const out = [];
  const prov = newProv(false, true);   // no origin here; the digest is the whole point

  // BOTH TAG FORMS. A component with no pinned artifacts is written self-closing, and matching
  // only the paired form under-counted against bin/jvm-resolve.sh's own `grep -c '<component '` —
  // two counts of the same thing disagreeing, which is the defect class this module exists to hunt.
  // A self-closing component still names a dependency; it just pins nothing, which is why it lands
  // in `packages` and not in `withDigest`.
  const componentRe = /<component\b([^>]*?)(?:\/>|>([\s\S]*?)<\/component>)/g;
  let m;
  while ((m = componentRe.exec(s)) !== null) {
    const attrs = m[1];
    const body = m[2] ?? '';
    const group = /\bgroup\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
    const name = /\bname\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
    if (!group || !name) continue;
    // group:artifact, matching extractGradleLockfile and the maven purl shape, so the three agree.
    out.push(obs(OBSERVABLE.PACKAGE, `${group}:${name}`, where));
    prov.packages += 1;

    let digested = false;
    for (const d of body.matchAll(/<sha256\s+value\s*=\s*"([0-9a-fA-F]{64})"/g)) {
      out.push(obs(OBSERVABLE.SHA256, d[1].toLowerCase(), where));
      digested = true;
    }
    if (digested) prov.withDigest += 1;
  }

  if (!out.length && !/<verification-metadata/.test(s)) {
    return unknown('unstated', `${where}: no <verification-metadata> root — not a gradle pin list this reader knows`);
  }
  return {
    observables: out,
    provenance: prov,
    note: 'gradle verification-metadata: pins BYTES, unlike a lockfile which pins versions',
  };
}

export function collectRepoResolved(reportsDir, repoName) {
  let batches = [];
  try { batches = readdirSync(reportsDir); } catch (e) { if (e.code !== 'ENOENT') throw e; return { repo: repoName, observables: [], ...unknown('absent', reportsDir) }; }

  // Newest batch that produced anything for this repo. Same rule as findSbom: the path must NAME
  // the repo, so a batch-level artifact is never attributed to an arbitrary one.
  let dir = null;
  for (const b of batches.sort()) {
    const d = join(reportsDir, b, repoName, 'jvm-resolve');
    if (existsSync(d)) dir = d;
  }
  if (!dir) return { repo: repoName, observables: [], ...unknown('absent', `no jvm-resolve output for ${repoName}`) };

  const out = [];
  const prov = newProv(false, false);
  let files = 0;
  const walk = (p) => {
    let entries = [];
    try { entries = readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(p, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const isLock = e.name === 'gradle.lockfile';
      const isPins = e.name === 'verification-metadata.xml';
      if (!isLock && !isPins) continue;
      let text;
      try { text = readFileSync(full, 'utf8'); } catch { continue; }
      const r = isPins
        ? extractGradleVerificationMetadata(text, `${repoName}/jvm-resolve/${e.name}`)
        : extractGradleLockfile(text, `${repoName}/jvm-resolve/${e.name}`);
      if (r.unknown) continue;
      files += 1;
      prov.withDigest += r.provenance.withDigest || 0;
      // Re-tier every observable. extractGradleLockfile is shared with the repository path and
      // marks `declared`; the tier belongs to WHERE the file came from, not to its format.
      for (const o of r.observables) out.push({ ...o, tier: TIER.DERIVED });
      prov.packages += r.provenance.packages;
    }
  };
  walk(dir);

  return {
    repo: repoName, dir, lockfiles: files, observables: out, provenance: prov,
    note: 'tier=derived — resolved by bin/jvm-resolve.sh in a sandbox, never written into the working tree',
  };
}

/**
 * SBOM-derived observables for one repo. Kept OUT of collectRepo on purpose: that function reads
 * the repository, and this reads what a scanner said about it. Merging the two entry points would
 * make the tier a property of a field somewhere rather than of where the data came from.
 */
export function collectRepoSbom(reportsDir, repoName) {
  const path = findSbom(reportsDir, repoName);
  if (!path) return { repo: repoName, observables: [], ...unknown('absent', `no sbom-syft.json for ${repoName}`) };
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    return { repo: repoName, observables: [], ...unknown('not-permitted', `${path}: ${e.code || e.message}`) };
  }
  const r = extractSyftSbom(text, `${repoName}/sbom-syft.json`);
  if (r.unknown) return { repo: repoName, observables: [], ...r };
  return { repo: repoName, path, ...r };
}

/**
 * The fleet. `coverage` counts repos from which at least one observable was extracted, over repos
 * that declared any manifest at all — so a fleet whose lockfiles are all pnpm reports low coverage
 * rather than a small clean corpus.
 */
export function collectFleet(repos, { cap = DEFAULT_CAP, sbomDir = null } = {}) {
  const perRepo = [];
  const all = [];
  const fleetProv = newAccum();
  let truncated = 0;
  const sbomStats = { repos: 0, withSbom: 0, derived: 0, byEcosystem: {}, unreadable: [] };
  const resolvedStats = { repos: 0, lockfiles: 0, observables: 0 };

  for (const r of repos) {
    const res = collectRepo(r.path, { name: r.name });

    // Tier `derived` observables, when a reports dir is supplied. They ride in the same corpus and
    // stay distinguishable by their tier — see TIER.
    if (sbomDir) {
      // Sandbox-resolved lockfiles first: same reports dir, same derived tier, different producer.
      const jr = collectRepoResolved(sbomDir, r.name);
      if (!jr.unknown && jr.observables.length) {
        resolvedStats.repos += 1;
        resolvedStats.lockfiles += jr.lockfiles;
        resolvedStats.observables += jr.observables.length;
        res.observables.push(...jr.observables);
      }

      sbomStats.repos += 1;
      const s = collectRepoSbom(sbomDir, r.name);
      if (s.unknown) {
        // An absent SBOM is ordinary — the repo may never have been swept. Anything else is not.
        if (s.unknownReason !== 'absent') sbomStats.unreadable.push({ repo: r.name, reason: s.unknownReason });
      } else {
        sbomStats.withSbom += 1;
        sbomStats.derived += s.observables.length;
        for (const [k, v] of Object.entries(s.byEcosystem || {})) sbomStats.byEcosystem[k] = (sbomStats.byEcosystem[k] || 0) + v;
        res.observables.push(...s.observables);
      }
    }
    const kept = res.observables.slice(0, cap);
    truncated += Math.max(0, res.observables.length - cap);
    all.push(...kept);
    // An unreadable repo (collectRepo's unknown branch) carries NO provenance accumulator — and
    // dereferencing it here took down the ENTIRE fleet collection the first time the registry
    // declared a repo whose clone had not landed yet (measured 2026-08-27, during the
    // ~/Repositories/Portll bulk-clone). One unreadable repo contributing zero to the fleet
    // counters is correct; one unreadable repo killing the lane is the exact failure the header
    // of this file forbids.
    if (res.provenance) {
      for (const k of ['packages', 'withOrigin', 'withDigest', 'originCapable', 'digestCapable']) {
        fleetProv[k] += res.provenance[k];
      }
    }
    perRepo.push({
      repo: res.repo,
      observables: res.observables.length,
      declaredObservables: res.observables.filter((o) => o.tier === TIER.DECLARED).length,
      truncated: Math.max(0, res.observables.length - cap),
      provenance: res.provenance,
      sources: res.sources,
      voids: res.voids,
      ...(res.unknown ? { unknown: true, unknownReason: res.unknownReason, unknownDetail: res.unknownDetail } : {}),
    });
  }

  // Coverage is about MANIFEST extraction and stays that way. Counting SBOM-derived repos here put
  // observed (131) above the population (121) — a repo with an SBOM and no parseable manifest
  // yields observables without ever entering the denominator. monitor/denominator.mjs threw rather
  // than render a coverage above 1, which is the guard doing exactly what it was written for.
  // Derived coverage is a different question and is reported separately, as `sbom`.
  const declaredAny = perRepo.filter((p) => p.sources.length || p.voids.length).length;
  const extracted = perRepo.filter((p) => p.declaredObservables > 0).length;

  // Deduplicate for the matchable corpus, keeping every `where`. Identity is (type, value) — never
  // the place, per the house rule: the same package in two lockfiles is one name that spread.
  const byKey = new Map();
  for (const o of all) {
    const k = `${o.type}|${o.value}`;
    if (!byKey.has(k)) byKey.set(k, { type: o.type, value: o.value, where: [], occurrences: 0, tier: o.tier });
    const e = byKey.get(k);
    e.occurrences += 1;
    // A name seen in BOTH a lockfile and an SBOM keeps the stronger tier: the committed claim is
    // not weakened by a tool also having noticed it.
    if (o.tier === TIER.DECLARED) e.tier = TIER.DECLARED;
    if (e.where.length < 10) e.where.push(o.where);
  }
  const corpus = [...byKey.values()].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.value < b.value ? -1 : 1));

  return {
    generated: process.env.CW_NOW || new Date().toISOString(),
    repos: perRepo.length,
    corpus,
    corpusSize: corpus.length,
    rawObservables: all.length,
    truncated,
    byType: countBy(corpus, (o) => o.type),
    byTier: countBy(corpus, (o) => o.tier),
    sbom: sbomDir ? sbomStats : null,
    sandboxResolved: sbomDir ? resolvedStats : null,
    hosts: hostDistribution(corpus),
    // THE DENOMINATOR THE HOST DISTRIBUTION IS MEANINGLESS WITHOUT. `hosts` describes only the
    // packages that named an origin; `originCoverage` says how many did. Publishing the first
    // without the second is what let a lockfile whose entries are 63% origin-less read as a
    // tidy two-registry split. Digest coverage is separate because they are separate claims.
    provenance: fleetProv,
    // Denominator is the CAPABLE population — see newProv on why package.json entries are not
    // counted as provenance failures.
    originCoverage: claim({
      count: fleetProv.withOrigin, observed: fleetProv.withOrigin, population: fleetProv.originCapable,
      unit: 'package', of: 'asserted origin',
    }),
    digestCoverage: claim({
      count: fleetProv.withDigest, observed: fleetProv.withDigest, population: fleetProv.digestCapable,
      unit: 'package', of: 'asserted digest',
    }),
    coverage: claim({
      count: corpus.length, observed: extracted, population: declaredAny,
      unit: 'repo', of: 'observable',
    }),
    voidsByKind: countBy(perRepo.flatMap((p) => p.voids), (v) => v.file),
    unreadable: perRepo.filter((p) => p.unknown || p.sources.some((s) => s.unknown))
      .map((p) => ({ repo: p.repo, reasons: [p.unknownReason, ...p.sources.filter((s) => s.unknown).map((s) => `${s.file}: ${s.unknownReason}`)].filter(Boolean) })),
    perRepo,
  };
}

/**
 * Where the fleet's dependencies claim to come from. The long tail is the interesting part.
 *
 * COUNTS OCCURRENCES, NOT DISTINCT ENTRIES. Written the obvious way — countBy over the deduplicated
 * corpus — every host came back with exactly 1, because deduplication is what the corpus IS. The
 * output was a perfectly plausible alphabetical list of 62 hosts each "used once", with github.com
 * sitting among them at 1 while go.mod alone names hundreds of modules under it. A distribution
 * where every bar is the same height is not a distribution, and that is the tell.
 */
export function hostDistribution(corpus) {
  const counts = new Map();
  for (const o of corpus) {
    if (o.type !== OBSERVABLE.DOMAIN) continue;
    counts.set(o.value, (counts.get(o.value) || 0) + (o.occurrences || 1));
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([host, n]) => ({ host, references: n }));
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

function countBy(list, keyFn) {
  const out = {};
  for (const x of list) { const k = keyFn(x); out[k] = (out[k] || 0) + 1; }
  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const dirs = argv.filter((a) => !a.startsWith('--') && a !== flag('--area'));

  let repos;
  if (dirs.length) {
    repos = dirs.map((d) => ({ name: relative(REPO, resolve(d)) || resolve(d), path: resolve(d) }));
  } else {
    const { loadRegistry } = await import('./registry.mjs');
    const { resolveRepos } = await import('./discover.mjs');
    const area = flag('--area');
    const resolved = resolveRepos(loadRegistry());
    repos = (resolved.repos || []).filter((r) => !area || r.area === area);
  }

  // --sbom folds in tier `derived` observables from the fleet's own syft output.
  let sbomDir = null;
  if (argv.includes('--sbom')) {
    const { reportsRootDir } = await import('./area.mjs');
    sbomDir = process.env.CW_OBSERVABLES_SBOM_DIR || reportsRootDir();
  }
  const report = collectFleet(repos, { cap: Number(process.env.CW_OBSERVABLES_CAP) || DEFAULT_CAP, sbomDir });

  const outPath = process.env.CW_OBSERVABLES_OUT || join(REPO, 'reports', 'observables.json');
  writeAtomic(outPath, `${JSON.stringify(report, null, 2)}\n`);

  if (argv.includes('--json')) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log(`observables: ${report.corpusSize} distinct over ${report.repos} repo(s) (${report.rawObservables} raw)`);
  for (const [t, n] of Object.entries(report.byType).sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(10)} ${n}`);

  if (report.sbom) {
    const s = report.sbom;
    console.log(`observables: tier DERIVED — ${s.derived} observable(s) from ${s.withSbom} of ${s.repos} repo(s) with an SBOM`);
    const eco = Object.entries(s.byEcosystem).sort((a, b) => b[1] - a[1]);
    if (eco.length) console.log(`             by ecosystem: ${eco.map(([k, v]) => `${k}:${v}`).join(' ')}`);
    console.log('             a derived observable is syft\'s resolution, not a claim the repository committed');
    for (const u of s.unreadable.slice(0, 5)) console.log(`             UNREADABLE ${u.repo} — ${u.reason}`);
  }
  if (report.byTier) {
    console.log(`observables: ${report.byTier.declared || 0} declared, ${report.byTier.derived || 0} derived (never summed as one number)`);
  }

  const pv = report.provenance;
  console.log(`observables: ${pv.withOrigin} of ${pv.originCapable} entries in ORIGIN-capable formats asserted one (${pct(pv.withOrigin, pv.originCapable)});`
    + ` ${pv.withDigest} of ${pv.digestCapable} in DIGEST-capable formats asserted one (${pct(pv.withDigest, pv.digestCapable)})`);
  const incapable = pv.packages - pv.originCapable;
  if (incapable) console.log(`             ${incapable} further entr${incapable === 1 ? 'y comes' : 'ies come'} from formats that cannot express an origin at all — not counted as a failure to`);

  if (argv.includes('--hosts')) {
    console.log('observables: origin hosts asserted by the fleet\'s lockfiles');
    for (const h of report.hosts.slice(0, 30)) console.log(`  ${String(h.references).padStart(6)}  ${h.host}`);
    if (report.hosts.length > 30) console.log(`  … ${report.hosts.length - 30} more host(s) in the artifact`);
    console.log(`  the above describes ${pv.withOrigin} of ${pv.packages} entries — the other ${pv.packages - pv.withOrigin} named no host at all`);
  }

  if (argv.includes('--provenance')) {
    // Worst-provenanced repos first: a lockfile that pins no bytes is a larger fact about a repo
    // than which registry the entries that DO pin them name.
    // Only repos with a CAPABLE population are ranked. A package.json-only repo is not a badly
    // provenanced repo and putting seventeen of them at the top of this list buried the one that
    // was — see newProv.
    const rows = report.perRepo.filter((r) => r.provenance.originCapable > 0)
      .sort((a, b) => (a.provenance.withOrigin / a.provenance.originCapable) - (b.provenance.withOrigin / b.provenance.originCapable));
    console.log('observables: repos by ORIGIN coverage over the provenance-CAPABLE population, worst first');
    for (const r of rows.slice(0, 20)) {
      const p = r.provenance;
      console.log(`  ${pct(p.withOrigin, p.originCapable).padStart(6)}  origin  ${pct(p.withDigest, p.digestCapable).padStart(6)}  digest  ${String(p.originCapable).padStart(5)} pkg  ${r.repo}`);
    }
    const excluded = report.perRepo.filter((r) => r.provenance.packages > 0 && r.provenance.originCapable === 0).length;
    if (excluded) console.log(`  (${excluded} repo(s) excluded: their only manifests cannot express an origin for anybody)`);
  }

  const voids = Object.entries(report.voidsByKind).sort((a, b) => b[1] - a[1]);
  if (voids.length) {
    console.log('observables: ecosystems present and DECLARED UNREAD (see DECLARED_VOIDS)');
    for (const [file, n] of voids) console.log(`  ${String(n).padStart(6)}  ${file}`);
  }
  for (const u of report.unreadable.slice(0, 10)) console.log(`  UNREADABLE  ${u.repo} — ${u.reasons.join('; ')}`);
  if (report.truncated) console.log(`observables: ${report.truncated} observable(s) beyond the per-repo cap were counted but not carried`);
  console.log(`observables: ${renderClaim(report.coverage)}`);
  console.log(`observables: ${outPath}`);
}

if (isMain) {
  main().catch((e) => { console.error(`observables: ${(e && e.stack) || e}`); process.exitCode = 2; });
}
