#!/usr/bin/env node
// DRAFT — unwired and UNTESTED. Nothing imports this. Testing it is task 1 of
// evaluations/HANDOFF-anchor-remediation-2026-08-22.md; do not wire it before then.
//
// anchor-disposition — did the audit finding get FIXED, or did its line just move under it?
//
// bin/anchor-staleness.mjs answers "did this text change?". Remediation and rot both change text,
// so that signal cannot separate them and no refinement of hashing will. This records the answer
// instead of inferring it, and probes for evidence where a probe is possible.
//
// Three states, and `unreviewed` is the honest default — an undisposed drift is not a fix.
// A disposition binds to the evidence digest it was made against (ingest-external.mjs's
// subject-digest pattern): change the code again and the ruling goes stale rather than carrying.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditDirFor } from './store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

export const DISPOSITIONS = Object.freeze(['remediated', 'still-present', 'moot', 'unreviewed']);

// Probeable kinds: the finding names a thing that is either in the file or not. The rest describe
// absent or wrong BEHAVIOUR, which no signal at the old line can decide.
export const PROBEABLE_KINDS = Object.freeze(['hardcoded', 'dead', 'stub']);

export const dispositionsPath = () =>
  process.env.CW_ANCHOR_DISPOSITIONS || join(auditDirFor(CW), 'dispositions.json');

const sha256hex = (s) => createHash('sha256').update(s).digest('hex');
const stable = (o) => JSON.stringify(o, Object.keys(o).sort());

/** What a ruling was made ABOUT. Changes when the code changes again, so the ruling expires. */
export function evidenceSubject(entry) {
  return {
    anchor: entry.anchor ?? null,
    state: entry.state ?? null,
    baselineHash: entry.baselineHash ?? entry.anchorHash ?? null,
    currentHash: entry.currentHash ?? null,
    removedBy: entry.removedBy ?? null,
  };
}
export const evidenceDigest = (entry) => `sha256:${sha256hex(stable(evidenceSubject(entry)))}`;

export function emptyDispositionsDoc() {
  return {
    note: 'Human rulings on drifted audit anchors — whether the finding was FIXED or merely moved. '
        + 'Append-only; each ruling carries the evidence digest it was made against and goes stale '
        + 'when that evidence changes. Written by the panel; never edit by hand.',
    version: 1,
    rulings: [],
  };
}

export function loadDispositions(path = dispositionsPath()) {
  if (!existsSync(path)) return emptyDispositionsDoc();
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) { throw new Error(`dispositions unreadable at ${path}: ${e.code || e.message}`); }
  let doc;
  try { doc = JSON.parse(raw); } catch { throw new Error(`dispositions at ${path} is corrupt (unparseable JSON)`); }
  if (!doc || !Array.isArray(doc.rulings)) throw new Error(`dispositions at ${path} has no rulings[] — unrecognised shape`);
  return doc;
}

/** Latest ruling per anchor, with stale ones surfaced rather than applied. */
export function currentRuling(doc, anchor, digest) {
  const mine = (doc.rulings || []).filter((r) => r.anchor === anchor);
  if (!mine.length) return { disposition: 'unreviewed', stale: false, ruling: null };
  const last = mine[mine.length - 1];
  if (digest && last.evidenceDigest && last.evidenceDigest !== digest) {
    return { disposition: 'unreviewed', stale: true, ruling: last, staleReason: 'the code changed again after this ruling' };
  }
  return { disposition: last.disposition, stale: false, ruling: last };
}

export function appendRuling(doc, { anchor, disposition, evidenceDigest: dig, by, reason, at }) {
  if (!DISPOSITIONS.includes(disposition)) throw new Error(`disposition must be one of ${DISPOSITIONS.join('|')}`);
  if (!anchor) throw new Error('anchor is required');
  if (!reason || !String(reason).trim()) throw new Error('reason is required — a ruling with no stated basis is not a ruling');
  const prevHash = doc.rulings.length ? doc.rulings[doc.rulings.length - 1].hash : null;
  const r = { anchor, disposition, evidenceDigest: dig ?? null, by: by ?? null, reason: String(reason).trim(), at, prevHash, hash: '' };
  r.hash = sha256hex(`${prevHash || ''}|${stable({ anchor, disposition, evidenceDigest: r.evidenceDigest, by: r.by, reason: r.reason, at })}`);
  doc.rulings.push(r);
  return r;
}

export function verifyRulings(doc) {
  const problems = [];
  let prev = null;
  for (const [i, r] of (doc.rulings || []).entries()) {
    if (r.prevHash !== prev) problems.push(`ruling ${i} (${r.anchor}): prevHash does not chain`);
    const expect = sha256hex(`${r.prevHash || ''}|${stable({ anchor: r.anchor, disposition: r.disposition, evidenceDigest: r.evidenceDigest, by: r.by, reason: r.reason, at: r.at })}`);
    if (r.hash !== expect) problems.push(`ruling ${i} (${r.anchor}): hash does not match its content`);
    prev = r.hash;
  }
  return problems;
}

// ── the probe ────────────────────────────────────────────────────────────────────────────────
// Produces EVIDENCE, never a verdict. `hardcoded` cites a literal, `dead`/`stub` a marker: all
// three are "is this still in the file", which is answerable without reading the anchor. The
// finding's own `evidence` string is the needle — it is what the auditor quoted.
const NEEDLE = /`([^`]{4,120})`|"([^"]{4,120})"|'([^']{4,120})'/g;

/** Quoted spans from the auditor's evidence, longest first — the most specific needle wins. */
export function needlesFrom(finding) {
  const src = `${finding.evidence || ''} ${finding.summary || ''}`;
  const out = new Set();
  for (const m of src.matchAll(NEEDLE)) {
    const s = (m[1] || m[2] || m[3] || '').trim();
    if (s.length >= 4 && !/\s{2,}/.test(s)) out.add(s);
  }
  return [...out].sort((a, b) => b.length - a.length).slice(0, 5);
}

/**
 * Is what the auditor quoted still in the file? present ⇒ the defect probably survived the edit;
 * absent ⇒ probably remediated. Probably: this is a hint for a human, and says so.
 */
export function probe(finding, { root = CW } = {}) {
  if (!PROBEABLE_KINDS.includes(finding.kind)) {
    return { probeable: false, why: `kind '${finding.kind}' describes behaviour, not a literal — no probe can decide it` };
  }
  const rel = String(finding.file || '').replace(/^.*\/commitwork\//, '');
  const p = join(root, rel);
  if (!existsSync(p)) return { probeable: true, fileGone: true, verdictHint: 'moot', why: 'the file no longer exists' };
  let body;
  try { body = readFileSync(p, 'utf8'); } catch (e) { return { probeable: true, error: e.code || 'unreadable' }; }
  const needles = needlesFrom(finding);
  if (!needles.length) return { probeable: true, needles: [], why: 'the finding quotes nothing specific enough to search for' };
  const hits = needles.filter((n) => body.includes(n));
  return {
    probeable: true,
    needles,
    stillPresent: hits,
    verdictHint: hits.length ? 'still-present' : 'remediated',
    why: hits.length
      ? `${hits.length} of ${needles.length} quoted spans are still in the file`
      : `none of the ${needles.length} quoted spans remain — the code the finding described is gone`,
  };
}
