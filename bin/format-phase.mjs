#!/usr/bin/env node
// bin/format-phase.mjs — remediation #19: the pre-commit formatting phase, built AROUND the two
// reasons it was deferred rather than despite them.
//
// REASON ONE, MADE STRUCTURAL (from the deferral): a formatter running before every commit would
// rewrite files other sessions hold uncommitted hunks in — admin/serve.mjs held three sessions'
// hunks the day this was written. So this phase never formats the tree and never sweeps by file
// type: it REFUSES any file that carries unstaged modifications on top of its staged state.
// Mixed staged/unstaged is the observable proxy for "a writer holds hunks here" that needs no
// session-identity oracle (the attribution ledger cannot supply one).
//
// REASON TWO, SURFACED AT REVIEW: the git INDEX IS SHARED — one .git/index for
// every session, GIT_INDEX_FILE unset. So "the staged set" is not this session's set, and a v1
// that formatted "whatever is staged" would format what ANOTHER session staged a second earlier,
// racing its own mixed-state check. Until remediation #1 (per-session indexes) lands, the only
// honest scoping is DECLARED, never inferred: the caller passes the exact paths it is about to
// commit — the same pathspec discipline the mesh already uses for `git add`/`git commit` — and
// this phase touches nothing outside that declaration. Staged files OUTSIDE the declared set are
// counted and warned about (a pathspec-less commit would sweep them in), never touched.
// The residual race — two sessions declaring the SAME file — is the pre-existing shared-tree
// collision, not a new one, and the mixed-state refusal catches its common shape. The full
// guarantee arrives with #1; v1 claims exactly what it can keep.
//
// REASON THREE, FROM A SECOND REVIEW: a file formatted AFTER staging no longer matches
// what was verified — the closure rule tracked-imports.test.mjs enforces by reading HEAD. So
// --write restages exactly the files it formatted (never -u, never -A), and nothing formatted
// can land unstaged-but-modified.
//
// WHAT "FORMATTING" MEANS IN v1 — git's own whitespace compliance, nothing stylistic:
//   · trailing spaces/tabs at end of line stripped — except Markdown, where trailing
//     double-space is a hard line break the format defines; .md keeps line interiors verbatim
//   · exactly one newline at end of file
// Deliberately NOT a style pass: this repo carries measured pre-existing style drift in
// many-handed files, and a style rewrite is a diff someone must own on purpose.
//
// Never touched, refusal stated: binary files (NUL sniff), test fixtures (verbatim tool output —
// a cleaned byte changes what the test proves), unreadable files.
//
// usage: node bin/format-phase.mjs [--check | --write] -- <path>…
//   --check (default)  report violations among the declared, cleanly-staged files; exit 1 if any
//   --write            fix them and restage exactly those files; exit 0
// No declared paths is an ERROR, not an implicit "all staged" — that inference is the shared-index
// trap this header documents.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isMainModule } from '../lib/is-main.mjs';

const FIXTURE_RE = /(^|\/)test\/fixtures\//;
const MD_RE = /\.(md|markdown)$/i;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

/** Staged (A/C/M) files and files with unstaged modifications — the SHARED sets, read for
 *  cross-checking a declaration, never as a source of scope. */
export function stagedState() {
  const staged = new Set(git('diff', '--cached', '--name-only', '--diff-filter=ACM').split('\n').filter(Boolean));
  const unstaged = new Set(git('diff', '--name-only').split('\n').filter(Boolean));
  return { staged, unstaged };
}

const looksBinary = (buf) => buf.subarray(0, 8192).includes(0);

/**
 * The v1 transform. Pure: bytes in, {out, changed} back. Markdown keeps line interiors verbatim
 * and only gains the EOF newline; CRLF files keep their CRs — v1 does not relitigate EOLs.
 */
export function formatBytes(buf, { markdown = false } = {}) {
  let text = buf.toString('utf8');
  if (!markdown) text = text.replace(/[ \t]+(?=\r?\n)/g, '').replace(/[ \t]+$/, '');
  text = text.replace(/\n+$/, '\n');
  if (!text.endsWith('\n')) text += '\n';
  const out = Buffer.from(text, 'utf8');
  return { out, changed: !out.equals(buf) };
}

