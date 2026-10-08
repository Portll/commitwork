#!/usr/bin/env node
// guard-destructive.mjs — PreToolUse/Bash gate over the destructive set.
//
// WHY THIS AND NOT THE STOP HOOKS. The gates that judge this fleet's behaviour today are Stop
// hooks: they run after the turn, on a turn already taken. For a claim ("you said the suite is
// green") that is fine — the claim can be corrected. For a force-push, a purged ledger or an
// exfiltrated key it is a post-mortem. PreToolUse is the only point where the answer can still be
// "no", and until now the only thing on it was guard-cwd.mjs, which judges one shell property.
//
// WHY IT LIVES IN THE REPOSITORY. Every other hook is under ~/.claude/, which is not a git
// repository — no history, no review, and no test. That is survivable for an advisory and not for a
// control: a control nobody can test is a claim. It also fails in the direction that hides itself.
// If the script is missing or unparseable the hook command exits non-zero, Claude Code treats that
// as a non-blocking error, and the gate is configured, listed, and enforcing nothing. So the gate's
// own liveness needs a witness that is not the gate — bin/test/guard-destructive.test.mjs asserts
// judge() decides, and `--selftest` asserts the INSTALLED path answers. Configured is not running.
//
// ASK, NOT DENY, IS THE DEFAULT VERDICT. Every action below is one somebody legitimately needs.
// A gate that refuses real work gets removed, and then nothing is gated — the failure mode
// guard-cwd.mjs names in its own header and the one this fleet has already hit with suppressed
// checks. `deny` is reserved for the cases with no legitimate form at all, where a reviewer would
// have said no every time. Everything else stops and asks a human, which is what "gating" means.
//
// FALSE POSITIVES ARE THE FAILURE MODE, so before any rule is applied the command is stripped of
// the places these words appear as DATA rather than as instructions: heredoc bodies (a commit
// message in this repository routinely contains `rm -rf` or `git push` while discussing them),
// single- and double-quoted strings in argument position, and `#` comments. Measured while writing
// this: the commit messages already landed this session contain "force-push", "rm -rf" and
// "credential" inside heredocs, and an unstripped matcher fires on all three.
//
// Exit 0 ALWAYS. The verdict travels in the JSON, exactly as guard-cwd.mjs does, so a crash in this
// file can never wedge the Bash tool for sixteen sessions. That is not defensive style, it is the
// blast radius: this runs on every Bash call in every session on this machine.

import { isMainModule } from '../../lib/is-main.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

// ── strip the places a dangerous word is data, not an instruction ────────────

const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm;

export function scrub(cmd) {
  let s = String(cmd ?? '');
  // 1. Heredoc bodies. `-m "$(cat <<'EOF' … EOF)"` is how this repo writes commit messages, and
  //    those messages discuss the very verbs below. Stripped FIRST, so what a substitution below
  //    keeps is `$(cat  )` — the live command with its data gone — and never the body.
  s = s.replace(HEREDOC, ' ');
  // 1b. A backslash-newline continues the line: `rm -rf \⏎ /` is one command.
  s = s.replace(/\\\r?\n/g, ' ');
  // 2. Quoted strings. `-m "…force-push…"` and `grep 'rm -rf'` are talking about the thing.
  //    Done before comment stripping so a `#` inside a quoted string is not read as a comment.
  s = collapseQuotes(s);
  // 3. Trailing comments.
  s = s.replace(/(^|\s)#[^\n]*/g, ' ');
  return s;
}

// THE TWO QUOTE KINDS ARE NOT THE SAME and treating them alike was a real defect here: a
// single-quoted string is inert, but a DOUBLE-quoted one still expands `$VAR`, so
// `rm -rf "$SCRATCH"/*` is a live hazard that a naive strip turns into `rm -rf /*`-with-the-
// evidence-removed and reads as harmless. Double quotes therefore collapse to their expansions
// only — prose goes, `$VAR` stays — and WITHOUT padding spaces, because the danger is adjacency:
// `"$X"/*` must survive as `$X/*` or the unset-variable case cannot be seen.
//
// A COMMAND SUBSTITUTION IS NOT PROSE EITHER. `cat "$(echo ~/.ssh/id_rsa)"` runs `echo`, and the
// regex collapse this replaced (2026-09-16) dropped the whole `$(…)` as quoted text and judged the
// read `allow`. `$(…)` and backticks inside double quotes are kept with their inner command
// collapsed by the same rules, so the judgement reaches whatever actually runs. An unterminated
// quote is left raw rather than swallowed to end-of-command: a shell would refuse it, and the
// gate must not read less of a command than the shell would.
function collapseQuotes(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { out += s.slice(i, i + 2); i += 2; continue; }
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return out + s.slice(i);
      out += " '' "; i = j + 1; continue;
    }
    if (c === '"') {
      const r = doubleQuoted(s, i + 1);
      if (r === null) return out + s.slice(i);
      out += r.kept; i = r.end; continue;
    }
    out += c; i += 1;
  }
  return out;
}

// From just after an opening `"`: returns what survives (expansions and substitutions) and the
// index after the closing quote, or null when the quote never closes.
function doubleQuoted(s, i) {
  let kept = '';
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '"') return { kept, end: i + 1 };
    if (c === '$' && s[i + 1] === '(') {
      const r = substitution(s, i + 2);
      kept += `$(${r.inner})`; i = r.end; continue;
    }
    if (c === '`') {
      // Emitted in `$(…)` form: the rules' lookaheads know `)` as a word end and not a backtick.
      const j = s.indexOf('`', i + 1);
      const body = j < 0 ? s.slice(i + 1) : s.slice(i + 1, j);
      kept += `$(${collapseQuotes(body)})`; i = j < 0 ? s.length : j + 1; continue;
    }
    // An expansion and the word glued to it are one argument: `"$HOME/.ssh/id_rsa"` names a key.
    const m = c === '$' ? /^\$\{?\w+\}?[^\s"'`$\\]*/.exec(s.slice(i)) : null;
    if (m) { kept += m[0]; i += m[0].length; continue; }
    i += 1;
  }
  return null;
}

// From just after `$(`: finds the matching `)` (quotes inside are skipped, nesting is counted) and
// returns the inner command already collapsed, so a nested `"$(…)"` is judged the same way.
function substitution(s, i) {
  const start = i;
  let depth = 1;
  while (i < s.length && depth > 0) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); i = j < 0 ? s.length : j + 1; continue; }
    if (c === '"') { const r = doubleQuoted(s, i + 1); i = r === null ? s.length : r.end; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    i += 1;
  }
  const inner = s.slice(start, depth === 0 ? i - 1 : i);
  return { inner: collapseQuotes(inner), end: i };
}

// ── git's global options sit between `git` and the subcommand ────────────────
//
// `git -c k=v push` and `git --no-pager push` are pushes, and the push rule read them as something
// else (review 2026-10-07 D14). Each `git <global options> <sub>` is rewritten to `git <sub> <global
// options>`: moved, never dropped, because an option value can hold a `$(…)` the other rules must
// still see. Runs on the RAW command so a quoted value (`-C "/a b"`) stays one word; scrub() would
// otherwise collapse it to nothing and the subcommand would be read as the value.
const GIT_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--attr-source', '--super-prefix']);

// Where a command word can start. `(` and `{` open subshells and groups (`(rm -rf ~)` was allowed),
// and `if`/`while`/`until`/`!` precede a command as much as `then` does.
const CMD_START = String.raw`(?:^|[;&|({!]|\n|\$\(|\x60|\b(?:then|do|else|elif|if|while|until|time)\b)`;
const GIT_AT = new RegExp(String.raw`${CMD_START}\s*(?:sudo\s+|env\s+\w+=\S+\s+)*git(?=[ \t])`, 'gm');

