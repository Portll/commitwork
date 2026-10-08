#!/usr/bin/env node
// commitwork monitor — a VERIFIED PORTABLE COPY of batch dirs. It never deletes and never uploads:
// offload and deletion stay human acts (declaration split from authority). What it produces is a
// single encrypted, compressed file plus a sealed manifest, and a --verify that proves the file is
// restorable BEFORE a human is told anything could be removed.
//
// WHY ENCRYPTED AT FULL FIDELITY RATHER THAN REDACTED. The raw per-batch reports carry plaintext
// secret VALUES — measured 2026-08-23: 172,695 gitleaks records each carrying its Secret, 7,518
// distinct, plus 2,568 trufflehog Raw values. rollup.mjs whitelists those out of the PUBLISHED
// artifacts; that whitelist never applied here. The first design redacted by denylist over
// Secret/Match/Raw, which misses `snippet.text` — Semgrep and CodeQL SARIF carry the matched source
// line, and for a secret-detection rule that line IS the secret. A denylist cannot see a field
// nobody told it about, so safety rests on the key instead and fidelity is preserved. --redact
// exists for a deliberately lower-fidelity artifact; it is not the safety mechanism.
//
// usage:
//   node monitor/archive-batches.mjs [--dry] [--area SLUG] [--older-than DAYS] [--level N] [--redact]
//   node monitor/archive-batches.mjs --verify <archive.cwar>
//
// There is deliberately NO --key flag: key material in argv is visible in `ps`.

import { isMainModule } from '../lib/is-main.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from './registry.mjs';
import { reportsRootDir } from './area.mjs';
import { batchStampMs, nowMs } from './retention.mjs';
import { packEntries, unpackEntries, sealArchive, openArchive, sha256, KEY_LEN } from './archive-container.mjs';
import { writeAtomic } from './lockfile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CW = path.resolve(HERE, '..');

// Read env at CALL time, never at module load — a const here silently defeats every test override.
export const archiveDir = () => process.env.CW_ARCHIVE_DIR || path.join(os.homedir(), 'commitwork-archives');
const keyService = () => process.env.CW_ARCHIVE_KEY_SERVICE || 'commitwork-archive';
const MIN_AGE_MS = 6 * 3600 * 1000; // a sweep finishes in minutes; 6h means "certainly not mid-write"

// ---- key ------------------------------------------------------------------
/**
 * The archive key, from the login keychain. 32 random bytes — no passphrase and no KDF, because a
 * memorable passphrase is weaker than 32 random bytes and a KDF adds parameters that must then be
 * versioned and stored. On creation the key is printed ONCE to stderr so it can be escrowed: if the
 * source is ever deleted and this key is lost, the archive is unreadable forever.
 */
export function keychainKey({ create = false } = {}) {
  const service = keyService();
  let hex = null;
  try {
    hex = execFileSync('security', ['find-generic-password', '-s', service, '-a', 'archive', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* absent — handled below; distinguished from "present but wrong" on purpose */ }
  if (hex !== null) {
    const key = Buffer.from(hex, 'hex');
    // A malformed item is an ERROR, never a reason to mint a second key: minting one here would
    // silently orphan every archive written under the first.
    if (key.length !== KEY_LEN) throw new Error(`keychain item '${service}' is ${key.length} bytes, not ${KEY_LEN} — refusing to guess at it, and refusing to replace it`);
    return key;
  }
  if (!create) throw new Error(`no archive key in the keychain (service '${service}') — an archive written under a lost key is unreadable, so --verify will not mint one`);
  const key = randomBytes(KEY_LEN);
  execFileSync('security', ['add-generic-password', '-s', service, '-a', 'archive', '-U', '-w', key.toString('hex')], { stdio: ['ignore', 'ignore', 'inherit'] });
  process.stderr.write(
    `\n  ESCROW THIS KEY NOW — it is printed once and never again.\n`
    + `  If the source is deleted and this key is lost, the archive is unreadable forever.\n`
    + `  It is now in your terminal scrollback; store it offline and clear the buffer.\n\n`
    + `    ${key.toString('hex')}\n\n`,
  );
  return key;
}

// ---- selection ------------------------------------------------------------
/**
 * Batch dirs only — never an area's out dir (the panel reads those live) and never an undeclared
 * dir. Excludes the newest batch of each area and anything younger than MIN_AGE_MS, because sweeps
 * write 50+ batches a day into this tree and archiving one mid-write stores a torn entry that
 * hashes fine and restores wrong.
 */
export function selectBatches(root, { now, olderThanDays = null, area = null, minAgeMs = MIN_AGE_MS } = {}) {
  const t = nowMs(now);
  const all = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !/^sweep-\d{14}/.test(e.name)) continue;
    const stamp = batchStampMs(e.name);
    if (stamp === null) continue; // unreadable age: never archived on a guess
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(root, e.name, 'batch-manifest.json'), 'utf8')); }
    catch (err) { if (err.code !== 'ENOENT') throw err; continue; } // fail closed; ENOENT = not a finished batch
    all.push({ name: e.name, stamp, area: manifest.area || '(unscoped)', manifest });
  }
  const newestOf = new Map();
  for (const b of all) if (!newestOf.has(b.area) || b.stamp > newestOf.get(b.area)) newestOf.set(b.area, b.stamp);
  const skipped = [];
  const picked = [];
  for (const b of all.sort((x, y) => (x.area < y.area ? -1 : x.area > y.area ? 1 : x.stamp - y.stamp))) {
    if (area && b.area !== area) continue;
    if (b.stamp === newestOf.get(b.area)) { skipped.push({ name: b.name, why: 'newest of its area — may be mid-write' }); continue; }
    if (t - b.stamp < minAgeMs) { skipped.push({ name: b.name, why: `younger than ${Math.round(minAgeMs / 3600000)}h` }); continue; }
    if (olderThanDays !== null && t - b.stamp < olderThanDays * 86400000) { skipped.push({ name: b.name, why: `newer than --older-than ${olderThanDays}d` }); continue; }
    picked.push(b);
  }
  return { picked, skipped };
}

