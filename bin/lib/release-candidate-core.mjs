// release-candidate-core.mjs — build a fresh-root candidate from a committed ref, and the pieces
// bin/release-candidate.mjs runs its gates with. Never writes to the source repository.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const STAMP_HEAD_LINES = 10;
export const STAMP_SHA_RE = /(<!--\s*verified-against:\s*\d{4}-\d{2}-\d{2})\s+[0-9a-f]{7,40}(\s*-->)/;

const git = (cwd, args, opts = {}) => execFileSync('git', ['-C', cwd, ...args],
  { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

export function resolveCommit(repo, ref) {
  return git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
}

/** Author identity, committer date and package version of the source commit. */
export function sourceMeta(repo, sha) {
  const [name, email, date] = git(repo, ['log', '-1', '--format=%an%n%ae%n%cI', sha]).split('\n');
  let version = null;
  try { version = JSON.parse(git(repo, ['show', `${sha}:package.json`])).version ?? null; } catch { /* guard: no package.json is a null version */ }
  return { name, email, date, version, tree: git(repo, ['rev-parse', `${sha}^{tree}`]).trim() };
}

/** Tracked entries at `sha`: { path, mode, blob }. */
export function trackedEntries(repo, sha) {
  return git(repo, ['ls-tree', '-r', '-z', '--full-tree', sha]).split('\0').filter(Boolean).map((e) => {
    const tab = e.indexOf('\t');
    const [mode, , blob] = e.slice(0, tab).split(' ');
    return { path: e.slice(tab + 1), mode, blob };
  });
}

function walkFiles(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = lstatSync(abs);
    if (st.isDirectory()) walkFiles(root, abs, out);
    else out.push(relative(root, abs).split(sep).join('/'));
  }
  return out;
}

/**
 * Extract `sha` into `dest` with git archive, which applies the tree's export-ignore attributes.
 * Returns what was archived, what the attributes excluded, and every symlink or gitlink.
 */
export function extractSnapshot(repo, sha, dest) {
  mkdirSync(dest, { recursive: true });
  if (readdirSync(dest).length) throw new Error(`${dest} is not empty`);
  const tar = execFileSync('git', ['-C', repo, 'archive', '--format=tar', sha], { maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', dest], { input: tar, maxBuffer: 1 << 30 });
  const tracked = trackedEntries(repo, sha);
  const files = walkFiles(dest).sort();
  const present = new Set(files);
  return {
    tracked,
    files,
    excluded: tracked.filter((t) => t.mode !== '160000' && !present.has(t.path)).map((t) => t.path),
    links: tracked.filter((t) => t.mode === '120000').map((t) => t.path),
    gitlinks: tracked.filter((t) => t.mode === '160000').map((t) => t.path),
  };
}

/** Rewrite each .md stamp in the first STAMP_HEAD_LINES lines to its date alone. Returns paths changed. */
export function dateOnlyStamps(dest, files) {
  const changed = [];
  for (const rel of files) {
    if (!rel.endsWith('.md')) continue;
    const abs = join(dest, rel);
    const lines = readFileSync(abs, 'utf8').split('\n');
    let hit = false;
    for (let i = 0; i < Math.min(STAMP_HEAD_LINES, lines.length); i++) {
      if (STAMP_SHA_RE.test(lines[i])) { lines[i] = lines[i].replace(STAMP_SHA_RE, '$1$2'); hit = true; }
    }
    if (!hit) continue;
    writeFileSync(abs, lines.join('\n'));
    changed.push(rel);
  }
  return changed;
}

/** git init in `dest` and commit everything as one root commit. Hooks, signing and templates off. */
export function commitFreshRoot(dest, { name, email, date, message }) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: date,
  };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY']) delete env[k];
  const cfg = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'core.fileMode=true'];
  git(dest, ['init', '-q', '--template=', '-b', 'main'], { env });
  git(dest, [...cfg, 'add', '-A', '-f', '.'], { env });
  git(dest, [...cfg, 'commit', '-q', '--no-verify', '-m', message], { env });
  return {
    root: git(dest, ['rev-parse', 'HEAD'], { env }).trim(),
    tree: git(dest, ['rev-parse', 'HEAD^{tree}'], { env }).trim(),
    entries: trackedEntries(dest, 'HEAD'),
  };
}