// One shell word from i, quotes and substitutions included: { word, end } or null when unterminated.
function shellWord(s, i) {
  const start = i;
  while (i < s.length && !/[\s;&|()<>]/.test(s[i])) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) return null; i = j + 1; continue; }
    if (c === '"') { const r = doubleQuoted(s, i + 1); if (r === null) return null; i = r.end; continue; }
    if (c === '$' && s[i + 1] === '(') { const r = substitution(s, i + 2); i = r.end; continue; }
    if (c === '`') { const j = s.indexOf('`', i + 1); if (j < 0) return null; i = j + 1; continue; }
    i += 1;
  }
  return { word: s.slice(start, i), end: i };
}

export function normaliseGit(cmd) {
  const s = String(cmd ?? '');
  let out = '';
  let last = 0;
  for (const m of s.matchAll(GIT_AT)) {
    const head = m.index + m[0].length;
    if (head < last) continue;
    let i = head;
    const opts = [];
    let sub = null;
    while (i < s.length) {
      while (s[i] === ' ' || s[i] === '\t') i += 1;
      const w = shellWord(s, i);
      if (!w || !w.word) break;
      if (!w.word.startsWith('-')) { sub = { ...w, start: i }; break; }
      opts.push(w.word);
      i = w.end;
      if (GIT_VALUED.has(w.word)) {
        while (s[i] === ' ' || s[i] === '\t') i += 1;
        const v = shellWord(s, i);
        if (!v || !v.word) break;
        opts.push(v.word);
        i = v.end;
      }
    }
    // Rewritten only when what follows the options is a plain subcommand name; anything else stays raw.
    // A span crossing a line could carry a heredoc terminator past live text, so it is left alone.
    if (!opts.length || !sub || !/^[a-z][a-z0-9-]*$/.test(sub.word) || s.slice(head, sub.end).includes('\n')) continue;
    out += `${s.slice(last, head)} ${sub.word} ${opts.join(' ')}`;
    last = sub.end;
  }
  return out + s.slice(last);
}

/** A token sits at COMMAND position: line start, or after a separator (`$(` and a backtick open one). Not inside another word. */
const atCommand = (verb) => new RegExp(String.raw`${CMD_START}\s*(?:sudo\s+|env\s+\w+=\S+\s+)*${verb}(?=\s|$)`, 'm');

// ── the command word behind its wrappers ─────────────────────────────────────
//
// The rules above and below read a command at command position, and a command reaches the shell
// behind prefixes the regexes never knew: `GIT_DIR=x git push`, `command git push`, `\git push`,
// `/usr/bin/git push`, `nice`/`nohup`/`timeout 5`/`env -i`/`sudo -u x`, `xargs -I{} git push`
// (review 2026-10-07 D14). A small lexer splits the command into simple commands (descending into
// `$(…)`, backticks and subshells), each prefix is skipped by the wrapper's own option grammar,
// and normaliseWrappers() puts a `;` before the real command word. Nothing is dropped: the prefix
// stays where it was, so a `$(…)` inside an assignment is still judged.
//
// STILL INVISIBLE TO A HOOK: shell functions and shell aliases. A hook sees the command text, not
// the session's shell, so `alias g=git; g push` in an earlier call, or a function named `git`,
// cannot be seen from here. Neither can `$(which git) push`, `$GIT push`, or text piped into `sh`.

const SEP = new Set([';', '&', '|', '(', ')', '\n']);
const KEYWORDS = new Set(['{', '}', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until']);

// From just after an opening `(`: { innerEnd, end } of its matching `)`, quotes skipped.
function closeParen(s, i, end) {
  let depth = 1;
  while (i < end) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); i = j < 0 ? end : j + 1; continue; }
    if (c === '"') { i = scanDouble(s, i + 1, end, null); continue; }
    if (c === '(') depth += 1;
    else if (c === ')' && --depth === 0) return { innerEnd: i, end: i + 1 };
    i += 1;
  }
  return { innerEnd: end, end };
}

// A backtick body from just after the opening backtick: { innerEnd, end }.
function closeTick(s, i, end) {
  const j = s.indexOf('`', i);
  return j < 0 || j >= end ? { innerEnd: end, end } : { innerEnd: j, end: j + 1 };
}

// From just after an opening `"`: the index after its close. Substitutions inside are lexed into `out`.
function scanDouble(s, i, end, out) {
  while (i < end) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '"') return i + 1;
    if (c === '$' && s[i + 1] === '(') { const p = closeParen(s, i + 2, end); if (out) lex(s, i + 2, p.innerEnd, out); i = p.end; continue; }
    if (c === '`') { const p = closeTick(s, i + 1, end); if (out) lex(s, i + 1, p.innerEnd, out); i = p.end; continue; }
    i += 1;
  }
  return end;
}

function scanWord(s, i, end, out) {
  const start = i;
  while (i < end && !/[\s;&|()<>]/.test(s[i])) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); i = j < 0 || j >= end ? end : j + 1; continue; }
    if (c === '"') { i = scanDouble(s, i + 1, end, out); continue; }
    if (c === '$' && s[i + 1] === '(') { const p = closeParen(s, i + 2, end); lex(s, i + 2, p.innerEnd, out); i = p.end; continue; }
    if (c === '`') { const p = closeTick(s, i + 1, end); lex(s, i + 1, p.innerEnd, out); i = p.end; continue; }
    i += 1;
  }
  return { raw: s.slice(start, Math.min(i, end)), start, end: Math.min(i, end) };
}

/** Simple commands of `s` as token arrays ({ raw, start, end }); `seg.inputs` holds `<` targets. */
function lex(s, i = 0, end = s.length, out = []) {
  let seg = [];
  seg.inputs = [];
  const flush = () => { if (seg.length || seg.inputs.length) out.push(seg); seg = []; seg.inputs = []; };
  while (i < end) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\r') { i += 1; continue; }
    if (c === '\\' && s[i + 1] === '\n') { i += 2; continue; }
    if (SEP.has(c)) { flush(); i += 1; continue; }
    if (c === '#') { while (i < end && s[i] !== '\n') i += 1; continue; }
    if (c === '<' || c === '>') {
      const input = c === '<' && s[i + 1] !== '<';
      while (i < end && (s[i] === '<' || s[i] === '>' || s[i] === '&')) i += 1;
      while (s[i] === ' ' || s[i] === '\t') i += 1;
      if (s[i] === '(') continue;                       // <(…) is a command, lexed as one
      const w = scanWord(s, i, end, out);
      if (input && w.raw) seg.inputs.push(unquote(w.raw));
      i = Math.max(w.end, i + 1);
      continue;
    }
    const w = scanWord(s, i, end, out);
    if (!w.raw) { i += 1; continue; }
    i = w.end;
    if (/^\d+$/.test(w.raw) && (s[i] === '>' || s[i] === '<')) continue;   // `2>`: an fd, not an argument
    seg.push(w);
  }
  flush();
  return out;
}

