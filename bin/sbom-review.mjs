#!/usr/bin/env node
// sbom-review.mjs — a reviewed reading of the CycloneDX SBOM for one project or one group (area).
//
// The sweep already writes an SBOM per repo (sbom-syft); this answers what a reader asks of one:
// which of these components does the product actually ship, what are they licensed under, which
// carry known vulnerabilities, which identities are weak, and is the document still current.
//
//   node bin/sbom-review.mjs --project <name>              one registry project (or discovered repo)
//   node bin/sbom-review.mjs --group <area>                every repo resolving to a registry area
//   node bin/sbom-review.mjs --repo <path> [--repo …]      any checkout; with --group <name>, an ad-hoc
//                                                          group of exactly these (registry not read)
//
//   --sbom <file>      review this CycloneDX document (one repo only)
//   --generate         run syft now rather than reading the newest scanned SBOM
//   --vulns            look components up with osv-scanner (sends name + version to osv.dev)
//   --osv <file>       read an existing osv-scanner JSON result instead (one repo only); without
//                      either flag, an osv.json beside the SBOM is read and labelled as earlier
//   --reports <dir>    where scanned SBOMs are looked for (default: the registry's reportsRoot)
//   --out <dir>        default reports/sbom-review/<target>
//   --label <text>     heading for the report
//
// Writes sbom-review.json, sbom-review.md and sbom-review.html (self-contained). Never drops a
// component: everything catalogued is counted, and what is not product is classified, not removed.
// Env: CW_NOW pins the clock; CW_SBOM_REVIEW_REPORTS overrides --reports. Both read at call time.

import { readFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { esc } from '../lib/render-markdown.mjs';
import { ROOT_CSS, SEAL_SVG } from '../lib/brand-tokens.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
const SBOM_FILES = ['sbom-syft.json', 'sbom.cdx.json', 'sbom.json'];

// ── component facts ─────────────────────────────────────────────────────────────────────────

const prop = (c, re) => (c.properties || []).find((p) => re.test(p.name || ''))?.value || '';
export const locationOf = (c) => prop(c, /location:0:path$/).replaceAll('\\', '/').replace(/^\/+/, '');
export const foundByOf = (c) => prop(c, /^syft:package:foundBy$/);

const PURL_ECO = { npm: 'npm', golang: 'Go', github: 'GitHub Actions', pypi: 'PyPI', cargo: 'crates.io',
  maven: 'Maven', gem: 'RubyGems', nuget: 'NuGet', composer: 'Packagist', hex: 'Hex', pub: 'Pub',
  swift: 'SwiftURL', cocoapods: 'CocoaPods', deb: 'Debian', apk: 'Alpine', rpm: 'RPM' };

/** Ecosystems an OSV npm lookup would misidentify: their purls say npm, their registry says otherwise. */
export const NOT_NPM = new Set(['JSR', 'URL']);

export function ecosystemOf(c) {
  if (c.type === 'file') return 'file';
  // syft writes deno.lock jsr: entries and remote URL imports as npm purls qualified with their real registry
  const repo = /^pkg:npm\/[^?]*\?(?:.*&)?repository_url=([^&#]+)/i.exec(c.purl || '');
  if (repo) {
    const host = decodeURIComponent(repo[1]);
    if (/^https?:\/\/jsr\.io/i.test(host)) return 'JSR';
    // esm.sh serves npm packages; once sbom-remote has named them, they are those npm packages
    if (/^https?:\/\/esm\.sh/i.test(host) && !/^esm\.sh/.test(c.name || '')) return 'npm';
    if (!/^https?:\/\/registry\.npmjs\.org/i.test(host)) return 'URL';
  }
  const m = /^pkg:([a-z0-9.+-]+)\//i.exec(c.purl || '');
  if (m) return PURL_ECO[m[1].toLowerCase()] || m[1].toLowerCase();
  return c.type === 'application' ? 'binary' : 'unknown';
}

/** Where a package comes from: its ecosystem, or the registry host its purl names when that is not the default. */
export function providerOf(c) {
  const eco = ecosystemOf(c);
  const repo = /[?&]repository_url=([^&#]+)/.exec(c.purl || '');
  let host = '';
  if (repo) { try { host = new URL(decodeURIComponent(repo[1])).hostname; } catch { /* unparseable qualifier */ } }
  if (host === 'esm.sh') return 'npm via esm.sh';
  if (eco === 'URL') return host || 'URL';
  return eco;
}

/**
 * provider -> package -> version -> instance. An INSTALLATION is one version of a package; an INSTANCE is one
 * place that version is declared (a lockfile or workflow). `entries` counts the SBOM components behind an
 * instance — more than one when a remote package was catalogued per file.
 */
export function inventoryOf(comps) {
  const providers = new Map();
  for (const c of comps) {
    if (c.scope === 'source-file') continue;
    if (!providers.has(c.provider)) providers.set(c.provider, new Map());
    const pkgs = providers.get(c.provider);
    if (!pkgs.has(c.name)) pkgs.set(c.name, new Map());
    const versions = pkgs.get(c.name);
    if (!versions.has(c.version)) versions.set(c.version, new Map());
    const at = versions.get(c.version); const loc = c.location || '(no location)';
    const prev = at.get(loc);
    if (prev) prev.entries += c.entries;
    else at.set(loc, { location: loc, scope: c.scope, entries: c.entries, licence: c.licence, vulns: c.vulns === null ? null : c.vulns.length });
  }
  const byNum = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  return [...providers].sort(([a], [b]) => a.localeCompare(b)).map(([provider, pkgs]) => ({
    provider,
    packages: [...pkgs].sort(([a], [b]) => a.localeCompare(b)).map(([name, versions]) => {
      const vs = [...versions].sort(([a], [b]) => byNum(a, b)).map(([version, at]) => ({ version, instances: [...at.values()].sort((a, b) => a.location.localeCompare(b.location)) }));
      const all = vs.flatMap((v) => v.instances);
      // advisories belong to a version, so each installation counts once however many instances it has
      const perVersion = vs.map((v) => v.instances.find((i) => i.vulns !== null)?.vulns ?? null).filter((n) => n !== null);
      return {
        name, installations: vs.length, instances: all.length, entries: all.reduce((s, i) => s + i.entries, 0),
        licences: [...new Set(all.map((i) => i.licence).filter(Boolean))].sort(),
        vulns: perVersion.length ? perVersion.reduce((s, n) => s + n, 0) : null,
        versions: vs,
      };
    }),
  }));
}

export function packageName(c) {
  if (!c.group) return c.name;
  return `${c.group}${ecosystemOf(c) === 'Maven' ? ':' : '/'}${c.name}`;
}

// purl without qualifiers/subpath: syft appends ?package-id=… per occurrence, which is not identity.
export const identityOf = (c) => (c.purl ? `${NOT_NPM.has(ecosystemOf(c)) ? `${ecosystemOf(c).toLowerCase()}:` : ''}${c.purl.replace(/[?#].*$/, '')}` : `${ecosystemOf(c)}:${packageName(c)}@${c.version || ''}`);

const LOCKFILE_RE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|deno\.lock|go\.mod|Cargo\.lock|poetry\.lock|Pipfile\.lock|uv\.lock|requirements[^/]*\.txt|Gemfile\.lock|composer\.lock|packages\.lock\.json|mix\.lock|Package\.resolved|pubspec\.lock|gradle\.lockfile|pom\.xml)$/;
const BINARY_RE = /\.(exe|dll|so(\.\d+)*|dylib|bin)$/i;
const VENDORED_RE = /(^|\/)(vendor|third_party|third-party|reference|reports)\//;

/** What kind of file a component was catalogued from. */
export function kindOf(loc, foundBy, type) {
  if (type === 'file') return 'file';
  if (!loc) return 'unlocated';
  if (/^\.github\/workflows\//.test(loc) || /(^|\/)\.github\/workflows\//.test(loc)) return 'workflow';
  if (/binary/i.test(foundBy) || BINARY_RE.test(loc)) return 'binary';
  return 'manifest';
}

export const SCOPES = {
  product: 'Declared in a lockfile or manifest the repository tracks — what it ships or builds from.',
  ci: 'GitHub Actions used by the repository\'s own tracked workflows.',
  binary: 'Read from an executable\'s embedded module list. Whether that executable ships is not something the SBOM can say.',
  installed: 'Inside an installed dependency tree (node_modules): a copy of, or the internals of, packages a lockfile already declares.',
  vendored: 'Under a vendored, reference or report directory.',
  'local-only': 'From a file git ignores or does not track — present on this disk, not in the repository.',
  unknown: 'No source location recorded, the file is gone, or git could not say whether it is tracked.',
  'source-file': 'A file the scanner hashed as evidence (a lockfile, a workflow), not a package.',
};
export const PRODUCT_SCOPES = new Set(['product', 'ci']);

/** Scope of one component, from its location and that location's git state. */
export function scopeOf(loc, kind, gitState) {
  if (kind === 'file') return 'source-file';
  if (kind === 'unlocated') return 'unknown';
  if (/(^|\/)node_modules\//.test(loc)) return 'installed';
  if (VENDORED_RE.test(loc)) return 'vendored';
  if (gitState === 'ignored' || gitState === 'untracked') return 'local-only';
  if (kind === 'binary') return 'binary';
  if (gitState === 'unknown' || gitState === 'missing') return 'unknown';
  return kind === 'workflow' ? 'ci' : 'product';
}

// ── version and identity checks ─────────────────────────────────────────────────────────────

const GO_PSEUDO_RE = /^v\d+\.\d+\.\d+-(0\.)?\d{14}-[0-9a-f]{12}$|-0\.\d{14}-[0-9a-f]{12}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * The refs a workflow file actually names per action -> Map(name -> Set(ref)), or null when unreadable.
 * syft reports a SHA-pinned `uses: a/b@<sha> # v4.4.0` as version v4.4.0, so the version alone cannot
 * say whether an action is pinned.
 */
export function workflowRefs(text) {
  if (typeof text !== 'string') return null;
  const refs = new Map();
  for (const m of text.matchAll(/^\s*-?\s*uses:\s*['"]?([^@\s'"#]+)@([^\s'"#]+)/gm)) {
    if (!refs.has(m[1])) refs.set(m[1], new Set());
    refs.get(m[1]).add(m[2]);
  }
  return refs;
}

/** 'pinned' | 'mutable' | 'unverified' for a ci-scope action, from the workflow's own text when given. */
export function actionPinning(c, refs) {
  if (refs === undefined) return SHA_RE.test(String(c.version ?? '')) ? 'pinned' : 'mutable';
  const named = refs?.get(c.name);
  if (!named?.size) return 'unverified';
  return [...named].every((r) => SHA_RE.test(r)) ? 'pinned' : 'mutable';
}

export function identityFlags(c, scope, refs) {
  const flags = [];
  const v = String(c.version ?? '');
  if (!c.purl) flags.push('no-purl');
  if (!v || /^unknown$/i.test(v)) flags.push('unknown-version');
  else if (GO_PSEUDO_RE.test(v)) flags.push('pseudo-version');
  else if (/^v?0\.0\.0$/.test(v)) flags.push('placeholder-version');
  else if (ecosystemOf(c) !== 'GitHub Actions' && /^v?\d+(\.\d+)*-(alpha|beta|rc|pre|next|canary|dev)/i.test(v)) flags.push('prerelease');
  if (/[?&](vcs_url|download_url)=/.test(c.purl || '')) flags.push('non-registry-source');
  if (ecosystemOf(c) === 'GitHub Actions' && scope === 'ci') {
    const p = actionPinning(c, refs);
    if (p === 'mutable') flags.push('mutable-action-ref');
    else if (p === 'unverified') flags.push('unverified-action-ref');
  }
  return flags;
}

// ── licences ────────────────────────────────────────────────────────────────────────────────

const PERMISSIVE = /^(MIT|MIT-0|ISC|0BSD|BSD-[0-9]-Clause(-[A-Za-z]+)?|BSD|Apache-2\.0|Apache 2\.0|Unlicense|CC0-1\.0|Zlib|BlueOak-1\.0\.0|Python-2\.0|PSF-2\.0|CC-BY-[34]\.0|WTFPL|BSL-1\.0|X11|PostgreSQL|Artistic-2\.0)$/i;
const WEAK = /^(LGPL|MPL|EPL|CDDL|CPL|EUPL-1\.1|MS-RL)/i;
const STRONG = /^(GPL|AGPL|SSPL|EUPL|OSL|CC-BY-SA|CC-BY-NC|Commons-Clause|BUSL)/i;
const RANK = { permissive: 0, review: 1, 'weak-copyleft': 2, 'strong-copyleft': 3 };

function classifyOne(id) {
  const s = id.trim().replace(/^\(+|\)+$/g, '').replace(/\+$/, '').replace(/-(only|or-later)$/, '');
  if (PERMISSIVE.test(s)) return 'permissive';
  if (STRONG.test(s)) return 'strong-copyleft';
  if (WEAK.test(s)) return 'weak-copyleft';
  return 'review';
}

/** Licence class of an SPDX-ish expression: OR takes the most permissive choice, AND/WITH the strictest. */
export function classifyLicence(expr) {
  if (!expr || !String(expr).trim()) return 'unknown';
  const ors = String(expr).replace(/[()]/g, ' ').split(/\s+OR\s+/i).map((alt) =>
    alt.split(/\s+(?:AND|WITH)\s+/i).map(classifyOne).reduce((a, b) => (RANK[a] >= RANK[b] ? a : b)));
  return ors.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));
}

export function sbomLicence(c) {
  const parts = (c.licenses || []).map((l) => l.expression || l.license?.id || l.license?.name).filter(Boolean);
  return parts.length ? parts.join(' AND ') : '';
}

function pkgJsonLicence(pj) {
  if (typeof pj.license === 'string') return pj.license;
  if (pj.license?.type) return pj.license.type;
  if (Array.isArray(pj.licenses)) return pj.licenses.map((l) => (typeof l === 'string' ? l : l.type)).filter(Boolean).join(' OR ');
  return '';
}

/** node_modules roots inside a checkout, never descending into one. */
export function nodeModulesRoots(repoPath, depth = 4) {
  const out = [];
  const walk = (dir, left) => {
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name === '.git') continue;
      const p = join(dir, e.name);
      if (e.name === 'node_modules') out.push(p);
      else if (left > 1 && !e.name.startsWith('.')) walk(p, left - 1);
    }
  };
  walk(repoPath, depth);
  return out.sort();
}

/** Deno's npm cache: DENO_DIR, else the platform default. Read at call time. */
export function denoNpmCache(env = process.env) {
  const base = env.DENO_DIR || (process.platform === 'win32' ? join(env.LOCALAPPDATA || '', 'deno')
    : process.platform === 'darwin' ? join(env.HOME || '', 'Library', 'Caches', 'deno') : join(env.XDG_CACHE_HOME || join(env.HOME || '', '.cache'), 'deno'));
  return join(base, 'npm', 'registry.npmjs.org');
}

/**
 * Licence from a package.json on this disk whose version matches -> { licence, source }, else null.
 * Offline and read-only: the repo's node_modules roots first, then Deno's npm cache.
 */
export function installedLicence(c, roots, denoCache = null) {
  if (ecosystemOf(c) !== 'npm') return null;
  const name = packageName(c);
  const tries = roots.flatMap((nm) => [join(nm, name, 'package.json'), join(nm, '.deno', `${name.replace('/', '+')}@${c.version}`, 'node_modules', name, 'package.json')])
    .map((p) => [p, 'installed-package']);
  if (denoCache) tries.push([join(denoCache, name, c.version, 'package.json'), 'deno-cache']);
  for (const [p, source] of tries) {
    let pj; try { pj = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    if (pj.version === c.version) { const licence = pkgJsonLicence(pj); if (licence) return { licence, source }; }
  }
  return null;
}

// ── vulnerabilities (osv-scanner JSON) ──────────────────────────────────────────────────────

export function severityBucket(score) {
  const n = Number.parseFloat(score);
  if (!Number.isFinite(n) || n <= 0) return 'unscored';
  if (n >= 9) return 'critical';
  if (n >= 7) return 'high';
  if (n >= 4) return 'medium';
  return 'low';
}
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unscored'];

/** osv-scanner JSON -> Map("eco|name|version" -> [{id, aliases, severity, score, summary, fixed}]). */
export function indexOsv(doc) {
  const idx = new Map();
  for (const r of doc?.results || []) {
    for (const p of r.packages || []) {
      const key = `${p.package.ecosystem}|${p.package.name}|${p.package.version}`;
      const vulns = new Map((p.vulnerabilities || []).map((v) => [v.id, v]));
      const list = (p.groups || []).map((g) => {
        const primary = vulns.get(g.ids[0]) || {};
        const fixed = new Set();
        for (const id of g.ids) for (const a of vulns.get(id)?.affected || []) {
          if (a.package?.name !== p.package.name) continue;
          for (const rg of a.ranges || []) for (const ev of rg.events || []) if (ev.fixed) fixed.add(ev.fixed);
        }
        const cve = (g.aliases || []).find((a) => a.startsWith('CVE-')) || '';
        return { id: g.ids[0], cve, aliases: [...(g.aliases || [])].sort(), score: g.max_severity || '',
          severity: severityBucket(g.max_severity), summary: primary.summary || '', fixed: [...fixed].sort() };
      });
      if (list.length) idx.set(key, (idx.get(key) || []).concat(list));
    }
  }
  return idx;
}

// ── git facts ───────────────────────────────────────────────────────────────────────────────

function git(repo, args, input) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', input, maxBuffer: 256 << 20, stdio: ['pipe', 'pipe', 'ignore'] });
}

/** { isGit, tracked:Set, state(path) -> tracked|ignored|untracked|missing|unknown, lockfiles[] } */
export function gitFacts(repoPath, locations) {
  let tracked;
  try { tracked = new Set(git(repoPath, ['ls-files', '-z']).split('\0').filter(Boolean)); } catch {
    return { isGit: false, tracked: new Set(), state: () => 'unknown', lockfiles: [], changedSince: () => null, dirty: new Set() };
  }
  const rest = [...new Set(locations)].filter((l) => l && !tracked.has(l));
  let ignored = new Set();
  if (rest.length) {
    try { ignored = new Set(git(repoPath, ['check-ignore', '-z', '--stdin'], rest.join('\0')).split('\0').filter(Boolean)); } catch (e) {
      // exit 1 = none ignored; anything else leaves the state undetermined rather than "untracked"
      if (e.status !== 1) return { isGit: true, tracked, state: (l) => (tracked.has(l) ? 'tracked' : 'unknown'), lockfiles: lockfilesOf(tracked), changedSince: changedSince(repoPath), dirty: dirtyOf(repoPath) };
    }
  }
  const state = (l) => (tracked.has(l) ? 'tracked' : ignored.has(l) ? 'ignored' : existsSync(join(repoPath, l)) ? 'untracked' : 'missing');
  return { isGit: true, tracked, state, lockfiles: lockfilesOf(tracked), changedSince: changedSince(repoPath), dirty: dirtyOf(repoPath) };
}

const lockfilesOf = (tracked) => [...tracked].filter((p) => LOCKFILE_RE.test(p) && !/(^|\/)node_modules\//.test(p) && !VENDORED_RE.test(p)).sort();
const changedSince = (repo) => (path) => { try { return git(repo, ['log', '-1', '--format=%cI', '--', path]).trim() || null; } catch { return null; } };
function dirtyOf(repo) {
  try { return new Set(git(repo, ['status', '--porcelain', '-z']).split('\0').filter(Boolean).map((l) => l.slice(3))); } catch { return new Set(); }
}

// ── one repo ────────────────────────────────────────────────────────────────────────────────

function provenanceState(sbomPath) {
  if (!sbomPath) return 'unknown';
  let r; try { r = JSON.parse(readFileSync(join(dirname(sbomPath), 'sbom-syft-provenance.json'), 'utf8')); } catch { return 'unenriched'; }
  // native read but no artifact carried a resolution (deno.lock records none): nothing could be checked
  if (r.ran !== true) return r.unknownReason === 'no-reference' && r.sources?.nativeRead ? 'no-resolution-data' : 'unenriched';
  return r.enriched > 0 ? 'enriched' : 'nothing-to-correct';
}

const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const sorted = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));

/**
 * Review one repo's SBOM. Pure apart from the injected facts: `git` (gitFacts), `licenceRoots`,
 * `osv` (indexOsv result or null when not checked), `osvState`.
 */
export function reviewRepo({ name, path = null, sbom, sbomPath = null, git: g, licenceRoots = [], denoCache = null, osv = null, osvState = 'not-checked', osvNote = '' }) {
  if (!sbom) {
    return { name, path, status: 'no-sbom', sbomPath, note: 'No SBOM was found for this repo, so nothing about it is known. Run with --generate, or sweep it with the sbom-syft check.' };
  }
  const gf = g || { isGit: false, state: () => 'unknown', lockfiles: [], changedSince: () => null, dirty: new Set() };
  const refCache = new Map();
  const refsAt = (loc) => {
    if (!refCache.has(loc)) { let t = null; try { t = readFileSync(join(path, loc), 'utf8'); } catch { /* unreadable -> unverified */ } refCache.set(loc, workflowRefs(t)); }
    return refCache.get(loc);
  };
  const comps = (sbom.components || []).map((c) => {
    const loc = locationOf(c);
    const foundBy = foundByOf(c);
    const kind = kindOf(loc, foundBy, c.type);
    const gitState = loc ? gf.state(loc) : 'unknown';
    const scope = gf.isGit ? scopeOf(loc, kind, gitState) : scopeOf(loc, kind, kind === 'unlocated' ? 'unknown' : 'tracked');
    let licence = sbomLicence(c); let licenceSource = licence ? 'sbom' : '';
    if (!licence) { const got = installedLicence(c, licenceRoots, denoCache); if (got) ({ licence, source: licenceSource } = got); }
    const eco = ecosystemOf(c);
    // JSR has no OSV ecosystem; osv-scanner reads these purls as npm, so a match would be a different package
    const vulns = osv && !NOT_NPM.has(eco) && eco !== 'file' ? (osv.get(`${eco}|${packageName(c)}|${c.version}`) || []) : null;
    return {
      identity: identityOf(c), ecosystem: eco, name: packageName(c), version: c.version || '', purl: c.purl || '',
      location: loc, foundBy, kind, gitState, scope, licence, licenceSource, licenceClass: classifyLicence(licence),
      flags: kind === 'file' ? [] : identityFlags(c, scope, kind === 'workflow' && path ? refsAt(loc) : undefined), vulns,
      provider: providerOf(c), entries: Number(prop(c, /^commitwork:remote-files$/)) || 1,
    };
  }).sort((a, b) => a.identity.localeCompare(b.identity) || a.location.localeCompare(b.location));

  const product = comps.filter((c) => PRODUCT_SCOPES.has(c.scope));
  const licensed = comps.filter((c) => c.scope === 'product');
  const ts = sbom.metadata?.timestamp || (sbomPath ? statSync(sbomPath).mtime.toISOString() : null);
  const tool = (sbom.metadata?.tools?.components || sbom.metadata?.tools || []).map?.((t) => `${t.name} ${t.version || ''}`.trim()).join(', ') || '';

  // lockfiles: which the SBOM read, which it did not, which changed after it was written
  const seen = new Set(comps.map((c) => c.location));
  const lockfiles = gf.lockfiles.map((p) => {
    const at = gf.changedSince(p);
    return { path: p, inSbom: seen.has(p) || (p.endsWith('go.mod') && seen.has(p.replace(/go\.mod$/, 'go.sum'))),
      lastCommit: at, changedAfterSbom: !!(at && ts && Date.parse(at) > Date.parse(ts)), uncommitted: gf.dirty.has(p),
      components: comps.filter((c) => c.location === p).length };
  });

  const versionsByName = {};
  for (const c of product) (versionsByName[`${c.ecosystem}|${c.name}`] ||= new Set()).add(c.version);
  const sprawl = Object.entries(versionsByName).filter(([, v]) => v.size > 1)
    .map(([k, v]) => ({ ecosystem: k.split('|')[0], name: k.split('|').slice(1).join('|'), versions: [...v].sort() }))
    .sort((a, b) => b.versions.length - a.versions.length || a.name.localeCompare(b.name));

  const edges = (sbom.dependencies || []).filter((d) => (d.dependsOn || []).length);
  const inGraph = new Set(edges.flatMap((d) => [d.ref, ...d.dependsOn]));

  const vulnRows = osv ? comps.filter((c) => c.vulns?.length).flatMap((c) => c.vulns.map((v) => ({ ...v, name: c.name, version: c.version, ecosystem: c.ecosystem, scope: c.scope, location: c.location }))) : [];
  const dedupVulns = [...new Map(vulnRows.map((v) => [`${v.scope}|${v.ecosystem}|${v.name}|${v.version}|${v.id}`, v])).values()]
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || Number(b.score || 0) - Number(a.score || 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const review = {
    name, path, status: 'reviewed', sbomPath,
    sbom: { format: `${sbom.bomFormat || '?'} ${sbom.specVersion || ''}`.trim(), tool, timestamp: ts, serialNumber: sbom.serialNumber || null,
      provenance: provenanceState(sbomPath), gitChecked: gf.isGit },
    totals: { components: comps.length, product: product.length, byScope: sorted(count(comps, (c) => c.scope)),
      byEcosystem: sorted(count(comps, (c) => c.ecosystem)), productByEcosystem: sorted(count(product, (c) => c.ecosystem)) },
    sources: Object.entries(count(comps, (c) => `${c.scope}\u0000${c.location || '(no location)'}`))
      .map(([k, n]) => ({ scope: k.split('\u0000')[0], location: k.split('\u0000')[1], components: n }))
      .sort((a, b) => b.components - a.components || a.location.localeCompare(b.location)),
    licences: { total: licensed.length,
      byClass: sorted(count(licensed, (c) => c.licenceClass)),
      bySource: sorted(count(licensed, (c) => c.licenceSource || 'none')),
      byLicence: sorted(count(licensed.filter((c) => c.licence), (c) => c.licence)),
      flagged: licensed.filter((c) => c.licenceClass === 'strong-copyleft' || c.licenceClass === 'weak-copyleft' || c.licenceClass === 'review')
        .map((c) => ({ name: c.name, version: c.version, licence: c.licence, class: c.licenceClass, location: c.location })),
    },
    vulns: { state: osvState, note: osvNote, rows: dedupVulns,
      bySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, dedupVulns.filter((v) => v.severity === s).length])),
      productBySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, dedupVulns.filter((v) => v.severity === s && PRODUCT_SCOPES.has(v.scope)).length])) },
    identity: { byFlag: sorted(count(comps.flatMap((c) => c.flags.map((f) => ({ f, c }))), (x) => x.f)),
      productFlagged: product.filter((c) => c.flags.length).map((c) => ({ name: c.name, version: c.version, flags: c.flags, location: c.location })) },
    lockfiles, sprawl, graph: { edges: edges.length, componentsInGraph: inGraph.size },
    inventory: inventoryOf(comps),
    components: comps,
  };
  review.findings = repoFindings(review);
  return review;
}