/**
 * Second witness: the candidate holds exactly the archived paths, every untransformed blob is
 * byte-identical to the source, and every transformed one differs.
 */
export function blobWitness(source, candidate, transformed, excluded = []) {
  const want = new Map(source.filter((e) => e.mode !== '160000' && !excluded.includes(e.path)).map((e) => [e.path, e]));
  const got = new Map(candidate.map((e) => [e.path, e]));
  const problems = [];
  for (const p of want.keys()) if (!got.has(p)) problems.push(`missing ${p}`);
  for (const p of got.keys()) if (!want.has(p)) problems.push(`unexpected ${p}`);
  const changed = new Set(transformed);
  for (const [p, w] of want) {
    const g = got.get(p);
    if (!g) continue;
    if (g.mode !== w.mode) problems.push(`mode ${p} ${w.mode}→${g.mode}`);
    if (changed.has(p) ? g.blob === w.blob : g.blob !== w.blob) problems.push(`${changed.has(p) ? 'untransformed' : 'altered'} ${p}`);
  }
  return problems;
}

/** Every blob at `ref` as { path, text }; text is null for binary content. */
export function treeTexts(repo, ref = 'HEAD') {
  const listing = trackedEntries(repo, ref).filter((e) => e.mode !== '160000');
  if (!listing.length) return [];
  const out = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], { input: `${listing.map((e) => e.blob).join('\n')}\n`, maxBuffer: 1 << 30 });
  const entries = [];
  let off = 0;
  for (const e of listing) {
    const nl = out.indexOf(0x0a, off);
    const size = Number(out.toString('utf8', off, nl).split(' ')[2]);
    const body = out.subarray(nl + 1, nl + 1 + size);
    entries.push({ path: e.path, text: body.subarray(0, 8000).includes(0) ? null : body.toString('utf8') });
    off = nl + 1 + size + 1;
  }
  if (entries.length !== listing.length) throw new Error(`cat-file returned ${entries.length} of ${listing.length} blobs`);
  return entries;
}

export const PUBLIC_ENV_KEYS = Object.freeze(['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TERM', 'SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']);

/** An environment carrying nothing of the operator's: allowlisted keys, a scratch HOME, no sidecar. */
export function publicEnv(scratch, env = process.env) {
  const home = join(scratch, 'home');
  mkdirSync(home, { recursive: true });
  const out = Object.fromEntries(PUBLIC_ENV_KEYS.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
  return { ...out, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', CW_SIDECAR: join(scratch, 'no-sidecar') };
}

/** Run a child to completion; output goes to `log` when given. */
export function runStep(cmd, args, { cwd, env, timeoutMs = 600_000, log = null } = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 29 });
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  if (log) writeFileSync(log, `${stdout}${stderr ? `\n--- stderr ---\n${stderr}` : ''}`);
  return {
    code: typeof r.status === 'number' ? r.status : null,
    signal: r.signal || null,
    error: r.error ? r.error.message : null,
    ms: Date.now() - t0,
    stdout, stderr,
  };
}

/** node --test summary counts from spec or tap output; null where a count is absent. */
export function testCounts(text) {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- k is a literal summary label at each call site
  const n = (k) => { const m = String(text).match(new RegExp(`^(?:ℹ|#) ${k} (\\d+)\\s*$`, 'm')); return m ? Number(m[1]) : null; };
  return { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), cancelled: n('cancelled'), todo: n('todo') };
}

export const STATUSES = Object.freeze(['pass', 'fail', 'cannot-check', 'not-run']);

/** accepted only when every gate passed; any fail blocks; anything else is incomplete. */
export function overallVerdict(gates) {
  if (gates.some((g) => g.status === 'fail')) return { verdict: 'blocked', exit: 1 };
  if (gates.length && gates.every((g) => g.status === 'pass')) return { verdict: 'accepted', exit: 0 };
  return { verdict: 'incomplete', exit: 2 };
}

