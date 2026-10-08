// Pure half of the touch-ledger hook, split out because the hook itself reads stdin and exits at
// module load — importing it to test it would hang. Same shape as gate-ratchet-core / gate-spine-core.

/** The tool's output, whichever shape the harness hands over (string, content blocks, or an object). */
export function responseText(ev) {
  const r = ev?.tool_response;
  if (typeof r === 'string') return r;
  if (Array.isArray(r)) return r.map((b) => (typeof b === 'string' ? b : b?.text || '')).join('\n');
  if (r && typeof r === 'object') return [r.stdout, r.stderr, r.output, r.text].filter(Boolean).join('\n');
  return '';
}

/**
 * The sha a `git commit` just created, from the command's OWN output, or null.
 *
 * Both halves are load-bearing. The command must look like a commit invocation, so `git log`,
 * `git show` or a message merely containing the word "commit" cannot qualify — otherwise an
 * unrelated command would bank whatever HEAD happens to be against this session, which on a
 * 28-session tree is usually somebody else's commit. And the sha must come from the output rather
 * than from `rev-parse HEAD`, because HEAD moves under you here: a co-session committing between
 * this command and the hook would hand us their sha with perfect confidence.
 */
export function commitShaFrom(command, out) {
  if (!/\bgit\b[^|;&]*\bcommit\b/.test(String(command || ''))) return null;
  // git prints `[<branch> <sha>] <subject>` on success, `[<branch> (root-commit) <sha>]` on the
  // first one, `[detached HEAD <sha>]` off a branch — note that last one has a SPACE in the branch
  // part, so the sha is matched as the final token before `]` rather than the second.
  const m = /\[[^\]]*?\s([0-9a-f]{7,40})\]/.exec(String(out || ''));
  return m ? m[1] : null;
}

// ---- record size: the no-lock contract, MEASURED rather than assumed ---------------------------
// ~28 sessions append to .claude/store/touches.jsonl with NO LOCK. That rests on each append being a
// single write to an O_APPEND file, which the kernel serialises with the seek-to-end.
//
// PIPE_BUF IS THE WRONG CONSTANT HERE and it nearly cost a correctness bug. PIPE_BUF (512 on
// darwin) bounds atomic writes to PIPES. This is a regular file, where the guarantee holds far
// wider. Measured 2026-08-23 on APFS, 16 concurrent writers x 200 records: ZERO torn lines and zero
// lost lines at 120, 512, 1144, 2048, 4096 and 8192 bytes. Had 512 been adopted as the ceiling, a
// path longer than ~440 bytes would have been silently trimmed for no reason at all.
//
// SO NOTHING IS EVER TRUNCATED. macOS fixes PATH_MAX at 1024 (sys/syslimits.h), so the widest
// record this hook can physically construct — PATH_MAX path plus the widest envelope, a
// commit-derived row carrying a 40-char sha — is 1144 bytes. That is under the bound below with
// 3.5x margin, so the ceiling is provably unreachable for any real filesystem input. It exists as
// an assertion that this reasoning still holds, not as a trimmer: a truncated path is a WRONG path,
// and a wrong path in an ownership ledger is worse than a missing one.
export const MAX_RECORD_BYTES = 4096;

/** The widest record the hook can construct: PATH_MAX + the commit-derived envelope. */
export const WORST_CASE_RECORD_BYTES = 1144;

/**
 * Serialise a ledger record. NEVER truncates and never drops: returns { line, bytes, exceeds }.
 * `exceeds` is a diagnostic for a caller that wants to log the impossible, not permission to trim.
 */
export function fitRecord(rec, max = MAX_RECORD_BYTES) {
  const line = JSON.stringify(rec);
  const bytes = Buffer.byteLength(line) + 1;
  return { line, bytes, exceeds: bytes > max };
}

