#!/usr/bin/env node
// bin/cobolwork-pin.mjs — installs, checks and bumps the cobolwork release manifests/tool-pins.json
// pins. The lanes and lib/cobolwork-bridge.mjs run that install (lib/cobolwork-resolve.mjs), never a
// cobolwork on PATH.
//
//   node bin/cobolwork-pin.mjs [--check]                  is the pinned release installed and verified; reads only
//   node bin/cobolwork-pin.mjs --install [--from <tgz>] [--dry-run]
//   node bin/cobolwork-pin.mjs --latest                   rewrite the pin from the latest release
//   add --json for one JSON result on stdout
//
// --install writes only under $CW_TOOLS_ROOT/cobolwork/<version> (default ~/.commitwork/tools). The
// asset's sha256 is checked before anything is extracted, the tarball may hold only files and
// directories under package/, the package's lib/revision.json must state the pinned commit, and
// `capabilities --json` must meet the contract before the staged tree is renamed into place. A
// verified install is left alone. --latest rewrites the pin and prints the change; it installs
// nothing and commits nothing, so an upgrade is a reviewed commit of manifests/tool-pins.json.
//
// Env, read per call: CW_TOOL_PINS, CW_TOOLS_ROOT, CW_GH_BIN (the gh to run; a .mjs runs with this
// node), CW_COBOLWORK_BIN (reported by --check: while it is set, commitwork runs it instead).
// Exit: 0 done, or installed and verified; 1 refused, or not installed (--check); 2 usage.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { validateAgainstSchema } from '../monitor/registry.mjs';
import {
  TOOL, PIN_SCHEMA, RECEIPT, SCRIPT, INSTALL_COMMAND, readPin, installDir, toolsRoot, pinUrl,
  digestEntries, statedCommit, verifyInstall, capabilitiesProblem,
} from '../lib/cobolwork-resolve.mjs';

// What commitwork passes each command; an install whose capabilities lack one is refused.
export const NEEDS = Object.freeze({
  scan: ['--out'], inventory: ['--out'], explain: [],
  gate: ['--base', '--head', '--target', '--target-only'],
});
const PIN_FIELDS = ['version', 'tag', 'asset', 'url', 'sha256', 'commit'];
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const short = (c) => String(c).slice(0, 12);

// ── the tarball ──────────────────────────────────────────────────────────────────────────────
const cstr = (b, off, len) => { const s = b.subarray(off, off + len); const z = s.indexOf(0); return (z === -1 ? s : s.subarray(0, z)).toString('utf8'); };
const octal = (b, off, len) => { const s = cstr(b, off, len).trim(); return /^[0-7]+$/.test(s) ? parseInt(s, 8) : null; };

function paxPath(data) {
  const text = data.toString('utf8');
  for (let i = 0; i < text.length;) {
    const sp = text.indexOf(' ', i);
    const len = parseInt(text.slice(i, sp), 10);
    if (sp === -1 || !Number.isFinite(len) || len <= 0) break;
    const rec = text.slice(sp + 1, i + len).replace(/\n$/, '');
    if (rec.startsWith('path=')) return rec.slice(5);
    i += len;
  }
  return null;
}

