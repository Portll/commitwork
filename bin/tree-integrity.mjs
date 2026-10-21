#!/usr/bin/env node
// usage: tree-integrity.mjs [rootDir]   (default '.')
// exit: 0 ran · 2 could not run
// env, read at call time: CW_TARGET_MODE (`webroot` turns the git-drift rules on; commitwork sets it
//   from brief/scan --webroot and pins `repo` on every other path), CW_INTEGRITY_SKIP_DIRS (comma list
//   of directory names or a/b paths the RECORD walk skips; default
//   .git,node_modules,.claude/worktrees,fixtures/scan-canary/dirty — every skip is listed)
// output: {tool, summary:{findings, byRule, filesScanned, mode, applicable, rulesNotApplicable, unmeasured,
//   git, record, ...}, findings[]}
//   rule ids, paths, sizes, distribution names and the HEAD commit only — never file contents.
//
// Answers "is this the code that should be here?" without knowing the platform, by comparing the tree
// with records that say what it should hold. A deployed tree from an exploited server once scanned
// clean, and no lane had asked that question, though the answer was on disk: a web root updated by
// `git pull` carries its own record in .git, and an installed Python package carries one in its
// *.dist-info/RECORD.
//
// Two record kinds, two scopes:
// - git drift (git-untracked-code, git-modified, git-deleted) applies ONLY to a deployed web root. In a
//   working repository untracked and modified files are the normal state, so outside webroot mode the
//   three rules are not applicable, with the reason stated. That is never a pass and never a finding.
// - RECORD verification (record-hash-mismatch, record-file-missing, record-unlisted-file) applies
//   wherever a RECORD exists, in any mode.
//
// Either record is only as good as its custody: whoever can write the tree can usually write .git and
// RECORD too, so a clean result says the tree agrees with its records, not that the records are true.
import { readdirSync, lstatSync, readlinkSync, openSync, readSync, closeSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, dirname, basename, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { scannedGit } from './lib/git-env.mjs';
import { isMainModule } from '../lib/is-main.mjs';

export const TOOL = 'tree-integrity';

export const GIT_RULES = Object.freeze(['git-untracked-code', 'git-modified', 'git-deleted']);
export const RECORD_RULES = Object.freeze(['record-hash-mismatch', 'record-file-missing', 'record-unlisted-file']);

// Every rule says the tree and its record disagree; whether that is an intrusion, a hotfix or a
// half-finished deploy is for the reader. CWE-345 claims only that.
export const RULE_CWE = Object.freeze(Object.fromEntries([...GIT_RULES, ...RECORD_RULES].map((r) => [r, 'CWE-345'])));

// Severity by what the differing file IS. A modified image is drift; a modified script, an
// .htaccess that lost its deny rule or a .pth that Python runs at start-up is how an intruder stays.
export const RULE_SEV = Object.freeze({
  'git-untracked-code': { code: 'high', control: 'high', executable: 'high' },
  'git-modified': { code: 'high', control: 'high', executable: 'high', other: 'med' },
  'git-deleted': { code: 'med', control: 'high', executable: 'med', other: 'low' },
  'record-hash-mismatch': { code: 'high', other: 'med' },
  'record-file-missing': { code: 'med', other: 'low' },
  'record-unlisted-file': { code: 'high', other: 'med' },
});

const DEFAULT_SKIP = ['.git', 'node_modules', '.claude/worktrees', 'fixtures/scan-canary/dirty'];
const LIST_CAP = 50;
const CHUNK = 1024 * 1024;
const GIT_TIMEOUT_MS = 600_000;
const GIT_MAX_BUFFER = 1 << 30;

export const targetMode = () => (process.env.CW_TARGET_MODE === 'webroot' ? 'webroot' : 'repo');
export const skipDirs = () => {
  const raw = process.env.CW_INTEGRITY_SKIP_DIRS;
  return raw == null ? DEFAULT_SKIP : raw.split(',').map((s) => s.trim()).filter(Boolean);
};

// Code a web server, an interpreter or a browser runs from the tree, including the templates that
// compile to it.
const CODE_EXT = /\.(php[0-9]?|phtml|pht|phar|inc|aspx?|ashx|asmx|asa|jspx?|jspf|cgi|pl|pm|py|pyw|rb|erb|m?js|cjs|jsx|tsx?|mts|cts|html?|shtml|xhtml|twig|tpl|ejs|sh|bash|zsh|ps1|bat|cmd|vbs|wsf|hta|jar|war|class|so|dll|dylib|exe|wasm|lua)$/i;
// Files that change what the server executes, or what git can see.
const CONTROL_NAMES = new Set(['.htaccess', '.user.ini', 'php.ini', 'web.config', '.gitignore', '.gitattributes', '.gitmodules']);
const PY_CODE_EXT = /\.(py|pyw|pth|so|pyd|dylib|dll|exe|pyc)$/i;

// ELF, Mach-O (both byte orders, 32/64, fat) and PE. A shebang counts only with the executable bit.
export function binaryMagic(head) {
  if (head.length < 4) return false;
  const b = head;
  if (b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) return true;
  const be = b.readUInt32BE(0);
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(be)) return be !== 0xcafebabe || b.length < 8 || b.readUInt32BE(4) < 40;
  return b[0] === 0x4d && b[1] === 0x5a;
}

