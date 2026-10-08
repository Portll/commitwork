// docsite-manifest.mjs — load and validate docsite/manifest.json at the LOAD, not only in a test
// (the pattern schema/*.schema.json gates elsewhere: a contract nobody enforces at read time goes
// decorative). Validation here is a hand duplicate of schema/docsite-manifest.schema.json on
// purpose — two witnesses with different failure modes; bin/test/docsite-manifest.test.mjs asserts
// they agree on the same fixtures.
//
// fact: a manifest that fails to read or parse THROWS — it is never an empty doc list / an
//   unreadable declaration returned as {docs: []} would make every downstream consumer treat
//   "cannot know" as "nothing exists", which is unsupported finding (expiry: never)
// fact: there are TWO manifests, and loadManifest() returns their union / docsite/manifest.json
//   lists the published documents; the private root's manifest.json (lib/docsite-roots.mjs) lists
//   the draft and hidden ones, so the public tree discloses neither their sources nor their
//   capability urlPaths. A private doc carries its root (DOC_ROOT), sourcePath/pagePath resolve
//   against it, and writeManifestAtomic writes each doc back to the manifest it came from. An
//   absent private manifest is the public checkout's normal state; an unreadable or invalid one,
//   or a slug/urlPath that both manifests claim, throws like any other broken manifest
//   (expiry: never)
// env, read at call time: CW_DOCSITE_ROOT, CW_DOCSITE_PRIVATE

import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { snapshotBeforeWrite } from './docsite-versions.mjs';
import { docsiteRoot, privateRoot, DOC_ROOT, rootOf, isPrivateDoc } from './docsite-roots.mjs';

export { docsiteRoot, privateRoot, presentPrivateRoot, draftRoot, rootOf, isPrivateDoc, withRoot, DOC_ROOT } from './docsite-roots.mjs';
export const manifestPath = () => join(docsiteRoot(), 'manifest.json');
/** The private manifest's path, or null when this process has no private root. */
export const privateManifestPath = () => { const r = privateRoot(); return r ? join(r, 'manifest.json') : null; };
const PRIVATE_NOTE = 'Draft and hidden docsite documents (lib/docsite-roots.mjs). Same identity rules as docsite/manifest.json: slug and urlPath never rotate; only bin/docsite-new.mjs mints one.';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SOURCE_RE = /^(content|imported)\/[A-Za-z0-9._/-]+$/;
const STATES = new Set(['draft', 'hidden', 'published']);
const KINDS = new Set(['md', 'imported']);
const DOC_KEYS = new Set(['slug', 'urlPath', 'title', 'source', 'kind', 'state', 'note', 'label', 'alias', 'editVia']);
// A kind:md doc whose source is DERIVED from a registry: the editor saves through the named adapter
// in admin/routes/docsite.mjs instead of writing the Markdown as truth.
export const EDIT_VIA = new Set(['remediations']);
const TOP_KEYS = new Set(['$schema', 'version', 'note', 'docs']);

