#!/usr/bin/env node
// anchor-triage — group anchor-changed findings by the commits that rewrote their line, so one
// human verdict disposes of N findings instead of N verdicts.
//
// Read-only. Writes nothing, dispositions nothing, and proposes no closure: `git log -S` proves a
// line left the tree, never that the DEFECT left. Measured on this repo 2026-08-22: of 24
// anchor-changed rows, ZERO were attributable to a single session — every line had been touched by
// two or more. A tier that auto-proposes on sole authorship would carry no traffic on a tree this
// concurrent, so there is no such tier. The win is grouping: those 24 rows collapse to a handful of
// commit-groups, and the question becomes "these commits rewrote this region — do these findings
// still apply?", which is one diff to read.
//
// usage: node bin/anchor-triage.mjs [--in <anchor-staleness.json>] [--json] [--file <path>]
// exit:  0 groups emitted (or nothing triageable) · 2 unreadable input / read nothing

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { auditDirFor } from '../monitor/store-paths.mjs';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { HOME_PLACEHOLDER } from './anchor-staleness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

// env read at CALL time, never at module load — a const here defeats every test override
const inPath = () => resolve(CW, val('--in', process.env.CW_ANCHOR_STALENESS
  || join(auditDirFor(CW), 'anchor-staleness.json')));
// The repository whose history is searched: this checkout, unless a test points it at a fixture repo.
const repoRoot = () => (process.env.CW_ANCHOR_TRIAGE_ROOT ? resolve(process.env.CW_ANCHOR_TRIAGE_ROOT) : CW);

// A line too short to be distinctive matches half the tree; -S on it is noise, not evidence.
const MIN_SEARCHABLE = 12;

/** The searchable pieces of an excerpt. anchor-staleness normalises home directories to
 *  HOME_PLACEHOLDER, which git never contains, so a search must go by the text either side of it.
 *  Longest first; empty when nothing clears MIN_SEARCHABLE. An excerpt with no placeholder is its
 *  own single fragment, so the common case is unchanged. */
export function searchFragments(text) {
  return String(text ?? '').split(HOME_PLACEHOLDER)
    .map((s) => s.trim()).filter((s) => s.length >= MIN_SEARCHABLE)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function readStaleness(path) {
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) {
    // fail closed: only ENOENT is "absent", everything else is a real failure
    if (e.code === 'ENOENT') throw new Error(`no anchor-staleness report at ${path} — run bin/anchor-staleness.mjs first`);
    throw new Error(`anchor-staleness report at ${path} is unreadable (${e.message}) — refusing to report zero groups from a file I could not parse`);
  }
  if (!doc || !Array.isArray(doc.results)) throw new Error(`${path} has no results[] — wrong shape, not an empty queue`);
  return doc;
}

/** Commits between baseline and HEAD that changed the OCCURRENCE COUNT of `text` in `file`. */
export function commitsTouching(text, file, baseline, { cwd = CW, git = execFileSync } = {}) {
  try {
    const out = git('git', ['-C', cwd, 'log', '--format=%h\t%s', '-S', text, `${baseline}..HEAD`, '--', file],
      { encoding: 'utf8', maxBuffer: 5e7 });
    return out.split('\n').filter(Boolean).map((l) => {
      const [sha, ...rest] = l.split('\t');
      return { sha, subject: rest.join('\t') };
    });
  } catch { return null; }   // null = could not ask, distinct from [] = asked, nothing found
}

// git injected here too — it was execFileSync directly, so triage() reached the live repo mid-run
// and could not be tested in isolation.
const stillPresent = (fragments, file, { cwd = CW, git = execFileSync } = {}) => {
  // fact: a file absent from HEAD is the catch, not a stderr line
  try {
    const head = git('git', ['-C', cwd, 'show', `HEAD:${file}`], { encoding: 'utf8', maxBuffer: 5e7, stdio: ['ignore', 'pipe', 'ignore'] });
    return fragments.every((f) => head.includes(f));
  } catch { return false; }    // file gone at HEAD
};