function readHead(abs, n = 8) {
  const fd = openSync(abs, 'r');
  try { const buf = Buffer.alloc(n); const got = readSync(fd, buf, 0, n, 0); return buf.subarray(0, got); } finally { closeSync(fd); }
}

/** 'code' | 'control' | 'executable' | 'other' for a tree file; head is read only when the name says nothing. */
export function kindOf(rel, st, head = null) {
  const name = basename(rel);
  if (CONTROL_NAMES.has(name)) return 'control';
  if (CODE_EXT.test(name)) return 'code';
  if (!head) return 'other';
  if (binaryMagic(head)) return 'executable';
  if (st && (st.mode & 0o111) && head[0] === 0x23 && head[1] === 0x21) return 'executable';
  return 'other';
}

export const pyKind = (rel) => (PY_CODE_EXT.test(rel) || /(^|\/)bin\/[^/.]+$/.test(rel) ? 'code' : 'other');

const sevFor = (rule, kind) => RULE_SEV[rule][kind] || RULE_SEV[rule].other || 'med';
const posix = (p) => p.split(sep).join('/');

// The blob id git would give these bytes: the object header, then the content, hashed whole.
function blobId(algo, size, feed) {
  const h = createHash(algo);
  h.update(`blob ${size}\0`);
  feed((buf) => h.update(buf));
  return h.digest('hex');
}

function streamFile(abs, onChunk) {
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    let n;
    while ((n = readSync(fd, buf, 0, CHUNK, null)) > 0) onChunk(buf.subarray(0, n));
  } finally { closeSync(fd); }
}

// The header carries the size before the content, so it is lstat's size; a file that grew or shrank
// between lstat and read hashes to something that cannot match, and git hash-object then decides.
function fileBlobId(abs, st, algo) {
  let read = 0;
  const id = blobId(algo, st.size, (u) => streamFile(abs, (b) => { read += b.length; u(b); }));
  return read === st.size ? id : null;
}

// ─── git drift ────────────────────────────────────────────────────────────────────────────────────

const firstLine = (s) => String(s || '').trim().split('\n')[0].slice(0, 200);