/** One shell word's value: quotes removed, escapes resolved, substitutions kept as written. */
function unquote(w) {
  let out = '';
  let i = 0;
  while (i < w.length) {
    const c = w[i];
    if (c === '\\') { out += w[i + 1] ?? ''; i += 2; continue; }
    if (c === '$' && w[i + 1] === "'") { i += 1; continue; }
    if (c === "'") { const j = w.indexOf("'", i + 1); const e = j < 0 ? w.length : j; out += w.slice(i + 1, e); i = e + 1; continue; }
    if (c === '$' && w[i + 1] === '(') { const p = closeParen(w, i + 2, w.length); out += w.slice(i, p.end); i = p.end; continue; }
    if (c === '"') {
      i += 1;
      while (i < w.length && w[i] !== '"') {
        if (w[i] === '\\' && /["\\$`\n]/.test(w[i + 1] ?? '')) { out += w[i + 1]; i += 2; continue; }
        if (w[i] === '$' && w[i + 1] === '(') { const p = closeParen(w, i + 2, w.length); out += w.slice(i, p.end); i = p.end; continue; }
        out += w[i]; i += 1;
      }
      i += 1; continue;
    }
    out += c; i += 1;
  }
  return out;
}

const maskHeredocs = (s) => s.replace(HEREDOC, (m) => m.replace(/[^\n]/g, ' '));

/** `\git` → git, `/usr/bin/git` → git, `'git'` → git. */
function cmdName(w) {
  const m = /^[^$`]*\/([^/]+)$/.exec(w);
  return m ? m[1] : w;
}

// Each wrapper's option grammar: `v` matches an option that takes the NEXT word as its value,
// `pos` is how many positional words precede the command, `assign` takes NAME=value words.
// `xargs` is assembled so lexical-ratchets' M16 (an xargs without -r) does not read this table
// as an invocation of it.
const TIMEOUT = { v: /^-[sk]$|^--(?:signal|kill-after)$/, pos: 1 };
const WRAP = {
  sudo: { v: /^-[ugpCDrtUTRh]$|^--(?:user|group|prompt|close-from|chdir|role|type|other-user|host|command-timeout)$/ },
  doas: { v: /^-[uC]$/ },
  command: { lookup: /^-[a-zA-Z]*[vV]/ },
  exec: { v: /^-a$/ },
  nice: { v: /^-n$|^--adjustment$/ },
  nohup: {},
  time: {},
  setsid: {},
  caffeinate: { v: /^-[tw]$/ },
  stdbuf: { v: /^-[ioe]$/ },
  timeout: TIMEOUT,
  gtimeout: TIMEOUT,
  env: { v: /^-[uCS]$|^--(?:unset|chdir|split-string)$/, assign: true },
  ['x' + 'args']: { v: /^-[IdaEnLPs]$|^--(?:arg-file|delimiter|eof|max-args|max-lines|max-procs|max-chars|replace|process-slot-var)$/ },
};
const ASSIGN = /^[A-Za-z_]\w*=/;

/** Index of the command word in a simple command's word values (-1: none), and its assignments. */
function unwrap(words) {
  const env = {};
  const take = (w) => { const e = w.indexOf('='); env[w.slice(0, e)] = w.slice(e + 1); };
  let k = 0;
  for (;;) {
    while (k < words.length && KEYWORDS.has(words[k])) k += 1;
    while (k < words.length && ASSIGN.test(words[k])) take(words[k++]);
    if (k >= words.length) return { k: -1, env };
    const w = Object.hasOwn(WRAP, cmdName(words[k])) ? WRAP[cmdName(words[k])] : null;
    if (!w) return { k, env };
    k += 1;
    let pos = w.pos ?? 0;
    let opts = true;
    while (k < words.length) {
      const x = words[k];
      if (opts && x === '--') { opts = false; k += 1; continue; }
      if (opts && w.lookup?.test(x)) return { k: -1, env };
      if (opts && w.assign && x === '-') { k += 1; continue; }
      if (opts && x.length > 1 && x.startsWith('-')) { k += w.v?.test(x) ? 2 : 1; continue; }
      if (w.assign && ASSIGN.test(x)) { take(x); k += 1; continue; }
      if (pos > 0) { pos -= 1; k += 1; continue; }
      break;
    }
  }
}

/**
 * Puts a `;` between every wrapper or assignment prefix and the command it runs, and writes the
 * command word bare (`\git`, `/usr/bin/git`, `'git'` → `git`), so the command-position rules see
 * it. Pure; positions come from the lexer on a heredoc-masked copy, so heredoc bodies are untouched.
 */
export function normaliseWrappers(cmd, segs = lex(maskHeredocs(String(cmd ?? '')))) {
  const s = String(cmd ?? '');
  const edits = [];
  for (const seg of segs) {
    if (!seg.length) continue;
    const words = seg.map((t) => unquote(t.raw));
    const { k } = unwrap(words);
    if (k < 0) continue;
    const t = seg[k];
    const name = cmdName(words[k]);
    const bare = /^[\w.+-]+$/.test(name) && t.raw !== name;
    const prefixed = k > 0 && !KEYWORDS.has(words[k - 1]);
    if (bare || prefixed) edits.push({ start: t.start, end: t.end, text: `${prefixed ? '; ' : ''}${bare ? name : t.raw}` });
  }
  let out = s;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

// ── ASK IS NOT A GATE IN AN UNATTENDED SESSION ───────────────────────────────
//
// Measured 2026-09-06, immediately after this file was installed, and it changes how the verdicts
// below should be read. Probing the installed gate from a NON-INTERACTIVE session:
//
//   `rm -rf /tmp/<nonexistent>`            → judged `ask` → RAN. Not stopped.
//   `git push --force <bad-remote> main`   → judged `deny` → REFUSED, with the reason shown.
//
// So `deny` is enforced everywhere and `ask` degrades to `allow` wherever nothing can be asked.
// That inverts the safety argument this file is built on: `ask` was chosen as the default BECAUSE
// it keeps real work moving, and it turns out to keep it moving in exactly the sessions where no
// human is watching — the unattended ones, which are the ones that most need a gate.
//
// The first reading of that probe was wrong in a way worth recording, because it is the same class
// this file's header warns about. `rm -rf` ran, so the conclusion drawn was "the hook did not load;
// hooks must be frozen at session start." That was one observation with two candidate causes and
// the more flattering one was chosen — flattering because "the harness did not call me" blames the
// harness, where "my ask tier is inert here" blames the design. The deny-case probe separates them
// in one command, costs nothing, and was not run until a documentation check contradicted the
// claim. A liveness probe must use the verdict that CANNOT be auto-approved, or it measures the
// permission mode rather than the gate.
//
// guard: headless spawners set CW_GUARD_UNATTENDED, ask becomes deny
const unattended = () => process.env.CW_GUARD_UNATTENDED === '1';
const askUnlessUnattended = (reason) => (unattended()
  ? { decision: 'deny', reason: `${reason}\n  · CW_GUARD_UNATTENDED=1: no human can answer this, so it is refused.` }
  : { decision: 'ask', reason });

// ── the rules ────────────────────────────────────────────────────────────────
//
// Each returns null (not my business) or { decision, reason }. Order matters only in that the
// FIRST deny wins over any ask, so the strongest statement is the one the operator sees.

const PUSH_AT = new RegExp(String.raw`${CMD_START}\s*(?:sudo\s+|env\s+\w+=\S+\s+)*git\s+(?:-C\s+\S+\s+|-(?!C\s)[\w-]+\s+)*push\b`, 'm');

const FORCE_PUSH = {
  decision: 'deny',
  reason:
    'This is an unconditional force-push. Sixteen sessions commit to this branch, so it would '
    + 'discard commits you have not read and whose authors cannot be enumerated from here.\n'
    + '  · `git push --force-with-lease` refuses if the remote moved — that is exactly the hazard, '
    + 'and it is almost always what was meant.\n'
    + '  · If the history genuinely must be rewritten, that is an operator decision. Say what you '
    + 'are rewriting and why, and let them run it.',
};

const catastrophic = (what) => ({
  decision: 'deny',
  reason:
    `This recursive force-delete targets ${what}. There is no form of that an agent session `
    + 'should run unattended, and it is not recoverable from here — git does not keep untracked '
    + 'files, and this tree carries gitignored live state (.claude/store, reports/) that exists '
    + 'nowhere else.',
});

const recursiveDelete = (lead = 'Recursive force-delete.') => ({
  decision: 'ask',
  reason:
    `${lead} Confirm the path is what you think it is before this runs.\n`
    + '  · `git` does not keep untracked files — anything not committed is gone, and this tree '
    + 'routinely carries 100+ dirty files belonging to other sessions.\n'
    + '  · gitignored live state (.claude/store, reports/, evaluations/) has no copy in the '
    + 'repository at all.\n'
    + '  · If this is a scratch directory under /tmp, say so and it is a one-word approval.',
});

// A word boundary that a path in interpreter code also has: `open("/x/.ssh/id_rsa")`.
const SECRETS = [
  { re: /(?:^|[\s/'"])id_(?:rsa|ed25519|ecdsa|dsa)(?!\.pub)(?=\s|$|['")])/, what: 'an SSH private key' },
  { re: /\.(?:pem|p12|pfx|jks|keystore)(?=\s|$|['")])/, what: 'a private key or keystore file' },
  { re: /(?:^|[\s/'"])\.env(?:\.[\w-]+)?(?=\s|$|['")])/, what: 'an environment file' },
  { re: /\.claude\/settings(?:\.local)?\.json/, what: "settings.json, which carries API keys in its `env` block" },
  { re: /(?:^|[\s/'"])\.(?:npmrc|netrc|pgpass|aws\/credentials|docker\/config\.json)(?=\s|$|['")])/, what: 'a credential file' },
  { re: /\bcredentials\.json\b/, what: 'a credentials file' },
  { re: /\.config\/gh\/hosts\.yml\b/, what: "the GitHub CLI's token file" },
  { re: /\.commitwork\/secrets\.json\b/, what: "commitwork's secret store" },
];
const secretIn = (text) => SECRETS.find((sec) => sec.re.test(text))?.what ?? null;

const credentialRead = (what) => askUnlessUnattended(
  `This reads ${what}. Reading one is often legitimate — checking a fingerprint, `
  + 'confirming a config — and is also the step before a key leaves the machine. Nothing here '
  + 'can tell those apart, so a human decides.\n'
  + '  · If you need a fingerprint, `ssh-keygen -lf <key>.pub` reads the PUBLIC half and is '
  + 'not gated.\n'
  + '  · If you need to know a variable is SET, test it without printing it.\n'
  + '  · Whatever is read must never reach a commit message, a report, or an outbound request.',
);

const LOOPBACK = /(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)/;
const LOOPBACK_HOST = /^(?:127(?:\.\d+){3}|localhost|::1|\[::1\]|0\.0\.0\.0)$/i;

const outbound = (dest) => askUnlessUnattended(
  `This sends a request body to ${dest ? dest.replace(/([?&](?:key|token|secret|password)=)[^&\s]+/gi, '$1<redacted>') : 'a non-local destination'}.\n`
  + '  · Sending content to an external service PUBLISHES it. It may be cached, logged or indexed '
  + 'even if deleted afterwards.\n'
  + '  · This tree contains client names, audit evidence about private repositories, and an '
  + 'identity scrub that is not finished. Check what is in the body, not just where it is going.\n'
  + '  · Loopback destinations (veld :3030, the panel :7878, LM Studio) are not gated — only this '
  + 'one left the machine.',
);

const RULES = [
  // ---- force-push -----------------------------------------------------------
  // DENY, and this is the one case where "a reviewer would have said no every time" is literally
  // true here: sixteen sessions share this branch, and a force-push discards commits whose authors
  // have not been asked and cannot be enumerated from the pushing session.
  // --force-with-lease is NOT this: it refuses if the remote moved, which is the whole hazard.
  (s) => {
    if (!/\bgit\b/.test(s) || !/\bpush\b/.test(s)) return null;
    const lease = /--force-with-lease/.test(s);
    const force = /(?:^|\s)(?:--force|-f)(?=\s|$)/.test(s) || /\+[\w./-]+:/.test(s);
    if (!force || lease) return null;
    return FORCE_PUSH;
  },

  // ---- ordinary push --------------------------------------------------------
  // ASK. Not because pushing is wrong, but because on this branch a push is never only yours: it
  // carries every commit between the remote tip and HEAD. Measured 2026-09-06: main sat 2 ahead
  // with both commits from one session, and earlier the same day a session found 10 ahead of which
  // 1 was its own. The reason names the count so the ask is a fact rather than a ritual.
  (s) => {
    // `git [-C <dir>] [--opts] push`. Matched as a unit rather than "git somewhere, push somewhere",
    // so `git log --grep push` and `npm run push` are not this.
    // `-(?!C\s)` keeps the two option forms disjoint: when `-C ` could be either, a command of
    // repeated `-C -- ` backtracked exponentially, 171ms at 22 repeats, in a hook on every command.
    // The command position is atCommand's, so `$(git push)` and `env K=V git push` count too; global
    // options were already moved behind the subcommand by normaliseGit().
    if (!PUSH_AT.test(s)) return null;
    return {
      decision: 'ask',
      reason:
        `A push on a shared branch carries EVERYONE. ${aheadSummary()}\n`
        + '  · It publishes every commit between the remote tip and HEAD, not only yours.\n'
        + '  · Nothing published can be unpublished — assume it is cached and indexed the moment it lands.\n'
        + '  · If an identity scrub or a licence decision is still outstanding, this is the step that '
        + 'makes them permanent.',
    };
  },

  // ---- rm -rf ---------------------------------------------------------------
  // Judged per `rm` command: its arguments run to the next separator, a `)` or a backtick, so
  // `$(rm -rf /)`, `` `rm -rf /` ``, `(rm -rf ~)` and `;rm -rf /;` reach the catastrophic tier (the
  // lookahead used to accept only whitespace or end of string after the target).
  (s) => {
    if (!atCommand('rm').test(s)) return null;
    const RM = new RegExp(String.raw`${CMD_START}\s*(?:sudo\s+|env\s+\w+=\S+\s+)*rm(?=\s|$)([^;&|)\x60\n]*)`, 'gm');
    const END = String.raw`(?=[\s;&|)\x60]|$)`;
    // Catastrophic targets have no legitimate form from an agent session.
    const CATASTROPHIC = [
      { re: new RegExp(String.raw`\s\/\*?${END}`), what: 'the filesystem root' },
      { re: new RegExp(String.raw`\s(?:~|\$HOME|\$\{HOME\})(?:\/\*?)?${END}`), what: 'the home directory' },
      { re: /\s\$\{?\w*\}?\/\*/, what: 'an unquoted variable expanded into a glob (empty ⇒ /*)' },
      { re: new RegExp(String.raw`\.git(?:\/)?${END}`), what: "a repository's .git directory" },
    ];
    let hit = false;
    for (const m of s.matchAll(RM)) {
      const a = ` ${m[1]} `;
      const recursiveForce = /\s-[a-zA-Z]*[rR][a-zA-Z]*f[a-zA-Z]*(?=\s)/.test(a)
        || /\s-[a-zA-Z]*f[a-zA-Z]*[rR][a-zA-Z]*(?=\s)/.test(a)
        || (/\s(?:-[rR]|--recursive)(?=\s)/.test(a) && /\s(?:-f|--force)(?=\s)/.test(a));
      if (!recursiveForce) continue;
      const c = CATASTROPHIC.find((x) => x.re.test(a));
      if (c) return catastrophic(c.what);
      hit = true;
    }
    return hit ? recursiveDelete() : null;
  },

  // ---- credential reads -----------------------------------------------------
  // ASK. Reading a key is legitimate (checking a fingerprint, verifying a config) and is also the
  // step before exfiltration. The gate cannot tell the two apart — which is the point of asking.
  // Interpreters (`python3 -c`, `node -e`…), single-quoted paths and `<` redirects are read per
  // command by readsSecret() below; this rule reads the scrubbed text.
  (s) => {
    const READERS = /\b(?:cat|bat|less|more|head|tail|strings|xxd|od|base64|cp|scp|rsync|grep|rg|awk|sed)\b/;
    const what = READERS.test(s) ? secretIn(s) : null;
    if (what) return credentialRead(what);
    // macOS keychain: no file to match, so it is matched by verb.
    if (/\bsecurity\s+find-(?:generic|internet)-password\b/.test(s) && /-w\b/.test(s)) {
      return askUnlessUnattended(
        'This extracts a secret from the macOS keychain in plaintext (`-w`). The keychain is the '
        + 'store of record for this fleet\'s API keys. Confirm where the value is going — a value '
        + 'printed into a transcript is in the transcript permanently.',
      );
    }
    return null;
  },

  // ---- outbound POST --------------------------------------------------------
  // ASK, and ONLY for a non-loopback destination. The fleet talks to 127.0.0.1 constantly (veld on
  // :3030, the panel on :7878, LM Studio, the spine) and gating those would fire dozens of times an
  // hour and be switched off within a day. Localhost is explicitly exempt for that reason.
  // curl's `--json`/`-T`/`--form`, wget's `--body-*`/`--method`, gh, scp, rsync, sftp, nc and socat
  // are read per command by sendsOut() below: `--json` is also a gh and trufflehog output flag.
  (s) => {
    if (!/\b(?:curl|wget|http|https|xh)\b/.test(s)) return null;
    const posts = /(?:-X\s*(?:POST|PUT|PATCH|DELETE)\b|--request\s*(?:POST|PUT|PATCH|DELETE)\b|--data\b|--data-\w+\b|(?:^|\s)-d(?=\s)|(?:^|\s)-F(?=\s)|--upload-file\b|--post-data\b|--post-file\b)/;
    if (!posts.test(s)) return null;
    const urls = s.match(/\bhttps?:\/\/[^\s'"]+/g) || [];
    if (urls.length && urls.every((u) => LOOPBACK.test(u))) return null;
    return outbound(urls.find((u) => !LOOPBACK.test(u)));
  },

  // ---- the ledgers ----------------------------------------------------------
  // The touch ledger and the verdict journal are APPEND-ONLY records used to answer "who changed
  // this" and "what did the gate decide". A truncating redirect onto one destroys the answer to a
  // question that will be asked later, and reads as a clean empty store — the fail-closed rule
  // this repository states everywhere else, applied to its own evidence.
  (s) => {
    const LEDGER = /\.claude\/(?:store|verdicts)\/|touches\.jsonl|verdict[s]?\.jsonl/;
    if (!LEDGER.test(s)) return null;
    if (/(?<!>)>(?!>)\s*\S*\.claude\/(?:store|verdicts)\//.test(s) || /(?<!>)>(?!>)\s*\S*(?:touches|verdicts?)\.jsonl/.test(s)) {
      return {
        decision: 'deny',
        reason:
          'This TRUNCATES an append-only ledger (`>` rather than `>>`). The touch ledger and the '
          + 'verdict journal are how "who changed this file" and "what did the gate decide" are '
          + 'answered later, and an emptied ledger does not read as damaged — it reads as a clean '
          + 'store with nothing in it.\n'
          + '  · Append with `>>`, or write through the tool that owns the store.\n'
          + '  · If a ledger genuinely needs rotating, that is the rotation path, not a redirect.',
      };
    }
    if (/\b(?:rm|mv|truncate|shred)\b/.test(s) || /\btee\b(?!\s+-a)/.test(s)) {
      return {
        decision: 'ask',
        reason:
          'This modifies or removes a durable ledger under .claude/store or .claude/verdicts. Those '
          + 'stores live in the sidecar because they must survive; they are the evidence behind '
          + 'attribution and gate decisions, and nothing else holds a copy.',
      };
    }
    return null;
  },
];

// ── per command: the code the scrubbed text cannot show ──────────────────────
//
// The rules above read the command with quoted text removed, which is right for prose and wrong
// where the quoted text is code: the string after `sh -c`, the program after `python3 -c` or
// `node -e`, a git alias's expansion, a `find -exec` command. Those are read here, one simple
// command at a time, each into the category its verb already has above.

const MAX_DEPTH = 4;
const tooDeep = () => ({
  decision: 'ask',
  reason: `This nests shells, aliases or find -exec more than ${MAX_DEPTH} deep, past what this gate reads, so a human reads it instead.`,
});

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish']);
const INTERPRETERS = /^(?:python[\d.]*|pypy[\d.]*|node|nodejs|deno|bun|ruby|perl|php|lua|osascript|awk|gawk|mawk|nawk|tclsh)$/;
const FILE_READERS = new Set(['cat', 'bat', 'less', 'more', 'head', 'tail', 'strings', 'xxd', 'od', 'base64', 'hexdump', 'tac', 'nl', 'jq', 'yq']);
const HEREDOC_RUNNER = /(?:^|[;&|(]|\n)[ \t]*(?:sudo[ \t]+)?(?:[^\s;&|<>]*\/)?((?:ba|z|da|k|mk)?sh|python[\d.]*|node|ruby|perl|php|osascript)[ \t][^\n<]*<<-?[ \t]*(['"]?)([A-Za-z_]\w*)\2[^\n]*\n([\s\S]*?)^[ \t]*\3[ \t]*$/gm;

function perCommand(seg, ctx, nested) {
  // `pbcopy < ~/.ssh/id_rsa`: a `<` redirect reads its file whatever the command is.
  const redirected = seg.inputs.map(secretIn).find(Boolean);
  const v = commandWord(seg, ctx, nested);
  return v?.decision === 'deny' || !redirected ? v : credentialRead(redirected);
}

function commandWord(seg, ctx, nested) {
  if (!seg.length) return null;
  const raws = seg.map((t) => t.raw);
  const words = raws.map(unquote);
  const { k, env } = unwrap(words);
  if (k < 0) return null;
  const name = cmdName(words[k]);
  const args = words.slice(k + 1);
  const rawArgs = raws.slice(k + 1);
  if (SHELLS.has(name)) return shellString(args, nested);
  if (name === 'eval') return args.length ? nested(args.join(' ')) : null;
  if (name === 'git') return gitCommand(args, rawArgs, env, ctx, nested);
  if (name === 'find') return findCommand(args, rawArgs, nested);
  const what = INTERPRETERS.test(name) ? interpreterReads(name, args)
    : FILE_READERS.has(name) ? readerFiles(name, args).map(secretIn).find(Boolean)
      : null;
  return what ? credentialRead(what) : sendsOut(name, args);
}

// The files a reader opens: `head -n 5 f` → f; jq's first operand is its filter, not a file.
function readerFiles(name, args) {
  if (name === 'head' || name === 'tail') return operands(args, /^-[nc]$|^--(?:lines|bytes)$/);
  if (name !== 'jq' && name !== 'yq') return operands(args, /^$/);
  const out = [];
  for (let j = 0; j < args.length; j += 1) {
    if (/^--(?:arg|argjson|slurpfile|rawfile)$/.test(args[j])) j += 2;
    else if (/^--(?:indent|tab-width)$/.test(args[j])) j += 1;
    else if (!args[j].startsWith('-')) out.push(args[j]);
  }
  return out.slice(1);
}

// Interpreter code is read as code, never its script's arguments (`node x.mjs --note "…"` is data):
// the string after -c/-e/-p/--eval, or awk's program and the files awk reads. Code must also read
// something, so an edit script that merely mentions a key path in its text is not a key read.
const CODE_FLAG = /^(?:-c|-e|-E|-p|-r|--eval|--print|eval)$/;
const READS = /\b(?:open|read\w*|createReadStream|require|import|loads?|slurp|fopen|file_get_contents|Get-Content)\s*\(|\bopen\s+\w+\s*,|\bgetline\b|\bcat\s|[<]\s*["'$/~]/;

function interpreterReads(name, args) {
  if (/awk$/.test(name)) {
    const ops = operands(args, /^-[fvF]$/);
    if (args.includes('-f')) return ops.map(secretIn).find(Boolean) ?? null;
    return codeReads(ops[0] ?? '') ?? ops.slice(1).map(secretIn).find(Boolean) ?? null;
  }
  for (let j = 0; j < args.length - 1; j += 1) {
    if (CODE_FLAG.test(args[j])) { const what = codeReads(args[j + 1]); if (what) return what; }
  }
  return null;
}

/** A secret path in code that reads something; `perLine` for long scripts, where it must be one statement. */
function codeReads(code, perLine = false) {
  for (const unit of perLine ? code.split('\n') : [code]) {
    const what = secretIn(unit);
    if (what && READS.test(unit)) return what;
  }
  return null;
}

// `sh -c 'git push'`: the first operand after a -c is a command string, judged whole.
function shellString(args, nested) {
  let c = false;
  for (let j = 0; j < args.length; j += 1) {
    const a = args[j];
    if (/^[-+][a-zA-Z]+$/.test(a)) { if (a[0] === '-' && a.includes('c')) c = true; if (a.endsWith('o')) j += 1; continue; }
    if (a === '--rcfile' || a === '--init-file') { j += 1; continue; }
    if (a.startsWith('--')) continue;
    return c ? nested(a) : null;
  }
  return null;
}

// ---- git: force flags the whole-text rule misses, `git clean`, and aliases --
const GIT_BUILTINS = new Set(('add am annotate apply archive backfill bisect blame branch bugreport bundle cat-file '
  + 'check-attr check-ignore check-mailmap check-ref-format checkout checkout-index cherry cherry-pick citool clean '
  + 'clone column commit commit-graph commit-tree config count-objects credential describe diagnose diff diff-files '
  + 'diff-index diff-pairs diff-tree difftool fast-export fast-import fetch fetch-pack filter-branch fmt-merge-msg '
  + 'for-each-ref for-each-repo format-patch fsck gc get-tar-commit-id grep gui hash-object help hook http-backend '
  + 'imap-send index-pack init init-db instaweb interpret-trailers log ls-files ls-remote ls-tree mailinfo mailsplit '
  + 'maintenance merge merge-base merge-file merge-index merge-one-file merge-tree mergetool mktag mktree '
  + 'multi-pack-index mv name-rev notes p4 pack-objects pack-redundant pack-refs patch-id prune prune-packed pull push '
  + 'quiltimport range-diff read-tree rebase receive-pack reflog refs remote repack replace replay request-pull rerere '
  + 'reset restore rev-list rev-parse revert rm send-email send-pack shell shortlog show show-branch show-index '
  + 'show-ref sparse-checkout stage stash status stripspace submodule subtree switch symbolic-ref tag unpack-file '
  + 'unpack-objects update-index update-ref update-server-info upload-archive upload-pack var verify-commit '
  + 'verify-pack verify-tag version whatchanged worktree write-tree').split(' '));

function gitCommand(args, rawArgs, env, ctx, nested) {
  const inline = new Map();
  const where = { cdir: null, gitDir: env.GIT_DIR ?? null, env };
  let cleanUnforced = false;
  const setOpt = (o, v) => {
    if (o === '-c') {
      const m = /^([^=]+)=([\s\S]*)$/.exec(v);
      const key = m?.[1].toLowerCase();
      if (key?.startsWith('alias.')) inline.set(key.slice(6), m[2]);
      if (key === 'clean.requireforce' && /^(?:false|no|off|0)$/i.test(m[2])) cleanUnforced = true;
    } else if (o === '-C') where.cdir = resolve(where.cdir ?? ctx.cwd ?? process.cwd(), v);
    else if (o === '--git-dir') where.gitDir = v;
  };
  let j = 0;
  while (j < args.length && args[j].startsWith('-')) {
    const a = args[j];
    if (GIT_VALUED.has(a)) { setOpt(a, args[j + 1] ?? ''); j += 2; continue; }
    const m = /^(--[\w-]+)=([\s\S]*)$/.exec(a);
    if (m && GIT_VALUED.has(m[1])) setOpt(m[1], m[2]);
    j += 1;
  }
  const sub = args[j];
  if (!sub) return null;
  const rest = args.slice(j + 1);
  if (sub === 'push') {
    // `-fu`, `--mirror` (force-updates every ref) and a bare `+ref` are force-pushes the text rule reads past.
    const lease = rest.some((a) => a.startsWith('--force-with-lease'));
    const force = rest.some((a) => a === '--force' || a === '--mirror' || /^-[vqund46]*f[vqunfd46]*$/.test(a) || /^\+[^:\s]/.test(a));
    return force && !lease ? FORCE_PUSH : null;
  }
  if (sub === 'clean') {
    const shorts = rest.filter((a) => /^-[a-zA-Z]+$/.test(a)).join('');
    const dry = shorts.includes('n') || rest.includes('--dry-run');
    const force = shorts.includes('f') || rest.includes('--force') || cleanUnforced;
    return force && !dry ? recursiveDelete('Recursive force-delete of untracked files (`git clean -f`).') : null;
  }
  if (GIT_BUILTINS.has(sub)) return null;        // git never lets an alias shadow a builtin
  let value = inline.get(sub.toLowerCase());
  if (value === undefined) {
    const table = gitAliases(ctx, where);
    value = table.aliases.get(sub.toLowerCase());
    if (value === undefined) {
      if (!table.unreadable.length) return null;
      return {
        decision: 'ask',
        reason: `\`git ${sub}\` is not a git command, so it may be an alias, and the alias table could not be `
          + `read (${table.unreadable.join('; ')}). An alias can expand to a push or to a shell command.`,
      };
    }
  }
  const after = rawArgs.slice(j + 1).join(' ');
  if (value.startsWith('!')) return nested(`${value.slice(1)} ${after}`);
  return nested(`git ${rawArgs.slice(0, j).join(' ')} ${value} ${after}`);
}

