#!/usr/bin/env node
/*
 * stub-detect.mjs — stub/unfinished-work marker scanner (hygiene lane, not a vuln scanner).
 *
 *   node bin/stub-detect.mjs [rootDir]   (default: cwd '.')
 * Emits JSON to stdout, shape mirrors bin/authz-bola.mjs:
 *   {tool:'stub-detect', summary:{findings, byMarker, filesScanned}, findings:[{type,marker,severity,path,line,detail}]}
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAgainstSchema } from '../monitor/registry.mjs';
import { stubAllowlistPathFor } from '../monitor/store-paths.mjs';

const ROOT = resolve(process.argv[2] || '.');
const __dirname = dirname(fileURLToPath(import.meta.url));
// Every input path is env-overridable (house rule: read at CALL time, never at module load).
// The allowlist names customer repositories, so it is a private record (monitor/private/stub-allowlist.json,
// CW_STUB_ALLOWLIST). Absent means nothing is allowed: every marker is reported.
const ALLOWLIST_PATH = () => stubAllowlistPathFor(join(__dirname, '..'));
const ALLOWLIST_SCHEMA_PATH = () => process.env.CW_STUB_ALLOWLIST_SCHEMA || join(__dirname, '..', 'schema', 'stub-allowlist.schema.json');

// Directories never worth walking.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'reports', 'reference', 'vendor',
  'build', 'target', '.gradle', 'out',
]);

// Source-ish text only; .json (data) and .html (generated) are deliberately excluded.
// ex/exs/hs/lhs/dart added 2026-08-26: Elixir, Haskell and Dart had ZERO source lanes of any kind
// (measured — the fleet holds none of them today), so this hygiene tripwire is deliberately wired
// before the languages appear rather than after.
const SCAN_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|java|kt|kts|py|rb|go|rs|php|c|h|cc|cpp|hpp|cs|swift|scala|groovy|gradle|sh|bash|zsh|yml|yaml|properties|sql|vue|svelte|ex|exs|hs|lhs|dart)$/i;

// Patterns must be lower-case: each line is lower-cased once before matching.
const MARKERS = [
  { marker: 'TODO', re: /\btodo\b/ },
  { marker: 'FIXME', re: /\bfixme\b/ },
  { marker: 'XXX', re: /\bxxx\b/ },
  { marker: 'HACK', re: /\bhack\b/ },
  { marker: 'WIP', re: /\bwip\b/ },
  { marker: 'stub', re: /\bstub\b/ },
  { marker: 'placeholder', re: /\bplaceholder\b/ },
  { marker: 'not-implemented', re: /\bnot[\s_-]?implemented\b|\bnotimplemented\b|\bunimplemented\b/ },
  { marker: 'NotImplementedError', re: /\braise\s+notimplementederror\b|\bnotimplementederror\b/ },
  { marker: 'throw-unimplemented', re: /throw\s+new\s+error\s*\(\s*['"`][^'"`]*unimplement/ },
  { marker: 'coming-soon', re: /\bcoming\s+soon\b/ },
];

// ---- comment context ----------------------------------------------------------
//
// A STUB MARKER IS A NOTE SOMEBODY WROTE TO THEMSELVES. `todo` appearing in an identifier is not
// one, and this lane had no way to tell the difference: MARKERS are matched against the whole
// lower-cased line, so `/\btodo\b/` fired on every occurrence of the WORD.
//
// MEASURED 2026-08-28 on the two repositories that motivated this — both of which ship a to-do
// feature, so `todo` is a domain noun in their source:
//
//   memory-layer          982 TODO rows, 191 comment-shaped (19%), 507 in a file whose path contains "todo"
//   shodh-memory 1079 TODO rows, 205 comment-shaped (19%), 538 likewise
//
// Matches included `"status": ["todo", "in_progress"]` in a shell script and `placeholder={...}` on
// a React prop. Four in five rows were the scanner reading a feature name as unfinished work.
//
// CLASSIFY, NEVER DROP — the same rule advisory-reach.mjs applies to a demoted advisory. A marker
// outside a comment still travels, tagged `context:'code'`, and is counted separately in
// `summary.codeContext`. What changes is that it no longer enters `summary.findings`, because that
// number is the one a reader treats as "unfinished work in this repo".
//
// The block-comment state machine is deliberately small and deliberately imperfect. It tracks
// C-family `/* … */` and nothing else, because that is where multi-line markers actually live; a
// marker inside a Python triple-quoted string reads as `code` and is counted apart rather than
// guessed at. A lexer per language would be the correct instrument and is not worth its own bugs
// here — this lane is hygiene, and the cost of the residual is a row in the smaller bucket.
// Where a line's comment STARTS, or -1. Position matters: `LINE_COMMENT.test(line)` was the first
// attempt and it was wrong in a way the measurement caught — `;` was in the opener set (it opens a
// comment in asm/lisp/ini) and it TERMINATES a statement in every language this lane actually
// scans, so `let pending: Vec<_> = todos.todos.iter()...;` classified as a comment. The marker must
// sit AT OR AFTER the opener, not merely on the same line.
//
// `;` and `%` are gone for that reason. None of the extensions in SCAN_EXT use them as comment
// openers, and keeping them cost more than they bought.
const OPENERS = ['//', '#', '/*', '<!--', '--'];
function commentStart(line) {
  let best = -1;
  for (const o of OPENERS) {
    let i = line.indexOf(o);
    // `http://` and `https://` are the reason `//` needs a guard at all; a `:` immediately before
    // it is never a comment in these languages.
    while (o === '//' && i > 0 && line[i - 1] === ':') i = line.indexOf(o, i + 2);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