export function gitDrift(root, mode) {
  const out = { state: 'not-applicable', reason: null, findings: [], filesScanned: 0, unreadable: [], partialReasons: [] };
  if (mode !== 'webroot') {
    out.reason = 'git drift is measured only on a deployed web root (brief/scan --webroot): in a working repository untracked and modified files are the normal state';
    return out;
  }
  try { lstatSync(join(root, '.git')); } catch (e) {
    if (e.code === 'ENOENT') { out.reason = 'not a git checkout (no .git at the root), so there is no committed tree to compare against'; return out; }
    out.state = 'unmeasured'; out.reason = `.git could not be read: ${e.code || e.message}`; return out;
  }
  const g = (args, opts = {}) => scannedGit(root, args, { timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, ...opts });
  const failed = (what, r) => { out.state = 'unmeasured'; out.reason = `git ${what} failed: ${firstLine(r.error ? r.error.message : r.stderr) || `exit ${r.status}`}`; return out; };

  const top = g(['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return failed('rev-parse', top);
  let same = false;
  try { same = realpathSync(top.stdout.trim()) === realpathSync(root); } catch { same = false; }
  if (!same) { out.state = 'unmeasured'; out.reason = 'the scanned directory is not the top of its git work tree, so its record is another tree\'s'; return out; }
  const head = g(['rev-parse', '--verify', '-q', 'HEAD^{commit}']);
  if (head.status !== 0) {
    if (head.status === 1 && !String(head.stderr).trim()) { out.reason = 'HEAD names no commit, so there is no committed tree to compare against'; return out; }
    return failed('rev-parse HEAD', head);
  }
  const headSha = head.stdout.trim();
  const algo = headSha.length === 64 ? 'sha256' : headSha.length === 40 ? 'sha1' : null;
  if (!algo) { out.state = 'unmeasured'; out.reason = `HEAD's object id has an unknown length (${headSha.length})`; return out; }
  const tree = g(['ls-tree', '-r', '-z', '--full-tree', 'HEAD']);
  if (tree.status !== 0) return failed('ls-tree', tree);

  out.state = 'measured';
  out.reason = null;
  const short = headSha.slice(0, 12);
  const stats = { head: headSha, objectFormat: algo, tracked: 0, compared: 0, submodules: 0, convertedOnly: 0, modeChanged: 0, sparse: 0,
    untracked: { code: 0, other: 0, nestedRepos: 0, hiddenControl: 0, declaredIgnoredControl: 0 }, ignored: { entries: 0, sample: [] } };
  out.stats = stats;
  const add = (rule, path, kind, detail) => out.findings.push({ rule, path, sev: sevFor(rule, kind), cwe: RULE_CWE[rule], detail });
  const unreadable = (path, why) => out.unreadable.push({ path, why });

  const candidates = [];
  const deleted = [];
  const tracked = new Set();
  for (const rec of tree.stdout.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const [fmode, type, oid] = rec.slice(0, tab).split(' ');
    const path = rec.slice(tab + 1);
    if (type === 'commit') { stats.submodules++; continue; }
    if (type !== 'blob') continue;
    tracked.add(path);
    stats.tracked++;
    out.filesScanned++;
    const abs = join(root, path);
    let st;
    try { st = lstatSync(abs); } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') { deleted.push({ path, oid }); continue; }
      unreadable(path, `lstat failed: ${e.code || e.message}`); continue;
    }
    const kind = () => kindOf(path, st, null);
    if (fmode === '120000') {
      if (!st.isSymbolicLink()) { add('git-modified', path, kind(), `a symbolic link at HEAD (${short}) is now ${st.isDirectory() ? 'a directory' : 'a file'}`); continue; }
      let target;
      try { target = Buffer.from(readlinkSync(abs, { encoding: 'buffer' })); } catch (e) { unreadable(path, `readlink failed: ${e.code || e.message}`); continue; }
      stats.compared++;
      if (blobId(algo, target.length, (u) => u(target)) !== oid) add('git-modified', path, kind(), `the symbolic link points somewhere other than it did at HEAD (${short})`);
      continue;
    }
    if (st.isSymbolicLink()) { add('git-modified', path, kind(), `a regular file at HEAD (${short}) has been replaced by a symbolic link`); continue; }
    if (!st.isFile()) { add('git-modified', path, kind(), `a regular file at HEAD (${short}) has been replaced by a directory or special file`); continue; }
    let id;
    try { id = fileBlobId(abs, st, algo); } catch (e) { unreadable(path, `read failed: ${e.code || e.message}`); continue; }
    stats.compared++;
    if (id !== oid) { candidates.push({ path, oid, st }); continue; }
    if (process.platform !== 'win32' && ((fmode === '100755') !== !!(st.mode & 0o100))) stats.modeChanged++;
  }

  // The bytes differ; git's own clean conversion (line endings, an ident attribute) decides whether
  // that is a change git would record. Only the mismatches are asked, so the common path never forks.
  if (candidates.length) {
    const askable = candidates.filter((c) => !c.path.includes('\n'));
    let confirmed = null;
    if (askable.length) {
      const r = g(['hash-object', '--stdin-paths'], { input: `${askable.map((c) => c.path).join('\n')}\n` });
      if (r.status === 0) {
        const ids = r.stdout.split('\n').filter(Boolean);
        if (ids.length === askable.length) confirmed = new Map(askable.map((c, i) => [c.path, ids[i]]));
      }
      if (!confirmed) out.partialReasons.push(`git hash-object could not confirm ${askable.length} byte-level difference(s): ${firstLine(r.stderr) || `exit ${r.status}`}; they are reported without ruling out a line-ending conversion`);
    }
    for (const c of candidates) {
      const viaGit = confirmed && confirmed.get(c.path);
      if (viaGit && viaGit === c.oid) { stats.convertedOnly++; continue; }
      let head = null;
      try { head = readHead(join(root, c.path)); } catch { /* the kind falls back to the name */ }
      const k = kindOf(c.path, c.st, head);
      add('git-modified', c.path, k, `content differs from HEAD (${short})${viaGit ? '' : ' (line-ending conversion not ruled out)'}`);
    }
  }

  if (deleted.length) {
    // A sparse checkout leaves paths out of the tree by design; the index's skip-worktree bit says which.
    let skipWorktree = new Set();
    const t = g(['ls-files', '-z', '-t']);
    if (t.status === 0) skipWorktree = new Set(t.stdout.split('\0').filter((e) => e.startsWith('S ')).map((e) => e.slice(2)));
    else out.partialReasons.push(`git ls-files -t failed, so a sparse checkout could not be told from a deletion: ${firstLine(t.stderr)}`);
    for (const d of deleted) {
      if (skipWorktree.has(d.path)) { stats.sparse++; continue; }
      add('git-deleted', d.path, kindOf(d.path, null, null), `tracked at HEAD (${short}) and absent from the tree`);
    }
  }

  // Ignore rules from the tree and the repository only: the scanning machine's own global excludes
  // file must not decide what counts as untracked on somebody else's server.
  const gitPath = g(['rev-parse', '--git-path', 'info/exclude']);
  const excludeArgs = ['--exclude-per-directory=.gitignore'];
  if (gitPath.status === 0) {
    const p = resolve(root, gitPath.stdout.trim());
    try { if (lstatSync(p).isFile()) excludeArgs.push(`--exclude-from=${p}`); } catch (e) { if (e.code !== 'ENOENT') out.partialReasons.push(`info/exclude unreadable: ${e.code || e.message}`); }
  } else out.partialReasons.push(`git rev-parse --git-path failed: ${firstLine(gitPath.stderr)}`);

  // Untracked means absent from HEAD, not absent from the index: `git add` alone would otherwise hide a
  // dropped file from --others, and a HEAD file removed from the index would be listed as new. So the
  // index entries HEAD lacks join the list, and HEAD's own paths leave it (they were compared above).
  const others = g(['ls-files', '-z', '--others', ...excludeArgs]);
  const cached = g(['ls-files', '-z', '--cached']);
  if (cached.status !== 0) out.partialReasons.push(`git ls-files --cached failed, so files staged but never committed were not listed: ${firstLine(cached.stderr)}`);
  const staged = new Set(cached.status === 0 ? cached.stdout.split('\0').filter((p) => p && !tracked.has(p)) : []);
  if (others.status !== 0) out.partialReasons.push(`git ls-files --others failed, so untracked files were not listed: ${firstLine(others.stderr)}`);
  else {
    for (const path of [...new Set([...others.stdout.split('\0'), ...staged])].sort()) {
      if (!path || tracked.has(path)) continue;
      if (path.endsWith('/')) { stats.untracked.nestedRepos++; continue; }
      out.filesScanned++;
      const abs = join(root, path);
      let st;
      try { st = lstatSync(abs); } catch (e) { if (e.code !== 'ENOENT') unreadable(path, `lstat failed: ${e.code || e.message}`); continue; }
      let head = null;
      if (st.isFile() && !CODE_EXT.test(path) && !CONTROL_NAMES.has(basename(path))) {
        try { head = readHead(abs); } catch (e) { unreadable(path, `read failed: ${e.code || e.message}`); continue; }
      }
      const k = kindOf(path, st, head);
      if (k === 'other') { stats.untracked.other++; continue; }
      stats.untracked.code++;
      add('git-untracked-code', path, k, `${k === 'control' ? 'server or git control file' : k === 'executable' ? 'executable' : 'code'} present in the tree, absent from HEAD (${short}) and ${staged.has(path) ? 'staged in the index without a commit' : 'not ignored'}`);
    }
  }
  // An ignore rule is only part of the record when the file holding it is tracked and unchanged: an
  // untracked `uploads/.gitignore` holding `*` ignores itself and everything beside it. Control files
  // are therefore listed with no exclusion at all, and one kept out of the list above by a rule the
  // record does not hold is reported, naming that rule's file. One a tracked, unchanged .gitignore (or
  // info/exclude) ignores is declared outside the record and only counted.
  const reported = new Set(out.findings.map((f) => f.path));
  const ctl = g(['ls-files', '-z', '--others', '--', ...[...CONTROL_NAMES].map((n) => `:(glob)**/${n}`)]);
  const hidden = ctl.status === 0 ? ctl.stdout.split('\0').filter((p) => p && !p.endsWith('/') && !reported.has(p)).sort() : [];
  if (ctl.status !== 0) out.partialReasons.push(`git ls-files could not list untracked control files: ${firstLine(ctl.stderr)}`);
  if (hidden.length) {
    const ci = g(['check-ignore', '-v', '-z', '--stdin'], { input: `${hidden.join('\0')}\0` });
    if (ci.status !== 0 && ci.status !== 1) out.partialReasons.push(`git check-ignore failed, so ${hidden.length} ignored control file(s) were not judged: ${firstLine(ci.stderr)}`);
    else {
      const f = ci.stdout.split('\0');
      const source = new Map();
      for (let i = 0; i + 3 < f.length; i += 4) source.set(f[i + 3], f[i]);
      const excludeRel = gitPath.status === 0 ? posix(relative(root, resolve(root, gitPath.stdout.trim()))) : null;
      const offRecord = new Set(out.findings.filter((x) => x.rule !== 'git-untracked-code').map((x) => x.path));
      for (const path of hidden) {
        const src = source.get(path) || '';
        const srcRel = isAbsolute(src) ? posix(relative(root, src)) : src;
        if ((tracked.has(srcRel) && !offRecord.has(srcRel)) || (excludeRel && srcRel === excludeRel)) { stats.untracked.declaredIgnoredControl++; continue; }
        out.filesScanned++;
        stats.untracked.code++;
        stats.untracked.hiddenControl++;
        const by = !src ? 'no rule git could name' : srcRel.startsWith('..') ? 'the scanning machine\'s own excludes' : `${srcRel}, which is not on the record`;
        add('git-untracked-code', path, 'control', `server or git control file present in the tree and absent from HEAD (${short}), ignored only by ${by}; what that rule hides is not listed here`);
      }
    }
  }
  if (gitPath.status === 0) {
    try {
      const n = readFileSync(resolve(root, gitPath.stdout.trim()), 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).length;
      if (n) stats.infoExcludePatterns = n;
    } catch (e) { if (e.code !== 'ENOENT') out.partialReasons.push(`info/exclude unreadable: ${e.code || e.message}`); }
  }

  // Ignored paths are outside git's record by declaration, so git cannot say whether they belong.
  // They are listed, collapsed to directories, and judged by no rule here.
  const ign = g(['ls-files', '-z', '--others', '--ignored', '--directory', ...excludeArgs]);
  if (ign.status !== 0) out.partialReasons.push(`git ls-files --ignored failed: ${firstLine(ign.stderr)}`);
  else {
    const entries = ign.stdout.split('\0').filter(Boolean).sort();
    stats.ignored.entries = entries.length;
    stats.ignored.sample = entries.slice(0, 10);
  }
  return out;
}

// ─── RECORD verification ──────────────────────────────────────────────────────────────────────────

// Python's csv dialect as the wheel spec writes it: comma-separated, a field may be double-quoted
// and a doubled quote inside one is a literal. null when the line cannot be read.
export function parseRecordLine(line) {
  const fields = [];
  let cur = '';
  let quoted = false;
  let fieldStart = true;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false; } else cur += c;
    } else if (c === '"' && fieldStart) { quoted = true; fieldStart = false; }
    else if (c === ',') { fields.push(cur); cur = ''; fieldStart = true; }
    else { cur += c; fieldStart = false; }
  }
  if (quoted) return null;
  fields.push(cur);
  return fields;
}

