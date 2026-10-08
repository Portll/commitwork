#!/usr/bin/env node
// cite-reach — every commit sha quoted in a document tree, and whether a reader can still reach it.
//
// Registry D2 (citation that resolves but is unreachable): `git show` prints a commit happily while
// no branch contains it, so it survives only until the next gc and the citation rots without a
// sound. D1 is the neighbour where a whole branch shares no ancestor with main. This sweeps the
// documents, classifies each quoted sha three ways, and — for the case a rewrite produced — finds
// the commit that replaced it and can annotate the citation in place.
//
// THREE STATES, never two. A token that does not name a commit at all is UNRESOLVABLE (pre-rewrite
// history, a typo, or a hex-looking word); one that names a commit in no branch is UNREACHABLE;
// the rest are REACHABLE. Collapsing the first two into "broken" would hide the one that is still
// recoverable.
//
// AMBIGUOUS PREFIXES ARE RESOLVED AS COMMITS FIRST. `git branch --contains <prefix>` errors when the
// seven-hex prefix also names a tree or blob, and a sweep that fed the bare token to --contains
// counted main's own HEAD as unreachable (measured 2026-09-09). `rev-parse --verify <tok>^{commit}`
// disambiguates by type and returns the full sha; only that goes to --contains. This is C18's
// example met while measuring D2.
//
// RE-ANCHORING IS TWO WITNESSES. A rewritten commit keeps its subject and its patch-id; the
// candidate on the main ref must match BOTH before `--annotate` writes `<old> (rewritten; now
// <new>)` into the document. A subject match alone is reported as a suggestion and never written —
// two commits can share a subject and carry different changes. Measured on the first sidecar run:
// 39 unreachable, 37 with both witnesses, 2 subject-only, left named and unwritten.
//
// Env (read at call time): CW_CITE_REPO (git repo, default cwd), CW_CITE_DIR (documents, default
// evaluations), CW_CITE_MAIN (ref rewritten commits are looked up on, default main).
import { scannedGit, scannedGitOut } from './lib/git-env.mjs';
import { readdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';

const TOKEN = /\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g;
const ANNOTATED = /^ \(rewritten; now [0-9a-f]{7,40}\)/;

export function git(repo, args, { allowFail = false } = {}) {
  try {
    return scannedGitOut(repo, args).trim(); // CW_CITE_REPO is any repo; `show` there runs its textconv under a plain git
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

/** Every *.md under dir, recursively. */
export function docsUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && /\.md$/i.test(ent.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** Sha-shaped tokens in one text, with the offset of each, skipping ones already annotated. */
export function tokensIn(text) {
  const out = [];
  for (const m of text.matchAll(TOKEN)) {
    if (ANNOTATED.test(text.slice(m.index + m[0].length, m.index + m[0].length + 60))) continue;
    out.push({ token: m[0], index: m.index });
  }
  return out;
}

/** Classify one token against the repo. */
export function classify(repo, token, { main = 'main', subjectIndex } = {}) {
  const full = git(repo, ['rev-parse', '--verify', '-q', `${token}^{commit}`], { allowFail: true });
  if (!full || !/^[0-9a-f]{40}$/.test(full)) return { token, state: 'unresolvable' };
  const contains = git(repo, ['branch', '-a', '--contains', full], { allowFail: true });
  if (contains === null) return { token, full, state: 'unresolvable', why: 'branch --contains failed' };
  if (contains.trim()) return { token, full, state: 'reachable' };
  const subject = git(repo, ['log', '-1', '--format=%s', full], { allowFail: true }) || '';
  const candidates = (subjectIndex ? subjectIndex.get(subject) : lookupSubject(repo, main, subject)) || [];
  let reanchor = null;
  if (candidates.length === 1) {
    const [cand] = candidates;
    const pid = (s) => {
      const show = git(repo, ['show', '--format=', s], { allowFail: true });
      if (show === null) return null;
      const r = scannedGit(repo, ['patch-id', '--stable'], { input: show });
      return r.status === 0 ? r.stdout.split(' ')[0] || null : null;
    };
    const a = pid(full); const b = pid(cand);
    reanchor = { candidate: cand, subject, patchIdAgrees: !!a && a === b };
  } else if (candidates.length > 1) {
    reanchor = { candidate: null, subject, patchIdAgrees: false, why: `${candidates.length} commits on ${main} share the subject` };
  }
  return { token, full, state: 'unreachable', subject, reanchor };
}

function lookupSubject(repo, main, subject) {
  return buildSubjectIndex(repo, main).get(subject) || [];
}

/** subject → [sha…] over the main ref, built once per sweep. */
export function buildSubjectIndex(repo, main = 'main') {
  const idx = new Map();
  const log = git(repo, ['log', '--format=%H %s', main], { allowFail: true }) || '';
  for (const line of log.split('\n')) {
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    const sha = line.slice(0, sp); const subj = line.slice(sp + 1);
    if (!idx.has(subj)) idx.set(subj, []);
    idx.get(subj).push(sha);
  }
  return idx;
}

/**
 * Sweep. Returns { files, tokens, byState, rows, rewritten } where rows is one entry per unique
 * token and rewritten lists the (old → new) pairs both witnesses agreed on.
 */
export function sweep({ repo, dir, main = 'main' }) {
  const files = docsUnder(dir);
  const where = new Map();  // token → [file…]
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const { token } of tokensIn(text)) {
      if (!where.has(token)) where.set(token, new Set());
      where.get(token).add(relative(dir, f));
    }
  }
  const subjectIndex = buildSubjectIndex(repo, main);
  const rows = [];
  for (const token of [...where.keys()].sort()) {
    rows.push({ ...classify(repo, token, { main, subjectIndex }), files: [...where.get(token)].sort() });
  }
  const byState = { reachable: 0, unreachable: 0, unresolvable: 0 };
  for (const r of rows) byState[r.state]++;
  const rewritten = rows.filter((r) => r.state === 'unreachable' && r.reanchor && r.reanchor.candidate && r.reanchor.patchIdAgrees)
    .map((r) => ({ token: r.token, full: r.full, now: r.reanchor.candidate, files: r.files }));
  return { files: files.length, tokens: rows.length, byState, rows, rewritten };
}

/** Write `<old> (rewritten; now <new7>)` beside every occurrence, atomically per file. Returns edits. */
export function annotate({ dir, rewritten }) {
  const edits = [];
  const byFile = new Map();
  for (const r of rewritten) for (const f of r.files) {
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(r);
  }
  for (const [rel, list] of byFile) {
    const p = join(dir, rel);
    const before = readFileSync(p, 'utf8');
    let after = before;
    let n = 0;
    for (const r of list) {
      const re = new RegExp(`\\b${r.token}\\b(?! \\(rewritten; now)`, 'g');
      after = after.replace(re, () => { n++; return `${r.token} (rewritten; now ${r.now.slice(0, 7)})`; });
    }
    if (after !== before) {
      const tmp = `${p}.tmp-${process.pid}`;
      writeFileSync(tmp, after);
      renameSync(tmp, p);
      edits.push({ file: rel, count: n });
    }
  }
  return edits;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (flag, env, dflt) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : (process.env[env] || dflt); };
  const repo = opt('--repo', 'CW_CITE_REPO', process.cwd());
  const dir = opt('--dir', 'CW_CITE_DIR', join(process.cwd(), 'evaluations'));
  const main = opt('--main', 'CW_CITE_MAIN', 'main');
  try { statSync(dir); } catch (e) { console.error(`cite-reach: documents dir unreadable (${e.code}): ${dir}`); process.exit(2); }
  const s = sweep({ repo, dir, main });
  if (args.includes('--json')) { console.log(JSON.stringify(s, null, 2)); }
  else {
    console.log(`cite-reach: ${s.files} document(s), ${s.tokens} distinct sha-shaped token(s) — ${s.byState.reachable} reachable, ${s.byState.unreachable} UNREACHABLE (in no branch), ${s.byState.unresolvable} unresolvable (not a commit here)`);
    for (const r of s.rows.filter((x) => x.state === 'unreachable')) {
      const ra = r.reanchor;
      const tail = !ra ? 'no commit on the main ref shares its subject'
        : ra.candidate ? `${ra.patchIdAgrees ? 'REWRITTEN as' : 'subject matches (patch-id DIFFERS — not annotated)'} ${ra.candidate.slice(0, 7)}`
          : ra.why;
      console.log(`  ${r.token.padEnd(10)} ${r.full.slice(0, 7)}  ${(r.subject || '').slice(0, 60).padEnd(60)}  ${tail}  [${r.files.length} doc(s)]`);
    }
  }
  if (args.includes('--annotate')) {
    const edits = annotate({ dir, rewritten: s.rewritten });
    console.log(`cite-reach: annotated ${s.rewritten.length} rewritten citation(s) across ${edits.length} file(s): ${edits.map((e) => `${e.file} ×${e.count}`).join(', ') || '(none)'}`);
  }
  const remaining = s.byState.unreachable - (args.includes('--annotate') ? s.rewritten.length : 0);
  process.exit(remaining > 0 ? 1 : 0);
}