/** Split rows into triageable groups and explicitly-skipped buckets. Never guesses. */
export function triage(doc, { cwd = CW, git = execFileSync } = {}) {
  const baseline = doc.baseline;
  if (!baseline) throw new Error('report carries no baseline ref — cannot scope the search');
  const rows = doc.results.filter((r) => r.state === 'anchor-changed');
  const skipped = { fileDeleted: [], noBaseline: [], unsearchable: [], moved: [], noEvidence: [] };
  const byGroup = new Map();

  for (const r of doc.results) {
    if (r.state === 'file-deleted') { skipped.fileDeleted.push(r); continue; }
    if (r.state === 'no-baseline') { skipped.noBaseline.push(r); continue; }
  }
  for (const r of rows) {
    const frags = searchFragments(r.wasText);
    // Ambiguous by construction: a vanished file may be a fix or a wholesale move. Never grouped.
    if (!frags.length) { skipped.unsearchable.push(r); continue; }
    if (stillPresent(frags, r.file, { cwd, git })) { skipped.moved.push(r); continue; }
    const commits = commitsTouching(frags[0], r.file, baseline, { cwd, git });
    if (commits === null || !commits.length) { skipped.noEvidence.push(r); continue; }
    const key = commits.map((c) => c.sha).sort().join('+');
    if (!byGroup.has(key)) byGroup.set(key, { key, commits, findings: [] });
    byGroup.get(key).findings.push(r);
  }
  // deterministic: groups by size then key, findings by file:line
  const groups = [...byGroup.values()]
    .map((g) => ({ ...g, findings: g.findings.sort((a, b) => `${a.file}:${a.line}`.localeCompare(`${b.file}:${b.line}`)) }))
    .sort((a, b) => b.findings.length - a.findings.length || a.key.localeCompare(b.key));
  // stamp what this was computed against - both HEAD and the input report move under co-sessions,
  // so a grouping recorded without its pair cannot be re-derived. Observed 2026-08-22: the same
  // command gave 58 verdicts, then 47, then 58 again.
  let head = null;
  try { head = git('git', ['-C', cwd, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a repo */ }
  return { baseline, head, considered: rows.length, groups, skipped };
}

function main() {
  const path = inPath();
  let doc, inputHash = null;
  try {
    doc = readStaleness(path);
    inputHash = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
  } catch (e) { console.error(`anchor-triage: ${e.message}`); process.exit(2); }
  let out;
  try { out = triage(doc, { cwd: repoRoot() }); } catch (e) { console.error(`anchor-triage: ${e.message}`); process.exit(2); }
  out.input = { path: path.replace(`${CW}/`, ''), sha256: inputHash };

  const only = val('--file', null);
  const groups = only ? out.groups.filter((g) => g.findings.some((f) => f.file === only)) : out.groups;
  const grouped = groups.reduce((n, g) => n + g.findings.length, 0);
  const skipTotal = Object.values(out.skipped).reduce((n, a) => n + a.length, 0);

  // A run that grouped nothing AND skipped nothing read nothing. Say so rather than print a clean sheet.
  if (!out.considered && !skipTotal) {
    console.error('anchor-triage: the report contains no anchor-changed, file-deleted or no-baseline rows — nothing was read, which is not the same as nothing to do');
    process.exit(2);
  }

  if (flag('--json')) { console.log(JSON.stringify({ ...out, groups }, null, 2)); return; }

  const multi = groups.filter((g) => g.findings.length > 1);

  // --summary: one line for a consumer that has no room for the full listing (the drift ratchet).
  // States the reduction AND the singleton count, because the reduction alone reads as a bigger
  // saving than it is - 43 of 58 verdicts covered one finding each when this was measured.
  if (flag('--summary')) {
    const top = groups[0];
    const ungrouped = out.considered - grouped;
    // Only the buckets fed BY anchor-changed rows may explain `ungrouped`. fileDeleted and
    // noBaseline are separate states that were never in `considered`, so listing them here made
    // the reasons sum to 55 against a count of 7.
    const FROM_CONSIDERED = ['unsearchable', 'moved', 'noEvidence'];
    const why = FROM_CONSIDERED.filter((k) => out.skipped[k].length)
      .map((k) => `${out.skipped[k].length} ${k}`).join(', ');
    const aside = ['fileDeleted', 'noBaseline'].filter((k) => out.skipped[k].length)
      .map((k) => `${out.skipped[k].length} ${k}`).join(', ');
    // grouped=0 must NEVER read as "nothing to look at". It is the opposite: every drifted
    // finding needs its own read. Printing "0 group into 0" under a rising drift alarm was a
    // false clean in this very line, caught before it shipped.
    if (!grouped) {
      console.log(`NONE of ${out.considered} drifted finding(s) could be grouped — each needs its own read`
        + (why ? ` (${why})` : '') + ` · ${out.baseline}..${out.head || 'HEAD'} · input @${out.input.sha256}`);
      return;
    }
    console.log(`${grouped} of ${out.considered} drifted finding(s) group into ${groups.length} verdict(s) `
      + `(${groups.length - multi.length} singleton, ${multi.length} covering ${multi.reduce((n, g) => n + g.findings.length, 0)})`
      + (top && top.findings.length > 1 ? `; largest is ${top.findings.length} rewritten by ${top.commits.map((c) => c.sha).join('+')}` : '')
      + (ungrouped > 0 ? `; ${ungrouped} NOT grouped (${why})` : '')
      + (aside ? `; separately ${aside}, never anchor-changed` : '')
      + ` · ${out.baseline}..${out.head || 'HEAD'} · input @${out.input.sha256}`);
    return;
  }

  console.log(`anchor-triage @ ${out.baseline}..${out.head || 'HEAD'} · input ${out.input.path}@${out.input.sha256}`);
  console.log(`${out.considered} anchor-changed, ${grouped} grouped into ${groups.length} verdict(s)`);
  // the headline group is not the distribution - say where the saving actually is
  console.log(`of those, ${groups.length - multi.length} are singletons; ${multi.length} verdicts cover ${multi.reduce((n, g) => n + g.findings.length, 0)} findings\n`);
  for (const g of groups) {
    console.log(`── ${g.findings.length} finding(s) · rewritten by ${g.commits.length} commit(s)`);
    for (const c of g.commits) console.log(`     ${c.sha}  ${c.subject.slice(0, 88)}`);
    for (const f of g.findings) console.log(`   · ${f.file}:${f.line}  ${String(f.summary || '').trim().slice(0, 76)}`);
    console.log(`   → one question: did these commits resolve these ${g.findings.length}? (no proposal is made here)\n`);
  }
  console.log('NOT GROUPED, and why — each needs its own read:');
  console.log(`  ${out.skipped.moved.length}\tline still present at HEAD (moved, not removed)`);
  console.log(`  ${out.skipped.unsearchable.length}\tanchored text too short to search distinctively`);
  console.log(`  ${out.skipped.noEvidence.length}\tno commit changed this line's occurrence count`);
  console.log(`  ${out.skipped.fileDeleted.length}\tfile deleted — fix or wholesale move, indistinguishable here`);
  console.log(`  ${out.skipped.noBaseline.length}\tno baseline anchor recorded`);
  console.log('\nNothing above is a disposition. -S proves a line left the tree, never that the defect did.');
}

if (isMainModule(import.meta.url)) main();