// ---- P1: the fingerprints the hook already receives ---------------------------------------------
// The PostToolUse payload carries old_string/new_string for Edit; the hook read file_path and threw
// the rest away. Capturing them is two hashes and no I/O. What this DOES NOT do is claim hunk
// ownership on top of them — supersession defeats that, which is why attribution has three states.
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { generations } from './ledger-rotate.mjs';

/** Short content fingerprint. 12 hex chars: collision-irrelevant here, and keeps the record small. */
export const fingerprint = (s) => (typeof s === 'string' && s.length
  ? createHash('sha256').update(s).digest('hex').slice(0, 12)
  : null);

/**
 * {h, n, t} for a tool event, omitting what does not exist rather than inventing it.
 * h = fingerprint of the text REPLACED, n = of the text WRITTEN, t = which tool.
 * A Write has no old_string; emitting h:null there would invent a fingerprint for absent content.
 */
export function editFingerprints(ev) {
  const ti = ev?.tool_input || {};
  const name = String(ev?.tool_name || '');
  const out = {};
  const h = fingerprint(ti.old_string);
  const n = fingerprint(ti.new_string ?? ti.content ?? ti.new_source);
  if (h) out.h = h;
  if (n) out.n = n;
  if (/notebook/i.test(name) || ti.notebook_path) out.t = 'notebook';
  else if (ti.old_string !== undefined) out.t = 'edit';
  else if (ti.content !== undefined) out.t = 'write';
  return out;
}

// ---- CLI-written stores: record the INVOCATION, never an inferred delta -------------------------
// The hook's header refuses to attribute file deltas to a session, and that refusal is correct: on a
// ~28-session checkout, "what changed since the last snapshot" attributes everyone's work to whoever
// looks next. This is a DIFFERENT signal and it does not share that flaw.
//
// A long-running writer launched from the shell — `node monitor/sweep.mjs all 100randomrepos` — wrote
// thousands of files under reports/ and left NOTHING linking them to the session that started it.
// Measured 2026-08-24: that session was compacted, lost its own memory of the launch, and then
// reported the running sweep as another session's work, because no record contradicted it. The
// ledger was the right place to look and was silent.
//
// What is recorded is `tool_input.command` — a fact about what this session RAN, observed directly,
// with no inference about which files moved. It cannot misattribute a co-session's writes because it
// never looks at writes at all. `via:'exec'` marks it, so a reader can tell "ran a writer" from
// "edited a file" from "made a commit"; none of the three is the others.
//
// TRUNCATION IS ALLOWED HERE, AND ONLY HERE. Paths are never trimmed because a truncated path is a
// WRONG path and silently names the wrong file. A command has no such failure mode — trimmed, it is
// still a legible record of what ran, and the head carries the entry point that identifies it. A
// command is also genuinely unbounded (heredocs, inline scripts), so the ceiling is load-bearing
// rather than theoretical the way the PATH_MAX bound above is.
export const MAX_CMD_CHARS = 300;

