// release-reviews.mjs — reviewed dispositions for pre-publish findings and unscanned blobs.
//
// A finding is identified by file, class and fingerprint, never by line; a row covers at most
// `count` occurrences. An unscanned blob is identified by its git blob hash. The record is read
// from the sidecar's COMMIT, so an uncommitted review cannot whitewash a finding.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from '../../lib/json-schema.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const REVIEWS_REL = 'release/reviews.json';
export const BLOCKING = Object.freeze(['REAL-SECRET', 'SENSITIVE-CONTEXT']);
export const ACCEPTING = Object.freeze(['synthetic-fixture', 'public-by-design', 'upstream-content', 'not-a-credential']);
export const ASSET_ACCEPTING = Object.freeze(['publish']);

export const sidecarDir = () => process.env.CW_SIDECAR || resolve(REPO, '..', 'commitwork-sidecar');
export const reviewsSchemaPath = () => process.env.CW_RELEASE_REVIEWS_SCHEMA
  || resolve(REPO, 'schema', 'release-reviews.schema.json');

export const findingKey = (f) => `${f.file}\0${f.cls}\0${f.fingerprint}`;
// cw-hazards-ignore: sha1 is git's object-id format, not a security use
export const gitBlobSha = (buf) => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

const EMPTY = Object.freeze({ findings: [], assets: [] });

function parseReviews(raw, where) {
  let doc;
  try { doc = JSON.parse(raw); } catch (e) {
    throw new Error(`release-reviews: ${where} is not valid JSON (${e.message})`);
  }
  const { errors } = validateAgainstSchema(doc, { path: reviewsSchemaPath() });
  if (errors.length) throw new Error(`release-reviews: ${where} fails its schema: ${errors.slice(0, 5).join('; ')}`);
  const unsigned = (r, accepting) => accepting.includes(r.disposition) && !(r.reason.trim() && r.reviewer.trim() && r.reviewedAt);
  const seen = new Set();
  for (const r of doc.findings) {
    const k = findingKey(r);
    if (seen.has(k)) throw new Error(`release-reviews: ${where} reviews ${r.file} ${r.cls} ${r.fingerprint} twice`);
    if (unsigned(r, ACCEPTING)) throw new Error(`release-reviews: ${where} accepts ${r.file} ${r.cls} without a reason, reviewer and date`);
    seen.add(k);
  }
  const blobs = new Set();
  for (const a of doc.assets) {
    if (blobs.has(a.blob)) throw new Error(`release-reviews: ${where} reviews blob ${a.blob} twice`);
    if (unsigned(a, ASSET_ACCEPTING)) throw new Error(`release-reviews: ${where} accepts blob ${a.blob} without a reason, reviewer and date`);
    blobs.add(a.blob);
  }
  return doc;
}

/**
 * The review record and where it came from. CW_RELEASE_REVIEWS reads a file on disk; otherwise the
 * sidecar's HEAD. No sidecar, or no record in it, is an EMPTY record: nothing reviewed, so every
 * finding stays blocking. Anything unreadable or malformed throws.
 */
export function loadReviews() {
  const override = process.env.CW_RELEASE_REVIEWS;
  if (override) {
    let raw;
    try { raw = readFileSync(override, 'utf8'); } catch (e) {
      throw new Error(`release-reviews: cannot read ${override} (${e.code || e.message})`);
    }
    return { source: `file:${override}`, ...parseReviews(raw, override) };
  }
  const dir = sidecarDir();
  if (!existsSync(dir)) return { source: 'none', ...EMPTY };
  let listed;
  try {
    listed = execFileSync('git', ['-C', dir, 'ls-tree', 'HEAD', '--', REVIEWS_REL],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`release-reviews: cannot read HEAD of ${dir} (${String(e.stderr || e.message).trim()})`);
  }
  if (!listed.trim()) return { source: `sidecar:${dir}:absent`, ...EMPTY };
  const raw = execFileSync('git', ['-C', dir, 'show', `HEAD:${REVIEWS_REL}`],
    { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] });
  return { source: `sidecar:${dir}`, ...parseReviews(raw, `${dir}:HEAD:${REVIEWS_REL}`) };
}

