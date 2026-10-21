#!/usr/bin/env node
// release-build — the release artefact, built from one commit's content and nothing else, so anybody
// holding the same commit can rebuild it to the same bytes and check a published file against it.
//
// usage: node bin/release-build.mjs --ref <tag|sha> --out <dir> [--json]
//        node bin/release-build.mjs --verify <manifest> [--json]
// exit: 0 built, or every rebuilt artefact matches · 20 a rebuilt or published artefact differs
//       from the manifest, or its ref now names another commit · 21 unreadable: git failed, the ref
//       does not resolve, a manifest that does not parse, a read other than ENOENT, or an
//       artefact that could not be written · 22 usage
// env, read at call time: CW_REPO_ROOT (the repository read, default this checkout)
// output: <out>/<name>-<version>-source.tar, its .tar.gz and <out>/release-manifest.json,
//         each via writeAtomic; --verify writes nothing
//
// The tar is written here, not by git archive: archive applies eol and export attributes, which
// vary with the runner's git config. Entries are the commit's blobs read raw, sorted by path bytes,
// owned 0:0 with no names, mode 0644 or 0755, mtime the commit's committer time (SOURCE_DATE_EPOCH).
// Gitlinks have no content in the commit and are listed in the manifest instead. The gzip header
// carries no name and mtime 0; its OS byte is set to 255 because zlib writes the build host's.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { gitChildEnv } from './lib/git-env.mjs';

export const EXIT = { OK: 0, MISMATCH: 20, UNREADABLE: 21, USAGE: 22 };
export const MANIFEST_NAME = 'release-manifest.json';
export const MANIFEST_SCHEMA = 'commitwork-release-manifest/1';

const REPO = () => resolve(process.env.CW_REPO_ROOT || dirname(dirname(fileURLToPath(import.meta.url))));

class Unreadable extends Error {}

function git(args, { input, cwd = REPO(), binary = false } = {}) {
  const r = spawnSync('git', args, {
    cwd, input, env: gitChildEnv(), maxBuffer: 1 << 30, timeout: 120_000,
    ...(binary ? {} : { encoding: 'utf8' }),
  });
  if (r.error) throw new Unreadable(`git could not be run: ${r.error.message}`);
  if (r.status !== 0) throw new Unreadable(`git ${args[0]} exited ${r.status}: ${String(r.stderr || '').trim().slice(0, 200)}`);
  return r.stdout;
}

export function resolveCommit(ref, cwd = REPO()) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-')) throw new Unreadable(`not a ref: ${JSON.stringify(ref)}`);
  return git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd }).trim();
}

// [{ mode, type, oid, path }] for every entry of the commit's tree, recursively.
function lsTree(commit, cwd) {
  return git(['ls-tree', '-r', '-z', '--full-tree', commit], { cwd }).split('\0').filter(Boolean).map((rec) => {
    const tab = rec.indexOf('\t');
    const [mode, type, oid] = rec.slice(0, tab).split(' ');
    return { mode, type, oid, path: rec.slice(tab + 1) };
  });
}