// ── findings: what a reader should act on, with the undetermined held apart ────────────────

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '0%');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function repoFindings(r) {
  const f = [];
  const T = r.totals; const nonProduct = T.components - T.product - (T.byScope['source-file'] || 0);
  if (nonProduct) {
    const parts = Object.entries(T.byScope).filter(([s]) => !PRODUCT_SCOPES.has(s) && s !== 'source-file').map(([s, n]) => `${s} ${n}`).join(', ');
    f.push({ level: nonProduct / T.components >= 0.25 ? 'medium' : 'info', area: 'scope',
      title: `${pct(nonProduct, T.components)} of catalogued components are not product dependencies`,
      detail: `${nonProduct} of ${T.components} came from outside the repository's tracked manifests (${parts}). Published as-is, the SBOM states an inventory the product does not have; exclude these paths at scan time or publish the product scope only.` });
  }
  const pv = r.vulns.productBySeverity; const av = r.vulns.bySeverity;
  if (r.vulns.state === 'checked') {
    const pTotal = SEVERITIES.reduce((s, k) => s + pv[k], 0); const aTotal = SEVERITIES.reduce((s, k) => s + av[k], 0);
    if (pTotal) f.push({ level: pv.critical || pv.high ? 'high' : pv.medium ? 'medium' : 'low', area: 'vulnerabilities',
      title: `${plural(pTotal, 'known vulnerability', 'known vulnerabilities')} in product dependencies`,
      detail: `critical ${pv.critical}, high ${pv.high}, medium ${pv.medium}, low ${pv.low}, unscored ${pv.unscored}. A version match against OSV, not a reachability proof.` });
    if (aTotal - pTotal) f.push({ level: 'low', area: 'vulnerabilities',
      title: `${plural(aTotal - pTotal, 'known vulnerability', 'known vulnerabilities')} outside the product scope`,
      detail: 'In local tool binaries, installed trees or vendored code: they bear on this machine and its tooling, not on what the product ships.' });
    if (!aTotal) f.push({ level: 'info', area: 'vulnerabilities', title: 'No known vulnerabilities matched', detail: 'Every component with a purl was looked up on OSV; none matched an advisory.' });
    if (pv.unscored) f.push({ level: 'unknown', area: 'vulnerabilities', title: `${plural(pv.unscored, 'product advisory', 'product advisories')} carry no severity score`, detail: 'Unscored is not low: read each advisory before ranking it.' });
  } else {
    f.push({ level: 'unknown', area: 'vulnerabilities', title: r.vulns.state === 'failed' ? 'Vulnerability lookup failed' : 'Vulnerabilities not checked',
      detail: r.vulns.note || 'Run with --vulns (osv-scanner) or pass --osv <result.json>. Not checked is not clean.' });
  }
  const lc = r.licences.byClass;
  if (lc['strong-copyleft']) f.push({ level: 'medium', area: 'licences', title: `${plural(lc['strong-copyleft'], 'product dependency', 'product dependencies')} under a strong copyleft licence`, detail: 'GPL/AGPL/SSPL-family terms can reach the product\'s own licence. Confirm how each is linked or distributed.' });
  if (lc['weak-copyleft']) f.push({ level: 'low', area: 'licences', title: `${plural(lc['weak-copyleft'], 'product dependency', 'product dependencies')} under a weak copyleft licence`, detail: 'LGPL/MPL/EPL-family: obligations attach to modifications of the component itself.' });
  if (lc.review) f.push({ level: 'low', area: 'licences', title: `${plural(lc.review, 'product dependency', 'product dependencies')} under a licence this review does not classify`, detail: 'Read the terms; unclassified is neither permissive nor a problem until someone has.' });
  const jsrUnknown = r.components.filter((c) => c.scope === 'product' && NOT_NPM.has(c.ecosystem) && c.licenceClass === 'unknown').length;
  if (lc.unknown) f.push({ level: 'unknown', area: 'licences', title: `Licence unknown for ${lc.unknown} of ${r.licences.total} declared dependencies`,
    detail: `The SBOM records a licence for ${r.licences.bySource.sbom || 0}; ${(r.licences.bySource['installed-package'] || 0) + (r.licences.bySource['deno-cache'] || 0)} more from package.json files on this disk (installed trees, Deno's npm cache).${jsrUnknown ? ` ${jsrUnknown} of the unknown are JSR packages or URL imports, whose licence is not kept anywhere this review reads.` : ''} Undetermined, not clear.` });
  const mutable = r.identity.productFlagged.filter((c) => c.flags.includes('mutable-action-ref'));
  const mutableIds = [...new Set(mutable.map((c) => `${c.name}@${c.version}`))];
  if (mutable.length) f.push({ level: 'medium', area: 'supply chain', title: `${plural(mutableIds.length, 'GitHub Action')} pinned by tag, not commit SHA (${plural(mutable.length, 'use')})`,
    detail: `${mutableIds.slice(0, 8).join(', ')}${mutableIds.length > 8 ? ', …' : ''}. A tag can be moved to different code after review; pin to the full SHA.` });
  const flagged = (flag) => r.identity.productFlagged.filter((c) => c.flags.includes(flag));
  if (flagged('unverified-action-ref').length) f.push({ level: 'unknown', area: 'supply chain', title: `${plural(flagged('unverified-action-ref').length, 'GitHub Action use')} whose pinning could not be read`,
    detail: 'The workflow file was not readable, and the SBOM\'s version is not the ref (syft reports a SHA pin by its comment), so pinned or not is undetermined.' });
  if (flagged('pseudo-version').length) f.push({ level: 'low', area: 'identity', title: `${plural(flagged('pseudo-version').length, 'product dependency', 'product dependencies')} on an unreleased commit (pseudo-version)`, detail: `${flagged('pseudo-version').slice(0, 6).map((c) => `${c.name}@${c.version}`).join(', ')}. No release tag names this code, so advisories and changelogs may not map to it.` });
  if (flagged('prerelease').length) f.push({ level: 'low', area: 'identity', title: `${plural(flagged('prerelease').length, 'product dependency', 'product dependencies')} on a pre-release version`, detail: flagged('prerelease').slice(0, 8).map((c) => `${c.name}@${c.version}`).join(', ') });
  const weak = r.components.filter((c) => c.flags.includes('no-purl') || c.flags.includes('unknown-version'));
  const weakProduct = weak.filter((c) => PRODUCT_SCOPES.has(c.scope)).length;
  if (weak.length) f.push({ level: 'unknown', area: 'identity', title: `${plural(weak.length, 'component')} without a purl or a version (${weakProduct} in product scope)`,
    detail: `${weak.slice(0, 6).map((c) => `${c.name}@${c.version || '?'}`).join(', ')}. These cannot be looked up against any advisory database; they are unidentified, not safe.` });
  if (r.sbom.provenance === 'unenriched') f.push({ level: 'unknown', area: 'identity', title: 'Provenance enrichment did not run on this SBOM', detail: 'A git- or URL-sourced dependency may be asserting a registry identity it does not have (see monitor/sbom-provenance.mjs).' });
  if (r.sbom.provenance === 'no-resolution-data') f.push({ level: 'unknown', area: 'identity', title: 'No component records where it was resolved from', detail: 'syft\'s native document was read, but no lockfile entry carries a resolved source (deno.lock records none), so a git- or URL-sourced dependency could not be told apart from a registry one.' });
  const jsr = (r.totals.productByEcosystem.JSR || 0) + (r.totals.productByEcosystem.URL || 0);
  if (jsr && r.vulns.state === 'checked') f.push({ level: 'unknown', area: 'vulnerabilities', title: `${plural(jsr, 'JSR package or URL import', 'JSR packages and URL imports')} not looked up`,
    detail: 'syft writes JSR packages and remote URL imports (deno.land, esm.sh) as npm purls qualified with their real registry. OSV has no ecosystem for them, and an npm lookup would check a different package, so these are unchecked rather than clean.' });
  const stale = r.lockfiles.filter((l) => l.changedAfterSbom || l.uncommitted);
  if (stale.length) f.push({ level: 'medium', area: 'freshness', title: `SBOM predates changes to ${plural(stale.length, 'lockfile')}`,
    detail: `${stale.map((l) => l.path + (l.uncommitted ? ' (uncommitted)' : '')).join(', ')}. Regenerate before relying on it.` });
  const missing = r.lockfiles.filter((l) => !l.inSbom);
  if (missing.length) f.push({ level: 'unknown', area: 'coverage', title: `${plural(missing.length, 'tracked lockfile')} not represented in the SBOM`,
    detail: `${missing.map((l) => l.path).join(', ')}. Either empty, or not catalogued — the scanner's silence is not a statement that they declare nothing.` });
  if (!r.sbom.gitChecked) f.push({ level: 'unknown', area: 'scope', title: 'Not a git checkout: tracked/ignored was not checked', detail: 'Scopes are inferred from file kind alone.' });
  if (r.sprawl.length) f.push({ level: 'low', area: 'hygiene', title: `${plural(r.sprawl.length, 'package')} installed at more than one version`, detail: `${r.sprawl.slice(0, 6).map((s) => `${s.name} (${s.versions.join(', ')})`).join('; ')}. Each extra version is another copy to patch; one version per package is the goal.` });
  const multi = (r.inventory || []).flatMap((p) => p.packages).filter((p) => p.versions.some((v) => v.instances.length > 1));
  if (multi.length) f.push({ level: 'info', area: 'hygiene', title: `${plural(multi.length, 'package')} declared in more than one place at the same version`,
    detail: 'Multiple instances of one installation (the same version in several lockfiles) are not drift: they patch together. Listed in the inventory.' });
  if (T.product && r.graph.componentsInGraph < T.product) f.push({ level: 'info', area: 'graph', title: 'Direct vs transitive is undetermined for most components',
    detail: `The dependency graph links ${r.graph.componentsInGraph} components through ${plural(r.graph.edges, 'entry', 'entries')}; the rest carry no edges, so "is this a direct dependency" cannot be answered from this document.` });
  return f;
}

