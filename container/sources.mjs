#!/usr/bin/env node
// The source bundle for one built image: the source of every component the image's INDEX.json
// (container/licenses.mjs) names a source for, fetched from a pinned place and checked, written as
// one tar with SOURCES.json beside it. Publish both beside the image; the image's SOURCES.md says where.
//
// usage: node container/sources.mjs --image <ref> --out <dir> [--dry]
//   --dry  resolve every source and write SOURCES.json, download nothing
// Debian sources come from the dated snapshot the image's own apt sources name: apt-get, run in the
// image, checks the snapshot's signed index and prints each file's SHA-256. PyPI sdists are pinned by
// the digest PyPI publishes. A GitHub tag is resolved to its commit; GitHub makes the tarball on
// request, so its SHA-256 is the one measured on download. A GitHub source marked goModules also
// brings every module its go.mod requires, from the Go module proxy, each checked against the
// go.sum hash in that tarball, at the path the proxy serves it under.
// exit: 0 every source fetched and checked · 1 a source unresolved, unfetched or mismatched, or a
//       copyleft component without one (each named; SOURCES.json lists them under `unfetched`) · 2 usage
// env, read at call time: CW_SOURCES_DOCKER (the docker binary), GITHUB_TOKEN (raises GitHub's API
//       rate limit), CW_SOURCES_PYPI (the PyPI origin), CW_SOURCES_GITHUB_API (the GitHub API origin),
//       CW_SOURCES_CODELOAD (the GitHub tarball origin), CW_SOURCES_GOPROXY (the Go module proxy)

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { COPYLEFT } from './licenses.mjs';

const INDEX_PATH = '/usr/share/licenses/commitwork/INDEX.json';
const docker = () => process.env.CW_SOURCES_DOCKER || 'docker';
const pypi = () => process.env.CW_SOURCES_PYPI || 'https://pypi.org';
const ghApi = () => process.env.CW_SOURCES_GITHUB_API || 'https://api.github.com';
const codeload = () => process.env.CW_SOURCES_CODELOAD || 'https://codeload.github.com';
const goproxy = () => process.env.CW_SOURCES_GOPROXY || 'https://proxy.golang.org';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** One fetch per distinct source, each naming the components it serves. */
export function plan(index) {
  const items = new Map(), missing = [];
  for (const c of index.components) {
    const who = { kind: c.kind, name: c.name, version: c.version, licence: c.licence, family: c.family };
    if (COPYLEFT.has(c.family) && !(c.source || []).length) missing.push({ ...who, reason: 'copyleft, and INDEX.json names no source for it' });
    for (const s of c.source || []) {
      const key = s.debian ? `debian ${s.debian} ${s.version}` : s.pypi ? `pypi ${s.pypi} ${s.version}` : s.github ? `github ${s.github} ${s.tag}` : `in-image ${s.inImage}`;
      if (!items.has(key)) items.set(key, { key, source: s, components: [] });
      items.get(key).components.push(who);
    }
  }
  return { items: [...items.values()].sort((a, b) => (a.key < b.key ? -1 : 1)), missing };
}

/** apt-get source --print-uris lines as { url, file, size, sha256 }. */
export function parsePrintUris(text) {
  return [...String(text).matchAll(/^'(\S+)' (\S+) (\d+) SHA256:([0-9a-f]{64})$/gm)].map((m) => ({ url: m[1], file: m[2], size: Number(m[3]), sha256: m[4] }));
}

/** The image's binary apt sources as source stanzas, so apt reads the same snapshot. */
export const debSrc = (sources) => String(sources).replace(/^Types:\s*deb\s*$/gm, 'Types: deb-src');