/**
 * Classify each DECLARED file against the shared staged/unstaged sets. Pure given inputs.
 * Verdicts: 'clean' | 'needs-format' | 'refused' (with reason) | 'not-staged' (declared but the
 * caller has not staged it — nothing to protect yet, nothing touched).
 */
export function classify(declared, staged, unstaged, readFile = (f) => readFileSync(f)) {
  const rows = [];
  for (const file of declared) {
    if (!staged.has(file)) {
      rows.push({ file, verdict: 'not-staged' });
      continue;
    }
    if (unstaged.has(file)) {
      rows.push({ file, verdict: 'refused', reason: 'staged AND unstaged hunks — a writer holds uncommitted work here; formatting would rewrite under them. Sequence with that session, or let them land first.' });
      continue;
    }
    if (FIXTURE_RE.test(file)) {
      rows.push({ file, verdict: 'refused', reason: 'test fixture — verbatim tool output; a cleaned byte changes what the test proves' });
      continue;
    }
    let buf;
    try { buf = readFile(file); } catch (e) {
      rows.push({ file, verdict: 'refused', reason: `unreadable (${e.code || 'error'}) — refusing to classify what could not be read` });
      continue;
    }
    if (looksBinary(buf)) {
      rows.push({ file, verdict: 'refused', reason: 'binary content' });
      continue;
    }
    const { changed } = formatBytes(buf, { markdown: MD_RE.test(file) });
    rows.push({ file, verdict: changed ? 'needs-format' : 'clean' });
  }
  return rows;
}

function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const dashdash = argv.indexOf('--');
  const declared = dashdash === -1 ? [] : argv.slice(dashdash + 1);
  if (!declared.length) {
    console.error('format-phase: no declared paths. Pass the exact files you are committing after `--`.');
    console.error('  The staged set is NOT a substitute: the index is shared across sessions, so "format');
    console.error('  what is staged" formats other sessions\' staging (see the header; full fix is remediation #1).');
    return 2;
  }

  const { staged, unstaged } = stagedState();
  const rows = classify(declared, staged, unstaged);
  const refused = rows.filter((r) => r.verdict === 'refused');
  const needs = rows.filter((r) => r.verdict === 'needs-format');
  const notStaged = rows.filter((r) => r.verdict === 'not-staged');

  for (const r of refused) console.error(`format-phase: REFUSED ${r.file} — ${r.reason}`);
  for (const r of notStaged) console.error(`format-phase: not staged (declared, untouched): ${r.file}`);

  // The shared-index disclosure: staged work OUTSIDE the declaration is someone's (possibly this
  // session's own earlier) staging that a pathspec-less commit would sweep in. Counted, named,
  // never touched.
  const foreign = [...staged].filter((f) => !declared.includes(f));
  if (foreign.length) {
    console.error(`format-phase: ${foreign.length} staged file(s) OUTSIDE your declared set (shared index): ${foreign.slice(0, 6).join(', ')}${foreign.length > 6 ? ` … +${foreign.length - 6}` : ''}`);
    console.error('  A pathspec-less `git commit` would carry them. Commit with your pathspec, or coordinate.');
  }

  if (!write) {
    for (const r of needs) console.error(`format-phase: needs formatting: ${r.file} (run with --write, or fix by hand)`);
    console.log(`format-phase: ${rows.length} declared · ${needs.length} need formatting · ${refused.length} refused · ${notStaged.length} not staged · ${foreign.length} foreign-staged`);
    // The 54-rule: format-clean is NOT commit-safe. A file can be individually clean and still
    // import something untracked — closure over the change set is tracked-imports' job, and a
    // green line here must never be read as clearance to commit.
    if (!needs.length) console.log('format-phase: format-clean only — closure over the change set is a separate gate (bin/test/tracked-imports.test.mjs)');
    return needs.length ? 1 : 0;
  }

  for (const r of needs) {
    const buf = readFileSync(r.file);
    const { out } = formatBytes(buf, { markdown: MD_RE.test(r.file) });
    writeFileSync(r.file, out);
    git('add', '--', r.file);              // restage exactly this file — the 23-rule: nothing formatted lands unverified
    console.log(`format-phase: formatted + restaged ${r.file}`);
  }
  console.log(`format-phase: ${needs.length} formatted · ${refused.length} refused (left for their holders) · ${rows.length - needs.length - refused.length - notStaged.length} already clean`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exit(main());
}