export class ManifestError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// The validation rules alone, as a function of the parsed object — no I/O, never throws. Returns
// an array of error strings (empty = valid). The one place a WRITER (docsite-new.mjs, and the
// admin sync/import/state/reorder routes) can check a proposed manifest before persisting it,
// without a second hand-copy of these rules to drift from loadManifest's.
export function validateManifest(m) {
  const errs = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) { errs.push('top level is not an object'); return errs; }
  for (const k of Object.keys(m)) if (!TOP_KEYS.has(k)) errs.push(`unknown top-level key '${k}'`);
  if (m.version !== 1) errs.push(`version must be 1, got ${JSON.stringify(m.version)}`);
  if (!Array.isArray(m.docs)) { errs.push('docs must be an array'); return errs; }
  const slugs = new Set(); const urlPaths = new Set();
  m.docs.forEach((d, i) => {
    const at = `docs[${i}]`;
    if (!d || typeof d !== 'object' || Array.isArray(d)) { errs.push(`${at}: not an object`); return; }
    for (const k of Object.keys(d)) if (!DOC_KEYS.has(k)) errs.push(`${at}: unknown key '${k}'`);
    for (const k of ['slug', 'urlPath', 'title', 'source', 'kind', 'state']) {
      if (typeof d[k] !== 'string' || !d[k]) errs.push(`${at}: missing required '${k}'`);
    }
    if (typeof d.slug === 'string' && !SLUG_RE.test(d.slug)) errs.push(`${at}: bad slug '${d.slug}'`);
    if (typeof d.urlPath === 'string' && !UUID_RE.test(d.urlPath) && !SLUG_RE.test(d.urlPath)) {
      errs.push(`${at}: urlPath must be a uuid or a clean name, got '${d.urlPath}'`);
    }
    if (typeof d.title === 'string' && d.title.length > 200) errs.push(`${at}: title over 200 chars`);
    if (typeof d.source === 'string') {
      if (!SOURCE_RE.test(d.source)) errs.push(`${at}: bad source '${d.source}'`);
      if (d.source.split('/').includes('..')) errs.push(`${at}: source escapes the docsite root`);
      if (d.kind === 'md' && !d.source.startsWith('content/')) errs.push(`${at}: kind md requires a content/ source`);
      if (d.kind === 'imported' && !d.source.startsWith('imported/')) errs.push(`${at}: kind imported requires an imported/ source`);
    }
    if (d.kind !== undefined && !KINDS.has(d.kind)) errs.push(`${at}: kind must be md|imported`);
    if (d.state !== undefined && !STATES.has(d.state)) errs.push(`${at}: state must be draft|hidden|published`);
    if (d.editVia !== undefined && !EDIT_VIA.has(d.editVia)) errs.push(`${at}: editVia must be one of ${[...EDIT_VIA].join('|')}`);
    if (d.editVia !== undefined && d.kind !== 'md') errs.push(`${at}: editVia requires kind md`);
    if (slugs.has(d.slug)) errs.push(`${at}: duplicate slug '${d.slug}'`); slugs.add(d.slug);
    if (urlPaths.has(d.urlPath)) errs.push(`${at}: duplicate urlPath '${d.urlPath}'`); urlPaths.add(d.urlPath);
  });
  return errs;
}

// Throws ManifestError. code 'ABSENT' only for a true ENOENT on the manifest file itself —
// everything else (unreadable, unparsable, invalid) is 'INVALID' and must never be shown as empty.
// A doc's PUBLIC href. `urlPath` is identity and never rotates — capability URLs live in readers'
// bookmarks — so a friendly URL is added ALONGSIDE it as `alias` rather than replacing it. The
// alias is what readers see and what the index and nav link to; the urlPath keeps working as a
// 301 into the alias, which is the only way to give a document a readable address without
// breaking every link already handed out under the old one.
export const docHref = (d) => `/${(d && d.alias) || (d && d.urlPath)}/`;

// THE nav, in the shape lib/docsite-page.mjs's shell renders: published docs only, in declaration
// order. One definition, for the same reason docsite-page.mjs gives at the top of its own file —
// bin/docsite-build.mjs derived this inline and bin/taxonomy-web.mjs hand-rolled a second copy that
// emitted its OWN <header class="site">, so the generated taxonomy pages and the markdown pages had
// two independent implementations of one piece of chrome. Two implementations is the thing that
// drifts; two callers is not.
export const docsiteNav = (manifest) => (manifest.docs || [])
  .filter((d) => d.state === 'published')
  .map((d) => ({ slug: d.slug, title: d.title, href: docHref(d) }));

// One manifest file: { raw, m }, validated. Throws ManifestError (ABSENT only for ENOENT).
function readOne(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') throw new ManifestError(`no manifest at ${path}`, 'ABSENT');
    throw new ManifestError(`manifest unreadable at ${path}: ${e.message}`, 'INVALID');
  }
  let m;
  try { m = JSON.parse(raw); } catch (e) {
    throw new ManifestError(`manifest is not JSON (${e.message}) — a broken manifest is not an empty one`, 'INVALID');
  }
  const errs = validateManifest(m);
  if (errs.length) throw new ManifestError(`manifest invalid at ${path}:\n  ${errs.join('\n  ')}`, 'INVALID');
  return { raw, m };
}

// The private manifest, or null when there is no private root or no file in it (ENOENT).
function readPrivate() {
  const p = privateManifestPath();
  if (!p) return null;
  try { return readOne(p); } catch (e) {
    if (e instanceof ManifestError && e.code === 'ABSENT') return null;
    throw e;
  }
}