// An npm-pack tarball, strictly: regular files and directories under package/ and nothing else.
// -> [{ path, data, exec }]; anything else throws.
export function readPackage(buf) {
  let tar;
  try { tar = gunzipSync(buf); } catch (e) { throw new Error(`not a gzip stream (${e.message})`); }
  const files = [], seen = new Set();
  let off = 0, longName = null, pax = null;
  while (off + 512 <= tar.length) {
    const head = tar.subarray(off, off + 512);
    if (head.every((b) => b === 0)) break;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : head[i];
    if (octal(head, 148, 8) !== sum) throw new Error(`header checksum mismatch at offset ${off}`);
    const size = octal(head, 124, 12);
    if (size === null) throw new Error(`unreadable size at offset ${off}`);
    const type = String.fromCharCode(head[156]);
    const prefix = cstr(head, 257, 6).startsWith('ustar') ? cstr(head, 345, 155) : '';
    let name = prefix ? `${prefix}/${cstr(head, 0, 100)}` : cstr(head, 0, 100);
    const mode = octal(head, 100, 8) || 0;
    if (off + 512 + size > tar.length) throw new Error(`${name} runs past the end of the archive`);
    const data = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = cstr(data, 0, size); continue; }
    if (type === 'x') { pax = paxPath(data); continue; }
    if (type === 'g') continue;
    if (longName !== null) { name = longName; longName = null; }
    if (pax !== null) { name = pax; pax = null; }
    const path = name.replace(/\/+$/, '');
    const parts = path.split('/');
    if (parts[0] !== 'package' || parts.some((p) => !p || p === '.' || p === '..') || path.includes('\\')) {
      throw new Error(`${JSON.stringify(name)} is not a path under package/`);
    }
    if (type === '5') continue;
    if (type !== '0' && type !== '\0') throw new Error(`${name} is a tar entry of type ${JSON.stringify(type)}, not a file or a directory`);
    // A case-insensitive filesystem would write two of these to one file.
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error(`${name} appears twice`);
    seen.add(key);
    files.push({ path, data: Buffer.from(data), exec: (mode & 0o111) !== 0 });
  }
  if (!files.length) throw new Error('the archive holds no files');
  return files;
}

// ── running things ───────────────────────────────────────────────────────────────────────────
const plan = (bin, args) => (/\.(mjs|cjs|js)$/i.test(bin) ? [process.execPath, [bin, ...args]] : [bin, args]);

