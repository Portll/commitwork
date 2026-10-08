#!/usr/bin/env node
// PostToolUse hook — record WHICH SESSION touched WHICH FILE, in WHICH working tree
// (.claude/store/touches.jsonl by default).
//
// That path used to read `.claude/touches.jsonl` HERE, in the writer's own header, while the
// writer had already moved. A stale docstring is the one place a reader
// checks before grepping, so it sends them to a path that returns nothing — and nothing reads as
// "no owner", not as "wrong file". docs/TRAPS.md records the cost: eight places in this repository
// still cited the dead path on 2026-08-27, one of them a string a GATE PRINTS at sessions telling
// them to consult it, and it produced a real misattribution.
//
// Deliberately tiny and unfailing: append-only JSONL, no locking, every error path exits 0 —
// losing an attribution record is a nuisance, interrupting an edit is not acceptable.
//
// Registered as: PostToolUse matcher "Edit|Write|NotebookEdit|Bash".
//
// fact: bash is in that matcher (2026-08-23) because the ledger only ever saw tool_input.file_path / a session editing through a shell heredoc, sed, python or `git apply` was INVISIBLE to the ownership oracle every attribution gate reads (expiry: never, prev: broken)
// fact: the blind spot tracked an agent's EDITING STYLE, so it was bias not noise — the same agent under-attributed run after run and its work reported as a co-author's / measured that day: monitor/projects.json edited three times by one session, ONE touch recorded, and bin/gate-ratchet.mjs called the resulting drift "theirs" while 12 drifted anchors sat in files that session had committed (expiry: never, prev: broken)
//
// WHAT IS STILL NOT DONE, and why. The obvious fix — snapshot the working tree before/after and
// attribute the delta — is WRONG on this tree. ~28 sessions share one checkout, so "what changed
// since the last snapshot" attributes whatever anyone did to whoever snapshots next. That is P1
// blame-under-concurrency, the exact class this hook exists to serve. Inferred deltas stay out.
//
// WHAT A BASH CALL DOES CARRY (two signals, both observed, neither inferred):
// fact: via:'commit' is the sha `git commit` PRINTED, parsed from the command's own output / rev-parse HEAD moves under you here (expiry: never, prev: wrong)
// fact: via:'exec' records a repo script that command invoked plus the command line — a fact about what the session RAN (2026-08-24) / a session launched a sweep, was compacted, lost its own memory of the launch, and reported the still-running sweep as a co-session's work because the oracle had no record either way (expiry: never, prev: missing)
// fact: via:'exec' never looks at WRITES, so it cannot misattribute a co-session's / see bin/lib/touch-ledger-core.mjs for the soundness argument in full (expiry: never, prev: unknown)
//
// COST: the exec check is a regex over the command plus an existsSync per matched token — no git,
// no I/O on the common path. The git call still runs ONLY when the command was a commit and its
// output carried a sha. Every error path still exits 0.

import { existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { responseText, commitShaFrom, editFingerprints, execScriptsFrom, execWritesFrom, fitCommand } from './lib/touch-ledger-core.mjs';
import { touchAppender } from './lib/touch-ledger-append.mjs';
import { relativePosix } from '../lib/path-contain.mjs'; // the ledger key must not be separator-dependent

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The ledger path, the rotation seam and the append itself now live in
// lib/touch-ledger-append.mjs, so bin/commit-phase.mjs uses THIS writer rather than growing a
// second one — that file's header records what the absence of a shared writer cost.

let raw = '';
try { raw = await new Promise((res) => { let s = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (d) => { s += d; }); process.stdin.on('end', () => res(s)); setTimeout(() => res(s), 2000); }); }
catch { process.exit(0); }