export const LEVELS = ['high', 'medium', 'low', 'unknown', 'info'];

// ── group ───────────────────────────────────────────────────────────────────────────────────

export function reviewGroup({ target, label, kind, repos, generatedAt, notes = [] }) {
  const done = repos.filter((r) => r.status === 'reviewed');
  const owners = new Map();
  for (const r of done) for (const c of r.components) if (PRODUCT_SCOPES.has(c.scope)) {
    const k = `${c.ecosystem}|${c.name}`;
    if (!owners.has(k)) owners.set(k, { ecosystem: c.ecosystem, name: c.name, byRepo: {} });
    (owners.get(k).byRepo[r.name] ||= new Set()).add(c.version);
  }
  const drift = []; const shared = [];
  for (const o of owners.values()) {
    const repoNames = Object.keys(o.byRepo).sort();
    if (repoNames.length < 2) continue;
    const versions = [...new Set(repoNames.flatMap((n) => [...o.byRepo[n]]))].sort();
    const row = { ecosystem: o.ecosystem, name: o.name, repos: Object.fromEntries(repoNames.map((n) => [n, [...o.byRepo[n]].sort()])), versions };
    (versions.length > 1 ? drift : shared).push(row);
  }
  drift.sort((a, b) => a.name.localeCompare(b.name)); shared.sort((a, b) => a.name.localeCompare(b.name));
  const sum = (f) => done.reduce((s, r) => s + f(r), 0);
  const findings = repos.flatMap((r) => (r.status === 'reviewed' ? r.findings.map((x) => ({ ...x, repo: r.name }))
    : [{ level: 'unknown', area: 'coverage', repo: r.name, title: 'No SBOM — not reviewed', detail: r.note }]));
  if (drift.length) findings.push({ level: 'low', area: 'hygiene', repo: null, title: `${plural(drift.length, 'package')} at different versions across repos`, detail: drift.slice(0, 6).map((d) => `${d.name} (${d.versions.join(', ')})`).join('; ') });
  findings.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
  return {
    schema: 'commitwork.sbom-review/1', generatedAt, target, label: label || target, kind, notes,
    summary: {
      repos: repos.length, reviewed: done.length, notReviewed: repos.length - done.length,
      components: sum((r) => r.totals.components), product: sum((r) => r.totals.product),
      uniqueProduct: owners.size,
      vulnsChecked: done.filter((r) => r.vulns.state === 'checked').length,
      productVulns: Object.fromEntries(SEVERITIES.map((s) => [s, sum((r) => r.vulns.productBySeverity[s])])),
      findings: Object.fromEntries(LEVELS.map((l) => [l, findings.filter((x) => x.level === l).length])),
    },
    findings, drift, shared, repos,
  };
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────

const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Undetermined', info: 'Note' };

export function renderMarkdown(g) {
  const L = [];
  L.push(`# SBOM review — ${g.label}`, '');
  L.push(`Generated by bin/sbom-review.mjs at ${g.generatedAt} · ${g.kind} \`${g.target}\` · ${g.summary.reviewed} of ${g.summary.repos} repos reviewed`, '');
  const s = g.summary;
  L.push(`**${s.components}** components catalogued, **${s.product}** of them product dependencies (${s.uniqueProduct} distinct packages).`);
  L.push(`Vulnerabilities checked for ${s.vulnsChecked} of ${s.reviewed} repos — product: critical ${s.productVulns.critical}, high ${s.productVulns.high}, medium ${s.productVulns.medium}, low ${s.productVulns.low}, unscored ${s.productVulns.unscored}.`, '');
  for (const n of g.notes) L.push(`> ${n}`);
  if (g.notes.length) L.push('');
  L.push('## Findings', '');
  if (!g.findings.length) L.push('_None._', '');
  for (const f of g.findings) L.push(`- **${LEVEL_LABEL[f.level]}** · ${f.area}${f.repo && g.repos.length > 1 ? ` · ${f.repo}` : ''} — ${f.title}. ${f.detail}`);
  L.push('');
  for (const r of g.repos) {
    L.push(`## ${r.name}`, '');
    if (r.status !== 'reviewed') { L.push(`Not reviewed: ${r.note}`, ''); continue; }
    L.push(`SBOM: ${r.sbom.format}, ${r.sbom.tool || 'tool unrecorded'}, written ${r.sbom.timestamp || 'at an unrecorded time'}; provenance ${r.sbom.provenance}.`, '');
    L.push('| Scope | Components | Meaning |', '|---|---:|---|');
    for (const [k, n] of Object.entries(r.totals.byScope)) L.push(`| ${k} | ${n} | ${SCOPES[k]} |`);
    L.push('', '### Where they came from', '', '| Scope | Source | Components |', '|---|---|---:|');
    for (const x of r.sources) L.push(`| ${x.scope} | \`${x.location}\` | ${x.components} |`);
    L.push('', '### Lockfiles', '', '| Lockfile | In SBOM | Components | Last commit | Changed after SBOM |', '|---|---|---:|---|---|');
    for (const l of r.lockfiles) L.push(`| \`${l.path}\` | ${l.inSbom ? 'yes' : '**no**'} | ${l.components} | ${l.lastCommit || '–'} | ${l.uncommitted ? '**uncommitted changes**' : l.changedAfterSbom ? '**yes**' : 'no'} |`);
    if (!r.lockfiles.length) L.push('| _none tracked_ | | | | |');
    L.push('', '### Licences (product scope)', '');
    L.push(Object.entries(r.licences.byClass).map(([k, n]) => `${k} ${n}`).join(' · ') || '_no product components_');
    if (r.licences.flagged.length) { L.push('', '| Package | Version | Licence | Class |', '|---|---|---|---|'); for (const x of r.licences.flagged) L.push(`| ${x.name} | ${x.version} | ${x.licence} | ${x.class} |`); }
    L.push('', '### Vulnerabilities', '');
    if (r.vulns.state !== 'checked') L.push(`_${r.vulns.state}_ — ${r.vulns.note || 'not checked is not clean.'}`);
    else if (!r.vulns.rows.length) L.push('No OSV advisory matched.');
    else {
      L.push('| Severity | Package | Version | Advisory | Scope | Fixed in |', '|---|---|---|---|---|---|');
      for (const v of r.vulns.rows) L.push(`| ${v.severity}${v.score ? ` (${v.score})` : ''} | ${v.name} | ${v.version} | ${v.id}${v.cve ? ` / ${v.cve}` : ''} | ${v.scope} | ${v.fixed.slice(0, 3).join(', ') || '–'} |`);
    }
    L.push('', '### Inventory by provider', '', 'Installations are distinct versions of a package; instances are the places one version is declared.');
    for (const p of r.inventory || []) {
      L.push('', `#### ${p.provider} (${p.packages.length})`, '', '| Package | Installations | Instances | Versions and where declared |', '|---|---:|---:|---|');
      for (const k of p.packages) {
        L.push(`| ${k.name} | ${k.installations} | ${k.instances} | ${k.versions.map((v) => `${v.version}: ${v.instances.map((i) => `\`${i.location}\`${i.entries > 1 ? ` ×${i.entries}` : ''}`).join(', ')}`).join('<br>')} |`);
      }
    }
    L.push('');
  }
  if (g.drift.length) {
    L.push('## Version drift across repos', '', '| Package | ' + g.repos.filter((r) => r.status === 'reviewed').map((r) => r.name).join(' | ') + ' |', '|---|' + g.repos.filter((r) => r.status === 'reviewed').map(() => '---|').join(''));
    for (const d of g.drift) L.push(`| ${d.name} | ${g.repos.filter((r) => r.status === 'reviewed').map((r) => (d.repos[r.name] || ['–']).join(', ')).join(' | ')} |`);
    L.push('');
  }
  return L.join('\n');
}

const CSS = `${ROOT_CSS}
:root{--hi:#b3261e;--md:#a15c00;--lo:#3f6f9f;--un:#6b6961}
@media (prefers-color-scheme: dark){:root{--hi:#ff6b5e;--md:#f0a640;--lo:#8ab4f8;--un:#98958e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--sans)}
main{max-width:1180px;margin:0 auto;padding:28px 16px 64px}
header{display:flex;gap:14px;align-items:center;margin-bottom:6px}header svg{width:36px;height:36px;flex:none}
h1{font-size:24px;margin:0;color:var(--head)}h2{font-size:19px;margin:36px 0 10px;color:var(--head);border-bottom:1px solid var(--line);padding-bottom:6px}
h3{font-size:15px;margin:22px 0 8px;color:var(--head)}.sub{color:var(--mut);margin:0 0 20px;font-size:13px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px}.tile b{display:block;font-size:24px;color:var(--head);font-variant-numeric:tabular-nums}.tile span{font-size:12px;color:var(--mut)}
.note{background:var(--wash);border-left:3px solid var(--acc);padding:8px 12px;margin:10px 0;font-size:13px}
table{border-collapse:collapse;width:100%;background:var(--panel);border:1px solid var(--line);font-size:13px;margin:6px 0 4px}
th,td{text-align:left;padding:6px 9px;border-bottom:1px solid var(--line);vertical-align:top}th{background:var(--panel2);font-weight:600;color:var(--head)}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}code{font:12px var(--mono);word-break:break-all}
.wrap{overflow-x:auto}.lv{display:inline-block;min-width:96px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.high{color:var(--hi)}.medium{color:var(--md)}.low{color:var(--lo)}.unknown{color:var(--un)}.info{color:var(--mut)}
.critical{color:var(--hi);font-weight:700}.unscored{color:var(--un)}
.bar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--panel2);margin:8px 0 4px}.bar i{display:block;height:100%}
.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--mut)}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.findings li{margin:6px 0;list-style:none}.findings{padding:0}.findings .d{color:var(--mut);font-size:13px}
details{margin:8px 0}summary{cursor:pointer;color:var(--acc2)}
th[aria-sort]{cursor:pointer;user-select:none}th[aria-sort="ascending"]::after{content:" ▲"}th[aria-sort="descending"]::after{content:" ▼"}
th[aria-sort]:focus-visible{outline:2px solid var(--acc);outline-offset:-2px}
input.tfilter,#filter-all{font:13px var(--sans);padding:5px 8px;margin:8px 0 2px;width:min(320px,100%);border:1px solid var(--line2);border-radius:6px;background:var(--panel);color:var(--ink)}
`;
const SCOPE_COLOUR = { product: 'var(--ok)', ci: 'var(--acc)', binary: '#8a6bbf', installed: 'var(--line2)', vendored: 'var(--mut)', 'local-only': 'var(--lo)', unknown: 'var(--un)' };

const h = (v) => esc(v ?? '');
// A cell is HTML, or { html, sort } when what it shows is not what it should sort by.
const cell = (x, num) => {
  const o = x !== null && typeof x === 'object' ? x : { html: x };
  return `<td${num ? ' class="n"' : ''}${o.sort !== undefined ? ` data-sort="${h(o.sort)}"` : ''}>${o.html}</td>`;
};
const table = (head, rows, numeric = []) => `<div class="wrap"><table><thead><tr>${head.map((x, i) => `<th${numeric.includes(i) ? ' class="n"' : ''}>${h(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((x, i) => cell(x, numeric.includes(i))).join('')}</tr>`).join('')}</tbody></table></div>`;

// Inline, no dependencies, file:// safe: click or Enter on a heading sorts, the box above a table filters it.
const TABLE_JS = `(()=>{const num=v=>v!==''&&!isNaN(Number(v));
const rowsOf=b=>[...b.querySelectorAll(':scope>tr')];
const key=(r,i)=>{const c=r.querySelectorAll(':scope>td')[i];if(!c)return'';const s=c.getAttribute('data-sort');return s!==null?s:c.textContent.trim();};
document.querySelectorAll('table').forEach(t=>{const body=t.querySelector(':scope>tbody');const ths=[...t.querySelectorAll(':scope>thead>tr>th')];if(!body||!ths.length)return;
ths.forEach((th,i)=>{th.tabIndex=0;th.setAttribute('aria-sort','none');th.title='Sort';
const go=()=>{const asc=th.getAttribute('aria-sort')!=='ascending';ths.forEach(x=>x.setAttribute('aria-sort','none'));th.setAttribute('aria-sort',asc?'ascending':'descending');
rowsOf(body).sort((a,b)=>{const x=key(a,i),y=key(b,i);const d=num(x)&&num(y)?Number(x)-Number(y):x.localeCompare(y,undefined,{numeric:true,sensitivity:'base'});return asc?d:-d;}).forEach(r=>body.appendChild(r));};
th.addEventListener('click',go);th.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});});
const n=rowsOf(body).length;if(n>5){const f=document.createElement('input');f.type='search';f.className='tfilter';f.placeholder='Filter '+n+' rows';f.setAttribute('aria-label','Filter this table');
f.addEventListener('input',()=>{const q=f.value.trim().toLowerCase();rowsOf(body).forEach(r=>{r.hidden=!!q&&!r.textContent.toLowerCase().includes(q);});});
(t.closest('.wrap')||t).before(f);}});
const g=document.getElementById('filter-all');if(g)g.addEventListener('input',()=>{document.querySelectorAll('input.tfilter').forEach(f=>{f.value=g.value;f.dispatchEvent(new Event('input'));});});})();`;

function scopeBar(byScope, total) {
  const seg = Object.entries(byScope).map(([k, n]) => `<i style="width:${(100 * n) / total}%;background:${SCOPE_COLOUR[k]}" title="${h(k)} ${n}"></i>`).join('');
  const leg = Object.entries(byScope).map(([k, n]) => `<span><i style="background:${SCOPE_COLOUR[k]}"></i>${h(k)} ${n}</span>`).join('');
  return `<div class="bar" role="img" aria-label="components by scope">${seg}</div><div class="legend">${leg}</div>`;
}

/** Provider -> package rows; each row lists its installations (versions) and their instances (where declared). */
function renderInventory(inv) {
  if (!inv.length) return '';
  const pkgs = inv.flatMap((p) => p.packages);
  const multiInstall = pkgs.filter((p) => p.installations > 1).length;
  const multiInstance = pkgs.filter((p) => p.versions.some((v) => v.instances.length > 1)).length;
  const o = ['<h3>Inventory by provider</h3>',
    `<p class="sub">${pkgs.length} packages. <b>Installations</b> are distinct versions of a package (${multiInstall} packages have more than one); <b>instances</b> are the places one version is declared (${multiInstance} packages have a version declared in more than one place). Entries count SBOM components behind an instance, more than one when a remote package was catalogued per file.</p>`];
  for (const p of inv) {
    const rows = p.packages.map((k) => [
      { html: `<b>${h(k.name)}</b>`, sort: k.name },
      { html: k.installations > 1 ? `<b class="low">${k.installations}</b>` : '1', sort: k.installations },
      { html: String(k.instances), sort: k.instances },
      { html: k.versions.map((v) => `<div><code>${h(v.version)}</code> — ${v.instances.map((i) => `<code>${h(i.location)}</code>${i.scope === 'product' ? '' : ` <span class="sub">${h(i.scope)}</span>`}${i.entries > 1 ? ` <span class="sub">×${i.entries} entries</span>` : ''}`).join(', ')}</div>`).join(''), sort: k.versions.map((v) => v.version).join(' ') },
      { html: k.licences.length ? h(k.licences.join(', ')) : '<span class="unknown">unknown</span>', sort: k.licences.join(', ') || '~' },
      { html: k.vulns === null ? '<span class="unknown">not checked</span>' : k.vulns ? `<b class="high">${k.vulns}</b>` : '0', sort: k.vulns ?? -1 },
    ]);
    o.push(`<details open><summary>${h(p.provider)} — ${p.packages.length} package${p.packages.length === 1 ? '' : 's'}</summary>${table(['Package', 'Installations', 'Instances', 'Versions and where declared', 'Licence', 'Vulns'], rows, [1, 2, 5])}</details>`);
  }
  return o.join('\n');
}

function renderRepoHtml(r, multi) {
  if (r.status !== 'reviewed') return `<h2>${h(r.name)}</h2><p class="note">Not reviewed: ${h(r.note)}</p>`;
  const o = [];
  o.push(`<h2>${h(r.name)}</h2>`);
  o.push(`<p class="sub">${h(r.sbom.format)} · ${h(r.sbom.tool || 'tool unrecorded')} · written ${h(r.sbom.timestamp || 'at an unrecorded time')} · provenance <b>${h(r.sbom.provenance)}</b>${r.path ? ` · <code>${h(r.path)}</code>` : ''}</p>`);
  if (multi) o.push(`<ul class="findings">${r.findings.map((f) => `<li><span class="lv ${f.level}">${LEVEL_LABEL[f.level]}</span> <b>${h(f.title)}</b><div class="d">${h(f.detail)}</div></li>`).join('')}</ul>`);
  o.push('<h3>Scope</h3>', scopeBar(r.totals.byScope, r.totals.components));
  o.push(table(['Scope', 'Components', 'Meaning'], Object.entries(r.totals.byScope).map(([k, n]) => [h(k), n, h(SCOPES[k])]), [1]));
  o.push('<h3>Where the components came from</h3>');
  o.push(table(['Scope', 'Source file', 'Components'], r.sources.map((x) => [h(x.scope), `<code>${h(x.location)}</code>`, x.components]), [2]));
  o.push('<h3>Lockfiles the repository tracks</h3>');
  o.push(r.lockfiles.length ? table(['Lockfile', 'In SBOM', 'Components', 'Last commit', 'Changed after SBOM'], r.lockfiles.map((l) => [`<code>${h(l.path)}</code>`, l.inSbom ? 'yes' : '<b class="unknown">no</b>', l.components, h(l.lastCommit || '–'), l.uncommitted ? '<b class="medium">uncommitted changes</b>' : l.changedAfterSbom ? '<b class="medium">yes</b>' : 'no']), [2]) : '<p class="sub">No tracked lockfiles.</p>');
  o.push('<h3>Product dependencies by ecosystem</h3>');
  o.push(table(['Ecosystem', 'Components'], Object.entries(r.totals.productByEcosystem).map(([k, n]) => [h(k), n]), [1]));
  o.push('<h3>Licences (product scope)</h3>');
  o.push(`<p>${Object.entries(r.licences.byClass).map(([k, n]) => `<span class="${k === 'unknown' ? 'unknown' : k === 'strong-copyleft' ? 'medium' : ''}">${h(k)} <b>${n}</b></span>`).join(' · ') || 'No product components.'}</p>`);
  o.push(`<p class="sub">Licence source: ${Object.entries(r.licences.bySource).map(([k, n]) => `${h(k)} ${n}`).join(' · ')}</p>`);
  if (Object.keys(r.licences.byLicence).length) o.push(`<details><summary>Licences seen (${Object.keys(r.licences.byLicence).length})</summary>${table(['Licence', 'Components'], Object.entries(r.licences.byLicence).map(([k, n]) => [h(k), n]), [1])}</details>`);
  if (r.licences.flagged.length) o.push(table(['Package', 'Version', 'Licence', 'Class'], r.licences.flagged.map((x) => [h(x.name), h(x.version), h(x.licence || '—'), `<span class="${x.class === 'strong-copyleft' ? 'medium' : 'low'}">${h(x.class)}</span>`])));
  o.push('<h3>Known vulnerabilities</h3>');
  if (r.vulns.state !== 'checked') o.push(`<p class="note"><b>${h(r.vulns.state)}</b> — ${h(r.vulns.note || 'not checked is not clean.')}</p>`);
  else if (!r.vulns.rows.length) o.push('<p>No OSV advisory matched any component.</p>');
  else {
    o.push(`<p class="sub">${SEVERITIES.map((s) => `${s} ${r.vulns.bySeverity[s]}`).join(' · ')} (all scopes) — a version match, not a reachability proof.</p>`);
    o.push(table(['Severity', 'Package', 'Version', 'Advisory', 'Scope', 'Fixed in', 'Summary'], r.vulns.rows.map((v) => [
      `<span class="${v.severity}">${h(v.severity)}${v.score ? ` ${h(v.score)}` : ''}</span>`, h(v.name), `<code>${h(v.version)}</code>`, `${h(v.id)}${v.cve ? `<br><span class="sub">${h(v.cve)}</span>` : ''}`,
      PRODUCT_SCOPES.has(v.scope) ? `<b>${h(v.scope)}</b>` : h(v.scope), h(v.fixed.slice(0, 3).join(', ') || '–'), h(v.summary)])));
  }
  if (r.identity.productFlagged.length) {
    o.push('<h3>Identity and pinning (product scope)</h3>');
    o.push(table(['Package', 'Version', 'Flags', 'Source'], r.identity.productFlagged.map((c) => [h(c.name), `<code>${h(c.version)}</code>`, h(c.flags.join(', ')), `<code>${h(c.location)}</code>`])));
  }
  o.push(renderInventory(r.inventory || []));
  return o.join('\n');
}

export function renderHtml(g) {
  const s = g.summary; const multi = g.repos.length > 1;
  const pv = s.productVulns;
  const tiles = [
    [s.components, 'components catalogued'], [s.product, 'product dependencies'], [s.uniqueProduct, 'distinct product packages'],
    [s.vulnsChecked === s.reviewed && s.reviewed ? pv.critical + pv.high : '–', s.vulnsChecked ? 'critical + high in product' : 'vulnerabilities not checked'],
    [s.findings.high + s.findings.medium, 'high + medium findings'], [s.findings.unknown, 'undetermined'],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SBOM review — ${h(g.label)}</title><style>${CSS}</style></head><body><main>
<header>${SEAL_SVG}<h1>SBOM review — ${h(g.label)}</h1></header>
<p class="sub">${h(g.kind)} <code>${h(g.target)}</code> · ${s.reviewed} of ${s.repos} repos reviewed · generated ${h(g.generatedAt)} by commitwork bin/sbom-review.mjs</p>
${g.notes.map((n) => `<p class="note">${h(n)}</p>`).join('')}
<label class="sub" for="filter-all">Filter every table </label><input id="filter-all" type="search" placeholder="package, version, lockfile, licence…">
<div class="tiles">${tiles.map(([n, l]) => `<div class="tile"><b>${h(n)}</b><span>${h(l)}</span></div>`).join('')}</div>
<h2>Findings</h2>
${g.findings.length ? `<ul class="findings">${g.findings.map((f) => `<li><span class="lv ${f.level}">${LEVEL_LABEL[f.level]}</span> <b>${h(f.title)}</b>${multi && f.repo ? ` <span class="sub">· ${h(f.repo)}</span>` : ''}<div class="d">${h(f.detail)}</div></li>`).join('')}</ul>` : '<p>None.</p>'}
<p class="sub">Undetermined is its own state: it is never counted as clean and never as a finding against the code.</p>
${multi ? `<h2>Repos</h2>${table(['Repo', 'Status', 'Components', 'Product', 'Vulns (product, crit+high)', 'SBOM written'], g.repos.map((r) => r.status === 'reviewed'
    ? [h(r.name), 'reviewed', r.totals.components, r.totals.product, r.vulns.state === 'checked' ? r.vulns.productBySeverity.critical + r.vulns.productBySeverity.high : `<span class="unknown">${h(r.vulns.state)}</span>`, h(r.sbom.timestamp || '–')]
    : [h(r.name), '<span class="unknown">no SBOM</span>', '–', '–', '–', '–']), [2, 3, 4])}` : ''}
${g.drift.length ? `<h2>Version drift across repos</h2>${table(['Package', ...g.repos.filter((r) => r.status === 'reviewed').map((r) => r.name)], g.drift.map((d) => [h(d.name), ...g.repos.filter((r) => r.status === 'reviewed').map((r) => h((d.repos[r.name] || ['–']).join(', ')))]))}` : ''}
${g.repos.map((r) => renderRepoHtml(r, multi)).join('\n')}
</main><script>${TABLE_JS}</script></body></html>
`;
}

// ── IO: locating, generating, scanning ──────────────────────────────────────────────────────

const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Newest scanned SBOM for a repo under reportsRoot (<batch>/<repo>/sbom-*.json), or null. */
export function findScannedSbom(reportsRoot, repoName) {
  let batches; try { batches = readdirSync(reportsRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'sbom-review'); } catch { return null; }
  let best = null;
  for (const b of batches) {
    for (const f of SBOM_FILES) {
      const p = join(reportsRoot, b.name, repoName, f);
      if (!existsSync(p)) continue;
      // an unparseable SBOM is still the newest candidate; the caller reports it unreadable, never absent
      let ts; try { ts = readJSON(p).metadata?.timestamp || statSync(p).mtime.toISOString(); } catch { ts = statSync(p).mtime.toISOString(); }
      const rank = SBOM_FILES.indexOf(f);
      if (!best || ts > best.ts || (ts === best.ts && rank < best.rank)) best = { path: p, ts, rank };
      break;
    }
  }
  return best?.path || null;
}

async function generateSbom(repoPath, dir) {
  const { run } = await import('./sbom-syft.mjs');
  const code = run(dir, { cwd: repoPath });
  if (code !== 0) throw Object.assign(new Error(`syft exited ${code}`), { status: code });
  return join(dir, 'sbom-syft.json');
}

function runOsv(sbomPath, dir) {
  mkdirSync(dir, { recursive: true });
  const copy = join(dir, 'sbom.cdx.json'); copyFileSync(sbomPath, copy);
  let out;
  try { out = execFileSync('osv-scanner', ['scan', 'source', '-L', copy, '--format', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 << 20 }); } catch (e) {
    if (e.status === 1 && e.stdout) out = e.stdout; // exit 1 = advisories found
    else return { state: 'failed', note: `osv-scanner ${e.code === 'ENOENT' ? 'is not installed' : `exited ${e.status}: ${String(e.stderr || '').trim().split('\n').pop()}`}` };
  }
  writeAtomic(join(dir, 'osv.json'), out);
  try { return { state: 'checked', doc: JSON.parse(out), note: 'osv-scanner against the SBOM (name + version sent to osv.dev)' }; } catch (e) { return { state: 'failed', note: `osv-scanner output unreadable: ${e.message}` }; }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const o = { repos: [], generate: false, vulns: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const v = () => argv[++i];
    if (a === '--project') o.project = v();
    else if (a === '--group' || a === '--area') o.group = v();
    else if (a === '--repo') o.repos.push(v());
    else if (a === '--name') o.name = v();
    else if (a === '--sbom') o.sbom = v();
    else if (a === '--osv') o.osv = v();
    else if (a === '--generate') o.generate = true;
    else if (a === '--vulns') o.vulns = true;
    else if (a === '--reports') o.reports = v();
    else if (a === '--out') o.out = v();
    else if (a === '--label') o.label = v();
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return o;
}

async function resolveTarget(o) {
  const notes = [];
  if (o.group && o.repos.length) {
    const repos = o.repos.map((p) => ({ name: basename(resolve(p)), path: resolve(p) }));
    notes.push(`An ad-hoc group: the repos named with --repo, not resolved from the registry.`);
    return { kind: 'group', target: o.group, repos, notes, reg: null };
  }
  if (o.project || o.group) {
    const { loadRegistry, areaRepos } = await import('../monitor/registry.mjs');
    const { resolveRepos } = await import('../monitor/discover.mjs');
    const reg = loadRegistry({ quiet: true });
    const all = resolveRepos(reg, { selfRoot: null }).repos;
    if (o.project) {
      const r = all.find((x) => x.name === o.project);
      if (!r) throw new Error(`no project named '${o.project}' resolves in the registry`);
      return { kind: 'project', target: o.project, repos: [{ name: r.name, path: r.path }], notes, reg };
    }
    const a = areaRepos(o.group, reg, { repos: all });
    if (a.status !== 'mapped') throw new Error(a.reason);
    return { kind: 'group', target: o.group, repos: a.repos.map((r) => ({ name: r.name, path: r.path })), notes, reg };
  }
  if (o.repos.length) {
    const repos = o.repos.map((p) => ({ name: o.repos.length === 1 && o.name ? o.name : basename(resolve(p)), path: resolve(p) }));
    return { kind: repos.length > 1 ? 'group' : 'project', target: repos.length > 1 ? 'ad-hoc' : repos[0].name, repos, notes, reg: null };
  }
  if (o.sbom) return { kind: 'project', target: o.name || basename(dirname(resolve(o.sbom))), repos: [{ name: o.name || basename(dirname(resolve(o.sbom))), path: null }], notes, reg: null };
  throw new Error('name a target: --project <name>, --group <area>, --repo <path> or --sbom <file>');
}

export async function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  if (o.help) { process.stdout.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1).filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n'); return 0; }
  const t = await resolveTarget(o);
  if ((o.sbom || o.osv) && t.repos.length !== 1) throw new Error('--sbom and --osv apply to a single repo');
  const reportsRoot = resolve(process.env.CW_SBOM_REVIEW_REPORTS || o.reports || join(CW, t.reg?.reportsRoot || 'reports'));
  const outDir = resolve(o.out || join(CW, 'reports', 'sbom-review', t.target));
  mkdirSync(outDir, { recursive: true });
  const generatedAt = process.env.CW_NOW || new Date().toISOString();

  const reviews = [];
  for (const r of t.repos) {
    const work = join(outDir, r.name);
    let sbomPath = o.sbom ? resolve(o.sbom) : null;
    if (!sbomPath && o.generate && r.path) {
      process.stderr.write(`syft: ${r.name}…\n`);
      try { sbomPath = await generateSbom(r.path, work); } catch (e) { t.notes.push(`${r.name}: syft failed (${e.code === 'ENOENT' ? 'not installed' : `exit ${e.status}`})`); }
    }
    if (!sbomPath) sbomPath = findScannedSbom(reportsRoot, r.name);
    let sbom = null;
    if (sbomPath) { try { sbom = readJSON(sbomPath); } catch (e) { t.notes.push(`${r.name}: SBOM unreadable at ${sbomPath} (${e.message}); treated as absent, not empty`); sbomPath = null; } }
    if (!sbom) { reviews.push(reviewRepo({ name: r.name, path: r.path, sbom: null })); continue; }

    const locs = (sbom.components || []).map(locationOf);
    const g = r.path && existsSync(r.path) ? gitFacts(r.path, locs) : null;
    const roots = r.path && existsSync(r.path) ? nodeModulesRoots(r.path) : [];
    let osv = { state: 'not-checked', note: 'Run with --vulns (osv-scanner) or pass --osv <result.json>. Not checked is not clean.' };
    if (o.osv) { try { osv = { state: 'checked', doc: readJSON(resolve(o.osv)), note: `osv-scanner result read from ${o.osv}` }; } catch (e) { osv = { state: 'failed', note: `--osv unreadable: ${e.message}` }; } }
    else if (o.vulns) { process.stderr.write(`osv-scanner: ${r.name}…\n`); osv = runOsv(sbomPath, work); }
    else if (existsSync(join(dirname(sbomPath), 'osv.json'))) {
      const p = join(dirname(sbomPath), 'osv.json');
      try { osv = { state: 'checked', doc: readJSON(p), note: `earlier osv-scanner result beside the SBOM (${p}, written ${statSync(p).mtime.toISOString()}); --vulns re-checks` }; } catch (e) { osv = { state: 'failed', note: `${p} unreadable: ${e.message}` }; }
    }
    reviews.push(reviewRepo({ name: r.name, path: r.path, sbom, sbomPath, git: g, licenceRoots: roots, denoCache: existsSync(denoNpmCache()) ? denoNpmCache() : null,
      osv: osv.state === 'checked' ? indexOsv(osv.doc) : null, osvState: osv.state, osvNote: osv.note }));
  }

  const group = reviewGroup({ target: t.target, label: o.label, kind: t.kind, repos: reviews, generatedAt, notes: t.notes });
  writeAtomic(join(outDir, 'sbom-review.json'), `${JSON.stringify(group, null, 2)}\n`);
  writeAtomic(join(outDir, 'sbom-review.md'), `${renderMarkdown(group)}\n`);
  writeAtomic(join(outDir, 'sbom-review.html'), renderHtml(group));
  const s = group.summary;
  process.stdout.write(`${group.label}: ${s.reviewed}/${s.repos} repos, ${s.components} components (${s.product} product); findings high ${s.findings.high}, medium ${s.findings.medium}, low ${s.findings.low}, undetermined ${s.findings.unknown}\n${join(outDir, 'sbom-review.html')}\n`);
  return s.notReviewed ? 3 : 0;
}

if (isMainModule(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`sbom-review: ${e.message}\n`); process.exitCode = 2; });
}
