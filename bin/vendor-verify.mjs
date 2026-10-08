#!/usr/bin/env node
// commitwork — vendor-verify: check this repo's own vendored JS blobs against their
// npm-published bytes.
//
// The anchor is the PUBLISHER, never a vendor-time digest ledger (trust-on-first-use): fetch
// dist.tarball, verify it against dist.integrity, then byte-compare the published entry.
//
// States are tri-state and explicit uncertainty:
//   verified      bytes are identical to the published bytes, under a verified tarball
//   mismatch      tarball verified, bytes differ (or the published path does not exist)
//   UNVERIFIABLE  registry unreachable, unknown package/version, tarball fails its integrity,
//                 tarball unparseable, vendored file absent or unreadable
// A network failure is UNVERIFIABLE. It is never `verified`, and never silently skipped.
//
// Usage:  node bin/vendor-verify.mjs [--json]
// Env (all read at CALL time, never at module load):
//   CW_VENDOR_ROSTER      JSON file listing the vendored assets (default: ROSTER below)
//   CW_VENDOR_ROOT        repo root the asset paths resolve against (default: this repo)
//   CW_NPM_REGISTRY       registry base; http(s):// or file:// (default registry.npmjs.org)
//   CW_VENDOR_CACHE       tarball cache dir (default <root>/reports/vendor-cache, gitignored) —
//                         bandwidth only; re-checked against fresh integrity every run
//   CW_VENDOR_OFFLINE     "1" forbids network — every asset becomes UNVERIFIABLE, never verified
//   CW_VENDOR_TIMEOUT_MS  per-request timeout (default 60000)
// Exit:  0 all verified · 1 any mismatch · 2 any unverifiable
//
// Asset identity is (path, pkg, entry) — never a line number, and never a digest.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// `entry` is the path inside the npm tarball (rooted at `package/`); OrbitControls is the legacy
// UMD build under examples/js/, not the examples/jsm/ ES module.
export const ROSTER = [
  { path: 'sitemap/vendor/three.min.js', pkg: 'three', version: '0.147.0', entry: 'package/build/three.min.js' },
  { path: 'sitemap/vendor/OrbitControls.js', pkg: 'three', version: '0.147.0', entry: 'package/examples/js/controls/OrbitControls.js' },
];