try {
  const ev = JSON.parse(raw || '{}');
  const session = ev?.session_id;
  // No session id ⇒ no record — an unowned touch would read as somebody's.
  if (!session) process.exit(0);

  // fitRecord bounds each line inside the writer: ~28 sessions append with no lock, and the
  // no-lock design only holds while every append is one small write. An over-long path is trimmed,
  // never emitted whole — and never truncated, because PATH_MAX caps the only unbounded field.
  const append = touchAppender({ session, repo: REPO });
  const write = (rel, extra) => append({ f: rel, ...extra });

  const file = ev?.tool_input?.file_path || ev?.tool_input?.notebook_path;
  if (file) {
    // relativePosix(): the value below becomes `f`, the ledger's IDENTITY for this touch. On
    // Windows `relative()` yields `monitor\sweep.mjs` where every reader of this ledger expects
    // `monitor/sweep.mjs`, so an identity was keyed on a separator-dependent string — the same
    // class of defect as keying one on a line number, which CLAUDE.md bans by name. It also
    // subsumes the containment check: outside the repo is null.
    const rel = relativePosix(REPO, file);
    if (rel === null || rel === '') process.exit(0);  // outside the repo; not our business
    // h/n/t: the payload already carries the replaced and written text. Capturing it is two hashes
    // and no I/O. Absent fields stay ABSENT — a Write has no old_string, and emitting h:null there
    // would invent a fingerprint for content that never existed.
    // access: the payload carries the replaced and written text, so this is a write on evidence.
    write(rel, { ...editFingerprints(ev), access: 'write' });
    process.exit(0);
  }

  const command = ev?.tool_input?.command;

  // Bash, signal 1: a repo script this command INVOKED. Not a file delta — see the core header.
  // This is what makes a shell-launched writer (sweep.mjs, rollup.mjs, a scan script) attributable
  // at all; without it a session that starts a 3-hour sweep leaves no trace that it did.
  //
  // fact: an executed script goes under `x`, NEVER `f` / `f` means "this session WROTE this file" and ~40 call sites read it that way without inspecting `via` — attributeFiles() in bin/gate-tests-core.mjs matches on `f` alone (expiry: never, prev: broken)
  // fact: the first version emitted it under `f` and made `node --test x.test.mjs` claim ownership of x.test.mjs — in twenty minutes live it recorded a co-session as having "touched" monitor/detail-schema.mjs and two test files it had only RUN (expiry: never, prev: broken)
  // fact: under `x` the record is invisible to every existing reader BY CONSTRUCTION and a reader wanting execution history opts in / filtering at every reader is the fragile fix, and the one reader that forgets is a wrong blame assignment (expiry: never, prev: broken)
  // fact: a new record type must not redefine an old field / that is how a ledger that was right yesterday starts lying (expiry: never, prev: unknown)
  //
  // existsSync is the repo-membership test, so a path that is not a real file here is dropped
  // rather than recorded. The oracle DECIDES and NORMALISES: an absolute invocation and a relative
  // one naming the same file land under one key, not two.
  for (const rel of execScriptsFrom(command, (tok) => {
    try {
      const abs = resolve(REPO, tok);
      // POSIX: this is the key the comment above calls "one key, not two". A separator-dependent
      // one is two keys on two platforms for the same file.
      const r = relativePosix(REPO, abs);
      return (r && existsSync(abs)) ? r : null;
    } catch { return null; }
  })) {
    const { cmd, clipped } = fitCommand(command);
    append({ x: rel, via: 'exec', access: 'exec', cmd, ...(clipped ? { clipped: 1 } : {}) });
  }

  // Bash, signal 1b: a repo file this command WROTE. Recorded under `f`, because `f` means "this
  // session wrote this file" and a redirection is exactly that — the field's meaning reached by
  // another route, not redefined. `via:'shell'` keeps the route legible.
  //
  // TWO WITNESSES, and the second is the point. The command text says what was PROBABLY written;
  // the filesystem says what actually CHANGED. Syntax alone would repeat the defect this pair was
  // written to close: a redirection on a branch that never ran, or one whose target was already
  // there, is a write that did not happen. A candidate is recorded only if the path resolves inside
  // this repo AND its mtime moved within the window, and those two cannot fail the same way.
  //
  // The window is deliberately tight. A generous one starts collecting files that some OTHER
  // session wrote while this command was running, and a confident wrong owner is worse than no
  // owner — which is the whole argument the narrowing above rests on.
  const WRITE_WINDOW_MS = 120_000;
  for (const rel of execWritesFrom(command, (tok) => {
    try {
      const r = relativePosix(REPO, resolve(REPO, tok));   // POSIX: this becomes the ledger key
      return r ? r : null;
    } catch { return null; }
  })) {
    try {
      const st = statSync(resolve(REPO, rel));
      if (!st.isFile() || Date.now() - st.mtimeMs > WRITE_WINDOW_MS) continue;
      write(rel, { via: 'shell', access: 'write' });
    } catch { /* absent means it was not written; silence is the honest record */ }
  }

  // R-A · WRITE DETECTION BY EFFECT. The block above only ever confirms paths the PARSER named, so
  // the parser is the recall ceiling: a `python3 - <<'PY'` heredoc, a `sed -i`, or any script whose
  // form the regex does not know produces a row indistinguishable from a read. Measured 2026-08-30 —
  // one session authored six files and was recorded as writing zero; bin/adjudication-sampler.mjs
  // held 450 touches and 0 write rows while its hunk demonstrably existed.
  //
  // `git status --porcelain` answers "what in this tree differs from HEAD" without needing a
  // before-snapshot, and git's index cache makes it ~73ms. The mtime window is what makes it MINE
  // rather than merely dirty — and it is deliberately tighter than the parser-confirmed window
  // above, because that one starts from a name this command actually contained.
  //
  // OFF AGAIN 2026-08-30, ~20:00, under the standing rule that a regression is reverted to
  // last-known-good BEFORE it is re-planned. Enabled earlier the same evening on operator
  // instruction; a peer then measured it inventing an author.
  //
  // WHAT WENT WRONG, stated so it is not re-enabled by someone reading only the falsifier. This
  // block records a row for EVERY dirty path whose mtime falls inside the window, with no test that
  // THIS session caused the change. On a checkout eleven sessions write, that is a race: a peer
  // running any Bash command within 15s of another session's write records that file as theirs.
  // Measured against `monitor/release-redactions.json` — a file created by one session and attributed
  // to a second whose edit set had been stable at six files for twenty-plus firings.
  //
  // The §11 claim that R-C makes this safe was INCOMPLETE. R-C's evidence filter guards the tests
  // gate's `unevidenced` bucket. The SPINE gate's edit count reads no such filter, so the false row
  // reaches a consumer that cannot see it is unproven. One consumer was verified and the result
  // generalised to all of them — the same error this cycle has been correcting elsewhere.
  //
  // Re-enabling requires a per-session causal test, not a wider window: something that ties the
  // change to THIS command rather than to its timing. `CW_LEDGER_FS_DELTA=1` still turns it on for
  // a single session that wants it.
  if (process.env.CW_LEDGER_FS_DELTA === '1') {
    try {
      const FS_WINDOW_MS = Number(process.env.CW_LEDGER_FS_WINDOW_MS) || 15_000;
      const named = new Set(execWritesFrom(command, (tok) => {
        try {
          const r = relativePosix(REPO, resolve(REPO, tok));  // POSIX: this becomes the ledger key
          return r ? r : null;
        } catch { return null; }
      }));
      const porcelain = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '-z'],
        { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] });
      const fields = porcelain.split('\0');
      for (let i = 0; i < fields.length; i++) {
        const entry = fields[i];
        if (!entry || entry.length < 4) continue;
        // R3 · RENAME AND COPY CONSUME TWO FIELDS. Porcelain v1 `-z` emits `XY NEW\0ORIG\0`, and the
        // second is a BARE PATH with no `XY ` prefix, so slice(3) mangles it — and for a nested path
        // it yields an ABSOLUTE one (`/deep-original.txt`), which resolve(REPO, …) then honours,
        // escaping the repository. Latent today (0 renames in the tree), fixed in the same pass.
        const xy = entry.slice(0, 2);
        const rel = entry.slice(3);
        if (xy[0] === 'R' || xy[0] === 'C') i++;   // consume ORIG; it is not separately dirty
        if (named.has(rel)) continue;             // already recorded above, with better standing
        // R3 · CONTAINMENT — guards every other path in this hook and was missing from here.
        const abs = resolve(REPO, rel);
        const within = relativePosix(REPO, abs);           // null when outside; POSIX when inside
        if (!within) continue;
        let st;
        try { st = statSync(abs); } catch { continue; }
        if (!st.isFile() || Date.now() - st.mtimeMs > FS_WINDOW_MS) continue;
        // R1 · UNDER `d`, NEVER `f`. `f` means "this session WROTE this file" and ~40 call sites read
        // it that way without inspecting `via`; this hook's own doctrine above says a new record type
        // must not redefine an old field, because that is how a ledger that was right yesterday
        // starts lying. This block has ONE witness — mtime — and mtime is exactly the witness that
        // cannot tell my write from a peer's. Measured 2026-08-30: a genuine write at 10:12:36Z
        // produced false rows against two OTHER sessions 11.0s and 10.5s later, and one session with
        // three real files was reported as thirteen.
        //
        // Under `d` the row is TRUE — "this session observed `d` change inside its window" is a fact
        // it can prove — and every existing reader drops it, because they all guard on `f`.
        // The cost is honest: nothing reads it until a reader opts in, so recall gains nothing yet.
        // Same trade the `x` split accepted, and the right way round: no recall beats false blame.
        append({ d: rel, via: 'fs-delta', access: 'undetermined' });
      }
    } catch { /* a detection that cannot run records nothing; it never breaks the tool call */ }
  }

  // Bash, signal 2: a commit this command created (see the header). `via:'commit'`
  // marks these as commit-derived, so a reader can tell a proven authorship record from a touch.
  const sha = commitShaFrom(command, responseText(ev));
  if (!sha) process.exit(0);
  const out = execFileSync('git', ['-C', REPO, 'show', '--name-only', '--format=', sha], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
  for (const f of out.split('\n').map((x) => x.trim()).filter(Boolean)) write(f, { via: 'commit', access: 'write', sha });
} catch { /* never interrupt an edit */ }

process.exit(0);