const SECRET_BEARING = /gitleaks|trufflehog|secret/i;

/**
 * The torn-read guard, split out so it is testable without racing a real writer. Compares the stat
 * taken before the read against the one after, plus what was actually read. Any disagreement means
 * a concurrent writer touched the file mid-read, and the only safe answer is to refuse this entry —
 * a torn copy hashes perfectly well and restores wrong, which is the failure this whole tool exists
 * to avoid.
 */
export function assertStable(before, after, rel, readBytes) {
  if (after.size !== before.size) throw new Error(`entry ${rel} changed size while being read (${before.size} -> ${after.size}) — refusing a torn copy`);
  if (after.mtimeMs !== before.mtimeMs) throw new Error(`entry ${rel} was rewritten while being read (mtime moved) — refusing a torn copy`);
  if (readBytes !== undefined && readBytes !== before.size) throw new Error(`entry ${rel} read ${readBytes} bytes but stat said ${before.size} — refusing a torn copy`);
}

function readEntries(root, batch, { redact = false } = {}) {
  const entries = [];
  const notRedacted = [];
  let secretBearing = 0;
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, r); continue; }
      if (!e.isFile()) continue;
      const before = fs.statSync(abs);
      let data;
      try { data = fs.readFileSync(abs); }
      catch (err) { throw new Error(`unreadable entry ${r}: ${err.message}`); } // fail closed — never a short archive
      // Re-stat: a sweep or the compactor can move underneath us. A torn entry is refused, not stored.
      assertStable(before, fs.statSync(abs), r, data.length);
      if (SECRET_BEARING.test(e.name)) secretBearing++;
      if (redact) {
        const red = redactBuffer(data, e.name);
        data = red.data;
        // A file redaction could not process is RECORDED, never quietly shipped as if it had been.
        if (!red.redacted) notRedacted.push({ path: `${batch}/${r}`, why: red.why, secretBearing: SECRET_BEARING.test(e.name) });
      }
      entries.push({ path: `${batch}/${r}`, data });
    }
  };
  walk(path.join(root, batch), '');
  return { entries, secretBearing, notRedacted };
}

// Opt-in, and deliberately NOT the safety mechanism. Drops known value-bearing fields; anything it
// does not recognise it leaves, which is exactly why this cannot be relied on for plaintext export.
export const VALUE_FIELDS = Object.freeze(['Secret', 'Match', 'Raw', 'RawV2', 'snippet']);
const VALUE_SET = new Set(VALUE_FIELDS);

/**
 * Best-effort, and it REPORTS its own coverage rather than implying completeness. A denylist over
 * field names cannot be complete — its covered set is "everything except the names I knew", which
 * shrinks silently as scanners add fields — so the honest thing is to publish the list applied and
 * name every file it could not process. Returns { data, redacted } and NEVER silently passes an
 * unredacted file off as redacted: an unparseable file is reported, because "you asked for
 * redaction and got raw bytes" must be visible in the manifest rather than inferred.
 */