// MARKER POSITION. A stub marker is the word used AS a marker — at the head of the comment, or
// followed by `:`/`(`/`-`/`!`. `// TODO: wire this up` and `/* FIXME(bob) */` and `# HACK - ...`
// are markers; `// GTD Todo List Tools` and `*   Tasks — the todo list` are prose that happens to
// name a feature.
//
// This is the half that does the work on these two repositories, and the reason is that both SHIP a
// to-do feature, so `todo` is a domain noun in their comments as well as their code. Measured
// 2026-08-28: of shodh-memory's 494 comment-context TODO rows only 134 (27%) were in marker form;
// memory-layer 108 of 440 (25%).
//
// CASE IS THE SIGNAL, and it is the one the lane was throwing away: every line was lower-cased
// before matching, which discarded the single most reliable discriminator these repositories offer.
// A marker is written `TODO`; the feature is written `Todo` or `todo`. MEASURED 2026-08-28 across
// both twins: 1,083 shodh rows and 982 memory-layer rows whose marker is conventionally capitalised, of
// which 11 and 10 respectively actually contain the CAPS word.
//
// Applied ONLY to markers whose canonical name is all-caps (TODO, FIXME, XXX, HACK, WIP). `stub`,
// `placeholder`, `not-implemented` and `coming-soon` are not conventionally capitalised, so for
// those the position-and-form test stands alone.
const CAPSY = (marker) => /^[A-Z]+$/.test(marker);
const MARKER_FORM = (marker) => {
  const m = CAPSY(marker) ? marker : marker.replace(/[-]/g, '[\\s_-]?');
  const flags = CAPSY(marker) ? '' : 'i';       // caps markers are matched case-SENSITIVELY
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- m is a marker word from the module's own fixed marker list
  return new RegExp(`(?:^|[^\\w])${m}\\s*(?::|\\(|$)|(?:\\/\\/+!?|#+|\\/\\*+!?|\\*|<!--|--)\\s*${m}\\b`, flags);
};

/** Per-line comment-start index for a whole file, tracking C-family and HTML block comments. */
function commentContext(lines) {
  const out = new Array(lines.length);
  let inBlock = false, inHtml = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const startedInside = inBlock || inHtml;
    if (!inBlock) { const o = l.indexOf('/*'); if (o !== -1 && l.indexOf('*/', o + 2) === -1) inBlock = true; }
    else if (l.includes('*/')) inBlock = false;
    if (!inHtml) { const o = l.indexOf('<!--'); if (o !== -1 && l.indexOf('-->', o + 4) === -1) inHtml = true; }
    else if (l.includes('-->')) inHtml = false;
    // Inside a block, the whole line is comment. Otherwise it is comment from the opener onward.
    out[i] = startedInside ? 0 : commentStart(l);
  }
  return out;
}