// hashlib names → node names; the wheel spec allows sha256 or stronger and forbids md5 and sha1.
const HASHES = { sha224: 'sha224', sha256: 'sha256', sha384: 'sha384', sha512: 'sha512', sha3_256: 'sha3-256', sha3_384: 'sha3-384', sha3_512: 'sha3-512', blake2b: 'blake2b512', blake2s: 'blake2s256' };

export function hashFile(abs, algo) {
  const h = createHash(algo);
  let size = 0;
  streamFile(abs, (b) => { size += b.length; h.update(b); });
  return { digest: h.digest('base64url'), size };
}

/** {entries:[{path, algo?, digest?, size?}], bad:n, unsupported:n} for a RECORD's text. */
export function parseRecord(text) {
  const entries = [];
  let bad = 0;
  let unsupported = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const f = parseRecordLine(raw);
    if (!f || f.length > 3 || !f[0]) { bad++; continue; }
    const [path, hash = '', size = ''] = f;
    const e = { path };
    if (hash) {
      const m = /^([A-Za-z0-9_]+)=([A-Za-z0-9_-]+)=*$/.exec(hash);
      if (!m) { bad++; continue; }
      const algo = HASHES[m[1].toLowerCase()];
      if (!algo) { unsupported++; e.unsupported = m[1]; } else { e.algo = algo; e.digest = m[2]; }
    }
    if (size !== '') { const n = Number(size); if (Number.isInteger(n) && n >= 0) e.size = n; }
    entries.push(e);
  }
  return { entries, bad, unsupported };
}