function dockerOut(args, timeout = 120_000) {
  return execFileSync(docker(), args, { encoding: 'utf8', timeout, maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Debian files per source package, resolved by apt in the image against its own snapshot. */
function resolveDebian(image, items, tmp) {
  const want = items.map((i) => `${i.source.debian}=${i.source.version}`);
  if (!want.length) return new Map();
  const src = join(tmp, 'deb-src.sources');
  writeAtomic(src, debSrc(dockerOut(['run', '--rm', '--entrypoint', 'cat', image, '/etc/apt/sources.list.d/debian.sources'])), { mkdir: true });
  const script = 'apt-get update -qq >/dev/null && for p in "$@"; do echo "== $p"; apt-get source --print-uris -qq "$p" 2>&1 || echo "UNRESOLVED"; done';
  const out = dockerOut(['run', '--rm', '--user', '0', '--network', 'bridge', '-v', `${src}:/etc/apt/sources.list.d/debian.sources:ro`, '--entrypoint', 'sh', image, '-c', script, 'sh', ...want], 1_800_000);
  const by = new Map();
  for (const block of out.split(/^== /m).slice(1)) {
    const [head, ...rest] = block.split('\n');
    const files = parsePrintUris(rest.join('\n'));
    by.set(head.trim(), files.length ? { files } : { reason: `apt could not resolve it in the image's snapshot: ${rest.join(' ').trim().slice(0, 200)}` });
  }
  return by;
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}
const ghHeaders = () => (process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {});

async function resolvePypi({ pypi: name, version }) {
  const j = await getJson(`${pypi()}/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`);
  const sdist = (j.urls || []).filter((u) => u.packagetype === 'sdist');
  if (!sdist.length) return { reason: `PyPI publishes no sdist for ${name} ${version}` };
  return { files: sdist.map((u) => ({ url: u.url, file: u.filename, size: u.size, sha256: u.digests.sha256 })) };
}

async function resolveGithub({ github: repo, tag }) {
  const res = await fetch(`${ghApi()}/repos/${repo}/commits/${encodeURIComponent(tag)}`, { headers: { accept: 'application/vnd.github.sha', ...ghHeaders() }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) return { reason: `GitHub could not resolve ${repo}@${tag}: HTTP ${res.status}` };
  const commit = (await res.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) return { reason: `GitHub returned no commit for ${repo}@${tag}` };
  return { commit, files: [{ url: `${codeload()}/${repo}/tar.gz/${commit}`, file: `${repo.split('/')[1]}-${tag}-${commit.slice(0, 12)}.tar.gz`, size: null, sha256: null }] };
}

/** go.mod's requirements with its replace directives applied; a local-path replacement has no version. */
export function goRequirements(gomod) {
  const t = String(gomod).replace(/\/\/.*$/gm, '');
  const req = [], rep = new Map();
  const reqLine = (l) => { const m = /^\s*(\S+)\s+(v\S+)\s*$/.exec(l); if (m) req.push([m[1], m[2]]); };
  const repLine = (l) => { const m = /^\s*(\S+)(?:\s+(v\S+))?\s+=>\s+(\S+)(?:\s+(v\S+))?\s*$/.exec(l); if (m) rep.set(m[2] ? `${m[1]}@${m[2]}` : m[1], [m[3], m[4] || null]); };
  for (const [, verb, body] of t.matchAll(/^(require|replace)\s*\(([\s\S]*?)^\)/gm)) body.split('\n').forEach(verb === 'require' ? reqLine : repLine);
  for (const [, verb, line] of t.matchAll(/^(require|replace)\s+([^(\s].*)$/gm)) (verb === 'require' ? reqLine : repLine)(line);
  return req.map(([m, v]) => rep.get(`${m}@${v}`) || rep.get(m) || [m, v]).map(([module, version]) => ({ module, version }));
}

/** go.sum as a map from "module version" and "module version/go.mod" to the h1: hash. */
export const goSum = (text) => new Map([...String(text).matchAll(/^(\S+) (\S+) (h1:\S+)$/gm)].map((m) => [`${m[1]} ${m[2]}`, m[3]]));
export const goEscape = (s) => s.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);

/** The entries of a zip as { name, data }. */
export function zipFiles(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  if (count === 0xffff || buf.readUInt32LE(eocd + 16) === 0xffffffff) throw new Error('zip64 is not read here');
  const out = [];
  for (let i = 0, p = buf.readUInt32LE(eocd + 16); i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), at = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28), raw = buf.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`${name}: compression method ${method}`);
    out.push({ name, data: method === 8 ? inflateRawSync(raw) : raw });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

/** Go's dirhash h1: over [{ name, data }], as go.sum records it. */
export function dirHash(files) {
  const lines = files.map((f) => `${sha256(f.data)}  ${f.name}\n`).sort((a, b) => { const x = a.slice(66), y = b.slice(66); return x < y ? -1 : x > y ? 1 : 0; });
  return `h1:${createHash('sha256').update(lines.join('')).digest('base64')}`;
}

/** Bundle path of one fetched file. */
export const bundlePath = (s, file) => (s.debian ? `debian/${s.debian}/${file}` : s.pypi ? `pypi/${s.pypi}/${file}` : `github/${s.github.replace('/', '__')}/${file}`);

async function fileSha(path) {
  const h = createHash('sha256');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

/** Download to dest unless a file that passes the checks is already there. Returns { sha256, size }. */
async function download(f, dest, tries = 3) {
  const passes = async (p) => (!f.sha256 || (await fileSha(p)) === f.sha256) && (!f.check || f.check(readFileSync(p)));
  if (existsSync(dest) && (await passes(dest))) return { sha256: await fileSha(dest), size: statSync(dest).size };
  mkdirSync(dirname(dest), { recursive: true });
  for (let n = 1; ; n++) {
    const tmp = `${dest}.part`;
    try {
      const res = await fetch(f.url, { redirect: 'follow', signal: AbortSignal.timeout(1_800_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const h = createHash('sha256');
      const tap = new Transform({ transform(chunk, _e, cb) { h.update(chunk); cb(null, chunk); } });
      await pipeline(Readable.fromWeb(res.body), tap, createWriteStream(tmp));
      const got = h.digest('hex');
      if (f.sha256 && got !== f.sha256) throw new Error(`sha256 ${got} is not the pinned ${f.sha256}`);
      if (f.check && !f.check(readFileSync(tmp))) throw new Error(`does not match its go.sum hash ${f.h1}`);
      renameSync(tmp, dest);
      return { sha256: got, size: statSync(dest).size };
    } catch (e) {
      rmSync(tmp, { force: true });
      if (n >= tries || /is not the pinned|go\.sum/.test(e.message)) throw e;
      await new Promise((ok) => setTimeout(ok, 2000 * n));
    }
  }
}

/** A ustar header: fixed owner, mode and mtime, so the same files give the same bytes. */
export function tarHeader(path, size) {
  const h = Buffer.alloc(512);
  let name = path, prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const cut = path.lastIndexOf('/', 155);
    prefix = path.slice(0, cut); name = path.slice(cut + 1);
    if (cut < 0 || Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`${path}: too long for ustar`);
  }
  const put = (s, at, len) => h.write(s, at, len, 'utf8');
  put(name, 0, 100); put('0000644\0', 100, 8); put('0000000\0', 108, 8); put('0000000\0', 116, 8);
  put(`${size.toString(8).padStart(11, '0')}\0`, 124, 12); put('00000000000\0', 136, 12); put('        ', 148, 8);
  put('0', 156, 1); put('ustar\0', 257, 6); put('00', 263, 2); put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return h;
}

/** Write a tar of [{ path, file | data }] in the order given, ending with two zero blocks. */
export async function writeTar(dest, entries) {
  const out = createWriteStream(`${dest}.part`);
  let failed = null;
  out.on('error', (e) => { failed = e; });
  const write = async (b) => { if (failed) throw failed; if (!out.write(b)) await once(out, 'drain'); };
  for (const e of entries) {
    const size = e.data ? e.data.length : statSync(e.file).size;
    await write(tarHeader(e.path, size));
    if (e.data) await write(e.data);
    else for await (const chunk of createReadStream(e.file)) await write(chunk);
    if (size % 512) await write(Buffer.alloc(512 - (size % 512)));
  }
  await write(Buffer.alloc(1024));
  await new Promise((ok, no) => out.end((err) => (err ? no(err) : ok())));
  renameSync(`${dest}.part`, dest);
}

/** The module files a Go source tarball's go.mod requires, each checked against its go.sum. */
export function goModuleFiles(gomod, gosum) {
  const sums = goSum(gosum), out = [], unpinned = [];
  for (const { module, version } of goRequirements(gomod)) {
    if (!version) continue;
    const base = `${goproxy()}/${goEscape(module)}/@v/${goEscape(version)}`, dir = `go/${goEscape(module)}/@v/${goEscape(version)}`;
    const h1 = sums.get(`${module} ${version}`), modH1 = sums.get(`${module} ${version}/go.mod`);
    if (!h1 || !modH1) { unpinned.push(`${module}@${version}`); continue; }
    out.push({ module, version, files: [
      { url: `${base}.mod`, path: `${dir}.mod`, h1: modH1, check: (b) => dirHash([{ name: 'go.mod', data: b }]) === modH1 },
      { url: `${base}.zip`, path: `${dir}.zip`, h1, check: (b) => dirHash(zipFiles(b)) === h1 },
    ] });
  }
  return { modules: out, unpinned };
}

function tarMember(tgz, re) {
  const name = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').find((n) => re.test(n));
  if (!name) throw new Error(`${tgz} holds no ${re}`);
  return execFileSync('tar', ['-xOzf', tgz, name], { encoding: 'utf8', maxBuffer: 64 << 20 });
}

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (queue.length) await fn(queue.shift()); }));
}

function parseArgs(argv) {
  const o = { image: '', out: '', dry: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry') o.dry = true;
    else if (argv[i] === '--image') o.image = argv[++i];
    else if (argv[i] === '--out') o.out = argv[++i];
    else throw Object.assign(new Error(`unknown argument ${argv[i]}`), { usage: true });
  }
  if (!o.image || !o.out) throw Object.assign(new Error('--image and --out are required'), { usage: true });
  return o;
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`sources: ${e.message}`); process.exit(2); }
  const raw = dockerOut(['run', '--rm', '--entrypoint', 'cat', o.image, INDEX_PATH]);
  const index = JSON.parse(raw), indexSha = sha256(Buffer.from(raw));
  const { items, missing } = plan(index);
  const unfetched = missing.map((m) => ({ components: [m], reason: m.reason }));
  const work = join(o.out, 'files');
  const deb = resolveDebian(o.image, items.filter((i) => i.source.debian), join(o.out, '.work'));
  const entries = [], inImage = [];
  await pool(items, 4, async (item) => {
    const s = item.source;
    if (s.inImage) { inImage.push({ path: s.inImage, components: item.components }); return; }
    let r;
    try { r = s.debian ? deb.get(`${s.debian}=${s.version}`) || { reason: 'apt printed nothing for it' } : s.pypi ? await resolvePypi(s) : await resolveGithub(s); } catch (e) { r = { reason: e.message }; }
    if (!r.files) { unfetched.push({ source: s, components: item.components, reason: r.reason }); return; }
    const files = [];
    for (const f of r.files) {
      const path = bundlePath(s, f.file);
      try {
        const got = o.dry ? { sha256: f.sha256, size: f.size } : await download(f, join(work, path));
        files.push({ path, url: f.url, size: got.size, sha256: got.sha256, ...(f.sha256 ? {} : { measured: true }) });
      } catch (e) { unfetched.push({ source: s, components: item.components, file: f.file, url: f.url, reason: e.message }); }
    }
    entries.push({ source: { ...s, ...(r.commit ? { commit: r.commit } : {}) }, components: item.components, files });
    if (s.goModules && !o.dry && files.length) {
      const tgz = join(work, files[0].path);
      let gm;
      try { gm = goModuleFiles(tarMember(tgz, /^[^/]+\/go\.mod$/), tarMember(tgz, /^[^/]+\/go\.sum$/)); } catch (e) { unfetched.push({ source: s, components: item.components, reason: `go modules: ${e.message}` }); return; }
      for (const m of gm.unpinned) unfetched.push({ source: { go: m, for: s.github }, components: item.components, reason: 'go.sum pins no hash for it' });
      await pool(gm.modules, 6, async (m) => {
        const got = [];
        for (const g of m.files) {
          try { const d = await download(g, join(work, g.path)); got.push({ path: g.path, url: g.url, size: d.size, sha256: d.sha256, h1: g.h1 }); } catch (e) { unfetched.push({ source: { go: m.module, version: m.version, for: s.github }, components: item.components, url: g.url, reason: e.message }); }
        }
        entries.push({ source: { go: m.module, version: m.version, for: s.github }, components: item.components, files: got });
      });
    }
  });
  const byKey = (a, b) => (JSON.stringify(a.source) < JSON.stringify(b.source) ? -1 : 1);
  entries.sort(byKey); unfetched.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  const bundle = `commitwork-sources-${indexSha.slice(0, 12)}.tar`;
  const doc = { schema: 'commitwork-sources/1', image: index.image, index: { path: INDEX_PATH, sha256: indexSha }, bundle, sources: entries, inImage, unfetched };
  const json = Buffer.from(`${JSON.stringify(doc, null, 1)}\n`);
  writeAtomic(join(o.out, 'SOURCES.json'), json, { mkdir: true });
  const files = entries.flatMap((e) => e.files);
  if (!o.dry) {
    const tarEntries = [{ path: 'SOURCES.json', data: json }, { path: 'INDEX.json', data: Buffer.from(raw) }, ...files.map((f) => ({ path: f.path, file: join(work, f.path) })).sort((a, b) => (a.path < b.path ? -1 : 1))];
    await writeTar(join(o.out, bundle), tarEntries);
  }
  const bytes = files.reduce((n, f) => n + (f.size || 0), 0);
  const kinds = {};
  for (const e of entries) { const k = Object.keys(e.source)[0]; kinds[k] = (kinds[k] || 0) + 1; }
  console.log(`sources: ${entries.length} sources (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}), ${inImage.length} in the image, ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB${o.dry ? ' (dry: nothing downloaded)' : ` in ${join(o.out, bundle)}`}; SOURCES.json beside it`);
  for (const u of unfetched) console.error(`  unfetched: ${u.components.map((c) => c.name).join(', ')}: ${u.reason}`);
  process.exit(unfetched.length ? 1 : 0);
}

if (isMainModule(import.meta.url)) main();
