#!/usr/bin/env node
// bin/worktree-imports.mjs — the WORKING TREE half of the import guard, split out from the HEAD half.
//
// WHY THESE ARE TWO TOOLS AND NOT ONE. bin/test/tracked-imports.test.mjs answers "is HEAD sound for
// everyone" — the property a fresh clone depends on. It used to answer that in one half and, in its
// V8 cross-check, quietly answer "is the tree sound right now" in the other: it listed files from
// the index and read their contents from disk. Two questions under one verdict, and on a checkout
// nine sessions share the second one is red most of the time for reasons no commit can fix.
// Measured 2026-09-07: the suite failed on a file that parses perfectly at HEAD because a peer held
// 114 uncommitted insertions in it. A gate that reddens on somebody else's half-finished edit is one
// everybody learns to scroll past, which is how a real breakage gets missed later.
//
// So the suite now judges HEAD only, and the tree question moves here — where it can be asked
// deliberately, by the person whose edits it is about, and where a finding is a report rather than a
// failure somebody else has to explain.
//
// THREE DIFFERENT FINDINGS. The first is about now; the other two are about what a commit would do,
// and they are separated because they have opposite remedies.
//
//   broken-now  — a relative import whose target does not exist on disk. Your tree is broken this
//                 second; node will throw when anything loads that file.
//
//   would-break-HEAD — the target exists on disk but is in neither HEAD nor the index. Everything
//                 works for you and nothing works for anyone else the moment this file is committed
//                 without its dependency. It is the shape that put an untracked module under 111
//                 importers on 2026-09-09, where any single pathspec commit would have broken HEAD.
//                 Remedy: ADD the target.
//
//   staged-deletion — the target is tracked at HEAD but staged for removal, so committing that
//                 staged set breaks every importer still naming it. Found live on this tool's first
//                 corrected run: admin/lib/adjudication-triage.mjs, imported by verdicts.mjs and its
//                 own test. Remedy: UNSTAGE the deletion, or remove the importers in the same set —
//                 the opposite action to the case above, which is why they cannot share a label.
//
// EXIT CODES ARE REAL, but nothing is wired to them yet — deliberately. This is runnable and
// unenforced on the same precedent as the docs gate: a check earns enforcement by being right for a
// while first, and this one has never run.
//
// usage:
//   node bin/worktree-imports.mjs              report both findings over the working tree
//   node bin/worktree-imports.mjs --json
//   node bin/worktree-imports.mjs --staged     only paths that are staged (what a commit would land)
//
// exit: 0 clean · 1 findings · 2 could not determine

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relativeSpecifiers, candidatesFor } from './lib/tracked-imports.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const CW = () => process.env.CW_COMMIT_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..');