const distName = (distInfo) => basename(distInfo).replace(/\.dist-info$/, '');

function findDistInfos(root, skip, summary, unreadable) {
  const found = [];
  const listed = (arr, v) => { if (arr.length < LIST_CAP) arr.push(v); };
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { unreadable(posix(relative(root, dir)) || '.', `readdir failed: ${e.code || e.message}`); return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const abs = join(dir, e.name);
      const rel = posix(relative(root, abs));
      if (skip.has(e.name) || skip.has(rel)) { listed(summary.skippedPaths, rel); continue; }
      if (e.name.endsWith('.dist-info')) { found.push(abs); continue; }
      walk(abs);
    }
  };
  walk(root);
  return found;
}

// A distribution installed without a RECORD (an .egg-info, a dist-info the packager stripped, or a
// conda build whose files conda rewrote after install) owns files no RECORD lists. Its top-level
// names keep those files out of the unlisted rule; without top_level.txt nothing in that
// site-packages can be judged unlisted, and the summary says so.
function foreignOwners(siteRoot) {
  const tops = new Set();
  let unknown = [];
  let entries;
  try { entries = readdirSync(siteRoot, { withFileTypes: true }); } catch { return { tops, unknown: ['site-packages unreadable'] }; }
  for (const e of entries) {
    const isEgg = e.name.endsWith('.egg-info');
    const isDist = e.name.endsWith('.dist-info');
    if (!isEgg && !isDist) continue;
    const abs = join(siteRoot, e.name);
    if (isDist) { try { lstatSync(join(abs, 'RECORD')); continue; } catch { /* RECORD-less */ } }
    if (!e.isDirectory()) { unknown.push(e.name); continue; }
    try { for (const t of readFileSync(join(abs, 'top_level.txt'), 'utf8').split(/\r?\n/)) if (t.trim()) tops.add(t.trim().split('/')[0]); } catch { unknown.push(e.name); }
  }
  return { tops, unknown };
}