// Aliases are read with `git config --file <f> --includes --get-regexp ^alias\.` against the user's
// and the repository's config, which executes nothing. A file with no [alias] or [include] section
// costs one read and no spawn, and every file is read once per process (the hook is one process per
// call). Only ENOENT is "no aliases": any other read failure is reported, never taken as none.
const aliasCache = new Map();

function gitAliases(ctx, where) {
  const env = { ...(ctx.env ?? process.env), ...where.env };
  const home = ctx.home ?? env.HOME ?? homedir();
  const cwd = ctx.cwd ?? process.cwd();
  const files = env.GIT_CONFIG_GLOBAL
    ? [env.GIT_CONFIG_GLOBAL]
    : [join(env.XDG_CONFIG_HOME || join(home, '.config'), 'git', 'config'), join(home, '.gitconfig')];
  const base = where.cdir ?? cwd;
  const gd = where.gitDir ? resolve(base, where.gitDir) : findGitDir(base);
  if (gd) files.push(...repoConfigFiles(gd));
  const aliases = new Map();
  const unreadable = [];
  for (const f of files) {
    const r = readAliases(resolve(cwd, f));
    if (r.unreadable) unreadable.push(r.unreadable);
    else for (const [k, v] of r.aliases) aliases.set(k, v);
  }
  return { aliases, unreadable };
}