function redactBuffer(buf, name) {
  if (!/\.(json|sarif|jsonl)$/i.test(name)) return { data: buf, redacted: false, why: 'not a JSON-shaped report' };
  const strip = (o) => {
    if (Array.isArray(o)) return o.map(strip);
    if (o && typeof o === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(o)) out[k] = VALUE_SET.has(k) ? '[REDACTED]' : strip(v);
      return out;
    }
    return o;
  };
  try { return { data: Buffer.from(JSON.stringify(strip(JSON.parse(buf.toString('utf8'))))), redacted: true }; }
  catch (e) { return { data: buf, redacted: false, why: `unparseable (${e.message.slice(0, 60)})` }; }
}

// ---- build / verify -------------------------------------------------------
export function buildArchive({ root, batches, key, level = 3, redact = false, now }) {
  const entries = [];
  const perBatch = [];
  const notRedacted = [];
  let secretBearing = 0;
  for (const b of batches) {
    const r = readEntries(root, b.name, { redact });
    entries.push(...r.entries);
    secretBearing += r.secretBearing;
    notRedacted.push(...r.notRedacted);
    perBatch.push({ batch: b.name, area: b.area, files: r.entries.length, anchors: b.manifest.anchors ?? b.manifest.repos ?? null });
  }
  const manifest = {
    v: 1,
    created: new Date(nowMs(now)).toISOString(),
    fidelity: redact ? 'redacted' : 'raw',
    entries: entries.map((e) => ({ path: e.path, size: e.data.length, sha256: sha256(e.data) })),
    batches: perBatch,
    secretBearingFiles: secretBearing,
    // Coverage STATED, not implied: a denylist cannot be complete, so publish what it applied and
    // every file it could not process. A reader can then judge the gap instead of assuming none.
    redaction: redact ? { fields: [...VALUE_FIELDS], notRedacted } : null,
  };
  // Two-pass: the manifest names the frame count, so seal once to learn it, then re-seal with the
  // count inside. The manifest is sealed WITH the data — a manifest outside the ciphertext could be
  // edited to describe a different archive.
  const first = sealArchive(packEntries([...entries, { path: '__manifest__.json', data: Buffer.from(JSON.stringify({ ...manifest, frames: 0 })) }]), key, { level });
  manifest.frames = first.frames;
  let sealed = sealArchive(packEntries([...entries, { path: '__manifest__.json', data: Buffer.from(JSON.stringify(manifest)) }]), key, { level });
  // The count can shift by one if the extra digits cross a frame edge; converge rather than lie.
  for (let i = 0; i < 4 && sealed.frames !== manifest.frames; i++) {
    manifest.frames = sealed.frames;
    sealed = sealArchive(packEntries([...entries, { path: '__manifest__.json', data: Buffer.from(JSON.stringify(manifest)) }]), key, { level });
  }
  if (sealed.frames !== manifest.frames) throw new Error('frame count did not converge — refusing to write an archive whose manifest disagrees with it');
  return { buf: sealed.buf, manifest, entryCount: entries.length };
}

/** Independent verification. Re-reads the file and re-derives every hash; the CLI path re-fetches
 *  the key from the keychain in a SEPARATE process, so nothing in memory can vouch for itself. */
export function verifyArchive(file, key) {
  const buf = fs.readFileSync(file);
  const { plaintext, frames } = openArchive(buf, key);
  const entries = unpackEntries(plaintext); // per-entry hashes checked in here
  const mEntry = entries.find((e) => e.path === '__manifest__.json');
  if (!mEntry) throw new Error('archive carries no manifest');
  const manifest = JSON.parse(mEntry.data.toString('utf8'));
  if (manifest.frames !== frames) throw new Error(`manifest declares ${manifest.frames} frames, archive has ${frames}`);
  const byPath = new Map(entries.filter((e) => e.path !== '__manifest__.json').map((e) => [e.path, e.data]));
  const missing = [];
  const wrong = [];
  for (const d of manifest.entries) {
    const got = byPath.get(d.path);
    if (!got) { missing.push(d.path); continue; }
    if (sha256(got) !== d.sha256) wrong.push(d.path);
  }
  const extra = [...byPath.keys()].filter((p) => !manifest.entries.some((d) => d.path === p));
  const ok = !missing.length && !wrong.length && !extra.length;
  return { ok, manifest, frames, missing, wrong, extra, bytes: buf.length };
}

