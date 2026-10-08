// release-names-head-scan.mjs — the HEAD-reading offender scan, extracted so the gate and the
// reseed tool share ONE implementation.
//
// It was exported from bin/test/release-names-head.test.mjs, which cannot be imported: importing a
// file that calls `test()` REGISTERS its tests, so a reseed script would run the whole gate as a
// side effect. Measured — the import printed the gate's own assertion failure. Reimplementing the
// scan in the tool instead would give two scanners that can disagree about what an offender is,
// which is the divergence the tool exists to resolve.
//
// The matcher and the scope are bin/lib/release-scope.mjs, shared with the working-tree gate. This
// file only decides WHERE the three scope documents and the scanned tree are read from.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScope, findNames, locate } from './release-scope.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// every input path env-overridable, read at CALL time so a test setting it afterwards is not defeated
// The map moved to the private stores 2026-09-09: it pairs every real name with its pseudonym, so
// it IS the reversal table, and the publication boundary bars shipping one. Public tree carries no
// name list at all now. The env override stays first so tests can aim this at a fixture. Read from
// the sidecar itself, not through monitor/private: that symlink is gitignored, so a fresh worktree
// has none, and the gate skipped exactly where a release is judged.
export const manifestPath = () => process.env.CW_RELEASE_REDACTIONS
  || resolve(SIDECAR(), MANIFEST_REL);
export const baselinePath = () => process.env.CW_RELEASE_NAMES_HEAD_BASELINE
  || resolve(REPO, 'bin', 'test', 'fixtures', 'release-names-head-baseline.json');
export const headRef = () => process.env.CW_RELEASE_NAMES_HEAD_REF || 'HEAD';
// The sidecar is another repository, so its manifest takes its own ref. One variable drove both,
// and naming a commitwork commit for the scan made the sidecar lookup fail closed.
export const sidecarRef = () => process.env.CW_RELEASE_NAMES_SIDECAR_REF || 'HEAD';

// THE TRUST ROOT MOVED; IT DID NOT DISAPPEAR. The manifest IS the reversal table, so the 2026-09-07
// publication boundary bars it from this repository — it now lives in the sidecar, reached here
// through the gitignored `monitor/private` directory symlink.
//
// Reading it from DISK instead would have been the one-line fix and would have silently deleted the
// property the whitewash assertion in release-names-head.test.mjs exists to protect: a gate that
// reads HEAD for its population and the working tree for its exemptions reports clean on an offender
// that is committed, because an UNCOMMITTED exemption whitewashes it. The requirement was never
// "commitwork's HEAD" — it was "a committed surface somebody can audit". The sidecar is a git repo,
// so that surface still exists; it is just a different one.
/**
 * The sidecar for a checkout: CW_SIDECAR, else `commitwork-sidecar` beside it, else beside the main
 * checkout. A worktree nested in the main checkout (.claude/worktrees/…) has nothing beside it, and
 * reading that as "no sidecar" skipped the gate as if it were a public clone.
 */
export function sidecarFor(repo, env = process.env) {
  if (env.CW_SIDECAR) return env.CW_SIDECAR;
  const beside = resolve(repo, '..', 'commitwork-sidecar');
  if (existsSync(beside)) return beside;
  try {
    const common = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return resolve(dirname(common), '..', 'commitwork-sidecar');
  } catch { return beside; }
}
export const SIDECAR = () => sidecarFor(REPO);
export const MANIFEST_REL = 'monitor/release-redactions.json';
export const PUBLISH_REL = 'monitor/publish-redactions.json';
export const IDENTITY_REL = 'identity/repo-identities.json';

// The other two scope documents on disk. Their overrides are read at call time like the manifest's.
export const publishMapPath = () => process.env.CW_PUBLISH_REDACTIONS
  || resolve(SIDECAR(), PUBLISH_REL);
export const identityRegisterPath = () => process.env.CW_REPO_IDENTITIES
  || resolve(SIDECAR(), IDENTITY_REL);

/**
 * The manifest AT HEAD. A malformed one is NOT an empty scope.
 *
 * Read from the commit, not the filesystem, and the reason is a false clean this gate had. The
 * population comes from `ls-tree HEAD` while the manifest came from `readFileSync` — so the
 * exemption list was the working tree's. Measured 2026-09-02: one entry carried 27 exemptions on
 * disk against 6 at HEAD, a peer mid-edit, and every one of those 21 uncommitted exemptions
 * suppressed a real HEAD offender. The gate read green in the working tree and red in a pristine
 * checkout of the same commit.
 */