export function recordVerify(root, skip, summary) {
  const out = { state: 'not-applicable', reason: null, findings: [], filesScanned: 0, unreadable: [], partialReasons: [] };
  const unreadable = (path, why) => out.unreadable.push({ path, why });
  const distInfos = findDistInfos(root, skip, summary, unreadable);
  const records = [];
  for (const d of distInfos) {
    try { if (lstatSync(join(d, 'RECORD')).isFile()) records.push(d); } catch (e) { if (e.code !== 'ENOENT') unreadable(posix(relative(root, join(d, 'RECORD'))), `lstat failed: ${e.code || e.message}`); }
  }
  const stats = { records: records.length, sites: 0, hashed: 0, verified: 0, unhashed: 0, unhashedAbsent: 0, outOfTree: 0,
    unsupportedHash: 0, conda: { distributions: 0, names: [] }, bytecodeUnlisted: 0, foreignUnlisted: 0, unlistedNotJudged: [], unparseable: [] };
  out.stats = stats;
  if (!records.length) { out.reason = 'no *.dist-info/RECORD in the tree, so there is no installed Python package to verify'; return out; }
  out.state = 'measured';

  const rootReal = realpathSync(root);
  const realCache = new Map();
  const dirInTree = (dir) => {
    if (realCache.has(dir)) return realCache.get(dir);
    let ok;
    try { const r = realpathSync(dir); ok = r === rootReal || r.startsWith(rootReal + sep); } catch (e) { ok = e.code === 'ENOENT' || e.code === 'ENOTDIR' ? 'absent' : false; }
    realCache.set(dir, ok);
    return ok;
  };
  const inside = (abs) => { const r = relative(root, abs); return r && !r.startsWith('..') && !isAbsolute(r); };
  const seen = new Set();
  const add = (rule, path, kind, detail) => {
    const key = `${rule}\0${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.findings.push({ rule, path, sev: sevFor(rule, kind), cwe: RULE_CWE[rule], detail });
  };

  const bySite = new Map();
  for (const d of records) { const s = dirname(d); if (!bySite.has(s)) bySite.set(s, []); bySite.get(s).push(d); }
  stats.sites = bySite.size;

  for (const [siteRoot, dists] of [...bySite.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const listedAbs = new Set();
    const owners = new Map(); // top-level directory → distributions that list files under it
    const foreign = foreignOwners(siteRoot);
    for (const dist of dists) {
      const recRel = posix(relative(root, join(dist, 'RECORD')));
      let text;
      try { text = readFileSync(join(dist, 'RECORD'), 'utf8'); } catch (e) { unreadable(recRel, `read failed: ${e.code || e.message}`); continue; }
      const parsed = parseRecord(text);
      if (parsed.bad) {
        if (stats.unparseable.length < LIST_CAP) stats.unparseable.push({ path: recRel, lines: parsed.bad });
        out.partialReasons.push(`${parsed.bad} line(s) of ${recRel} unparseable`);
      }
      let installer = '';
      try { installer = readFileSync(join(dist, 'INSTALLER'), 'utf8').trim().toLowerCase(); } catch { /* absent INSTALLER is ordinary */ }
      const conda = installer === 'conda';
      if (conda) { stats.conda.distributions++; if (stats.conda.names.length < LIST_CAP) stats.conda.names.push(distName(dist)); }
      for (const e of parsed.entries) {
        const abs = resolve(siteRoot, e.path);
        listedAbs.add(abs);
        const segs = posix(relative(siteRoot, abs)).split('/');
        if (segs.length > 1 && segs[0] !== '..') {
          if (!owners.has(segs[0])) owners.set(segs[0], new Set());
          owners.get(segs[0]).add(distName(dist));
          if (conda) foreign.tops.add(segs[0]);
        }
        if (conda) continue;
        if (!inside(abs)) { if (e.algo) stats.outOfTree++; continue; }
        const rel = posix(relative(root, abs));
        if (e.unsupported) { stats.unsupportedHash++; continue; }
        if (!e.algo) {
          stats.unhashed++;
          try { lstatSync(abs); } catch { stats.unhashedAbsent++; }
          continue;
        }
        stats.hashed++;
        out.filesScanned++;
        const where = dirInTree(dirname(abs));
        if (where === false) { unreadable(rel, 'reached through a symbolic link that leaves the tree; not followed'); continue; }
        const kind = pyKind(rel);
        let st;
        try { st = lstatSync(abs); } catch (err) {
          if (err.code === 'ENOENT' || err.code === 'ENOTDIR') { add('record-file-missing', rel, kind, `listed with a ${e.algo} hash in ${recRel} and absent from the tree`); continue; }
          unreadable(rel, `lstat failed: ${err.code || err.message}`); continue;
        }
        if (st.isSymbolicLink()) { add('record-hash-mismatch', rel, kind, `replaced by a symbolic link (not followed); ${recRel} lists a regular file`); continue; }
        if (!st.isFile()) { add('record-hash-mismatch', rel, kind, `replaced by a directory or special file; ${recRel} lists a regular file`); continue; }
        let got;
        try { got = hashFile(abs, e.algo); } catch (err) { unreadable(rel, `read failed: ${err.code || err.message}`); continue; }
        if (got.digest === e.digest) { stats.verified++; continue; }
        const sizes = e.size != null ? ` (${e.size} bytes recorded, ${got.size} on disk)` : ` (${got.size} bytes on disk)`;
        add('record-hash-mismatch', rel, kind, `content differs from the ${e.algo} in ${recRel}${sizes}`);
      }
    }
    if (stats.unsupportedHash) out.partialReasons.push(`${stats.unsupportedHash} RECORD line(s) use a hash this lane cannot compute`);

    // Files in a directory some RECORD installs into, listed by none of them. __pycache__ bytecode is
    // written by the interpreter at import time, so it is counted, not judged.
    if (foreign.unknown.length) {
      stats.unlistedNotJudged.push({ site: posix(relative(root, siteRoot)) || '.', reason: `installed without a RECORD or top_level.txt: ${foreign.unknown.slice(0, 5).join(', ')}` });
      out.partialReasons.push(`unlisted files not judged in ${posix(relative(root, siteRoot)) || '.'}: a distribution there has no RECORD and no top_level.txt`);
      continue;
    }
    for (const top of [...owners.keys()].sort()) {
      const topAbs = join(siteRoot, top);
      let st;
      try { st = lstatSync(topAbs); } catch { continue; }
      if (!st.isDirectory()) continue;
      const by = [...owners.get(top)].sort();
      const walk = (dir) => {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { unreadable(posix(relative(root, dir)), `readdir failed: ${e.code || e.message}`); return; }
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const e of entries) {
          const abs = join(dir, e.name);
          if (e.isDirectory()) { walk(abs); continue; }
          if (listedAbs.has(abs)) continue;
          const rel = posix(relative(root, abs));
          if (/(^|\/)__pycache__\/[^/]+\.pyc$/.test(rel)) { stats.bytecodeUnlisted++; continue; }
          if (foreign.tops.has(top)) { stats.foreignUnlisted++; continue; }
          out.filesScanned++;
          add('record-unlisted-file', rel, pyKind(rel), `in ${top}/, which ${by.slice(0, 3).join(', ')}${by.length > 3 ? ` and ${by.length - 3} more` : ''} install${by.length === 1 ? 's' : ''}, and listed in no RECORD there${e.isSymbolicLink() ? ' (a symbolic link)' : ''}`);
        }
      };
      walk(topAbs);
    }
  }
  return out;
}

// ─── the lane ─────────────────────────────────────────────────────────────────────────────────────

export function scanTree(root) {
  const mode = targetMode();
  const skip = new Set(skipDirs());
  const summary = {
    findings: 0, byRule: {}, filesScanned: 0, mode, applicable: true,
    notApplicable: 0, rulesNotApplicable: [], notApplicableReasons: {}, unmeasured: [],
    git: null, record: null, unreadable: 0, skipDirs: [...skip], skippedPaths: [], unreadableFiles: [],
  };
  const git = gitDrift(root, mode);
  const rec = recordVerify(root, skip, summary);
  const findings = [...git.findings, ...rec.findings];
  summary.filesScanned = git.filesScanned + rec.filesScanned;
  summary.git = { state: git.state, ...(git.reason ? { reason: git.reason } : {}), ...(git.stats || {}) };
  summary.record = { state: rec.state, ...(rec.reason ? { reason: rec.reason } : {}), ...(rec.stats || {}) };
  for (const [part, rules] of [[git, GIT_RULES], [rec, RECORD_RULES]]) {
    if (part.state === 'not-applicable') { summary.rulesNotApplicable.push(...rules); summary.notApplicableReasons[rules[0].split('-')[0]] = part.reason; }
    if (part.state === 'unmeasured') summary.unmeasured.push(...rules);
  }
  summary.notApplicable = summary.rulesNotApplicable.length;
  const unreadable = [...git.unreadable, ...rec.unreadable];
  summary.unreadable = unreadable.length;
  summary.unreadableFiles = unreadable.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).slice(0, LIST_CAP);

  findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
  for (const f of findings) summary.byRule[f.rule] = (summary.byRule[f.rule] || 0) + 1;
  summary.byRule = Object.fromEntries(Object.entries(summary.byRule).sort(([a], [b]) => (a < b ? -1 : 1)));
  summary.findings = findings.length;

  const partialReasons = [...git.partialReasons, ...rec.partialReasons];
  if (git.state === 'unmeasured') partialReasons.unshift(`git drift unmeasured: ${git.reason}`);
  if (unreadable.length) partialReasons.push(`${unreadable.length} file(s) unreadable`);
  if (partialReasons.length) { summary.partial = true; summary.partialReasons = partialReasons; }

  if (git.state === 'not-applicable' && rec.state === 'not-applicable') {
    // Nothing to compare: in a repository that is a lane that does not apply; on a web root the
    // operator asked whether the tree is what should be there, and the honest answer is unmeasured.
    if (mode === 'webroot') summary.voidReason = `no record to compare the tree against: ${git.reason}; ${rec.reason}`;
    else { summary.applicable = false; summary.notApplicableReason = `${git.reason}; ${rec.reason}`; }
  } else if (summary.filesScanned === 0) {
    summary.voidReason = git.state === 'unmeasured' ? `git drift unmeasured (${git.reason}) and no RECORD-listed file was verified`
      : 'a record was found but no file it lists was examined, so nothing was compared';
  }
  return { tool: TOOL, summary, findings };
}

// exitCode and return, never process.exit(): docs/TRAPS.md, "process.exit() can hang forever".
function main() {
  const root = resolve(process.argv[2] || '.');
  const fail = (why) => { process.stderr.write(`tree-integrity: ${why}\n`); process.exitCode = 2; };
  let st;
  try { st = lstatSync(root); } catch (e) { return fail(`cannot read ${root}: ${e.code || e.message}`); }
  if (!st.isDirectory()) return fail(`${root} is not a directory`);
  let report;
  try { report = scanTree(root); } catch (e) { return fail(`could not run: ${e.message}`); }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (isMainModule(import.meta.url)) main();