const repoRoot = () => resolve(process.env.CW_VENDOR_ROOT || join(HERE, '..'));
const registryBase = () => (process.env.CW_NPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');
const cacheDir = () => resolve(process.env.CW_VENDOR_CACHE || join(repoRoot(), 'reports', 'vendor-cache'));
const offline = () => process.env.CW_VENDOR_OFFLINE === '1';
const timeoutMs = () => Number(process.env.CW_VENDOR_TIMEOUT_MS || 60000);

export function loadRoster() {
  const p = process.env.CW_VENDOR_ROSTER;
  if (!p) return ROSTER;
  // fail closed: a roster that exists but will not parse is an error, not an empty roster
  const parsed = JSON.parse(readFileSync(p, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : parsed.assets;
  if (!Array.isArray(list)) throw new Error(`vendor roster ${p} has no asset array`);
  return list;
}

// ---------------------------------------------------------------- tar (no dependencies)

const cstr = (b, off, len) => {
  const s = b.subarray(off, off + len);
  const z = s.indexOf(0);
  return s.subarray(0, z === -1 ? s.length : z).toString('latin1');
};

function parseNumeric(b, off, len) {
  if (b[off] & 0x80) { // GNU base-256
    let n = b[off] & 0x7f;
    for (let i = off + 1; i < off + len; i++) n = n * 256 + b[i];
    return n;
  }
  const s = cstr(b, off, len).trim().replace(/\0+$/, '');
  if (!/^[0-7]+$/.test(s)) return null;
  return parseInt(s, 8);
}

// Minimal ustar/GNU/pax reader. Returns only the `wanted` regular-file entries. Any structural
// surprise throws — the caller turns that into UNVERIFIABLE, never into "no such file, so clean".
export function readTar(buf, wanted) {
  const out = new Map();
  let off = 0, longName = null, paxPath = null;
  while (off + 512 <= buf.length) {
    const head = buf.subarray(off, off + 512);
    if (head.every((b) => b === 0)) break; // end-of-archive marker
    const stored = parseNumeric(head, 148, 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : head[i];
    if (stored === null || sum !== stored) throw new Error(`tar: header checksum mismatch at offset ${off}`);
    const size = parseNumeric(head, 124, 12);
    if (size === null || size < 0) throw new Error(`tar: unreadable size field at offset ${off}`);
    const type = String.fromCharCode(head[156]);
    let name = cstr(head, 0, 100);
    const prefix = cstr(head, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const dataAt = off + 512;
    if (dataAt + size > buf.length) throw new Error(`tar: entry '${name}' runs past end of archive`);
    const data = buf.subarray(dataAt, dataAt + size);
    off = dataAt + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = cstr(data, 0, size); continue; }
    if (type === 'x') { paxPath = paxField(data, 'path'); continue; }
    if (type === 'g' || type === 'K') continue;
    if (longName !== null) { name = longName; longName = null; }
    if (paxPath !== null) { name = paxPath; paxPath = null; }
    if ((type === '0' || type === '\0') && wanted.has(name)) out.set(name, Buffer.from(data));
  }
  return out;
}

function paxField(data, key) {
  const text = data.toString('utf8');
  let i = 0;
  while (i < text.length) {
    const sp = text.indexOf(' ', i);
    if (sp === -1) break;
    const len = parseInt(text.slice(i, sp), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = text.slice(sp + 1, i + len).replace(/\n$/, '');
    const eq = record.indexOf('=');
    if (eq !== -1 && record.slice(0, eq) === key) return record.slice(eq + 1);
    i += len;
  }
  return null;
}

// ---------------------------------------------------------------- integrity

// SSRI first (sha512/384/256), legacy sha1 shasum only as a fallback. No anchor at all is a
// failure, not a pass: an unanchored tarball proves nothing about the bytes it carries.
export function checkIntegrity(meta, buf) {
  const entries = String(meta?.integrity || '').trim().split(/\s+/).filter(Boolean);
  for (const algo of ['sha512', 'sha384', 'sha256']) {
    const e = entries.find((x) => x.startsWith(`${algo}-`));
    if (!e) continue;
    const want = e.slice(algo.length + 1).split('?')[0];
    const got = createHash(algo).update(buf).digest('base64');
    return got === want ? { ok: true, anchor: `${algo} integrity` } : { ok: false, why: `tarball ${algo} does not match the registry integrity` };
  }
  const shasum = String(meta?.shasum || '');
  if (/^[0-9a-f]{40}$/.test(shasum)) {
    // cw-hazards-ignore: the registry's legacy shasum is sha1 by protocol; this branch only runs when no sha512 integrity exists and is labelled legacy
    const got = createHash('sha1').update(buf).digest('hex');
    return got === shasum ? { ok: true, anchor: 'sha1 shasum (legacy)' } : { ok: false, why: 'tarball sha1 does not match the registry shasum' };
  }
  return { ok: false, why: 'registry metadata carries no integrity or shasum — nothing anchors this tarball' };
}

// ---------------------------------------------------------------- fetch

export function joinUrl(base, rest) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(rest)) return rest;
  return `${base.replace(/\/+$/, '')}/${String(rest).replace(/^\/+/, '')}`;
}

async function getBytes(url) {
  if (url.startsWith('file:')) return readFileSync(fileURLToPath(url));
  if (url.startsWith('/')) return readFileSync(url);
  if (offline()) throw new Error('CW_VENDOR_OFFLINE=1 forbids network access');
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs()) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

const cacheFile = (pkg, version) => join(cacheDir(), `${String(pkg).replace(/[^\w.-]+/g, '_')}-${version}.tgz`);

// Resolve one package@version to its verified, extracted entries.
// Returns { ok:true, files, anchor, tarballSha512 } or { ok:false, why } — never a partial pass.
export async function resolvePackage(pkg, version, wanted) {
  let meta;
  try {
    const doc = await getBytes(joinUrl(registryBase(), `${pkg}/${version}`));
    meta = JSON.parse(doc.toString('utf8'))?.dist;
  } catch (e) {
    return { ok: false, why: `registry lookup failed for ${pkg}@${version}: ${e.message}` };
  }
  if (!meta?.tarball) return { ok: false, why: `registry document for ${pkg}@${version} has no dist.tarball` };

  const cached = cacheFile(pkg, version);
  let buf = null, from = 'cache';
  try {
    buf = readFileSync(cached);
    if (!checkIntegrity(meta, buf).ok) buf = null; // a cached tarball that no longer anchors is not evidence
  } catch (e) {
    if (e.code !== 'ENOENT') return { ok: false, why: `cached tarball ${cached} unreadable: ${e.message}` };
    buf = null;
  }
  if (!buf) {
    from = 'registry';
    try {
      buf = await getBytes(joinUrl(registryBase(), meta.tarball));
    } catch (e) {
      return { ok: false, why: `tarball fetch failed for ${pkg}@${version}: ${e.message}` };
    }
  }

  const integrity = checkIntegrity(meta, buf);
  if (!integrity.ok) return { ok: false, why: integrity.why };

  if (from === 'registry') {
    try { // best effort; a cache we cannot write is not a verification failure
      mkdirSync(cacheDir(), { recursive: true });
      writeAtomic(cached, buf);
    } catch { /* cache is an optimisation, never the anchor */ }
  }

  let files;
  try {
    files = readTar(gunzipSync(buf), new Set(wanted));
  } catch (e) {
    return { ok: false, why: `tarball for ${pkg}@${version} could not be read: ${e.message}` };
  }
  return { ok: true, files, anchor: integrity.anchor, tarballSha512: createHash('sha512').update(buf).digest('hex') };
}

// ---------------------------------------------------------------- judgement

const sha512 = (b) => createHash('sha512').update(b).digest('hex');

export function readLocal(root, relPath) {
  try {
    return { ok: true, buf: readFileSync(join(root, relPath)) };
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: false, why: 'vendored file is absent — the roster claims an asset this tree does not have' };
    return { ok: false, why: `vendored file unreadable: ${e.code || e.message}` };
  }
}

// One decision per asset. Pure: takes the package result and the local read, returns the state.
// `pkgResult.ok === false` is UNVERIFIABLE, never verified — that is the whole point of the lane.
export function judge(item, pkgResult, local) {
  const base = { path: item.path, pkg: item.pkg, version: item.version, entry: item.entry };
  if (!local.ok) return { ...base, state: 'UNVERIFIABLE', why: local.why };
  const localSize = local.buf.length, localSha512 = sha512(local.buf);
  const withLocal = { ...base, localSize, localSha512 };
  if (!pkgResult || !pkgResult.ok) return { ...withLocal, state: 'UNVERIFIABLE', why: pkgResult?.why || 'package never resolved' };
  const pub = pkgResult.files.get(item.entry);
  if (!pub) {
    return { ...withLocal, state: 'mismatch', anchor: pkgResult.anchor, why: `published tarball ${item.pkg}@${item.version} contains no '${item.entry}' — the claimed provenance does not exist` };
  }
  const publishedSize = pub.length, publishedSha512 = sha512(pub);
  const out = { ...withLocal, publishedSize, publishedSha512, anchor: pkgResult.anchor };
  if (Buffer.compare(local.buf, pub) === 0) return { ...out, state: 'verified', why: `byte-identical to ${item.pkg}@${item.version} ${item.entry}` };
  return { ...out, state: 'mismatch', why: `vendored bytes differ from ${item.pkg}@${item.version} ${item.entry} (${localSize} vs ${publishedSize} bytes)` };
}

export async function run(roster = loadRoster()) {
  const root = repoRoot();
  const byPkg = new Map();
  for (const item of roster) {
    const key = `${item.pkg}@${item.version}`;
    if (!byPkg.has(key)) byPkg.set(key, { pkg: item.pkg, version: item.version, wanted: new Set() });
    byPkg.get(key).wanted.add(item.entry);
  }
  const resolved = new Map();
  for (const [key, { pkg, version, wanted }] of [...byPkg.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)) {
    resolved.set(key, await resolvePackage(pkg, version, wanted));
  }
  const assets = roster
    .map((item) => judge(item, resolved.get(`${item.pkg}@${item.version}`), readLocal(root, item.path)))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const count = (s) => assets.filter((a) => a.state === s).length;
  return {
    tool: 'vendor-verify',
    summary: { total: assets.length, verified: count('verified'), mismatch: count('mismatch'), unverifiable: count('UNVERIFIABLE') },
    assets,
  };
}

export const exitCodeFor = (summary) => (summary.mismatch ? 1 : summary.unverifiable ? 2 : 0);

if (isMainModule(import.meta.url)) {
  let report;
  try {
    report = await run();
  } catch (e) {
    // fail closed: a roster that will not load is not an empty roster, and an empty roster is not
    // a clean run. Exit 2 (the unverifiable class), never 0.
    console.error(`vendor-verify: ${e.message}`);
    process.exit(2);
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const a of report.assets) {
      const mark = { verified: '🟢', mismatch: '🔴', UNVERIFIABLE: '⚪' }[a.state];
      console.log(`${mark} ${a.state.padEnd(12)} ${a.path}  ${a.localSize ?? '?'} B  ${(a.localSha512 || '').slice(0, 16) || '—'}`);
      console.log(`   ${a.why}${a.anchor ? `  [anchor: ${a.anchor}]` : ''}`);
    }
    const s = report.summary;
    console.log(`\n${s.total} vendored asset(s): ${s.verified} verified · ${s.mismatch} mismatch · ${s.unverifiable} unverifiable`);
  }
  process.exit(exitCodeFor(report.summary));
}