// Entry-point file extensions worth recording. A bare `git`/`ls`/`rg` is not a store writer.
// The leading `/?` is load-bearing and was MISSING until a vacuity test caught it: an absolute
// invocation — `node /opt/commitwork/monitor/rollup.mjs` — is the ordinary form when a command
// does not assume a cwd, and it was matching nothing at all. A `$VAR/` prefix is stripped so the
// common `bash $CW_ROOT/bin/scan.sh` idiom resolves by its remainder.
const SCRIPT_RE = /(?:^|[\s'"=])(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\/)?(\/?(?:[\w.@-]+\/)*[\w.@-]+\.(?:mjs|cjs|js|sh|py))\b/g;

/**
 * The repo-relative script(s) a shell command invoked, or [].
 *
 * `toRepoScript(token)` is injected so this stays pure, and it both DECIDES and NORMALISES: it
 * returns the canonical repo-relative path, or a falsy value to drop the token. Normalising is the
 * oracle's job because only it knows the repo root — an absolute path and a relative one naming the
 * same file must land in the ledger under ONE key, or the ownership oracle answers differently
 * depending on how the command happened to be typed.
 *
 * A token that does not resolve to a file IN the repo is DROPPED rather than guessed: an invented
 * entry in an ownership ledger is worse than a missing one.
 *
 * Order-preserving and de-duplicated after normalisation, so `bash x.sh && node y.mjs` records both
 * once each, and `node monitor/x.mjs && node $R/monitor/x.mjs` records one.
 */
// ---- P16: invoked vs merely named -------------------------------------------------------------
// SCRIPT_RE's delimiter class accepts a QUOTE, so a path inside a string literal matched as though
// it had been run. Measured 2026-08-29 against a real row: a python heredoc that edited
// sitemap/README.md and did `io.open('admin/serve.mjs')` was recorded as x:"admin/serve.mjs" — an
// execution claim about a file the command only read. The author and the true target were both
// established independently, so this is a confirmed instance, not a shape.
//
// fact: `x` claims INVOCATION, per this file's own contract four comments above / a token in
//   command position was run, one in a string literal, a flag value or an argument was named
//   (expiry: never, prev: broken)
// fact: narrowing to command position converts a FALSE POSITIVE into a known absence — the shell
//   heredoc that wrote the file was never visible to `f` anyway, which is the documented P13 /
//   silence is recoverable by looking elsewhere, a confident wrong name is not, because nothing
//   prompts the reader to look (expiry: never, prev: broken)
// fact: nothing is erased — the full command survives in `cmd` on every row that IS emitted, so a
//   reader wanting the mention has it, and no new field redefines an old one (expiry: never)
const ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const INTERP_RE = /^(?:node|deno|bun|npx|bash|sh|zsh|python3?|ruby|perl)$/;
// SCRIPT_RE's capture, anchored to a WHOLE shell word rather than to any delimiter.
const WORD_SCRIPT_RE = /^(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\/)?(\/?(?:[\w.@-]+\/)*[\w.@-]+\.(?:mjs|cjs|js|sh|py))$/;

/**
 * Repo scripts this command INVOKED. A path is invoked when it stands in command position: first
 * word of a segment (./x.sh, /abs/x.mjs), or the first non-flag word after an interpreter, after
 * leading VAR=value assignments are stepped over. Everything else the old regex caught was a
 * mention and is deliberately not recorded.
 */
// A heredoc BODY is data, not shell. Splitting the whole command on ;/&&/newline treats each body
// line as a segment, so a data line whose first word happens to resolve to a repo file is recorded
// as an executed script. Measured 2026-08-29 against this very function: a `python3 - <<'PYEOF'`
// whose body contained a bare `admin/serve.mjs` returned ["admin/serve.mjs"] for a command that
// executed no such file. That is precisely the "confident wrong name" this file's header forbids,
// and it is how a shell-mediated edit gets execution history attributed to an innocent module.
//
// An UNTERMINATED heredoc (a clipped command — fitCommand truncates) drops everything after it,
// which is the safe direction by this module's own rule: silence is recoverable by looking
// elsewhere, a confident wrong name is not.
function stripHeredocBodies(cmd) {
  if (!cmd.includes('<<')) return cmd;
  const out = [];
  let tag = null;
  for (const line of cmd.split('\n')) {
    if (tag !== null) {
      if (line.trim() === tag) tag = null;   // the closing delimiter ends the body
      continue;                              // every body line is data, never a segment
    }
    out.push(line);                          // the line bearing `<<TAG` is still real shell
    const m = /<<-?\s*(?:'([^']*)'|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*))/.exec(line);
    if (m) tag = m[1] ?? m[2] ?? m[3];
  }
  return out.join('\n');
}

export function execScriptsFrom(command, toRepoScript) {
  const cmd = String(command || '');
  if (!cmd) return [];
  const resolveTok = (raw) => {
    const rel = typeof toRepoScript === 'function' ? toRepoScript(raw) : (toRepoScript?.has?.(raw) ? raw : null);
    return (rel && typeof rel === 'string') ? rel : null;
  };
  const seen = new Set();
  for (const seg of stripHeredocBodies(cmd).split(/(?:&&|\|\||[;|\n])/)) {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length && ASSIGN_RE.test(words[i])) i += 1;
    if (i >= words.length) continue;
    let cand = words[i];
    if (INTERP_RE.test(cand.replace(/^.*\//, ''))) {
      let j = i + 1;
      while (j < words.length && words[j].startsWith('-')) j += 1;
      cand = words[j];
    }
    const m = cand ? cand.match(WORD_SCRIPT_RE) : null;
    const rel = m ? resolveTok(m[1]) : null;
    if (rel) seen.add(rel);
  }
  return [...seen];
}

// ---- P16, second half: shell-mediated WRITES ---------------------------------------------------
// Narrowing `x` to genuine invocations was correct and it was HALF a fix. It removed the residual
// signal without adding a real one, and the consequence was measured the same day: a session that
// had just committed 15 files across 8 commits held 23 ledger rows, every one via:exec, ZERO
// carrying `f` — and bin/gate-tests-core.mjs:82 skips every row without `f`. The gate then told
// that session "of the 591 files committed since the floor, YOU touched 0", about its own work.
//
// fact: `f` means "this session WROTE this file" and that is exactly what a redirection does, so
//   emitting under `f` reaches the field's meaning by another route rather than redefining it —
//   via:'shell' keeps the route visible to any reader who cares (expiry: never)
// fact: SYNTAX ALONE WOULD REPEAT P16 / a redirection that was never reached, or one whose target
//   is outside the repo, is a write that did not happen, and a confident wrong name is what this
//   whole class is about. The caller confirms each candidate against the filesystem before it is
//   recorded; that check cannot fail the way the parser fails (expiry: never, prev: broken)
// fact: 2>&1 and >&2 are NOT writes to a path / they redirect a descriptor, and treating &1 as a
//   filename is the kind of near-miss that produces a plausible wrong row (expiry: never)
const WRITE_RE = /(?:^|\s)(?:\d?>>?|(?:-o|--output)[ =]|tee(?:\s+-a)?\s+)\s*("[^"]+"|'[^']+'|[^\s;|&<>]+)/g;
const NOT_A_PATH = /^(?:&\d|\/dev\/\w+|-)$/;

/**
 * Repo paths this command redirects or writes output to. Candidates only: the caller MUST confirm
 * each against the filesystem before recording it, because a derivation that is not checked is the
 * defect this pair of functions exists to stop repeating.
 */
export function execWritesFrom(command, toRepoPath) {
  const cmd = String(command || '');
  if (!cmd) return [];
  const seen = new Set();
  for (const m of cmd.matchAll(WRITE_RE)) {
    const raw = m[1].replace(/^['"]|['"]$/g, '');
    if (!raw || NOT_A_PATH.test(raw)) continue;
    const rel = typeof toRepoPath === 'function' ? toRepoPath(raw) : null;
    if (rel && typeof rel === 'string') seen.add(rel);
  }
  return [...seen];
}

/** The `cmd` field: single-line and bounded. Returns {cmd, clipped}. */
export function fitCommand(command, max = MAX_CMD_CHARS) {
  const one = String(command || '').replace(/\s+/g, ' ').trim();
  return one.length <= max ? { cmd: one, clipped: false } : { cmd: one.slice(0, max), clipped: true };
}

// ---- P1b: read the ROTATION CHAIN, not the live file --------------------------------------------
// touch-ledger.mjs rotates at MAX_BYTES. A single-path reader passes every test written while the
// file is small and fails SILENTLY the first time it rotates. Measured elsewhere in this fleet: a
// single-path read of a rotated journal dropped 157 records and rendered a 2000+ record corpus as
// 0.00% coverage. Worse here, because this is a population denominator — a missed rotation SHRINKS
// it, which flatters every rate computed over it instead of zeroing one loudly.
//
// THIS FUNCTION WAS ITSELF THE DEFECT IT WARNS ABOUT, until 2026-08-29. It returned a fixed
// `[livePath.1, livePath]` — a two-file window — while shiftArchives() shifts .N to .N+1 with no
// cap, so the chain grows without bound. Measured on the live store the day it was found: 22,808
// rows existed across the chain and this returned paths covering 6,140 of them. 16,668 rows, 73%,
// were outside anything it could name.
//
// It now delegates to generations(), the same enumerator bin/gate-tests.mjs:113 already used, so the
// two cannot diverge again. That divergence is the point: the live reader had been fixed, this had
// not, and nothing failed — a reader implementing from THIS would have rebuilt the two-file window
// against a consumer that was already correct. Filed as R18, a record outliving the defect it
// describes, and found by executing it rather than reading it, which is that class's own detection
// property.
//
// The injected `readdirSync` is kept for callers that stub the filesystem; generations() reads the
// real one, so a stub is honoured only when supplied.
export function ledgerChainPaths(livePath, { readdirSync: injected } = {}) {
  if (!injected) return generations(livePath);
  const dir = dirname(livePath);
  const base = `${livePath.slice(dir.length + 1)}.`;
  let names = [];
  try { names = injected(dir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const archives = names
    .filter((n) => n.startsWith(base) && /^\d+$/.test(n.slice(base.length)))
    .map((n) => ({ n: Number(n.slice(base.length)), path: join(dir, n) }))
    .sort((a, b) => b.n - a.n);          // highest N is OLDEST, so oldest first
  return [...archives.map((a) => a.path), livePath];
}

/** Parse a ledger's whole chain. Unparseable lines are COUNTED, never silently skipped. */
export function parseLedger(texts) {
  const rows = [];
  let torn = 0;
  for (const t of texts) {
    for (const line of String(t || '').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { torn++; }
    }
  }
  return { rows, torn };
}

// ── R-A · WRITE DETECTION BY EFFECT, NOT BY TOOL ────────────────────────────────────────────────
// `execWritesFrom` above parses the command string for write-looking paths, then the caller
// confirms with an mtime window — two witnesses that cannot fail the same way. But the mtime
// witness only ever runs on paths the PARSER already named, so the parser is the recall ceiling.
// A `python3 - <<'PY'` heredoc, a `sed -i`, or any script writing a path the regex does not
// recognise yields a row indistinguishable from a read. Measured 2026-08-30: one session authored
// six files and was recorded as having written zero; `bin/adjudication-sampler.mjs` carried 450
// touches and 0 write rows while its hunk demonstrably existed.
//
// Absence of a write marker was being read as "this was a read" — an unsupported pass, inside the
// instrument every attribution downstream trusts.
//
// THE SHARED-TREE HAZARD, which is why this is not simply "diff the tree". Eleven sessions write
// this checkout concurrently. A filesystem delta cannot tell my write from theirs, and the existing
// comment in bin/touch-ledger.mjs already states the governing rule: *a confident wrong owner is
// worse than no owner*. So a delta-derived row is NEVER promoted to the same standing as an
// Edit/Write payload row:
//   · corroborated  — the parser also named it ⇒ `write`, two independent witnesses.
//   · fs-only       — only the delta saw it ⇒ `undetermined` (R-B), carrying `witness:'fs'`.
//                     It says "something changed this in my window", never "I changed it".
// That is the honest reading, and it is strictly more information than today's silence.

/** A path→stat snapshot entry. Kept tiny: this runs on every Bash event. */
export function snapshotEntry(st) {
  return st && st.isFile() ? { m: Math.round(st.mtimeMs), z: st.size } : null;
}

/**
 * Paths that changed between two snapshots. Pure, so the decision is testable without a filesystem.
 *
 * `before`/`after` are plain objects rel → {m,z}. A path is CHANGED when it is new in `after`, or
 * its mtime or size differs. Deletion is reported too — removing a file is a write to the tree, and
 * a ledger that only sees creations cannot explain a vanished module.
 *
 * `parserNamed` is the set execWritesFrom produced, and decides standing rather than membership:
 * everything changed is reported, and the caller marks corroboration.
 */
export function writesFromFsDelta(before = {}, after = {}, { parserNamed = [] } = {}) {
  const named = new Set(parserNamed);
  const out = [];
  for (const [rel, a] of Object.entries(after)) {
    const b = before[rel];
    if (b && b.m === a.m && b.z === a.z) continue;
    out.push({ rel, kind: b ? 'modified' : 'created', corroborated: named.has(rel) });
  }
  for (const rel of Object.keys(before)) {
    if (!(rel in after)) out.push({ rel, kind: 'deleted', corroborated: named.has(rel) });
  }
  return out.sort((x, y) => (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : 0));
}

/** The access kind a delta observation earns. R-B: `undetermined` is a value, never an absence. */
export function accessForDelta({ corroborated }) {
  return corroborated ? 'write' : 'undetermined';
}

// ── R-B · ACCESS IS A VALUE, NEVER AN ABSENCE ───────────────────────────────────────────────────
// Every row emitted from 2026-08-30 carries `access`. Rows written before it do not, and they are
// `undetermined` — NOT `read`. That distinction is the whole point: today a consumer sees no
// `t:"write"` and concludes "this was a read", which is an unsupported pass one layer beneath every
// attribution the fleet publishes.
//
// Measured on the live store the day this landed: 18,762 file rows, of which 6,528 (34.8%) carry
// write evidence and 12,166 carry none. `attributeFiles` consulted none of it — its only filter is
// `if (!r.f) continue` — so ownership was being asserted from all 18,762 regardless. THAT is why a
// session is named as having "touched" a file it may only have had mentioned in a command string.
//
// Back-labelling historical rows is forbidden (plan §5): stamping a plausible access on a row that
// never carried one converts an honest unknown into a false record, which is worse than the gap.

/** Access kinds. `undetermined` is a first-class answer, not a failure to produce one. */
export const ACCESS_KINDS = new Set(['read', 'write', 'exec', 'undetermined']);

/**
 * The access a row supports. An explicit field wins. Otherwise it is inferred ONLY from evidence
 * that already exists in the row, and anything else is `undetermined`.
 *
 * There is deliberately no path to `read`: the hook matches Edit|Write|NotebookEdit|Bash, none of
 * which is a read tool, so the store has never held read evidence. A consumer that renders a
 * bare touch as "read" is inventing a category this instrument never recorded.
 */
export function accessOf(row = {}) {
  if (ACCESS_KINDS.has(row.access)) return row.access;
  if (row.t === 'write' || row.t === 'edit') return 'write';   // payload fingerprints
  if (row.via === 'commit' || row.via === 'shell') return 'write';
  if (row.x || row.via === 'exec') return 'exec';
  return 'undetermined';
}

/** True only when the row is positive evidence that this session WROTE the path. R-C's predicate. */
export const isWriteEvidence = (row) => accessOf(row) === 'write';

// ── THE ATTRIBUTION LEXICON ─────────────────────────────────────────────────────────────────────
// Four vocabularies grew across this subsystem in one day and collided. `undetermined` alone came to
// mean four different things, and three near-synonyms (`unknown`, `undetermined`, `unevidenced`)
// ended up in ONE result object with no way for a reader to tell them apart.
//
// That is the same defect class the rest of this work is about: a word that answers two questions
// answers neither. It is recorded here rather than renamed, because the names are load-bearing in
// callers and a rename would be a bigger change than the confusion warrants — but a term MUST NOT be
// added without a row here, and bin/test/attribution-lexicon.test.mjs enforces that.
//
// The discriminator column is the point. If two rows share one, they are the same concept under two
// names and one should go.
export const ATTRIBUTION_LEXICON = {
  // ── ledger row: what the recorder OBSERVED ──
  'access.read': { field: 'access', scope: 'ledger row', means: 'positive evidence of a read', note: 'NEVER PRODUCED — the hook matches no read tool. Reserved so a consumer cannot invent it.' },
  'access.write': { field: 'access', scope: 'ledger row', means: 'proof this session wrote the path', note: 'payload fingerprints, a git-confirmed commit, or a parser hit corroborated by mtime' },
  'access.exec': { field: 'access', scope: 'ledger row', means: 'the session RAN the file', note: 'never authorship — running node --test x does not make x yours' },
  'access.undetermined': { field: 'access', scope: 'ledger row', means: 'the recorder could not tell what the command did', note: 'fs-delta rows: something changed in my window, not that I changed it' },

  // ── attributeFiles buckets: what is known about a DIRTY FILE ──
  'bucket.unknown': { field: 'unknown[]', scope: 'dirty file', means: 'no ledger rows exist for this path at all', note: 'absence of the record, not absence of proof' },
  'bucket.undetermined': { field: 'undetermined[]', scope: 'dirty file', means: 'rows exist, but every touch PREDATES the last commit of the file', note: 'a timestamp verdict; git cannot say whose hunks that commit carried' },
  'bucket.unevidenced': { field: 'unevidenced[]', scope: 'dirty file', means: 'rows exist and are recent, but none carries write evidence', note: 'SAME CONCEPT as authorOf basis.unknown, under a second name — see the note there' },

  // ── authorOf: who PROVABLY wrote a path ──
  'basis.write': { field: 'basis', scope: 'path', means: 'exactly one session has write evidence' },
  'basis.contested': { field: 'basis', scope: 'path', means: 'more than one session has write evidence', note: 'a real answer, not a failure to produce one' },
  'basis.unknown': { field: 'basis', scope: 'path', means: 'no row proves who wrote it', note: 'DUPLICATE DISCRIMINATOR with bucket.unevidenced. Same question, two names, because one is per-path and the other per-run. If these ever diverge, that is a bug.' },

  // ── unattributedKind: WHY a run could not attribute ──
  'kind.no-ledger': { field: 'kind', scope: 'run', means: 'the store could not be read; nothing was checked' },
  'kind.no-session': { field: 'kind', scope: 'run', means: 'the store read fine; there was no session id to compare against' },
  'kind.no-entry': { field: 'kind', scope: 'run', means: 'store read, session known, and these paths genuinely have no rows', note: 'the ONLY one that is a claim about the files rather than about the check' },

  // ── emptyReason: why a ratchet attribution is EMPTY ──
  'empty.no-drift': { field: 'emptyReason', scope: 'ratchet run', means: 'nothing drifted; there was nothing to attribute' },
  'empty.no-dirty-match': { field: 'emptyReason', scope: 'ratchet run', means: 'things drifted, but no dirty file matches them' },
  'empty.git-unavailable': { field: 'emptyReason', scope: 'ratchet run', means: 'git failed; this is an OUTAGE, not a clean tree' },
};

/** Every term the lexicon declares, as `field.value` keys. */
export const LEXICON_TERMS = new Set(Object.keys(ATTRIBUTION_LEXICON));

/** Terms sharing a discriminator — same concept under two names. Empty is the healthy state. */
export function lexiconCollisions(lex = ATTRIBUTION_LEXICON) {
  const byMeaning = new Map();
  for (const [k, v] of Object.entries(lex)) {
    const sig = `${v.scope}|${v.means}`;
    byMeaning.set(sig, [...(byMeaning.get(sig) || []), k]);
  }
  return [...byMeaning.values()].filter((g) => g.length > 1);
}