// Public docs first, then private ones tagged with their root. The union is validated again so a
// slug or urlPath claimed by both files is a broken declaration, never a silent shadow.
// UNION marks an object that holds BOTH manifests' docs. Object spread carries it into the `next`
// a writer builds, and writeManifestAtomic rewrites the private manifest only from such an object:
// a public-only document (an archived public manifest being restored, `docsite-new --init`) can
// never empty the private one by omission.
const UNION = Symbol('docsite manifest union');

function merge(pub, priv) {
  const root = privateRoot();
  const docs = [...pub.m.docs, ...(priv ? priv.m.docs.map((d) => ({ ...d, [DOC_ROOT]: root })) : [])];
  const merged = { ...pub.m, docs, [UNION]: true };
  if (priv) {
    const errs = validateManifest(merged);
    if (errs.length) throw new ManifestError(`the public and private manifests disagree:\n  ${errs.join('\n  ')}`, 'INVALID');
  }
  return merged;
}

// No argument: the union of both manifests. An explicit path: that one file, as before.
export function loadManifest(path) {
  const pub = readOne(path === undefined ? manifestPath() : path);
  const m = path === undefined ? merge(pub, readPrivate()) : pub.m;
  return Object.freeze({ ...m, docs: Object.freeze(m.docs.map((d) => Object.freeze({ ...d }))) });
}

export const manifestHash = (raw) => createHash('sha256').update(raw).digest('hex');

// What a mutating route compares and edits: both files' bytes, ONE hash over them (so a change to
// either refuses a stale baseHash), and the union, unfrozen and tagged, to build the next manifest
// from. With no private manifest the hash is exactly manifestHash(public raw), as it always was.
export function readManifestState() {
  const pub = readOne(manifestPath());
  const priv = readPrivate();
  const hash = manifestHash(priv ? `${pub.raw}\u0000${priv.raw}` : pub.raw);
  return { raw: pub.raw, privateRaw: priv ? priv.raw : null, hash, parsed: merge(pub, priv) };
}

// THE write path for docsite/manifest.json — bin/docsite-new.mjs and the admin sync/import/state/
// reorder routes are two callers of this one function, never two implementations (same
// write-cardinality reasoning as lib/docsite-page.mjs's renderAndWritePage). Snapshots the
// previous manifest before overwriting it — small and easy to clobber by hand, exactly the file
// this whole version-history mechanism exists to protect.
//
// Each doc goes back to the manifest it came from: untagged docs to docsite/manifest.json, docs
// tagged with the private root to the private manifest. The private file is written only when it
// holds docs or already exists, and only when its bytes change, so a public checkout never grows
// one and a public-doc edit never rewrites it.
function writeOne(path, m, root, { onlyIfChanged = false } = {}) {
  const text = `${JSON.stringify(m, null, 2)}\n`;
  let previous = null;
  try { previous = readFileSync(path, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (onlyIfChanged && previous === text) return;
  snapshotBeforeWrite('manifest', 'generated', previous, { root });
  mkdirSync(dirname(path), { recursive: true });
  writeAtomic(path, text);
}

export function writeManifestAtomic(m) {
  const { docs = [], ...top } = m;
  const privateDocs = docs.filter((d) => isPrivateDoc(d));
  const pp = privateManifestPath();
  if (privateDocs.length && !pp) throw new ManifestError('a document is tagged private but this process has no private docsite root', 'INVALID');
  if (privateDocs.length && !m[UNION]) throw new ManifestError('private documents can only be written back from the union loadManifest() returned', 'INVALID');
  writeOne(manifestPath(), { ...top, docs: docs.filter((d) => !isPrivateDoc(d)) }, docsiteRoot());
  if (!m[UNION]) return;
  if (!privateDocs.length && !(pp && existsSync(pp))) return;
  let privateTop = { version: 1, note: PRIVATE_NOTE };
  try { const { docs: _ignored, ...rest } = JSON.parse(readFileSync(pp, 'utf8')); privateTop = rest; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  writeOne(pp, { ...privateTop, docs: privateDocs.map((d) => ({ ...d })) }, privateRoot(), { onlyIfChanged: true });
}

export const findDoc = (manifest, slug) => manifest.docs.find((d) => d.slug === slug) || null;
export const findByUrlPath = (manifest, urlPath) => manifest.docs.find((d) => d.urlPath === urlPath) || null;
export const sourcePath = (doc) => join(rootOf(doc), doc.source);
export const pagePath = (doc) => join(rootOf(doc), 'pages', doc.urlPath, 'index.html');