// Raw object bytes keyed by oid; cat-file --batch applies no filter, textconv or eol conversion.
function readBlobs(oids, cwd) {
  const unique = [...new Set(oids)];
  const out = new Map();
  if (!unique.length) return out;
  const buf = git(['cat-file', '--batch'], { cwd, binary: true, input: unique.join('\n') + '\n' });
  let at = 0;
  for (const oid of unique) {
    const nl = buf.indexOf(0x0a, at);
    const head = buf.subarray(at, nl).toString('utf8').split(' ');
    if (head[0] !== oid || head[1] !== 'blob') throw new Unreadable(`cat-file returned "${head.join(' ')}" for ${oid}`);
    const size = Number(head[2]);
    out.set(oid, buf.subarray(nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1;
  }
  return out;
}

// null only when the commit has no package.json; one that does not parse is unreadable
function readPackage(entries, blobs, commit) {
  const e = entries.find((x) => x.path === 'package.json');
  if (!e) return null;
  try { return JSON.parse(blobs.get(e.oid).toString('utf8')); } catch (err) {
    throw new Unreadable(`package.json at ${commit.slice(0, 12)} is not JSON: ${err.message.slice(0, 120)}`);
  }
}

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export function artefactBase(pkg, commit) {
  const name = String(pkg?.name ?? 'source').replace(/^@[^/]+\//, '');
  const version = String(pkg?.version ?? commit.slice(0, 12));
  const base = `${name}-${version}`;
  if (!SAFE.test(base)) throw new Unreadable(`artefact name "${base}" is not a plain file name`);
  return base;
}

// ── tar (POSIX ustar, pax records only where a field cannot hold the value) ─────────────────────

const BLOCK = 512;
const RECORD = BLOCK * 20;

function octal(n, width) {
  const s = n.toString(8);
  if (s.length > width - 1) throw new Unreadable(`${n} does not fit a ${width}-byte tar field`);
  return s.padStart(width - 1, '0') + '\0';
}

function header({ name, mode, size, mtime, type, linkname = '' }) {
  const h = Buffer.alloc(BLOCK);
  const put = (s, off, len) => {
    const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'utf8');
    if (b.length > len) throw new Unreadable(`tar field overflow: ${String(s).slice(0, 60)}`);
    b.copy(h, off);
  };
  put(name, 0, 100);
  put(octal(mode, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(mtime, 12), 136, 12);
  h.fill(0x20, 148, 156);
  put(type, 156, 1);
  put(linkname, 157, 100);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  put(octal(0, 8), 329, 8);
  put(octal(0, 8), 337, 8);
  let sum = 0;
  for (const b of h) sum += b;
  put(octal(sum, 7) + ' ', 148, 8);
  return h;
}

const pad = (n) => Buffer.alloc((BLOCK - (n % BLOCK)) % BLOCK);

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  const bodyLen = Buffer.byteLength(body);
  let digits = String(bodyLen).length;
  while (String(bodyLen + digits).length !== digits) digits++;
  return `${bodyLen + digits}${body}`;
}

function entry(parts, { path, mode, mtime, type, data = Buffer.alloc(0), linkname = '' }) {
  const pax = [];
  if (Buffer.byteLength(path) > 100) pax.push(paxRecord('path', path));
  if (Buffer.byteLength(linkname) > 100) pax.push(paxRecord('linkpath', linkname));
  if (pax.length) {
    const body = Buffer.from(pax.join(''), 'utf8');
    parts.push(header({ name: 'PaxHeader', mode: 0o644, size: body.length, mtime, type: 'x' }), body, pad(body.length));
  }
  // the pax record carries the full value; the ustar field keeps its first 100 bytes
  const short = (s) => Buffer.from(s, 'utf8').subarray(0, 100);
  parts.push(header({ name: short(path), mode, size: data.length, mtime, type, linkname: short(linkname) }), data, pad(data.length));
}

const byBytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** The tar bytes for a list of tree entries with their blobs, under `prefix/`. */
export function tarOf(entries, blobs, { prefix, mtime }) {
  const parts = [];
  const dirs = new Set([`${prefix}/`]);
  for (const e of entries) {
    const segs = e.path.split('/');
    for (let i = 1; i < segs.length; i++) dirs.add(`${prefix}/${segs.slice(0, i).join('/')}/`);
  }
  const items = [
    ...[...dirs].map((path) => ({ path, mode: 0o755, type: '5' })),
    ...entries.map((e) => {
      const data = blobs.get(e.oid);
      const path = `${prefix}/${e.path}`;
      if (e.mode === '120000') return { path, mode: 0o777, type: '2', linkname: data.toString('utf8') };
      return { path, mode: e.mode === '100755' ? 0o755 : 0o644, type: '0', data };
    }),
  ].sort((a, b) => byBytes(a.path, b.path));
  for (const it of items) entry(parts, { ...it, mtime });
  parts.push(Buffer.alloc(BLOCK * 2));
  const tar = Buffer.concat(parts);
  return Buffer.concat([tar, Buffer.alloc((RECORD - (tar.length % RECORD)) % RECORD)]);
}

/** gzip with an empty name, mtime 0 and OS byte 255, so the header names no host or time. */
export function gzipOf(buf) {
  const gz = gzipSync(buf, { level: 9 });
  if (gz[3] !== 0) throw new Unreadable(`zlib wrote gzip flags ${gz[3]}; expected none`);
  gz.writeUInt32LE(0, 4);
  gz[9] = 0xff;
  return gz;
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Build the artefacts for `ref` in memory.
 * @returns {{ manifest: object, files: Map<string, Buffer> }}
 */
export function build(ref, cwd = REPO()) {
  const commit = resolveCommit(ref, cwd);
  const [tree, epoch] = git(['show', '-s', '--format=%T %ct', commit], { cwd }).trim().split(' ');
  const mtime = Number(epoch);
  if (!Number.isSafeInteger(mtime) || mtime < 0) throw new Unreadable(`commit time "${epoch}" is not a timestamp`);
  const all = lsTree(commit, cwd);
  const gitlinks = all.filter((e) => e.type === 'commit').map((e) => ({ path: e.path, commit: e.oid }));
  const entries = all.filter((e) => e.type === 'blob');
  const blobs = readBlobs(entries.map((e) => e.oid), cwd);
  const base = artefactBase(readPackage(entries, blobs, commit), commit);
  const tar = tarOf(entries, blobs, { prefix: base, mtime });
  const files = new Map([[`${base}-source.tar`, tar], [`${base}-source.tar.gz`, gzipOf(tar)]]);
  const manifest = {
    schema: MANIFEST_SCHEMA,
    source: { ref, commit, tree, sourceDateEpoch: mtime },
    files: entries.length,
    gitlinksExcluded: gitlinks.sort((a, b) => byBytes(a.path, b.path)),
    artefacts: [...files].map(([file, buf]) => ({ file, bytes: buf.length, sha256: sha256(buf) })),
  };
  return { manifest, files };
}

export function writeBuild(ref, outDir, cwd = REPO()) {
  const { manifest, files } = build(ref, cwd);
  mkdirSync(outDir, { recursive: true });
  for (const [file, buf] of files) writeAtomic(join(outDir, file), buf);
  writeAtomic(join(outDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function readManifest(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) { throw new Unreadable(`manifest ${path}: ${e.code || e.message}`); }
  let m;
  try { m = JSON.parse(raw); } catch (e) { throw new Unreadable(`manifest ${path} is not JSON: ${e.message.slice(0, 120)}`); }
  const ok = m && m.schema === MANIFEST_SCHEMA && typeof m.source?.commit === 'string' && typeof m.source?.ref === 'string'
    && Array.isArray(m.artefacts) && m.artefacts.length > 0
    && m.artefacts.every((a) => typeof a?.file === 'string' && SAFE.test(a.file) && /^[0-9a-f]{64}$/.test(a.sha256 ?? ''));
  if (!ok) throw new Unreadable(`manifest ${path} is not a ${MANIFEST_SCHEMA} manifest`);
  return m;
}

const firstDiff = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
};

/**
 * Rebuild the manifest's commit and compare. A published file beside the manifest is compared too;
 * one that is absent is reported `absent`, never as a match.
 */
export function verify(manifestPath, cwd = REPO()) {
  const m = readManifest(manifestPath);
  const dir = dirname(resolve(manifestPath));
  const problems = [];
  const refNow = (() => {
    try { return resolveCommit(m.source.ref, cwd); } catch { return null; }
  })();
  if (refNow !== null && refNow !== m.source.commit) {
    problems.push(`ref ${m.source.ref} now names ${refNow}, the manifest records ${m.source.commit}`);
  }
  const rebuilt = build(m.source.commit, cwd);
  const results = m.artefacts.map((a) => {
    const buf = rebuilt.files.get(a.file);
    const r = { file: a.file, expected: a.sha256, rebuilt: buf ? sha256(buf) : null, published: 'absent' };
    if (!buf) problems.push(`${a.file}: the rebuild produced no file of that name`);
    else if (r.rebuilt !== a.sha256) problems.push(`${a.file}: rebuilt sha256 ${r.rebuilt} differs from the manifest's ${a.sha256}`);
    let pub = null;
    try { pub = readFileSync(join(dir, a.file)); } catch (e) {
      if (e.code !== 'ENOENT') throw new Unreadable(`${a.file}: ${e.code || e.message}`);
    }
    if (pub) {
      const h = sha256(pub);
      r.published = h === a.sha256 ? 'match' : 'mismatch';
      if (h !== a.sha256) {
        const at = buf ? firstDiff(pub, buf) : -1;
        problems.push(`${a.file}: published sha256 ${h} differs from the manifest's ${a.sha256}${at >= 0 ? ` (first differing byte against the rebuild: ${at})` : ''}`);
      }
    }
    return r;
  });
  for (const f of rebuilt.files.keys()) {
    if (!m.artefacts.some((a) => a.file === f)) problems.push(`${f}: rebuilt but not listed in the manifest`);
  }
  return { ok: problems.length === 0, commit: m.source.commit, ref: m.source.ref, refNow, results, problems };
}

function parseArgs(argv) {
  const o = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--ref' || a === '--out' || a === '--verify') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) return null;
      o[a.slice(2)] = v;
    } else return null;
  }
  if (o.verify) return o.ref || o.out ? null : o;
  return o.ref && o.out ? o : null;
}

export function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  if (!o) {
    process.stderr.write('usage: release-build.mjs --ref <tag|sha> --out <dir> [--json] | --verify <manifest> [--json]\n');
    return EXIT.USAGE;
  }
  try {
    if (o.verify) {
      const v = verify(o.verify);
      if (o.json) process.stdout.write(JSON.stringify(v, null, 2) + '\n');
      else {
        for (const r of v.results) {
          process.stdout.write(`${r.rebuilt === r.expected ? 'rebuilt-match' : 'rebuilt-MISMATCH'}  published-${r.published}  ${r.file}\n`);
        }
        if (v.refNow === null) process.stdout.write(`ref ${v.ref} does not resolve here; rebuilt from the recorded commit ${v.commit}\n`);
      }
      for (const p of v.problems) process.stderr.write(`release-build: ${p}\n`);
      return v.ok ? EXIT.OK : EXIT.MISMATCH;
    }
    const m = writeBuild(o.ref, resolve(o.out));
    if (o.json) process.stdout.write(JSON.stringify(m, null, 2) + '\n');
    else for (const a of m.artefacts) process.stdout.write(`${a.sha256}  ${basename(a.file)}\n`);
    return EXIT.OK;
  } catch (e) {
    process.stderr.write(`release-build: ${e.message}\n`);
    return EXIT.UNREADABLE;
  }
}

if (isMainModule(import.meta.url)) process.exitCode = main();
