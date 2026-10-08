#!/usr/bin/env node
// commitwork anchor-staleness — does each finding still point at the code it was written about?
//
// Records what an anchor POINTED AT, not merely where it pointed:
//   verifiedAtHead — the git ref the finding was verified against
//   anchorHash     — a hash of the anchored source line as it was at that ref
// then re-derives the hash from the current tree. A matching anchorHash is safe to schedule; a
// changed one must be re-read. The gate exits nonzero when a still-`open` entry no longer matches.
// Hashes ONE line: a window would flag every entry in any touched file (alarm fatigue).
//
// usage:
//   node bin/anchor-staleness.mjs [--queue <path>] [--baseline <git-ref>] [--out <path>] [--json]
//                                 [--only-open] [--no-gate] [--reanchor [--force]]
//                                 [--reverify-comment-only [--force]]
//
// --reanchor does NOT reduce the gate (which counts changed/gone/deleted, never `moved`): it only
// re-pins the line numbers of entries whose source text is unchanged. Entries in files with
// uncommitted changes are SKIPPED and named, not re-pinned — the tree as a whole need not be clean,
// only the file each entry is anchored in. --force re-pins them anyway.
// exit: 0 clean · 1 open entries have drifted (gate) · 2 bad usage / unreadable input
import { hashLine } from '../lib/anchor-hash.mjs';
import { readFileSync, writeFileSync, existsSync, renameSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { auditDirFor } from '../monitor/store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
// The tree the audit read, recorded beside its queue as `baseline`. A fixed commit, never "HEAD~n" —
// that would re-baseline every commit and report clean forever.
function recordedBaseline(dir) {
  try { return readFileSync(join(dir, 'baseline'), 'utf8').trim().split(/\s+/)[0] || null; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

export { hashLine };

// Quoted source lines are content: a baseline line that hard-codes a home directory carries that
// user's name into a generated report, and the identity scrub cannot reach a file the generator
// rewrites on every run (found 2026-09-09: two wasText values, re-emitted after every scrub).
// The hash above is over the RAW line, so the identity of an anchor is unaffected; only the two
// human-readable excerpts are normalised. anchor-triage searches by the fragments around the
// placeholder, so the excerpt stays searchable in git.
export const HOME_PLACEHOLDER = '/Users/username/';
export const redactHome = (text) => String(text ?? '').replace(/\/Users\/[^/\s'"`]+\//g, HOME_PLACEHOLDER);
const excerpt = (text) => redactHome(String(text).trim()).slice(0, 160);

// ── classification ──────────────────────────────────────────────────────────────────────────
// States are distinct: a moved anchor is a bookkeeping fix, a changed one needs re-reading.
export const STATES = {
  UNCHANGED: 'anchor-unchanged',   // the line is byte-identical (after trim). Safe to schedule.
  MOVED: 'anchor-moved',           // the same line text now lives elsewhere in the file.
  CHANGED: 'anchor-changed',       // the line is different and the original text is gone.
  GONE: 'anchor-gone',             // the file no longer has that many lines.
  FILE_DELETED: 'file-deleted',
  NO_BASELINE: 'no-baseline',      // the file did not exist at the baseline ref — cannot compare.
  NO_ANCHOR: 'no-anchor',          // the entry carries no usable file:line.
};

// States that mean "a human must re-read this before working it".
export const DRIFTED = new Set([STATES.CHANGED, STATES.GONE, STATES.FILE_DELETED]);

// The dispositions that are still WORK, and so still worth anchoring. 'moved' is a finding that is
// live at a different file than it was written against (reconcile-findings' moved ledger): it is
// re-anchored to the destination, which is exactly what this gate then checks. 'fixed' and
// 'refuted' are judged and excluded; 'unreviewed' has no tested severity, so it is scheduled off
// nothing and is read only once a second pass rules on it.
export const LIVE = new Set(['open', 'moved']);

/**
 * The repository whose history holds `path`, and the path inside it. A finding re-anchored into a
 * private record (monitor/private, a directory link into the sidecar repository) carries a sidecar
 * commit as its ref; asked of this repository it read as no-baseline, which is outside the gate,
 * so the move would have taken it out of the only check that reads it. The directory is resolved
 * rather than the file, so a record deleted since still reads as file-deleted.
 */
export function historyFor(path, root = REPO_ROOT) {
  if (!String(path).startsWith('monitor/private/')) return { cwd: root, rel: path };
  let dir;
  try { dir = realpathSync(dirname(join(root, path))); } catch { return { cwd: root, rel: path } }
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { cwd: top, rel: relative(realpathSync(top), join(dir, basename(path))) };
  } catch { return { cwd: root, rel: path }; }
}

export function gitShow(ref, path, root = REPO_ROOT) {
  const { cwd, rel } = historyFor(path, root);
  try {
    return execFileSync('git', ['show', `${ref}:${rel}`], {
      cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { return null; }
}

const readNow = (path) => {
  const full = join(REPO_ROOT, path);
  if (!existsSync(full)) return null;
  try { return readFileSync(full, 'utf8'); } catch { return null; }
};

export function classify({ file, line }, baselineText, currentText) {
  if (!file || !Number.isFinite(line) || line < 1) return { state: STATES.NO_ANCHOR };
  if (baselineText === null) return { state: STATES.NO_BASELINE };
  if (currentText === null) return { state: STATES.FILE_DELETED };

  const baseLines = baselineText.split('\n');
  const curLines = currentText.split('\n');
  const was = baseLines[line - 1];
  if (was === undefined) return { state: STATES.NO_BASELINE };

  const anchorHash = hashLine(was);
  const now = curLines[line - 1];
  if (now === undefined) return { state: STATES.GONE, anchorHash };
  if (hashLine(now) === anchorHash) return { state: STATES.UNCHANGED, anchorHash, nowLine: line };

  // Blank/near-blank lines match everywhere, so they are only ever unchanged-or-changed.
  // UNIQUE match only: with duplicates, an EDITED line whose twin sits elsewhere would re-pin to
  // the twin and read as bookkeeping. Same rule as reverifyCommentOnly — a wrong pin beats no pin
  // nowhere.
  if (was.trim().length >= 8) {
    const count = (ls) => ls.reduce((n, l) => n + (hashLine(l) === anchorHash ? 1 : 0), 0);
    const wasN = count(baseLines);
    const hits = [];
    for (let i = 0; i < curLines.length; i++) if (hashLine(curLines[i]) === anchorHash) hits.push(i + 1);
    // Unique on BOTH sides or it is not an identity: a duplicate in the baseline means the text
    // never named this line, and a surviving twin would absorb an edit as bookkeeping.
    if (wasN === 1 && hits.length === 1) return { state: STATES.MOVED, anchorHash, nowLine: hits[0], delta: hits[0] - line };
    if (hits.length) {
      return { state: STATES.CHANGED, anchorHash, ambiguous: true, wasText: excerpt(was), nowText: excerpt(now) };
    }
  }
  return { state: STATES.CHANGED, anchorHash, wasText: excerpt(was), nowText: excerpt(now) };
}

// The baseline is per entry: `line` only means anything paired with the ref it was measured
// against, so an entry may carry its own `verifiedAtHead` (re-anchoring sets both halves). Entries
// never re-anchored fall back to the audit's baseline.
export function checkQueue(queue, { baseline, onlyOpen = false } = {}) {
  if (!baseline) throw new Error('checkQueue needs the baseline commit the audit read');
  const entries = queue.queue || [];
  const baselineCache = new Map();   // keyed `${ref} ${file}` — refs differ per entry
  const currentCache = new Map();
  const results = [];

  for (const e of entries) {
    // 'moved' is live work at a NEW anchor (reconcile-findings' moved ledger), so it belongs in
    // this population: dropping it would relocate a finding out of the only check that reads it.
    if (onlyOpen && !LIVE.has(e.disposition)) continue;
    // The finding's identity stays in e.file; a re-pin sets anchorFile when the code moved to
    // another file, and the pinned line is only meaningful in that file.
    const file = e.anchorFile || e.file || null;
    const ref = e.verifiedAtHead || baseline;
    const key = `${ref}\0${file}`;
    if (file && !baselineCache.has(key)) baselineCache.set(key, gitShow(ref, file));
    if (file && !currentCache.has(file)) currentCache.set(file, readNow(file));
    const c = classify(
      { file, line: Number(e.line) },
      file ? baselineCache.get(key) : null,
      file ? currentCache.get(file) : null,
    );
    results.push({
      id: e.id, anchor: e.anchor, file, line: e.line,
      severity: e.severity, disposition: e.disposition,
      summary: String(e.summary || '').slice(0, 200),
      verifiedAtHead: ref,
      ...c,
    });
  }

  const byState = {};
  for (const r of results) byState[r.state] = (byState[r.state] || 0) + 1;
  // The gate counts ONLY open entries: a `fixed` entry whose line changed is the point of fixing it.
  const driftedOpen = results.filter((r) => LIVE.has(r.disposition) && DRIFTED.has(r.state));
  return { baseline, checked: results.length, byState, driftedOpen, results };
}

/**
 * Rewrite the line numbers of `anchor-moved` entries in place, and ONLY those — a moved anchor is
 * bookkeeping (identical text elsewhere), while re-anchoring a changed one would convert "re-read
 * this" into "this is fine". `verifiedAtHead` still names the verification baseline; the new
 * fields record that a machine moved the line and from where.
 */
export function reanchor(queue, results, headSha, { skipFiles = null } = {}) {
  if (!headSha) throw new Error('reanchor needs the current HEAD sha: the new line is only meaningful against it');
  const byId = new Map(results.map((r) => [r.id, r]));
  let moved = 0;
  const skipped = [];
  for (const e of queue.queue || []) {
    const r = byId.get(e.id);
    if (!r || r.state !== STATES.MOVED || !Number.isFinite(r.nowLine)) continue;
    const from = Number(e.line);
    if (from === r.nowLine) continue;
    // An entry whose FILE has uncommitted changes cannot be re-pinned honestly: the new line comes
    // from the working tree while `verifiedAtHead` is set to HEAD, so the pair would describe a
    // tree that exists in nobody's repository. Skipped and reported, never silently dropped.
    if (skipFiles && skipFiles.has(e.file)) { skipped.push(`${e.file}:${from} (${e.id})`); continue; }
    e.reanchor = {
      fromLine: from,
      fromRef: r.verifiedAtHead,
      toLine: r.nowLine,
      delta: r.nowLine - from,
      // The line's own hash — the same text before and after, which is what makes this bookkeeping.
      anchorHash: r.anchorHash,
      note: 'line moved; the anchored source text is unchanged. Re-based, NOT re-verified.',
    };
    e.line = r.nowLine;
    e.anchor = `${e.file}:${r.nowLine}`;
    // Both halves move together, or the line names the new tree while the comparison reads the old ref.
    e.verifiedAtHead = headSha;
    moved += 1;
  }
  return { n: moved, skipped };
}

// Strips a trailing line comment, skipping `//` inside string/template/regex literals — a naive
// /\/\/.*$/ would call `fetch('http://a')` → `fetch('http://b')` a comment-only delta.
const stripLineComment = (s) => {
  const t = String(s);
  let q = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && t[i + 1] === '/') return t.slice(0, i).trim();
  }
  return t.trim();
};

/**
 * Re-verify `anchor-changed` entries whose delta is comment-only: the old line and exactly one
 * current line agree after comment stripping. Records its basis on the entry — a re-verification
 * with stated grounds, never a silent re-base. Ambiguous or genuinely-changed code stays flagged.
 */
export function reverifyCommentOnly(queue, results, headSha, { baseline, readCur, readOld, skipFiles = null } = {}) {
  if (!headSha) throw new Error('reverify needs the current HEAD sha');
  if (!baseline) throw new Error('reverify needs the baseline commit the audit read');
  const byId = new Map(results.map((r) => [r.id, r]));
  const curCache = new Map();
  const cur = (f) => { if (!curCache.has(f)) curCache.set(f, ((readCur || readNow)(f) || '').split('\n')); return curCache.get(f); };
  const oldCache = new Map();
  const old = (ref, f) => { const k = `${ref} ${f}`; if (!oldCache.has(k)) oldCache.set(k, ((readOld || gitShow)(ref, f) || '').split('\n')); return oldCache.get(k); };
  let n = 0;
  const skipped = [];
  for (const e of queue.queue || []) {
    const r = byId.get(e.id);
    if (!r || r.state !== STATES.CHANGED || !e.file) continue;
    // Same per-file hazard as reanchor(): re-verifying against a file somebody is mid-edit on pins
    // a judgment to a version of the code that was never committed.
    if (skipFiles && skipFiles.has(e.file)) { skipped.push(`${e.file}:${e.line} (${e.id})`); continue; }
    const ref = e.verifiedAtHead || baseline;
    const was = old(ref, e.file)[Number(e.line) - 1];
    if (was === undefined) continue;
    const code = stripLineComment(was);
    if (code.length < 8) continue;   // near-blank code matches everywhere
    const lines = cur(e.file);
    const hits = [];
    for (let i = 0; i < lines.length; i++) if (stripLineComment(lines[i]) === code) hits.push(i + 1);
    if (hits.length !== 1) continue;   // absent or ambiguous — stays changed, a human reads it
    e.reverified = {
      fromRef: ref, fromLine: Number(e.line), toLine: hits[0],
      basis: 'comment-only delta: code tokens identical after comment stripping; unique match in file',
      at: headSha,
    };
    e.line = hits[0];
    e.anchor = `${e.file}:${hits[0]}`;
    e.verifiedAtHead = headSha;
    n += 1;
  }
  return { n, skipped };
}

// The files that differ from HEAD, as a Set of repo-relative paths — tracked modifications and
// untracked files alike.
//
// WHY A SET RATHER THAN A BOOLEAN, which is what both re-pin operations used to ask for. The hazard
// they guard against is real but PER FILE: re-pinning writes `verifiedAtHead = HEAD` while the new
// line number was read from the working tree, so for a DIRTY file the entry ends up describing a
// tree nobody has. A file nobody is editing has no such gap, and someone else's edit two
// directories away says nothing about it.
//
// Asking the whole-tree question instead made both operations unrunnable here rather than safe.
// This repository routinely carries a dozen concurrent sessions and ~50 modified files; the tree is
// essentially never wholly clean, so `--reanchor` could not be run at all, and the queue
// accumulated drifted anchors that the tool was forbidden from re-pinning — while `--force`, the
// only way through, ignored the per-file hazard completely. A precondition that is never satisfiable
// is not a strict guard, it is an off switch with a justification attached.
function dirtyPaths() {
  const run = (args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  const out = new Set();
  // Two plain-path queries rather than parsing --porcelain status codes: rename records and quoted
  // paths make that format easy to mis-read, and a mis-read path here silently fails OPEN — the
  // entry would not be recognised as dirty and would be re-pinned anyway, which is the one outcome
  // this function exists to prevent.
  for (const p of run(['diff', '--name-only', 'HEAD']).split('\n')) if (p.trim()) out.add(p.trim());
  for (const p of run(['ls-files', '--others', '--exclude-standard']).split('\n')) if (p.trim()) out.add(p.trim());
  return out;
}

function main(argv) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i === -1 ? d : argv[i + 1]; };
  const queuePath = resolve(arg('--queue', join(auditDirFor(REPO_ROOT), 'queue.json')));
  const outPath = arg('--out', join(dirname(queuePath), 'anchor-staleness.json'));
  const onlyOpen = argv.includes('--only-open');

  if (!existsSync(queuePath)) {
    console.error(`no queue at ${queuePath} — run \`node bin/reconcile-findings.mjs\` first`);
    process.exit(2);
  }
  const baseline = arg('--baseline', process.env.CW_AUDIT_BASELINE || recordedBaseline(dirname(queuePath)));
  if (!baseline) {
    console.error(`missing input: no baseline commit — pass --baseline, set CW_AUDIT_BASELINE, or record it in ${join(dirname(queuePath), 'baseline')}`);
    process.exit(2);
  }
  let queue;
  try { queue = JSON.parse(readFileSync(queuePath, 'utf8')); }
  catch (e) { console.error(`queue at ${queuePath} is not valid JSON: ${e.message}`); process.exit(2); }

  // Fail loudly: an unresolvable baseline would report every anchor as no-baseline (silent green).
  try { execFileSync('git', ['rev-parse', '--verify', `${baseline}^{commit}`], { cwd: REPO_ROOT, stdio: 'ignore' }); }
  catch { console.error(`baseline ref '${baseline}' does not resolve in this repository`); process.exit(2); }

  const report = checkQueue(queue, { baseline, onlyOpen });

  // --reanchor rewrites moved line numbers in place; opt-in, atomic (tmp+rename).
  if (argv.includes('--reanchor')) {
    // Entries in files with uncommitted changes are skipped, not refused wholesale — see dirtyPaths().
    // --force re-pins them anyway, which is the caller asserting they know the file is theirs.
    const skipFiles = argv.includes('--force') ? null : dirtyPaths();
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'],
      { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const { n, skipped } = reanchor(queue, report.results, head, { skipFiles });
    // Only touch the queue when something actually moved: this file is shared, and rewriting it
    // byte-identically still churns its mtime for every other session watching it.
    if (n) {
      const tmp = `${queuePath}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(queue, null, 2) + '\n');
      renameSync(tmp, queuePath);
    }
    process.stdout.write(`re-anchored ${n} moved entr${n === 1 ? 'y' : 'ies'} to ${head} in ${queuePath}\n`);
    process.stdout.write('changed / gone / deleted anchors were NOT touched — those need a human, and\n');
    process.stdout.write('re-anchoring them would convert "re-read this" into "this is fine".\n');
    // NAMED, never counted-and-forgotten: a skipped entry stays drifted and will be re-reported by
    // the gate, so the operator has to be able to see WHICH ones and why without re-deriving it.
    if (skipped.length) {
      process.stdout.write(`\nSKIPPED ${skipped.length} moved entr${skipped.length === 1 ? 'y' : 'ies'} whose file has uncommitted changes:\n`);
      for (const s of skipped) process.stdout.write(`  ${s}\n`);
      process.stdout.write('  Re-pinning these would record a line read from the working tree against HEAD.\n');
      process.stdout.write('  Re-run once those files are committed, or --force to re-pin them regardless.\n');
    }
    process.stdout.write('\n');
  }
  // --reverify-comment-only re-verifies changed entries whose code tokens are identical; same
  // dirty-tree poisoning as --reanchor, same atomic write.
  if (argv.includes('--reverify-comment-only')) {
    const skipFiles = argv.includes('--force') ? null : dirtyPaths();
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'],
      { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const { n, skipped } = reverifyCommentOnly(queue, report.results, head, { baseline, skipFiles });
    if (n) {
      const tmp = `${queuePath}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify(queue, null, 2) + '\n');
      renameSync(tmp, queuePath);
    }
    process.stdout.write(`re-verified ${n} comment-only change(s) to ${head} in ${queuePath}\n`);
    process.stdout.write('code-changed, gone and deleted anchors were NOT touched — a human reads those.\n');
    if (skipped.length) {
      process.stdout.write(`\nSKIPPED ${skipped.length} changed entr${skipped.length === 1 ? 'y' : 'ies'} whose file has uncommitted changes:\n`);
      for (const s of skipped) process.stdout.write(`  ${s}\n`);
    }
    process.stdout.write('\n');
  }
  const doc = {
    tool: 'commitwork anchor-staleness',
    baseline: report.baseline,
    queue: queuePath.replace(REPO_ROOT + '/', ''),
    checked: report.checked,
    byState: report.byState,
    driftedOpen: report.driftedOpen.length,
    results: report.results,
  };
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');

  if (argv.includes('--json')) { process.stdout.write(JSON.stringify(doc, null, 2) + '\n'); }
  else {
    process.stdout.write(`anchor staleness vs ${report.baseline} — ${report.checked} entries checked\n\n`);
    for (const [state, n] of Object.entries(report.byState).sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`  ${String(n).padStart(4)}  ${state}\n`);
    }
    if (report.driftedOpen.length) {
      process.stdout.write(`\n${report.driftedOpen.length} OPEN entr${report.driftedOpen.length === 1 ? 'y' : 'ies'} no longer match their anchor.\n`);
      process.stdout.write('Each must be re-read before it is scheduled — the line it describes has changed.\n\n');
      for (const r of report.driftedOpen.slice(0, 40)) {
        process.stdout.write(`  ${r.severity.padEnd(8)} ${r.anchor}  [${r.state}]\n      ${r.summary}\n`);
      }
      if (report.driftedOpen.length > 40) process.stdout.write(`  … and ${report.driftedOpen.length - 40} more (see ${outPath})\n`);
    }
    process.stdout.write(`\nwrote ${outPath}\n`);
  }

  // process.exitCode, never process.exit(): stdout to a pipe is async and process.exit truncates it.
  if (report.driftedOpen.length && !argv.includes('--no-gate')) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