/**
 * Blob hash per unscanned path: from the tree at `ref` when given, else from the bytes on disk.
 * A path whose hash cannot be computed maps to null, which no review can match.
 */
export function blobShas(root, files, ref = null) {
  const out = new Map(files.map((f) => [f, null]));
  if (!files.length) return out;
  if (ref) {
    const listing = execFileSync('git', ['-C', root, 'ls-tree', '-r', '-z', ref, '--', ...files],
      { encoding: 'utf8', maxBuffer: 1 << 26 });
    for (const entry of listing.split('\0').filter(Boolean)) {
      const tab = entry.indexOf('\t');
      const [, type, sha] = entry.slice(0, tab).split(' ');
      if (type === 'blob') out.set(entry.slice(tab + 1), sha);
    }
    return out;
  }
  for (const f of files) {
    try { out.set(f, gitBlobSha(readFileSync(resolve(root, f)))); } catch { /* guard: unhashable stays null */ }
  }
  return out;
}

const brief = (f) => ({ file: f.file, line: f.line, cls: f.cls, verdict: f.verdict, fingerprint: f.fingerprint });

/**
 * Split a sweep result by review. Blocking findings past a row's `count`, or under a row whose
 * disposition does not accept, stay unreviewed. Rows that matched nothing are returned as stale.
 */
export function applyReviews({ findings = [], unscanned = [] }, reviews, shas = new Map()) {
  const rows = new Map(reviews.findings.map((r) => [findingKey(r), { row: r, used: 0 }]));
  const reviewed = [];
  const unreviewed = [];
  for (const f of findings) {
    if (!BLOCKING.includes(f.verdict)) continue;
    const hit = f.fingerprint ? rows.get(findingKey(f)) : undefined;
    if (hit && ACCEPTING.includes(hit.row.disposition) && hit.used < hit.row.count) {
      hit.used++;
      reviewed.push({ ...brief(f), disposition: hit.row.disposition });
    } else if (hit && ACCEPTING.includes(hit.row.disposition)) {
      hit.used++;
      unreviewed.push({ ...brief(f), beyondCount: hit.row.count });
    } else {
      if (hit) hit.used++;
      unreviewed.push({ ...brief(f), ...(hit ? { disposition: hit.row.disposition } : {}) });
    }
  }
  const assets = new Map(reviews.assets.map((a) => [a.blob, { row: a, used: false }]));
  const assetsReviewed = [];
  const assetsUnreviewed = [];
  for (const u of unscanned) {
    const blob = shas.get(u.file) ?? null;
    const hit = blob ? assets.get(blob) : undefined;
    if (hit) hit.used = true;
    if (hit && ASSET_ACCEPTING.includes(hit.row.disposition)) assetsReviewed.push({ file: u.file, blob, disposition: hit.row.disposition });
    else assetsUnreviewed.push({ file: u.file, reason: u.reason, blob, ...(hit ? { disposition: hit.row.disposition } : {}) });
  }
  const stale = [
    ...[...rows.values()].filter((r) => !r.used).map((r) => ({ file: r.row.file, cls: r.row.cls, fingerprint: r.row.fingerprint })),
    ...[...assets.values()].filter((a) => !a.used).map((a) => ({ blob: a.row.blob, path: a.row.path })),
  ];
  return { reviewed, unreviewed, assetsReviewed, assetsUnreviewed, stale };
}

/** Pending review rows for every open item, for a reviewer to decide. */
export function draftRows(applied) {
  const groups = new Map();
  for (const f of applied.unreviewed) {
    const k = findingKey(f);
    const g = groups.get(k) || { file: f.file, cls: f.cls, fingerprint: f.fingerprint, verdict: f.verdict, count: 0, disposition: 'pending', reason: '', reviewer: '', reviewedAt: null };
    g.count++;
    groups.set(k, g);
  }
  const blobs = new Map();
  for (const a of applied.assetsUnreviewed) {
    if (a.blob && !blobs.has(a.blob)) blobs.set(a.blob, { blob: a.blob, path: a.file, disposition: 'pending', reason: '', reviewer: '', reviewedAt: null });
  }
  return { findings: [...groups.values()], assets: [...blobs.values()] };
}