function gh(args, env) {
  const [file, argv] = plan(env.CW_GH_BIN || 'gh', args);
  const r = spawnSync(file, argv, { encoding: 'utf8', env, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { ok: false, reason: `${file} could not be run (${r.error.code || r.error.message})` };
  if (r.status !== 0) return { ok: false, reason: `gh ${args.slice(0, 2).join(' ')} exited ${r.status}: ${String(r.stderr || '').trim().split('\n')[0] || 'no message'}` };
  return { ok: true, stdout: r.stdout };
}

const ghJson = (args, env) => {
  const r = gh(args, env);
  if (!r.ok) return r;
  try { return { ok: true, json: JSON.parse(r.stdout) }; } catch (e) { return { ok: false, reason: `gh ${args.slice(0, 2).join(' ')} wrote no JSON (${e.message})` }; }
};

// The asset's bytes: `gh release download` (the repository is private and gh holds the
// credential), else a plain GET of the pinned url. Only the sha256 decides whether they are used.
async function fetchAsset(pin, env) {
  const tmp = mkdtempSync(join(tmpdir(), 'cw-cobolwork-pin-'));
  try {
    const r = gh(['release', 'download', pin.tag, '-R', pin.repo, '-p', pin.asset, '-D', tmp], env);
    if (r.ok && existsSync(join(tmp, pin.asset))) return { bytes: readFileSync(join(tmp, pin.asset)), via: 'gh release download' };
    let why = r.ok ? `gh release download wrote no ${pin.asset}` : r.reason;
    try {
      const res = await fetch(pin.url, { redirect: 'follow' });
      if (res.ok) return { bytes: Buffer.from(await res.arrayBuffer()), via: pin.url };
      why += `; GET ${pin.url} answered ${res.status}`;
    } catch (e) { why += `; GET ${pin.url} failed (${e.cause?.code || e.message})`; }
    return { reason: `${pin.asset} could not be downloaded: ${why}. Download it by hand and pass --from <tgz>` };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// The installed cobolwork's own statement of what it is, held to the contract and to the pin.
export function probeCapabilities(script, pin, env = process.env) {
  const r = spawnSync(process.execPath, [script, 'capabilities', '--json'], { cwd: tmpdir(), encoding: 'utf8', env, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0) return { ok: false, reason: `capabilities --json ${r.error ? `could not run (${r.error.code || r.error.message})` : `exited ${r.status}: ${String(r.stderr || '').trim().split('\n')[0] || 'no message'}`}` };
  let doc;
  try { doc = JSON.parse(r.stdout); } catch (e) { return { ok: false, reason: `capabilities --json wrote no JSON (${e.message})` }; }
  const problem = capabilitiesProblem(doc, { needs: NEEDS });
  if (problem) return { ok: false, reason: `capabilities --json: ${problem}` };
  if (doc.toolVersion !== pin.version) return { ok: false, reason: `it says it is version ${JSON.stringify(doc.toolVersion)}, and the pin says ${pin.version}` };
  const rev = doc.toolRevision || {};
  if (rev.commit !== pin.commit || rev.from !== 'release') return { ok: false, reason: `it says it runs from ${JSON.stringify(rev)}, not the release at ${pin.commit}` };
  return { ok: true, caps: { schemaVersion: doc.schemaVersion, identity: doc.identity.version, toolVersion: doc.toolVersion, toolRevision: rev } };
}

// ── the three modes ──────────────────────────────────────────────────────────────────────────
export function check({ env = process.env } = {}) {
  const override = env.CW_COBOLWORK_BIN || null;
  const p = readPin({ env });
  if (!p.ok) return { ok: false, override, reason: p.reason };
  const v = verifyInstall(p.pin, { env });
  if (!v.ok) return { ok: false, override, version: p.pin.version, dir: v.dir, reason: v.reason };
  const c = probeCapabilities(v.script, p.pin, env);
  if (!c.ok) return { ok: false, override, version: p.pin.version, dir: v.dir, reason: `${v.dir} is installed but ${c.reason}` };
  return { ok: true, override, version: p.pin.version, commit: p.pin.commit, dir: v.dir, script: v.script, capabilities: c.caps };
}

export async function install({ env = process.env, from = null, dryRun = false } = {}) {
  const p = readPin({ env });
  if (!p.ok) return { ok: false, reason: p.reason };
  const { pin } = p;
  const dir = installDir(pin, env);
  const had = verifyInstall(pin, { env });
  if (had.ok) return { ok: true, installed: false, version: pin.version, dir, note: 'already installed and verified; nothing written' };
  if (existsSync(dir)) return { ok: false, version: pin.version, dir, reason: `${dir} exists and does not verify (${had.reason}); remove it and run --install again` };
  if (dryRun) return { ok: true, installed: false, dryRun: true, version: pin.version, dir, source: from || pin.url, note: 'dry run; nothing written' };

  let bytes, via;
  if (from) {
    try { bytes = readFileSync(from); via = from; } catch (e) { return { ok: false, reason: `--from ${from} could not be read (${e.code || e.message})` }; }
  } else {
    const got = await fetchAsset(pin, env);
    if (!got.bytes) return { ok: false, version: pin.version, reason: got.reason };
    ({ bytes, via } = got);
  }
  const actual = sha256(bytes);
  if (actual !== pin.sha256) return { ok: false, version: pin.version, reason: `${basename(via)} has sha256 ${actual}, and the pin says ${pin.sha256}; nothing was extracted or written` };
  let files;
  try { files = readPackage(bytes); } catch (e) { return { ok: false, version: pin.version, reason: `${pin.asset} is not a package this installs: ${e.message}; nothing was written` }; }
  const stated = statedCommit(files);
  if (stated.commit !== pin.commit) return { ok: false, version: pin.version, reason: `${stated.reason || `the package states commit ${stated.commit}`}, and the pin says ${pin.commit}; nothing was written` };
  if (!files.some((f) => f.path === SCRIPT)) return { ok: false, version: pin.version, reason: `the package has no ${SCRIPT}; nothing was written` };

  // Staged beside its destination, so the rename that publishes it is atomic.
  const parent = dirname(dir);
  mkdirSync(parent, { recursive: true });
  const stage = mkdtempSync(join(parent, `.stage-${pin.version}-`));
  try {
    for (const f of files) {
      const abs = join(stage, ...f.path.split('/'));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.data, { mode: f.exec || f.path === SCRIPT ? 0o755 : 0o644 });
    }
    chmodSync(join(stage, ...SCRIPT.split('/')), 0o755);
    const c = probeCapabilities(join(stage, ...SCRIPT.split('/')), pin, env);
    if (!c.ok) return { ok: false, version: pin.version, reason: `the package was not installed: ${c.reason}` };
    const receipt = { tool: TOOL, repo: pin.repo, version: pin.version, tag: pin.tag, url: pin.url, sha256: pin.sha256, commit: pin.commit, treeSha256: digestEntries(files), capabilities: c.caps };
    writeFileSync(join(stage, RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`);
    chmodSync(stage, 0o755);
    try { renameSync(stage, dir); }
    catch (e) {
      // Another install published first; it is used only if it verifies.
      const now = verifyInstall(pin, { env });
      if (now.ok) return { ok: true, installed: false, version: pin.version, dir, note: 'installed by a concurrent run and verified; nothing written' };
      return { ok: false, version: pin.version, dir, reason: `${dir} could not be published (${e.code || e.message})` };
    }
  } finally { rmSync(stage, { recursive: true, force: true }); }
  const v = verifyInstall(pin, { env });
  if (!v.ok) return { ok: false, version: pin.version, dir, reason: `installed, and then did not verify: ${v.reason}` };
  return { ok: true, installed: true, version: pin.version, commit: pin.commit, dir, script: v.script, via };
}

const semver = (v) => String(v).split('.').map(Number);
const older = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };

// Rewrites the pin from the latest release; installs nothing and commits nothing.
export function latest({ env = process.env } = {}) {
  const p = readPin({ env });
  if (!p.ok) return { ok: false, reason: p.reason };
  const { pin, doc, path } = p;
  const rel = ghJson(['api', `repos/${pin.repo}/releases/latest`], env);
  if (!rel.ok) return { ok: false, reason: `the latest ${pin.repo} release could not be read: ${rel.reason}` };
  const r = rel.json || {};
  if (r.draft || r.prerelease) return { ok: false, reason: `${r.tag_name} is a draft or a prerelease` };
  const tag = String(r.tag_name || '');
  const version = tag.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) return { ok: false, reason: `the latest release's tag ${JSON.stringify(tag)} names no version` };
  const assetName = `${pin.repo.split('/')[1]}-${version}.tgz`;
  const asset = (Array.isArray(r.assets) ? r.assets : []).find((a) => a && a.name === assetName);
  if (!asset) return { ok: false, reason: `${tag} has no ${assetName} asset` };
  const digest = /^sha256:([0-9a-f]{64})$/.exec(String(asset.digest || ''));
  if (!digest) return { ok: false, reason: `${tag} states no sha256 digest for ${assetName}, and a pin needs one` };
  const com = ghJson(['api', `repos/${pin.repo}/commits/${tag}`], env);
  if (!com.ok) return { ok: false, reason: `the commit ${tag} names could not be read: ${com.reason}` };
  const commit = String((com.json || {}).sha || '');
  if (!/^[0-9a-f]{40}$/.test(commit)) return { ok: false, reason: `${tag} resolved to no commit id (${JSON.stringify(commit)})` };
  const next = { ...pin, version, tag, asset: assetName, url: '', sha256: digest[1], commit };
  next.url = pinUrl(next);
  if (asset.browser_download_url && asset.browser_download_url !== next.url) return { ok: false, reason: `${assetName} downloads from ${asset.browser_download_url}, not ${next.url}` };
  if (older(version, pin.version)) return { ok: false, reason: `the latest release, ${tag}, is older than the pinned ${pin.version}; nothing written` };
  const changes = PIN_FIELDS.filter((k) => pin[k] !== next[k]).map((k) => ({ field: k, from: pin[k], to: next[k] }));
  if (!changes.length) return { ok: true, changed: false, version, path, changes, note: `the pin already names the latest release, ${tag}; nothing written` };
  const out = { ...doc, tools: { ...doc.tools, [TOOL]: next } };
  const { errors } = validateAgainstSchema(out, { path: PIN_SCHEMA });
  if (errors.length) return { ok: false, reason: `the rewritten pin would not satisfy its schema: ${errors[0]}; nothing written` };
  writeAtomic(path, `${JSON.stringify(out, null, 2)}\n`);
  return { ok: true, changed: true, version, path, changes };
}

// ── the CLI ──────────────────────────────────────────────────────────────────────────────────
const USAGE = `usage: node bin/cobolwork-pin.mjs [--check] | --install [--from <tgz>] [--dry-run] | --latest   [--json]
  --check     is the pinned cobolwork installed and verified (the default; writes nothing)
  --install   install the pinned release under ${'$'}CW_TOOLS_ROOT/cobolwork/<version> (default ~/.commitwork/tools)
  --latest    rewrite manifests/tool-pins.json from the latest release; installs and commits nothing
`;

export function parseArgs(argv) {
  const o = { mode: null, from: null, dryRun: false, json: false };
  const setMode = (m) => { if (o.mode && o.mode !== m) throw new Error(`--${o.mode} and --${m} cannot be combined`); o.mode = m; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check' || a === '--install' || a === '--latest') setMode(a.slice(2));
    else if (a === '--from') { o.from = argv[++i]; if (!o.from) throw new Error('--from needs a path'); }
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  o.mode = o.mode || 'check';
  if ((o.from || o.dryRun) && o.mode !== 'install') throw new Error('--from and --dry-run go with --install');
  return o;
}

function report(mode, r) {
  const out = [];
  if (mode === 'check') {
    if (r.override) out.push(`CW_COBOLWORK_BIN is set (${r.override}): commitwork runs that, not the pin, until it is unset.`);
    out.push(r.ok
      ? `cobolwork ${r.version} (${short(r.commit)}) is installed and verified at ${r.dir}`
      : `cobolwork is not installed and verified: ${r.reason}\n  install it: ${INSTALL_COMMAND}`);
  } else if (mode === 'install') {
    out.push(r.ok ? (r.installed ? `installed cobolwork ${r.version} (${short(r.commit)}) at ${r.dir}, verified` : `${r.dir}: ${r.note}`) : `refused: ${r.reason}`);
  } else if (r.ok && r.changed) {
    out.push(`rewrote ${r.path}:`);
    for (const c of r.changes) out.push(`  ${c.field.padEnd(8)} ${c.from}  ->  ${c.to}`);
    out.push(`Review and commit it, then run \`${INSTALL_COMMAND}\`. Nothing was installed or committed.`);
  } else out.push(r.ok ? r.note : `refused: ${r.reason}`);
  return `${out.join('\n')}\n`;
}

export async function main(argv, env = process.env) {
  let o;
  try { o = parseArgs(argv); } catch (e) { process.stderr.write(`cobolwork-pin: ${e.message}\n${USAGE}`); return 2; }
  if (o.help) { process.stdout.write(USAGE); return 0; }
  const r = o.mode === 'install' ? await install({ env, from: o.from, dryRun: o.dryRun })
    : o.mode === 'latest' ? latest({ env }) : check({ env });
  process.stdout.write(o.json ? `${JSON.stringify({ mode: o.mode, toolsRoot: toolsRoot(env), ...r }, null, 2)}\n` : report(o.mode, r));
  return r.ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`cobolwork-pin: ${e.stack || e.message}\n`); process.exitCode = 2; });
}