function findGitDir(dir) {
  let d = resolve(dir);
  for (let n = 0; n < 64; n += 1) {
    const p = join(d, '.git');
    let st;
    try { st = statSync(p, { throwIfNoEntry: false }); } catch { return p; }   // unreadable ⇒ reported by the read
    if (st?.isDirectory()) return p;
    if (st?.isFile()) {
      try { const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(p, 'utf8')); return m ? resolve(d, m[1].trim()) : null; } catch { return p; }
    }
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}

function repoConfigFiles(gd) {
  let common = gd;
  try { common = resolve(gd, readFileSync(join(gd, 'commondir'), 'utf8').trim()); } catch { /* not a linked worktree */ }
  return [join(common, 'config'), join(gd, 'config.worktree')];
}

function readAliases(file) {
  if (aliasCache.has(file)) return aliasCache.get(file);
  let r;
  let text = null;
  try { text = readFileSync(file, 'utf8'); } catch (e) {
    r = e.code === 'ENOENT' || e.code === 'ENOTDIR' ? { aliases: new Map() } : { unreadable: `${file}: ${e.code ?? e.message}` };
  }
  if (text !== null) {
    if (!/^[ \t]*\[[ \t]*(?:alias|include|includeif)\b/im.test(text)) r = { aliases: new Map() };
    else {
      const p = spawnSync('git', ['config', '--file', file, '--includes', '--null', '--get-regexp', '^alias\\.'],
        { cwd: tmpdir(), encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });   // outside any repo: no discovery
      // status 1 is git's "no match"; anything else and the [alias] section is read by hand
      r = !p.error && !p.signal && (p.status === 0 || p.status === 1)
        ? { aliases: parseNullConfig(p.stdout) }
        : { aliases: parseAliasSection(text) };
    }
  }
  aliasCache.set(file, r);
  return r;
}

function parseNullConfig(out) {
  const m = new Map();
  for (const entry of String(out ?? '').split('\0')) {
    const nl = entry.indexOf('\n');
    const key = (nl < 0 ? entry : entry.slice(0, nl)).toLowerCase();
    if (key.startsWith('alias.')) m.set(key.slice(6), nl < 0 ? '' : entry.slice(nl + 1));
  }
  return m;
}

function parseAliasSection(text) {
  const m = new Map();
  let inAlias = false;
  for (const line of text.split('\n')) {
    const sec = /^\s*\[\s*([^\]\s"]+)/.exec(line);
    if (sec) { inAlias = sec[1].toLowerCase() === 'alias'; continue; }
    const kv = inAlias && /^\s*([\w-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (kv) m.set(kv[1].toLowerCase(), kv[2].replace(/^"([\s\S]*)"$/, '$1'));
  }
  return m;
}

// ---- find: -delete and -exec rm are bulk deletes ------------------------------
const FIND_CATASTROPHIC = [
  { re: /^\/\*?$/, what: 'the filesystem root' },
  { re: /^(?:~|\$HOME|\$\{HOME\})\/?$/, what: 'the home directory' },
  { re: /(?:^|\/)\.git\/?$/, what: "a repository's .git directory" },
];

function findCommand(args, rawArgs, nested) {
  let j = 0;
  while (j < args.length && /^-[HLPEXdsx]$/.test(args[j])) j += 1;
  const roots = [];
  while (j < args.length && !/^[-(!]/.test(args[j])) roots.push(args[j++]);
  let del = false;
  let other = null;
  for (let x = j; x < args.length; x += 1) {
    if (args[x] === '-delete') { del = true; continue; }
    if (!/^-(?:exec|execdir|ok|okdir)$/.test(args[x])) continue;
    let y = x + 1;
    while (y < args.length && args[y] !== ';' && args[y] !== '+') y += 1;
    if (y > x + 1) {
      if (/^(?:rm|unlink|shred|srm)$/.test(cmdName(args[x + 1]))) del = true;
      else {
        const v = nested(rawArgs.slice(x + 1, y).join(' '));
        if (v?.decision === 'deny') return v;
        other ??= v;
      }
    }
    x = y;
  }
  if (!del) return other;
  const c = roots.map((r) => FIND_CATASTROPHIC.find((x) => x.re.test(r))).find(Boolean);
  return c ? catastrophic(c.what) : recursiveDelete('Bulk delete through `find` (-delete or -exec rm).');
}

// ---- outbound writes that are not curl ---------------------------------------
const GH_WRITES = { gist: ['create'], issue: ['create', 'comment'], pr: ['create', 'comment'], release: ['create', 'upload'] };

function operands(args, valued) {
  const out = [];
  for (let j = 0; j < args.length; j += 1) {
    if (valued.test(args[j])) j += 1;
    else if (!args[j].startsWith('-')) out.push(args[j]);
  }
  return out;
}

/** `[user@]host:path`, `host::module`, `scp://…` → host; a local path → null. */
function remoteHost(w) {
  const url = /^(?:scp|sftp|rsync|ssh):\/\/(?:[^@/]+@)?(\[[^\]]+\]|[^/:]+)/.exec(w);
  if (url) return url[1];
  const m = /^(?:[^@/:\s]+@)?(\[[^\]]+\]|[A-Za-z0-9][\w.-]*):/.exec(w);
  return m ? m[1] : null;
}

function sendsOut(name, args) {
  if (name === 'gh') {
    if (args[0] === 'api') return ghApi(args.slice(1));
    return Object.hasOwn(GH_WRITES, args[0]) && GH_WRITES[args[0]].includes(args[1]) ? outbound(`GitHub (\`gh ${args[0]} ${args[1]}\`)`) : null;
  }
  if (name === 'curl' || name === 'wget') {
    // `-sd @f`: in a cluster of short curl flags only the last takes a value, and d/F/T is a body.
    const body = name === 'curl'
      ? args.some((a) => /^(?:--json|--form|--form-string|-T)$/.test(a) || (/^-[a-zA-Z]{2,}$/.test(a) && /[dFT]$/.test(a)))
      : args.some((a, j) => /^--body-(?:data|file)\b/.test(a)
        || /^(?:POST|PUT|PATCH|DELETE)$/i.test(/^--method=(.*)$/.exec(a)?.[1] ?? (a === '--method' ? args[j + 1] ?? '' : '')));
    if (!body) return null;
    const url = args.find((a) => /^https?:\/\//.test(a));
    return url && LOOPBACK.test(url) ? null : outbound(url);
  }
  if (name === 'scp' || name === 'rsync') {
    if (name === 'rsync' && args.some((a) => a === '--dry-run' || /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a))) return null;
    const ops = name === 'scp' ? operands(args, /^-[PioFclSJDX]$/) : args.filter((a) => !a.startsWith('-'));
    const host = ops.length >= 2 ? remoteHost(ops.at(-1)) : null;
    return host && !LOOPBACK_HOST.test(host) ? outbound(`${host} (${name})`) : null;
  }
  if (name === 'sftp') {
    const target = operands(args, /^-[BbcDFiJloPRSsX]$/)[0];
    const host = target && remoteHost(target.includes(':') ? target : `${target}:`);
    return host && !LOOPBACK_HOST.test(host) ? outbound(`${host} (sftp)`) : null;
  }
  if (name === 'nc' || name === 'ncat' || name === 'netcat') {
    if (args.some((a) => a === '--listen' || /^-[a-zA-Z]*[lz][a-zA-Z]*$/.test(a))) return null;   // a listener or a port scan
    const [host, port] = operands(args, /^-[pswxXiqecOITVGgMmP]$|^--(?:proxy|sh-exec|exec|source-port|wait)$/);
    return host && !LOOPBACK_HOST.test(host) ? outbound(`${host}${port ? `:${port}` : ''} (${name})`) : null;
  }
  if (name === 'socat') {
    for (const a of args) {
      const m = /^(?:TCP[46]?|UDP[46]?|SCTP|DCCP|OPENSSL|SSL|SOCKS4A?|PROXY)(?:-CONNECT)?:(\[[^\]]+\]|[^:,]+)/i.exec(a);
      if (m && !LOOPBACK_HOST.test(m[1])) return outbound(`${m[1]} (socat)`);
    }
  }
  return null;
}

// `gh api` sends a body for -X POST/PUT/PATCH/DELETE, for --input, and for any -f/-F field (gh then
// defaults to POST). A GraphQL read is a POST that writes nothing, so `graphql` is a write only
// when its query is a mutation or comes from a file this gate cannot read.
function ghApi(rest) {
  let method = null;
  let fields = false;
  let input = false;
  let endpoint = null;
  let opaque = false;
  const field = (v) => { fields = true; if (/^[^=]*=@/.test(v) || /\bmutation\b/.test(v)) opaque = true; };
  for (let j = 0; j < rest.length; j += 1) {
    const a = rest[j];
    let m;
    if (a === '-X' || a === '--method') { method = String(rest[++j] ?? '').toUpperCase(); continue; }
    if ((m = /^(?:-X|--method=)(.+)$/.exec(a))) { method = m[1].toUpperCase(); continue; }
    if (['-f', '-F', '--field', '--raw-field'].includes(a)) { field(rest[++j] ?? ''); continue; }
    if ((m = /^(?:-[fF]|--field=|--raw-field=)(.+)$/.exec(a))) { field(m[1]); continue; }
    if (a === '--input') { input = true; j += 1; continue; }
    if (a.startsWith('--input=')) { input = true; continue; }
    if (['-H', '--header', '-q', '--jq', '-t', '--template', '--hostname', '--cache', '-p', '--preview'].includes(a)) { j += 1; continue; }
    if (!a.startsWith('-')) endpoint ??= a;
  }
  const write = /^(?:POST|PUT|PATCH|DELETE)$/.test(method ?? '') || input
    || (fields && !method && (endpoint !== 'graphql' || opaque));
  return write ? outbound(`GitHub (\`gh api ${endpoint ?? ''}\`)`) : null;
}

// ── the verdict ──────────────────────────────────────────────────────────────

/**
 * Pure but for reading git alias config: command string → null (allow silently) | { decision, reason }.
 * Exported as the test seam. The stdin/JSON wrapper below adds no judgment of its own.
 * `ctx` = { cwd, home, env } for alias lookup; each defaults to this process's.
 */
export function judge(command, ctx = {}) {
  return judgeAt(command, ctx, 0);
}

function judgeAt(command, ctx, depth) {
  const raw = String(command ?? '');
  if (!raw.trim()) return null;
  const segs = lex(maskHeredocs(raw));
  const s = scrub(normaliseGit(normaliseWrappers(raw, segs)));
  const nested = (cmd) => (depth >= MAX_DEPTH ? tooDeep() : judgeAt(cmd, ctx, depth + 1));
  const checks = [
    ...(s.trim() ? RULES.map((rule) => () => rule(s)) : []),
    ...segs.map((seg) => () => perCommand(seg, ctx, nested)),
    ...[...raw.matchAll(HEREDOC_RUNNER)].map(([, prog, , , body]) => () => {
      if (/sh$/.test(prog)) return nested(body);
      const what = codeReads(body, true);
      return what ? credentialRead(what) : null;
    }),
  ];
  let ask = null;
  for (const check of checks) {
    let v = null;
    try { v = check(); } catch { v = null; }   // one broken rule must not silence the rest
    if (!v) continue;
    if (v.decision === 'deny') return v;       // strongest statement wins, and wins immediately
    if (!ask) ask = v;
  }
  return ask;
}

// The ledger directories are symlinks into the sidecar, so a tool may be handed either path form.
const LEDGER_PATH = /(?:\/\.claude\/(?:store|verdicts)\/|\/commitwork-sidecar\/(?:store|verdicts)\/)/;
const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** Pure: file-writing tool + path → null | { decision, reason }. */
export function judgeFileWrite(tool, filePath) {
  if (!FILE_WRITE_TOOLS.has(tool) || typeof filePath !== 'string' || !LEDGER_PATH.test(filePath)) return null;
  if (tool === 'Write') {
    return {
      decision: 'deny',
      reason:
        'Write replaces the whole file, and this is an append-only ledger under .claude/store or '
        + '.claude/verdicts. It is the same truncation a `>` redirect is refused for, and an emptied '
        + 'ledger reads as a clean store rather than a damaged one.\n'
        + '  · Append through the tool that owns the store (verdict-journal, touch-ledger).',
    };
  }
  return {
    decision: 'ask',
    reason:
      'This rewrites records in place in an append-only ledger under .claude/store or .claude/verdicts. '
      + 'Hash-chained entries edited after the fact break the chain, and nothing else holds a copy.',
  };
}

// The Read tool on key material is the same read `cat` is asked for. It reaches this hook only when
// the PreToolUse matcher that runs it includes `Read`.
/** Pure: Read + path → null | { decision, reason }, from the same credential-path list. */
export function judgeFileRead(tool, filePath) {
  if (tool !== 'Read' || typeof filePath !== 'string') return null;
  const what = secretIn(filePath);
  return what ? credentialRead(what) : null;
}

/** How far ahead of upstream we are, for the push reason. Best-effort: a fact if cheap, else silence. */
function aheadSummary() {
  try {
    const n = execFileSync('git', ['rev-list', '--count', '@{u}..HEAD'],
      { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (/^\d+$/.test(n) && +n > 0) return `HEAD is ${n} commit(s) ahead of upstream right now.`;
  } catch { /* no upstream, not a repo, git slow — the reason stands without the number */ }
  return 'Check how many commits are ahead of upstream before answering.';
}

// ── CLI ──────────────────────────────────────────────────────────────────────
//
// EVERYTHING BELOW IS GUARDED ON BEING THE ENTRY MODULE, and that is not tidiness. Attaching the
// stdin listener at import time made `import { judge }` hang forever in the test process: node
// stays alive while a readable stream has a listener and no 'end' ever arrives. The test suite hung
// at 120s rather than failing, which is the worse outcome — a suite that hangs gets its file
// excluded, and an excluded test file is a gate nobody runs.

const isEntry = isMainModule(import.meta.url);

// `--selftest` is the liveness witness. A hook whose script is missing or broken exits non-zero,
// which Claude Code treats as a NON-BLOCKING error — the gate stays listed in settings.json and
// enforces nothing. Configured is not running, so the installed path has to be asked directly.
if (isEntry && process.argv.includes('--selftest')) {
  const cases = [
    ['git push --force origin main', 'deny'],
    ['rm -rf /', 'deny'],
    ['ls -la', null],
  ];
  let bad = 0;
  for (const [cmd, want] of cases) {
    const got = judge(cmd)?.decision ?? null;
    if (got !== want) { console.error(`selftest FAIL: ${cmd} → ${got}, want ${want}`); bad++; }
  }
  console.log(bad ? `guard-destructive: ${bad} selftest failure(s)` : 'guard-destructive: live (3/3)');
  process.exit(bad ? 1 : 0);
}

if (isEntry && process.stdin.isTTY) {
  console.error('guard-destructive.mjs reads a PreToolUse payload on stdin. Try --selftest.');
  process.exit(0);
}

if (isEntry) readPayload();

function readPayload() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    let payload = null;
    try { payload = JSON.parse(raw); }
    catch { process.exit(0); }            // an unreadable payload is not this gate's to judge
    const input = payload?.tool_input ?? {};
    const cmd = input.command;
    const filePath = input.file_path ?? input.notebook_path;

    let v = null;
    try {
      if (typeof cmd === 'string' && cmd) v = judge(cmd, { cwd: typeof payload?.cwd === 'string' ? payload.cwd : undefined });
      else if (typeof filePath === 'string') v = judgeFileWrite(payload?.tool_name, filePath) ?? judgeFileRead(payload?.tool_name, filePath);
    } catch { v = null; }
    if (!v) process.exit(0);

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: v.decision,
        permissionDecisionReason: v.reason,
      },
    }));
    process.exit(0);
  });
}