const git = (args) => execFileSync('git', ['-C', CW(), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * TWO sets, because `git ls-files` reports the INDEX and not the commit, and this tool was wrong
 * about a live file for exactly that reason before the distinction existed.
 *
 * Measured 2026-09-10: admin/lib/adjudication-triage.mjs is absent from `ls-files`, so the first
 * version called it untracked and told the author to "land it in the same pathspec". It is tracked
 * at HEAD and present in `git archive HEAD`; a peer had STAGED ITS DELETION. The hazard was real and
 * the diagnosis was wrong, which is worse than silence — the remedy it printed would have had the
 * author add a file that is already there.
 *
 * So the three states are kept apart: in HEAD and in the index (fine), in HEAD but staged for
 * deletion (committing that deletion breaks its importers), in neither (genuinely new).
 */
export function trackedSets() {
  const index = new Set(git(['ls-files']).split('\n').filter(Boolean));
  const head = new Set(git(['ls-tree', '-r', 'HEAD', '--name-only']).split('\n').filter(Boolean));
  return { index, head };
}

/** Source files present on disk. Untracked ones are INCLUDED: a new file can dangle too. */
export function worktreeSources({ stagedOnly = false } = {}) {
  const listed = stagedOnly
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    : git(['ls-files', '--cached', '--others', '--exclude-standard']);
  return listed.split('\n').filter(Boolean)
    .filter((f) => /\.mjs$/.test(f) && !f.startsWith('.claude/') && !f.startsWith('workflows/'))
    .filter((f) => stagedOnly || existsSync(join(CW(), f)));
}

/**
 * Classify each relative import of each file.
 *
 * `candidatesFor` returns every path node would try (extension and index forms), so a specifier is
 * resolved if ANY candidate exists — and tracked only if the candidate that resolved is tracked.
 * Checking trackedness against a candidate that does not exist would report a phantom.
 */
export function classify(files, { index, head }, { read = (f) => readFileSync(join(CW(), f), 'utf8'), exists = (f) => existsSync(join(CW(), f)) } = {}) {
  const brokenNow = [];
  const wouldBreakHead = [];
  const stagedDeletion = [];
  const unreadable = [];
  for (const f of files) {
    let src;
    try { src = read(f); } catch (e) { unreadable.push({ file: f, reason: e?.code || String(e) }); continue; }
    // Only a file that IS or WILL BE in the repo can break HEAD by being committed. An untracked
    // file importing an untracked file lands both or neither, and reporting it is noise the author
    // cannot act on. The pair that bites is repo-file-imports-missing-file.
    const importerCounts = index.has(f) || head.has(f);
    for (const spec of relativeSpecifiers(src)) {
      const candidates = candidatesFor(f, spec);
      const onDisk = candidates.find(exists);
      if (!onDisk) { brokenNow.push({ file: f, spec, candidates }); continue; }
      if (!importerCounts) continue;
      if (index.has(onDisk)) continue;                       // in the index — a commit carries it
      if (head.has(onDisk)) stagedDeletion.push({ file: f, spec, target: onDisk });
      else wouldBreakHead.push({ file: f, spec, target: onDisk });
    }
  }
  return { brokenNow, wouldBreakHead, stagedDeletion, unreadable };
}

/**
 * Readers for --staged mode: content comes from the INDEX, not the disk.
 *
 * THE SAME DEFECT THIS TOOL WAS SPLIT OUT TO FIX, reproduced here within the hour. --staged listed
 * staged PATHS and then read their content from the working tree, which is the index/worktree
 * surface mix that made the old cross-check unreliable. Measured immediately: the staged
 * admin/routes/verdicts.mjs has already dropped its import of the staged-for-deletion module (0
 * occurrences), while the worktree copy still carries it (1). So --staged reported that committing
 * would break an importer, about a change set that is internally consistent.
 *
 * The mode exists to answer "what would this commit contain", and only the index can answer it.
 * `exists` becomes index membership for the same reason: a file on disk that is not staged is not
 * in the commit.
 */
export function stagedReaders(index) {
  return {
    read: (f) => execFileSync('git', ['-C', CW(), 'show', `:${f}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
    exists: (f) => index.has(f),
  };
}

function main(argv) {
  const asJson = argv.includes('--json');
  const stagedOnly = argv.includes('--staged');
  let tracked;
  let files;
  try {
    tracked = trackedSets();
    files = worktreeSources({ stagedOnly });
  } catch (e) {
    console.error(`worktree-imports: could not enumerate — ${e?.message || e}. Nothing was checked, which is not a pass.`);
    return 2;
  }
  if (files.length === 0) {
    console.log(`worktree-imports: no source files ${stagedOnly ? 'staged' : 'in the tree'} — nothing to check.`);
    return 0;
  }
  const r = classify(files, tracked, stagedOnly ? stagedReaders(tracked.index) : undefined);

  if (asJson) {
    console.log(JSON.stringify({ generated: process.env.CW_NOW || new Date().toISOString(), scanned: files.length, ...r }, null, 2));
  } else {
    console.log(`worktree-imports: ${files.length} source file(s) ${stagedOnly ? 'staged' : 'on disk'}.`);
    for (const b of r.brokenNow) {
      console.log(`  BROKEN NOW        ${b.file} -> ${b.spec}`);
      console.log(`                    no candidate exists on disk (${b.candidates.slice(0, 2).join(', ')}…)`);
    }
    for (const w of r.wouldBreakHead) {
      console.log(`  WOULD BREAK HEAD  ${w.file} -> ${w.spec}`);
      console.log(`                    ${w.target} exists but is UNTRACKED — land it in the same pathspec, or first`);
    }
    for (const d of r.stagedDeletion) {
      console.log(`  STAGED DELETION   ${d.file} -> ${d.spec}`);
      console.log(`                    ${d.target} is tracked at HEAD but STAGED FOR DELETION — committing that deletion breaks this importer`);
    }
    for (const u of r.unreadable) console.log(`  UNREADABLE        ${u.file} (${u.reason}) — excluded, not treated as clean`);
    if (!r.brokenNow.length && !r.wouldBreakHead.length && !r.stagedDeletion.length) {
      console.log('  clean — every relative import resolves on disk, and every target a tracked file imports is tracked.');
    }
  }
  // Unreadable files do not make the run a failure, but they do make it undetermined: a file nobody
  // could open is not a file that passed.
  if (r.brokenNow.length || r.wouldBreakHead.length || r.stagedDeletion.length) return 1;
  return r.unreadable.length ? 2 : 0;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
