#!/usr/bin/env node
// stage-mine — land only THIS session's hunks of a file that several sessions have edited.
//
// Registry WP1 (a), classes P12 (untracked-path co-authorship) and P3 (authorship inferred from
// contact). The measured shape: one file carries three sessions' work, and every commit form —
// bare, pathspec, --from-blob of the working tree — commits the file WHOLE under one session's
// message. The touch ledger has recorded a content fingerprint per Edit since 2026-08-23 and
// nothing consumed it; this does.
//
// HOW. For each file: the ledger's STANDING fingerprints (bin/lib/touch-attribution.mjs — a claim
// no later edit is proven to have replaced) are located in the current text as line windows
// (bin/lib/hunk-locate.mjs), each hunk of `git diff HEAD -- <file>` is assigned mine / theirs /
// shared / unmatched, and the MINE hunks are applied to HEAD's content to produce the blob to land.
// That blob goes through `commit-phase --from-blob <path>=<file>@<head-blob>`: content only, the
// working tree untouched for its other authors, HEAD-moved refusal and the CAS as for any land.
//
// WHAT IT REFUSES TO GUESS. A `shared` hunk (my fingerprint and a peer's both cover it) and an
// `unmatched` hunk (nothing covers it — a mid-line Edit, a shell write, a peer the ledger cannot
// see) are NOT staged and are printed by name. A file with no `mine` hunk lands nothing. The report
// is the deliverable even without --land: it is the first thing in this repository that can say
// which lines of a shared file are whose, and it says "cannot tell" where it cannot.
//
// Usage:
//   node bin/stage-mine.mjs [--session <id>] [--land -m <msg>] [--json] -- <path>…
// Env (call time): CLAUDE_CODE_SESSION_ID (session), CW_TOUCH_LEDGER (ledger), CW_COMMIT_REPO.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { touchLedger, treeId, treeClaim } from './lib/store-paths.mjs';
import { generations } from './lib/ledger-rotate.mjs';
import { parseLedger } from './lib/touch-ledger-core.mjs';
import { attributeFile, STATE } from './lib/touch-attribution.mjs';
import { parseHunks, locate, assign, applyHunks } from './lib/hunk-locate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const repo = () => process.env.CW_COMMIT_REPO || process.cwd();
const git = (args, { allowFail = false } = {}) => {
  try { return execFileSync('git', ['-C', repo(), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { if (allowFail) return null; throw e; }
};

/** Every ledger row, oldest generation first; torn lines counted. */
export function readLedgerRows(ledgerPath = touchLedger()) {
  const texts = generations(ledgerPath).map((p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } });
  return parseLedger(texts);
}

/**
 * Decide one file. Pure over its inputs so a test can drive it without git.
 * @returns {{ file, hunks:[{state, sessions, range}], mine:number, theirs, shared, unmatched, searched, content:string|null }}
 */
export function decideFile({ file, me, rows, headText, currentText, diffText }) {
  const mine8 = String(me || '').slice(0, 8);
  const tree = treeId(repo());
  const here = rows.filter((r) => r.f === file && treeClaim(r, tree) !== 'other');
  const standing = attributeFile(here, file).filter((a) => a.state === STATE.STANDING && a.n);
  const hunks = parseHunks(diffText);
  const loc = locate(currentText, hunks, standing.map((a) => ({ n: a.n, s: a.session })));
  const assigned = assign(hunks, loc.located, mine8);
  const count = (st) => assigned.filter((a) => a.state === st).length;
  const mineHunks = assigned.filter((a) => a.state === 'mine').map((a) => a.hunk);
  return {
    file,
    hunks: assigned.map((a) => ({ state: a.state, sessions: a.sessions, range: a.hunk.changedNew })),
    mine: count('mine'), theirs: count('theirs'), shared: count('shared'), unmatched: count('unmatched'),
    standingClaims: standing.length, searched: loc.searched,
    content: mineHunks.length ? applyHunks(headText, mineHunks) : null,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const dd = argv.indexOf('--');
  const files = dd === -1 ? [] : argv.slice(dd + 1);
  const flags = dd === -1 ? argv : argv.slice(0, dd);
  const opt = (f) => { const i = flags.indexOf(f); return i >= 0 ? flags[i + 1] : null; };
  const me = opt('--session') || process.env.CW_COMMIT_SESSION || process.env.CLAUDE_CODE_SESSION_ID || null;
  const land = flags.includes('--land');
  const message = opt('-m');
  const asJson = flags.includes('--json');
  if (!files.length) { console.error('stage-mine: no paths. Usage: stage-mine.mjs [--session <id>] [--land -m <msg>] -- <path>…'); return 2; }
  if (!me) { console.error('stage-mine: no session id (CLAUDE_CODE_SESSION_ID or --session). Refusing: "mine" is undefined without one.'); return 2; }
  if (land && !message) { console.error('stage-mine: --land needs -m <message>.'); return 2; }

  const head = (git(['rev-parse', 'HEAD'], { allowFail: true }) || '').trim();
  if (!/^[0-9a-f]{40}$/.test(head)) { console.error('stage-mine: HEAD unreadable — refusing.'); return 2; }
  const { rows, torn } = readLedgerRows();
  const results = [];
  const blobs = [];
  for (const file of files) {
    const entry = git(['ls-tree', head, '--', file], { allowFail: true }) || '';
    const m = /^\d{6}\s+blob\s+([0-9a-f]{40})\s/.exec(entry);
    if (!m) { results.push({ file, error: 'not a blob at HEAD (untracked or a directory) — stage-mine only splits a tracked file; a new file has one author by construction' }); continue; }
    const headBlob = m[1];
    const headText = git(['show', `${head}:${file}`], { allowFail: true });
    let currentText;
    try { currentText = readFileSync(resolve(repo(), file), 'utf8'); } catch (e) { results.push({ file, error: `unreadable in the working tree (${e.code})` }); continue; }
    const diffText = git(['diff', '-U3', head, '--', file], { allowFail: true }) || '';
    const d = decideFile({ file, me, rows, headText: headText ?? '', currentText, diffText });
    results.push(d);
    if (d.content !== null) blobs.push({ file, headBlob, content: d.content });
  }

  // --json: stdout is the document and nothing else, so `| jq` can read it; the prose goes to stderr
  const say = (m) => (asJson ? console.error(m) : console.log(m));
  if (asJson) console.log(JSON.stringify({ session: String(me).slice(0, 8), ledgerTorn: torn, results }, null, 2));
  else {
    for (const r of results) {
      if (r.error) { console.log(`stage-mine: ${r.file} — ${r.error}`); continue; }
      console.log(`stage-mine: ${r.file} — ${r.hunks.length} hunk(s): ${r.mine} mine · ${r.theirs} theirs · ${r.shared} shared · ${r.unmatched} unmatched${r.searched ? '' : ' · SEARCH INCOMPLETE (window cap)'} · ${r.standingClaims} standing fingerprint(s) in the ledger`);
      for (const h of r.hunks) console.log(`  lines ${h.range[0]}-${h.range[1]}  ${h.state.toUpperCase().padEnd(9)} ${h.sessions.join(', ') || '(no fingerprint covers this hunk)'}`);
    }
    if (torn) console.log(`stage-mine: ${torn} torn ledger line(s) skipped`);
  }
  if (!land) {
    say(blobs.length ? `stage-mine: ${blobs.length} file(s) have hunks to land — re-run with --land -m <msg>` : 'stage-mine: nothing of yours to land');
    return blobs.length ? 0 : 1;
  }
  if (!blobs.length) { say('stage-mine: nothing of yours to land'); return 1; }
  const tmp = mkdtempSync(join(tmpdir(), 'cw-stage-mine-'));
  try {
    const args = ['-m', message];
    for (const b of blobs) {
      const p = join(tmp, b.file.replace(/[\\/]/g, '__'));
      writeFileSync(p, b.content);
      args.push('--from-blob', `${b.file}=${p}@${b.headBlob}`);
    }
    const r = execFileSync(process.execPath, [join(HERE, 'commit-phase.mjs'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, CW_COMMIT_REPO: repo() } });
    (asJson ? process.stderr : process.stdout).write(r);
  } finally {
    // fix: the frozen blobs outlived the land; commit-phase has read them by now, landed or refused
    rmSync(tmp, { recursive: true, force: true });
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  // fix: process.exit() dropped what stdout still held, cutting a piped --json at the 64KB buffer
  try { process.exitCode = main(); } catch (e) { console.error(`stage-mine: ${e.stderr || e.message}`); process.exitCode = 2; }
}