export function loadManifest() {
  if (process.env.CW_RELEASE_REDACTIONS) {
    let raw;
    try {
      raw = readFileSync(manifestPath(), 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw new Error(`release-redactions: cannot read ${manifestPath()}: ${e.message}`);
    }
    return JSON.parse(raw);
  }
  // No sidecar at all: a public checkout, which the boundary requires to build and test without
  // private records. null, so the caller SKIPS and says so. Not a pass — a skip is visibly not-run.
  if (!existsSync(SIDECAR())) return null;
  return JSON.parse(showRequired(MANIFEST_REL));
}

// The sidecar is HERE and a scope document is not committed in it. Not "no names to check" — a name
// gate missing part of its scope reports clean over those names, which is the one way it can pass
// without looking. Fail closed, exactly as this did when the manifest lived in commitwork's HEAD.
function showRequired(rel) {
  try {
    return execFileSync('git', ['-C', SIDECAR(), 'show', `${sidecarRef()}:${rel}`],
      { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error(`release-redactions: ${rel} is not in ${sidecarRef()} of ${SIDECAR()} — `
      + (rel === MANIFEST_REL
        ? 'refusing to scan with no identity list, which would report clean over every file'
        : 'refusing to scan with part of the name scope missing, which would report clean over it'));
  }
}

function readRequired(path, what) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) {
    throw new Error(`release-redactions: the ${what} is unreadable at ${path} (${e.code || e.message}) — `
      + 'refusing to scan with part of the name scope missing, which would report clean over it');
  }
  try { return JSON.parse(raw); } catch (e) {
    throw new Error(`release-redactions: the ${what} at ${path} is not valid JSON (${e.message})`);
  }
}

/**
 * The scope for the HEAD gate: all three documents from the sidecar's COMMIT, for the whitewash
 * reason above. CW_RELEASE_REDACTIONS switches to files on disk (a fixture, or a deliberate
 * override), taking the other two from their own overrides. null only when there is no sidecar and
 * no override: a public checkout, which skips.
 */
export function loadScope() {
  if (process.env.CW_RELEASE_REDACTIONS) return loadDiskScope();
  if (!existsSync(SIDECAR())) return null;
  return buildScope({
    release: JSON.parse(showRequired(MANIFEST_REL)),
    publish: JSON.parse(showRequired(PUBLISH_REL)),
    identities: JSON.parse(showRequired(IDENTITY_REL)),
  });
}

/**
 * The scope for the working-tree gate: all three documents from disk. null only when the release
 * manifest is absent (a public checkout). Once it is present, a missing publish map or identity
 * register THROWS: half a scope is not a smaller pass, it is a blind one.
 */
export function loadDiskScope() {
  if (!existsSync(manifestPath())) return null;
  return buildScope({
    release: readRequired(manifestPath(), 'release manifest'),
    publish: readRequired(publishMapPath(), 'publish map'),
    identities: readRequired(identityRegisterPath(), 'identity register'),
  });
}

/**
 * Offending paths and content in `entries` ({ path, text }; text null = unreadable). Content
 * offenders carry file-relative lines and the source document, never the matched text.
 */
export function scanEntries(entries, scope) {
  const paths = [];
  const content = [];
  for (const { path, text } of entries) {
    if (findNames(path, scope).length) paths.push(path);
    if (typeof text !== 'string') continue;
    const hits = findNames(text, scope);
    if (hits.length) content.push({ path, hits: locate(text, hits) });
  }
  return { paths, content };
}

/**
 * The COMMIT's file list — `ls-tree -r`, never `ls-files`. That difference is the whole point of
 * this file: `ls-files` reports the index, so a staged-but-uncommitted rename reads as done.
 */
export const headFiles = () => execFileSync('git', ['-C', REPO, 'ls-tree', '-r', '--name-only', headRef()],
  { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean);

// ONE `git cat-file --batch` FOR THE WHOLE TREE, not one `git show` per file.
//
// headContent() spawned a git process per path, and currentOffenders() calls it for every file at
// HEAD. Measured on this box 2026-09-04: 1,436 files at ~88 ms per spawn is roughly 126 SECONDS for
// a single scan, and the test calls it several times — enough that the full suite appeared to hang
// and was killed before printing its summary, three runs in a row. Windows process creation is far
// more expensive than fork+exec, so a per-item spawn that is merely wasteful on POSIX becomes the
// difference between a suite that finishes and one that does not.
//
// bin/test/esm-specifier-shape.test.mjs had the identical defect and the identical fix earlier in
// this cycle: 52 s to 149 ms. Worth stating as a rule — a `git show` inside a loop over tracked
// files is always a `cat-file --batch` waiting to be written.
//
// No `encoding` on the batch buffer: the stream is length-delimited in BYTES and this tree is
// multi-byte dense, so decoding first would put character offsets against byte lengths.
let _blobs = null;
function headBlobs() {
  const ref = headRef();
  if (_blobs && _blobs.ref === ref) return _blobs.map;
  const map = new Map();
  try {
    const listing = execFileSync('git', ['-C', REPO, 'ls-tree', '-r', ref, '--format=%(objectname) %(path)'],
      { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean)
      .map((l) => { const i = l.indexOf(' '); return { sha: l.slice(0, i), path: l.slice(i + 1) }; });
    if (listing.length) {
      const out = execFileSync('git', ['-C', REPO, 'cat-file', '--batch'],
        { input: `${listing.map((e) => e.sha).join('\n')}\n`, maxBuffer: 1 << 30 });
      let off = 0;
      for (const e of listing) {
        const nl = out.indexOf(0x0a, off);
        if (nl === -1) break;
        const size = Number(out.toString('utf8', off, nl).split(' ')[2]);
        if (!Number.isFinite(size)) break;
        map.set(e.path, out.toString('utf8', nl + 1, nl + 1 + size));
        off = nl + 1 + size + 1;
      }
    }
  } catch { /* fall through: headContent() degrades to a per-file read rather than lying */ }
  _blobs = { ref, map };
  return map;
}

/** Drop the batch cache — for a test that moves HEAD mid-run. */
export function _resetHeadBlobs() { _blobs = null; _offenders = null; }

/** A path's content AT THE COMMIT. null only for genuinely unreadable/binary — never a silent pass. */
export function headContent(rel) {
  const cached = headBlobs().get(rel);
  if (cached !== undefined) return cached;
  // Not in the batch (a path added since, or a batch that failed): ask directly rather than
  // reporting absence. A scan that silently sees nothing is the failure this whole gate is about.
  try {
    return execFileSync('git', ['-C', REPO, 'show', `${headRef()}:${rel}`],
      { encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch { return null; }
}

/**
 * Offending PATHS and offending CONTENT FILES at HEAD, as sorted key sets, plus `detail` (file ->
 * lines and sources) for messages.
 *
 * Keyed on path only — never on a count or a line. A count-based floor would move on any unrelated
 * edit to a file already known to offend, converting ordinary churn into a state change; this repo
 * has the same rule for finding identity and for the same reason.
 *
 * No file is exempt from its own scan. The name lists used to live in this tree, so the gate
 * skipped them and itself; they are in the sidecar now, and a tracked file that still needed a real
 * name would be the offender, not the exemption.
 */
let _offenders = null;
export function currentOffenders() {
  const scope = loadScope();
  if (!scope) return { paths: [], content: [], detail: {} };
  const ref = headRef();
  if (_offenders && _offenders.ref === ref && _offenders.scope === scope.fingerprint) return _offenders.result;
  const r = scanEntries(headFiles().map((path) => ({ path, text: headContent(path) })), scope);
  const result = {
    paths: [...r.paths].sort(),
    content: r.content.map((c) => c.path).sort(),
    detail: Object.fromEntries(r.content.map((c) => [c.path, c.hits])),
  };
  _offenders = { ref, scope: scope.fingerprint, result };
  return result;
}

export const loadBaseline = () => {
  const raw = readFileSync(baselinePath(), 'utf8');
  const doc = JSON.parse(raw);
  return { paths: Object.keys(doc.paths || {}).sort(), content: Object.keys(doc.content || {}).sort() };
};