// ---- allowlist ----------------------------------------------------------------
// Fail closed: only ENOENT is absence; any other read error sets allowlistUnreadable.
function loadAllowlist() {
  const p = ALLOWLIST_PATH();
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    // fix: shape checked before any entry suppresses - `Array.isArray(j.allow) ? … : []` read a
    // mistyped `allowe:[…]` as an EMPTY allowlist, which is indistinguishable from a file with
    // nothing in it. Same fail-closed path as a corrupt file: suppress nothing, say why.
    const v = validateAgainstSchema(j, { path: ALLOWLIST_SCHEMA_PATH() });
    if (v.errors.length) {
      console.error(`stub-detect: allowlist ${p} does not satisfy schema/stub-allowlist.schema.json — suppressing NOTHING:\n  - ${v.errors.join('\n  - ')}`);
      return { _error: true, message: v.errors.join('; ') };
    }
    return Array.isArray(j.allow) ? j.allow : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    // Any other error (corrupt JSON, permission denied, etc) — fail attributed
    console.error(`stub-detect: failed to read allowlist ${p}: ${e.message}`);
    return { _error: true, message: e.message };
  }
}
function globToRe(glob) {
  // escape regex metachars, then re-expand our two glob tokens
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') { out += '.*'; i++; } // ** → any incl. slash
      else out += '[^/]*';                            // *  → any non-slash
    } else if ('\\^$.|?+()[]{}'.includes(ch)) {
      out += '\\' + ch;
    } else {
      out += ch;
    }
  }
  return new RegExp('^' + out + '$'); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- `out` is built by the escaping compiler above; only `[^/]*`/`.*` survive unescaped, neither nests a quantifier
}
// Entries without `repo` apply only to commitwork's own tree; scanned repos never supply their
// own allowlist (a repo that ships its own suppressions can silence its own findings).
const SELF_ROOT = resolve(__dirname, '..');
const SCANNED_REPO = basename(ROOT);
const IS_SELF_SCAN = ROOT === SELF_ROOT;
const loaded = loadAllowlist();
const allowlistUnreadable = loaded._error ? true : false;
const ALLOW = (allowlistUnreadable ? [] : loaded).map((a) => ({
  reason: a.reason || '',
  marker: a.marker || null,
  repo: a.repo || null,
  pathGlob: String(a.pathGlob || ''),
  re: globToRe(String(a.pathGlob || '')),
})).filter((a) => {
  if (allowlistUnreadable) return false;  // skip filtering if allowlist unreadable
  const applies = a.repo ? (a.repo === SCANNED_REPO || (a.repo === 'commitwork' && IS_SELF_SCAN)) : IS_SELF_SCAN;
  // Report out-of-scope suppressions — out of scope is not the same as absent.
  if (!applies) process.stderr.write(`stub-detect: allowlist entry ${a.pathGlob}`
    + `${a.marker ? ` [${a.marker}]` : ''} is scoped to ${a.repo || 'commitwork'} — not applied to ${SCANNED_REPO}\n`);
  return applies;
});
function isAllowed(relPath, marker) {
  return ALLOW.some((a) => (a.marker == null || a.marker === marker) && a.re.test(relPath));
}

// ---- walk ---------------------------------------------------------------------
const findings = [];
let filesScanned = 0;

function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      // skip .claude/worktrees specifically (but allow the rest of .claude if ever walked)
      if (name === 'worktrees' && /(^|\/)\.claude$/.test(dir)) continue;
      walk(p);
      continue;
    }
    if (!SCAN_EXT.test(name)) continue;
    let txt; try { txt = readFileSync(p, 'utf8'); } catch { continue; }
    filesScanned++;
    const rel = relative(ROOT, p).split('\\').join('/');
    const lines = txt.split('\n');
    const ctx = commentContext(lines);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const lc = raw.toLowerCase();
      for (const { marker, re } of MARKERS) {
        if (!re.test(lc)) continue;
        if (isAllowed(rel, marker)) continue;
        // comment context = the marker sits at or after this line's comment opener AND is in
        // marker position. Both halves are needed: position alone admits `// GTD Todo List Tools`,
        // form alone admits `const todo: Todo = ...` on a line that also has a trailing comment.
        const cs = ctx[i];
        const idx = lc.search(re);
        const inComment = cs !== -1 && idx >= cs && MARKER_FORM(marker).test(raw.slice(cs));
        findings.push({
          type: 'stub-marker',
          marker,
          severity: 'low',
          path: rel,
          line: i + 1,
          context: inComment ? 'comment' : 'code',
          detail: raw.trim().slice(0, 200),
        });
      }
    }
  }
}

walk(ROOT);

// `findings` is the note-to-self count; `codeContext` is the word-appeared-in-code count. Both are
// published, and every row is still in `findings[]` with its `context` — the split is in how they
// are TOTALLED, not in what is kept.
const inComment = findings.filter((f) => f.context === 'comment');
const inCode = findings.filter((f) => f.context !== 'comment');
const byMarker = {};
for (const f of inComment) byMarker[f.marker] = (byMarker[f.marker] || 0) + 1;
const byMarkerCode = {};
for (const f of inCode) byMarkerCode[f.marker] = (byMarkerCode[f.marker] || 0) + 1;

const summary = {
  findings: inComment.length,
  byMarker,
  filesScanned,
  codeContext: inCode.length,
  byMarkerCodeContext: byMarkerCode,
  contextNote: 'findings/byMarker count markers written in a COMMENT — a note somebody left. codeContext counts the same words appearing in code (an identifier, a string, a JSX prop): measured 2026-08-28 at 81% of all TODO rows on two repositories that ship a to-do feature. Every row is present in findings[] either way, tagged with `context`.',
};
const output = { tool: 'stub-detect', summary, findings };
if (allowlistUnreadable) output.allowlistUnreadable = true;
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