// D25 (2026-10-07): the public snapshot cites no commit SHA. The tree keeps its SHAs; the candidate
// strips each one that names a commit in the source history. A token is a candidate only with a
// digit, and only a confirmed commit is touched, so content hashes, ids and numbers stay. An
// all-digit token is a candidate too: 1234567 is as much a commit as 1234a67.
const SHA_TOKEN_RE = /(?<![/\w])(?=[0-9a-f]*\d)[0-9a-f]{7,40}(?![\w/])/g;
// Two commits written as a/b; the slash otherwise reads as a path and keeps both tokens.
const SHA_PAIR_RE = /(?<![/\w])([0-9a-f]{7,40})\/([0-9a-f]{7,40})(?![\w/])/g;
export const STRIP_TARGETS = (rel) => rel.endsWith('.md') || rel === 'monitor/failure-taxonomy.json';
// The failure taxonomy is commitwork's file; another project's snapshot strips its .md alone.
export const STRIP_TARGETS_MD = (rel) => rel.endsWith('.md');

/** The subset of `tokens` that resolve to commit objects in `repo`. */
export function commitTokens(repo, tokens) {
  const list = [...new Set(tokens)];
  if (!list.length) return new Set();
  const out = execFileSync('git', ['-C', repo, 'cat-file', '--batch-check=%(objecttype)'],
    { input: `${list.join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['pipe', 'pipe', 'ignore'] });
  const types = out.split('\n');
  // An id short enough to match a commit and another object reads `ambiguous`; ^{commit} picks the
  // commit when there is one, which is what a prose citation of it meant.
  const isCommit = (t, i) => types[i] === 'commit' || (/ambiguous$/.test(types[i])
    && spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '-q', `${t}^{commit}`], { stdio: 'ignore' }).status === 0);
  return new Set(list.filter(isCommit));
}

/** Remove a parenthesis of commit SHAs alone; replace any other commit SHA with "a commit". */
export function stripCommitShas(text, commits) {
  const isCommit = (t) => commits.has(t);
  return text
    .replace(/ ?\(((?:\s*`?[0-9a-f]{7,40}`?\s*(?:,|;|\+|\/|\.\.|and)?)+)\)/g, (whole, inner) => {
      const toks = inner.match(/[0-9a-f]{7,40}/g) || [];
      return toks.length && toks.every(isCommit) ? '' : whole;
    })
    .replace(/`([0-9a-f]{7,40})`/g, (whole, t) => (isCommit(t) ? 'a commit' : whole))
    .replace(SHA_PAIR_RE, (whole, a, b) => (isCommit(a) && isCommit(b) ? 'two commits' : whole))
    .replace(SHA_TOKEN_RE, (t) => (isCommit(t) ? 'a commit' : t));
}

/** Apply stripCommitShas to every target: by default each .md and the failure taxonomy's strings. Returns paths changed. */
export function stripShas(repo, dest, files, isTarget = STRIP_TARGETS) {
  const targets = files.filter(isTarget);
  const read = new Map(targets.map((rel) => [rel, readFileSync(join(dest, rel), 'utf8')]));
  const commits = commitTokens(repo, [...read.values()].flatMap((s) => [
    ...(s.match(SHA_TOKEN_RE) || []), ...[...s.matchAll(SHA_PAIR_RE)].flatMap((m) => [m[1], m[2]])]));
  const changed = [];
  for (const [rel, before] of read) {
    let after;
    if (rel.endsWith('.json')) {
      const walk = (v) => (typeof v === 'string' ? stripCommitShas(v, commits)
        : Array.isArray(v) ? v.map(walk)
          : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
      after = `${JSON.stringify(walk(JSON.parse(before)), null, 2)}\n`;
    } else {
      after = stripCommitShas(before, commits);
    }
    if (after === before) continue;
    writeFileSync(join(dest, rel), after);
    changed.push(rel);
  }
  return { changed, commits: commits.size };
}

export const PATTERN_BASELINE = 'monitor/pattern-baseline.json';
const BASELINE_SHA_RE = /::sha:([0-9a-f]{7,40})::/;
/**
 * Drop pattern-baseline identities that suppress a citation of a commit. They name the commit, and
 * the strip above removes the citation they suppress, so in the snapshot they suppress nothing.
 */
export function pruneBaselineShas(repo, dest, files) {
  if (!files.includes(PATTERN_BASELINE)) return { changed: [], dropped: 0 };
  const path = join(dest, PATTERN_BASELINE);
  const before = readFileSync(path, 'utf8');
  const doc = JSON.parse(before);
  const ids = Array.isArray(doc.identities) ? doc.identities : [];
  const commits = commitTokens(repo, ids.map((id) => id.match(BASELINE_SHA_RE)?.[1]).filter(Boolean));
  const kept = ids.filter((id) => !commits.has(id.match(BASELINE_SHA_RE)?.[1]));
  if (kept.length === ids.length) return { changed: [], dropped: 0 };
  writeFileSync(path, `${JSON.stringify({ ...doc, identities: kept }, null, 2)}\n`);
  return { changed: [PATTERN_BASELINE], dropped: ids.length - kept.length };
}

// D25: the snapshot's CLAUDE.md is the public variant, and the variant's own path does not ship.
export const PUBLIC_CLAUDE = 'release/CLAUDE.public.md';
export function swapPublicClaude(dest) {
  const src = join(dest, PUBLIC_CLAUDE);
  let text;
  try { text = readFileSync(src, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${PUBLIC_CLAUDE} is absent: the snapshot has no public CLAUDE.md to ship`);
    throw e;
  }
  writeFileSync(join(dest, 'CLAUDE.md'), text);
  rmSync(src);
  const changed = ['CLAUDE.md'];
  // The source README indexes the variant by its own path; in the snapshot that file is CLAUDE.md.
  const readme = join(dest, 'README.md');
  let index = null;
  try { index = readFileSync(readme, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (index !== null && index.includes(PUBLIC_CLAUDE)) {
    writeFileSync(readme, index.replaceAll(`[${PUBLIC_CLAUDE}](${PUBLIC_CLAUDE})`, '[CLAUDE.md](CLAUDE.md)').replaceAll(PUBLIC_CLAUDE, 'CLAUDE.md'));
    changed.push('README.md');
  }
  // The source export-ignores its operational CLAUDE.md; kept in the snapshot, that rule would drop
  // the public one from the published repository's own archives.
  const attrs = join(dest, '.gitattributes');
  let rules = null;
  try { rules = readFileSync(attrs, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (rules !== null) {
    const kept = rules.split('\n').filter((l) => !/^\/?CLAUDE\.md\s+export-ignore\s*$/.test(l)).join('\n');
    if (kept !== rules) { writeFileSync(attrs, kept); changed.push('.gitattributes'); }
  }
  return { changed, removed: [PUBLIC_CLAUDE] };
}

/**
 * Rebuild the docsite pages the stripped sources derive from, inside the candidate, so a docsite
 * build there reproduces its own pages. Returns tracked paths whose bytes changed; anything the
 * generators write that the snapshot does not track (version snapshots) is removed.
 */
export function regenerateDerived(dest, files, { redactions } = {}) {
  const tracked = new Set(files);
  const before = new Map(files.filter((f) => f.startsWith('docsite/')).map((f) => [f, readFileSync(join(dest, f))]));
  // The redaction map is private and the candidate holds none; the pages are rendered with the
  // source checkout's map, exactly as the committed pages were.
  const env = { ...process.env, CW_DOCSITE_PRIVATE: join(dest, '.no-private-docsite'), CW_SIDECAR: join(dest, '.no-sidecar'),
    ...(redactions ? { CW_PUBLISH_REDACTIONS: redactions } : {}) };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'CW_DOCSITE_ROOT', 'CW_TAXONOMY_JSON']) delete env[k];
  const run = (args) => {
    const r = spawnSync(process.execPath, args, { cwd: dest, env, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`regenerate: node ${args.join(' ')} exited ${r.status}: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ')}`);
  };
  if (tracked.has('bin/taxonomy-render.mjs') && tracked.has('docsite/imported/taxonomy-reference.html')) {
    run(['bin/taxonomy-render.mjs', '--out', 'docsite/imported/taxonomy-reference.html']);
  }
  if (tracked.has('bin/docsite-build.mjs')) run(['bin/docsite-build.mjs']);
  for (const rel of walkFiles(dest)) if (!tracked.has(rel)) rmSync(join(dest, rel));
  return [...before].filter(([f, b]) => !b.equals(readFileSync(join(dest, f)))).map(([f]) => f);
}