// ---- coverage -------------------------------------------------------------
// Append-only, and keyed on VERIFIED archives only: counting an unverified one would let a partial
// run mask a gap that a human then deletes the source for.
const coveragePath = () => path.join(archiveDir(), 'coverage.jsonl');
export function coveredBatches() {
  const covered = new Set();
  let text;
  try { text = fs.readFileSync(coveragePath(), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return covered; throw e; }
  for (const line of text.split('\n').filter(Boolean)) {
    try { for (const b of JSON.parse(line).batches || []) covered.add(b); } catch { /* a bad line hides nothing: unknown stays uncovered */ }
  }
  return covered;
}

function recordCoverage(rec) {
  fs.mkdirSync(archiveDir(), { recursive: true });
  fs.appendFileSync(coveragePath(), `${JSON.stringify(rec)}\n`);
}

// ---- CLI ------------------------------------------------------------------
function main(argv) {
  const has = (f) => argv.includes(f);
  const val = (f, d = null) => { const i = argv.indexOf(f); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
  if (has('--key')) { console.error('[archive] --key is refused: key material in argv is visible in `ps`. The keychain is the only source.'); return 2; }

  const reg = loadRegistry({ quiet: true });
  const root = reportsRootDir(reg);
  const out = archiveDir();

  const verifyTarget = val('--verify');
  if (verifyTarget) {
    const r = verifyArchive(verifyTarget, keychainKey());
    console.log(`[archive] ${path.basename(verifyTarget)} — ${r.ok ? 'VERIFIED' : 'FAILED'}`);
    console.log(`[archive]   ${r.manifest.entries.length} entries · ${r.frames} frames · ${(r.bytes / 1e6).toFixed(1)} MB · fidelity=${r.manifest.fidelity}`);
    if (!r.ok) {
      for (const p of r.missing.slice(0, 5)) console.log(`[archive]   MISSING ${p}`);
      for (const p of r.wrong.slice(0, 5)) console.log(`[archive]   HASH MISMATCH ${p}`);
      for (const p of r.extra.slice(0, 5)) console.log(`[archive]   UNDECLARED ${p}`);
      return 1;
    }
    recordCoverage({ archive: path.basename(verifyTarget), at: new Date(nowMs()).toISOString(), batches: r.manifest.batches.map((b) => b.batch), sha256: sha256(fs.readFileSync(verifyTarget)), verified: true });
    console.log(`[archive]   coverage recorded — ${r.manifest.batches.length} batches now provably archived`);
    return 0;
  }

  const dry = has('--dry');
  const redact = has('--redact');
  const level = +(val('--level', '3'));
  const olderThanDays = val('--older-than') ? +val('--older-than') : null;
  const { picked, skipped } = selectBatches(root, { olderThanDays, area: val('--area') });
  const already = has('--force') ? new Set() : coveredBatches();
  const todo = picked.filter((b) => !already.has(b.name));

  console.log(`[archive] ${picked.length} eligible · ${already.size ? `${picked.length - todo.length} already archived` : 'none previously archived'} · ${skipped.length} skipped`);
  if (!todo.length) { console.log('[archive] nothing to do'); return 0; }

  if (dry) {
    let bytes = 0, files = 0, secretish = 0;
    for (const b of todo) {
      const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { files++; bytes += fs.statSync(p).size; if (SECRET_BEARING.test(e.name)) secretish++; } } };
      walk(path.join(root, b.name));
    }
    console.log(`[archive] DRY — would archive ${todo.length} batches · ${files} files · ${(bytes / 1e9).toFixed(2)} GB raw`);
    console.log(`[archive] DRY — ${secretish} secret-bearing report files would be included${redact ? ' (redaction ON — best-effort, not the safety mechanism)' : ' at FULL FIDELITY, protected by encryption alone'}`);
    console.log('[archive] DRY — nothing written, nothing deleted, nothing uploaded');
    return 0;
  }

  const key = keychainKey({ create: true });
  const stamp = new Date(nowMs()).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const name = `commitwork-batches-${stamp}.cwar`;
  const built = buildArchive({ root, batches: todo, key, level, redact });
  fs.mkdirSync(out, { recursive: true });
  const finalPath = path.join(out, name);
  writeAtomic(finalPath, built.buf);   // atomic: a partial write never becomes an archive
  console.log(`[archive] wrote ${finalPath}`);
  console.log(`[archive]   ${todo.length} batches · ${built.entryCount} entries · ${built.manifest.frames} frames · ${(built.buf.length / 1e6).toFixed(1)} MB · fidelity=${built.manifest.fidelity}`);
  console.log(`[archive]   ${built.manifest.secretBearingFiles} secret-bearing files inside — this artifact is sensitive until decrypted by someone entitled to it`);
  console.log('[archive] NOT yet counted as coverage. Run --verify on it; nothing should be deleted until that passes.');
  console.log('[archive] This tool never deletes and never uploads. Offload is a human act.');
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
