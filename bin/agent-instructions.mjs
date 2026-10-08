#!/usr/bin/env node
// usage: agent-instructions.mjs [rootDir]
// env, read at call time: CW_AGENT_INSTR_ROOT, CW_AGENT_INSTR_MAX_BYTES, CW_SCAN_EXCLUDE_DIRS
// exit: 0 ran (findings or none, filesScanned 0 is a declared void) · 2 could not run
// writes: JSON to stdout {tool, summary:{findings, byRule, filesScanned, filesSkipped, ...voids}, findings:[{rule, path, sev, cwe, detail}]}
//
// fact: every detail is counts, code points, line numbers, paths, variable names and hosts — never a quoted line / an instruction file is addressed to the model that will read the report (expiry: never, prev: not built)
import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, relative, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirExcluder } from './scan-exclusions.mjs';
import { HIDDEN_TEXT } from './minify-detect.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// one definition of "hidden character", shared with minify-detect's bidi-homoglyph rule
const HIDDEN_ALL = new RegExp(HIDDEN_TEXT.source, 'gu');

const __dirname = dirname(fileURLToPath(import.meta.url));
const SELF_ROOT = resolve(__dirname, '..');
const SELF_CANARY_DIR = 'fixtures/scan-canary/dirty/';
const maxBytes = () => {
  const n = Number(process.env.CW_AGENT_INSTR_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 2_000_000;
};

export const SEVERITY = Object.freeze({
  'hidden-unicode': 'high',
  'html-comment-directive': 'high',
  'agent-directive-exec': 'high',
  'agent-directive-exfil': 'crit',
  'encoded-blob': 'med',
  'directive-split-across-files': 'high',
  'directive-in-command-file': 'high',
  'guard-bypass-directive': 'crit',
  'instruction-env-indirection': 'med',
});
// encoded-blob is CWE-506: the hazard is a concealed payload in a file whose whole purpose is to be read, not the injection path
export const RULE_CWE = Object.freeze({
  'hidden-unicode': 'CWE-1427',
  'html-comment-directive': 'CWE-1427',
  'agent-directive-exec': 'CWE-1427',
  'agent-directive-exfil': 'CWE-1427',
  'encoded-blob': 'CWE-506',
  'directive-split-across-files': 'CWE-1427',
  'directive-in-command-file': 'CWE-1427',
  'guard-bypass-directive': 'CWE-693',
  'instruction-env-indirection': 'CWE-829',
});

// dedicated instruction files: every line is addressed to an agent; README/docs need an address cue
const INSTRUCTION_FILE = /(^|\/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|\.windsurfrules|\.aider[^/]*|\.cursor\/rules\/[^/]+|\.github\/copilot-instructions\.md)$/i;
const DOC_FILE = /(^|\/)README\.md$|^docs\/.*\.md$/i;
const DOTDIR_MD = /(^|\/)\.(claude|cursor|github)\/.*\.md$/i;
// executed prompts: a slash command or a cursor rule runs as-is, so no heading or cue can excuse a directive there
const COMMAND_FILE = /(^|\/)\.claude\/commands\/.*\.md$|(^|\/)\.cursor\/rules\/[^/]+$/i;
export function isInstructionFile(rel) {
  return INSTRUCTION_FILE.test(rel) || DOTDIR_MD.test(rel) || DOC_FILE.test(rel);
}
export const isCommandFile = (rel) => COMMAND_FILE.test(rel);
const dedicated = (rel) => INSTRUCTION_FILE.test(rel) || DOTDIR_MD.test(rel);

const SHELL_VERB = /\b(?:curl|wget|iwr|Invoke-WebRequest|bash|zsh|sh|npx|npm\s+(?:i|install)|pip3?\s+install|pipx\s+install|eval|chmod|sudo|powershell)\b/i;
const URL = /\bhttps?:\/\/[^\s)>'"]+/i;
const AGENT_NOUN = /\b(?:agent|assistant|claude|copilot|cursor|gemini|codex|gpt|llm|ai|model|system prompt)\b/i;
const IMPERATIVE = /\b(?:must|should|always|never|do not|don't|ignore|disregard|run|execute|send|read|fetch|download|install|open)\b/i;
const IGNORE_PREVIOUS = /\b(?:ignore|disregard|forget)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all)\b[^.\n]{0,40}\b(?:instruction|rule|prompt|guideline)/i;
const LICENCE = /\b(?:licen[cs]e|copyright|spdx-license-identifier)\b/i;
const ADDRESS_CUE = /\b(?:agent|assistant|claude|copilot|cursor|gemini|codex|llm|ai|you must|always run|before (?:you )?(?:start|begin|commit|answer)|first,? run)\b/i;
const INSTALL_HEADING = /^#{1,6}\s.*\b(?:install|installation|setup|set ?up|getting started|prerequisites|requirements|quick ?start|build(?:ing)? from source|deploy(?:ment)?)\b/i;

const FETCH_RUN = [
  /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python3?|node|perl|ruby)\b/i,
  /\b(?:sh|bash|zsh)\s+<\(\s*(?:curl|wget)\b/i,
  /\b(?:curl|wget)\b[^\n]*(?:&&|;)\s*(?:sudo\s+)?(?:sh|bash|chmod|\.\/)/i,
  /\b(?:pip3?|pipx)\s+install\s+(?:git\+)?https?:\/\//i,
  /\bnpm\s+(?:i|install)\s+(?:git\+)?https?:\/\//i,
  /\bpowershell\b[^\n]*\b(?:DownloadString|DownloadFile|iwr|Invoke-WebRequest)\b/i,
];

const CRED_PATH = /~\/\.ssh|\.ssh\/|\bid_(?:rsa|ed25519|ecdsa|dsa)\b|\.aws\/|\.npmrc\b|\.pypirc\b|\.netrc\b|\.git-credentials\b|\.docker\/config\.json|\.kube\/config|\.gnupg\b|\/etc\/(?:passwd|shadow)\b|\bkeychain\b|(?:^|[\s`'"(])\.env(?:\.[A-Za-z]+)?\b|\bprintenv\b|\benv\s*\|/i;
const CRED_VAR = /\$\{?[A-Za-z_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z_]*\}?|process\.env\.[A-Za-z_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Za-z_]*|\b(?:GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|NPM_TOKEN)\b/;
const CRED_WORD = /\b(?:api[_ -]?keys?|access[_ -]?tokens?|auth[_ -]?tokens?|credentials?|secrets?|private[_ -]?keys?|passwords?|environment variables?|env vars?)\b/i;
const READ_VERB = /\b(?:cat|read|print|echo|dump|collect|copy|grab|list|include|attach|output|reveal|show|display|gather|extract)\b/i;
// a bare URL is a link, not a sink: it needs a transport word in front of it
const SEND_SINK = /\b(?:curl|wget|nc|netcat|scp|rsync)\b|\b(?:to|into|via|toward|POST|upload|send|submit|forward)\s+`?https?:\/\/|\bwebhook\b|pastebin|ngrok|requestbin|transfer\.sh|discord\.com\/api|hooks\.slack\.com|\b(?:send|sends|upload|uploads|transmit|exfiltrate|e-?mail|paste|submit|forward|POST)\s+(?:it|them|this|that|the|all|these|those|its|your|my|every|any|a)\b/i;
const SHELL_SEND = /\b(?:curl|wget|nc|netcat|scp|rsync)\b/i;
const NEGATED_SEND = /\b(?:never|do not|don't|must not|should not|shouldn't|avoid)\s+(?:\w+\s+){0,3}(?:send|upload|post|e-?mail|curl|wget|transfer|exfiltrate|share|paste)/i;
const GITIGNORE_CONTEXT = /\bgitignore\b|\b(?:never|do not|don't|not)\s+(?:be\s+)?commit(?:ted)?\b|\buntracked\b/i;

const BASE64_RUN = /[A-Za-z0-9+/]{200,}={0,2}|[A-Za-z0-9_-]{200,}/;
const HEX_RUN = /\b[0-9a-fA-F]{200,}\b/;
const IMAGE_DATA_URI = /<img\b[^>]*\bsrc=["']data:image\/|!\[[^\]]*\]\(\s*data:image\//i;

// the fetched text is executed, but no FETCH_RUN shape is on the line: eval/source of a substitution
const EXEC_OF_SUBST = /\b(?:eval|source|exec|sh|bash|zsh)\s+[^\n]*\$\(\s*(?:curl|wget|iwr|Invoke-WebRequest)\b|(?:\bsource|(?:^|[\s;&|])\.)\s+<\(\s*(?:curl|wget)\b/i;
const INDIRECT_VAR = /\$\{?([A-Z0-9_]*(?:INSTRUCTION|PROMPT|SETUP|BOOTSTRAP|SCRIPT|RULES|PLAYBOOK|AGENT|POLICY|TASK|COMMAND|INSTALL|MANIFEST)[A-Z0-9_]*)\}?/g;
const INDIRECT_VERB = /\b(?:run|execute|eval|source|fetch|read|follow|load|apply|obey|download|bash|sh|curl|wget|import)\b/i;
const EXEC_OF_VAR = /\b(?:eval|source|exec|sh|bash|zsh)\s+[^\n]*\$\{?([A-Z0-9_]*(?:URL|URI|ENDPOINT|HOST|SCRIPT|CMD|COMMAND)[A-Z0-9_]*)\}?|\b(?:curl|wget)\b[^\n]*\$\{?([A-Z0-9_]*(?:URL|URI|ENDPOINT|HOST)[A-Z0-9_]*)\}?[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python3?|node)\b/i;
const ANY_VAR = /\$\{?([A-Z][A-Z0-9_]*)\}?/g;

const GUARD_BYPASS = /--no-verify\b|\bHUSKY=0\b|\bSKIP_HOOKS?=|\bCW_GUARD[A-Z_]*\s*=\s*(?:off|0|false|no)\b|\bcore\.hooksPath\b|\b(?:skip|bypass|disable|circumvent|turn off|ignore|remove|silence)\b[^.\n]{0,40}\b(?:guards?|hooks?|pre-commit|precommit|pre-push|gates?)\b/i;
const GUARD_BYPASS_ALL = new RegExp(GUARD_BYPASS.source, 'gi');
const NEGATED_BYPASS = /\b(?:never|do not|don't|must not|should not|shouldn't|avoid|without|not)\b[^.\n]{0,40}$/i;

// a reference only counts as a directive when the line tells the reader to ACT on the target
const REF_IMPERATIVE = /\b(?:follow|run|execute|apply|complete|perform|obey|carry out|work through)\b|\b(?:must|always|first)\s+(?:read|follow|run|do|open)\b|\bbefore\s+(?:any|every|each|starting|you)\b/i;
const MD_LINK = /\[[^\]]*\]\(\s*<?([^)\s>#?]+)(?:[#?][^)]*)?>?\s*\)/g;
const AT_REF = /(?:^|[\s(])@((?:\.{1,2}\/)?[\w./-]+)/g;
const BARE_REF = /(?:^|[\s`'"(])((?:\.{1,2}\/)?(?:[\w-]+\/)*[\w-]+\.(?:md|mdc|txt))\b/gi;

// counts only: which trigger kinds fired, how many comments, where the first one starts
function htmlComments(text) {
  const out = [];
  let i = 0;
  for (;;) {
    const open = text.indexOf('<!--', i);
    if (open < 0) break;
    const close = text.indexOf('-->', open + 4);
    if (close < 0) break;
    const line = text.slice(0, open).split('\n').length;
    out.push({ body: text.slice(open + 4, close), line, start: open, end: close + 3 });
    i = close + 3;
  }
  return out;
}

function commentTriggers(body) {
  const kinds = [];
  if (SHELL_VERB.test(body)) kinds.push('shell-verb');
  if (IGNORE_PREVIOUS.test(body) || (AGENT_NOUN.test(body) && IMPERATIVE.test(body))) kinds.push('agent-imperative');
  if (URL.test(body) && !LICENCE.test(body)) kinds.push('url');
  return kinds;
}

const fmtCps = (counts) => [...counts.entries()].sort((a, b) => a[0] - b[0])
  .map(([cp, n]) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}×${n}`).join(' ');

const hostOf = (url) => { const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^:/?#]+)/i.exec(url); return m ? m[1].toLowerCase() : ''; };

/** Names (variables, hosts) a directive line resolves its target through at run time; null when it does not. */
function indirectionOn(line) {
  const vars = new Set(), hosts = new Set();
  let hit = false;
  if (EXEC_OF_SUBST.test(line)) {
    hit = true;
    for (const m of line.matchAll(new RegExp(URL.source, 'gi'))) { const h = hostOf(m[0]); if (h) hosts.add(h); }
    if (!hosts.size) for (const m of line.matchAll(ANY_VAR)) if (!/^(?:HOME|PWD|USER|TMPDIR)$/.test(m[1])) vars.add(m[1]);
  }
  const ev = EXEC_OF_VAR.exec(line);
  if (ev) { hit = true; vars.add(ev[1] || ev[2]); }
  if (INDIRECT_VERB.test(line)) {
    for (const m of line.matchAll(INDIRECT_VAR)) { hit = true; vars.add(m[1]); }
  }
  return hit ? { vars: [...vars], hosts: [...hosts] } : null;
}

/** Scan one file's text. Returns findings (one per rule) with counts-only detail. */
export function scanText(rel, text) {
  const findings = [];
  const lines = text.replace(/^\uFEFF/, '').split('\n');
  const push = (rule, detail) => findings.push({ rule, path: rel, sev: SEVERITY[rule], cwe: RULE_CWE[rule], detail });

  const cps = new Map(); let hiddenLines = 0, firstHidden = 0;
  lines.forEach((line, i) => {
    const hits = line.match(HIDDEN_ALL);
    if (!hits) return;
    hiddenLines++; if (!firstHidden) firstHidden = i + 1;
    for (const ch of hits) { const cp = ch.codePointAt(0); cps.set(cp, (cps.get(cp) || 0) + 1); }
  });
  if (hiddenLines) push('hidden-unicode', `${[...cps.values()].reduce((a, b) => a + b, 0)} hidden code point(s) on ${hiddenLines} line(s), first at line ${firstHidden}: ${fmtCps(cps)}`);

  const comments = htmlComments(text);
  const fired = comments.map((c) => ({ ...c, kinds: commentTriggers(c.body) })).filter((c) => c.kinds.length);
  if (fired.length) {
    const kinds = [...new Set(fired.flatMap((c) => c.kinds))].sort();
    push('html-comment-directive', `${fired.length} of ${comments.length} HTML comment(s) carry a directive, first at line ${fired[0].line}: ${kinds.join(', ')}`);
  }
  const inComment = commentLineSet(text);

  const isDedicated = dedicated(rel);
  const isCommand = isCommandFile(rel);
  let heading = '';
  let execLines = 0, firstExec = 0;
  let exfilLines = 0, firstExfil = 0;
  let indirectLines = 0, firstIndirect = 0;
  const indirectVars = new Set(), indirectHosts = new Set();
  let cmdExec = 0, cmdExfil = 0, firstCmd = 0;
  let bypassLines = 0, firstBypass = 0;
  lines.forEach((line, i) => {
    if (/^#{1,6}\s/.test(line)) heading = line;
    const ln = i + 1;
    if (inComment.has(ln)) return;
    const window = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
    const addressed = isDedicated || ADDRESS_CUE.test(window);
    const fetchRun = FETCH_RUN.some((re) => re.test(line));
    if (fetchRun && !INSTALL_HEADING.test(heading) && addressed) {
      execLines++; if (!firstExec) firstExec = ln;
    }
    // the sink is on THIS line, the credential within the two above it; the generic nouns need
    // their read verb on the same line, or a doc link two lines under the word "secret" fires
    const cred = CRED_PATH.test(window) || CRED_VAR.test(window);
    // A generic noun with a read verb and a send phrase is how a threat model DESCRIBES exfiltration;
    // outside a dedicated instruction file it counts only when addressed to an agent. A concrete
    // credential path or variable beside a sink still fires everywhere.
    const credWord = CRED_WORD.test(line) && READ_VERB.test(line) && addressed;
    let exfilPair = false;
    if ((cred || credWord) && SEND_SINK.test(line)) {
      const negated = NEGATED_SEND.test(window) && !SHELL_SEND.test(line);
      const gitignore = GITIGNORE_CONTEXT.test(window) && !SHELL_SEND.test(line);
      if (!negated && !gitignore) { exfilPair = true; exfilLines++; if (!firstExfil) firstExfil = ln; }
    }
    const indirect = indirectionOn(line);
    if (indirect && !INSTALL_HEADING.test(heading) && addressed) {
      indirectLines++; if (!firstIndirect) firstIndirect = ln;
      for (const v of indirect.vars) indirectVars.add(v);
      for (const h of indirect.hosts) indirectHosts.add(h);
    }
    if (isCommand) {
      if (fetchRun) { cmdExec++; if (!firstCmd) firstCmd = ln; }
      if (exfilPair) { cmdExfil++; if (!firstCmd) firstCmd = ln; }
      const live = [...line.matchAll(GUARD_BYPASS_ALL)].some((m) => !NEGATED_BYPASS.test(line.slice(Math.max(0, m.index - 60), m.index)));
      if (live) { bypassLines++; if (!firstBypass) firstBypass = ln; }
    }
  });
  if (execLines) push('agent-directive-exec', `${execLines} line(s) instruct fetching from the network and executing the result, first at line ${firstExec}`);
  if (exfilLines) push('agent-directive-exfil', `${exfilLines} line(s) pair a credential path or variable with a send sink, first at line ${firstExfil}`);
  if (indirectLines) {
    const named = [];
    if (indirectVars.size) named.push(`variables ${[...indirectVars].sort().join(', ')}`);
    if (indirectHosts.size) named.push(`hosts ${[...indirectHosts].sort().join(', ')}`);
    push('instruction-env-indirection', `${indirectLines} line(s) take a directive target from an environment variable or a fetched substitution, first at line ${firstIndirect}: ${named.join('; ')}`);
  }
  if (cmdExec + cmdExfil) push('directive-in-command-file', `${cmdExec + cmdExfil} exec/exfil directive line(s) in an executed prompt, first at line ${firstCmd}: fetch-and-execute ×${cmdExec}, credential-to-sink ×${cmdExfil}`);
  if (bypassLines) push('guard-bypass-directive', `${bypassLines} line(s) instruct disabling or bypassing a hook or guard, first at line ${firstBypass}`);

  let blobs = 0, firstBlob = 0, longest = 0;
  lines.forEach((line, i) => {
    if (IMAGE_DATA_URI.test(line)) return;
    const m = BASE64_RUN.exec(line) || HEX_RUN.exec(line);
    if (!m) return;
    blobs++; if (!firstBlob) firstBlob = i + 1;
    longest = Math.max(longest, m[0].length);
  });
  if (blobs) push('encoded-blob', `${blobs} encoded run(s) of 200+ chars, longest ${longest}, first at line ${firstBlob}`);

  return findings;
}

const commentLineSet = (text) => {
  const set = new Set();
  for (const c of htmlComments(text)) {
    const from = text.slice(0, c.start).split('\n').length, to = text.slice(0, c.end).split('\n').length;
    for (let l = from; l <= to; l++) set.add(l);
  }
  return set;
};

/** The executable payload a file carries when read as a directive: fetch-and-execute and credential-to-sink lines, no heading or cue exemption. */
function payloadOf(text) {
  const lines = text.replace(/^\uFEFF/, '').split('\n');
  const skip = commentLineSet(text);
  let fetch = 0, exfil = 0, first = 0;
  lines.forEach((line, i) => {
    if (skip.has(i + 1)) return;
    const window = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
    if (FETCH_RUN.some((re) => re.test(line)) || EXEC_OF_SUBST.test(line)) { fetch++; if (!first) first = i + 1; }
    const cred = CRED_PATH.test(window) || CRED_VAR.test(window);
    const credWord = CRED_WORD.test(line) && READ_VERB.test(line);
    if ((cred || credWord) && SEND_SINK.test(line)) {
      const negated = NEGATED_SEND.test(window) && !SHELL_SEND.test(line);
      const gitignore = GITIGNORE_CONTEXT.test(window) && !SHELL_SEND.test(line);
      if (!negated && !gitignore) { exfil++; if (!first) first = i + 1; }
    }
  });
  return { fetch, exfil, first };
}

/** Relative file references on one line: markdown links, `@path` includes, bare `path.md` tokens. */
function refsOn(line) {
  const out = new Set();
  for (const re of [MD_LINK, AT_REF, BARE_REF]) {
    for (const m of line.matchAll(re)) {
      const ref = m[1];
      if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('#')) continue;
      out.add(ref);
    }
  }
  return [...out];
}

/**
 * One hop across files: a line in A that tells the reader to act on B, where B carries a payload the
 * lexical rules excuse in B alone. `texts` is rel → text for every instruction file in the tree.
 */
export function crossFileFindings(texts) {
  const findings = [];
  const payloads = new Map();
  const payload = (rel) => { if (!payloads.has(rel)) payloads.set(rel, payloadOf(texts.get(rel))); return payloads.get(rel); };
  const resolveRef = (from, ref) => {
    const clean = ref.replace(/^\.\//, '');
    for (const cand of [posix.normalize(posix.join(posix.dirname(from), clean)), posix.normalize(clean)]) {
      if (cand !== from && !cand.startsWith('../') && texts.has(cand)) return cand;
    }
    return null;
  };
  for (const [rel, text] of [...texts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const lines = text.replace(/^\uFEFF/, '').split('\n');
    const skip = commentLineSet(text);
    const targets = new Map();
    let refLines = 0, first = 0;
    lines.forEach((line, i) => {
      // An inline code span is a name (the `run` command), not an instruction to follow a file.
      if (skip.has(i + 1) || !REF_IMPERATIVE.test(line.replace(/`[^`\n]*`/g, ''))) return;
      let counted = false;
      for (const ref of refsOn(line)) {
        const target = resolveRef(rel, ref);
        if (!target) continue;
        const p = payload(target);
        if (!p.fetch && !p.exfil) continue;
        targets.set(target, p);
        if (!counted) { counted = true; refLines++; if (!first) first = i + 1; }
      }
    });
    if (!targets.size) continue;
    const list = [...targets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([t, p]) => `${t} (fetch-and-execute ×${p.fetch}, credential-to-sink ×${p.exfil}, first at line ${p.first})`);
    findings.push({ rule: 'directive-split-across-files', path: rel, sev: SEVERITY['directive-split-across-files'], cwe: RULE_CWE['directive-split-across-files'],
      detail: `${refLines} directive line(s), first at line ${first}, reference ${targets.size} instruction file(s) carrying a payload: ${list.join('; ')}` });
  }
  return findings;
}

/** Walk a tree, scan every instruction file, return the report object plus an exit code. */
export function scanTree(rootArg) {
  const root = resolve(rootArg || process.env.CW_AGENT_INSTR_ROOT || '.');
  let skipDir;
  try { skipDir = dirExcluder(); } catch (e) {
    return { code: 2, report: { tool: 'agent-instructions', summary: { findings: 0, byRule: {}, filesScanned: 0, filesSkipped: [], void: `exclusion policy unreadable: ${e.message}` }, findings: [] } };
  }
  let selfScan = false;
  try { selfScan = realpathSync(root) === realpathSync(SELF_ROOT); } catch { selfScan = false; }
  try { if (!statSync(root).isDirectory()) throw new Error('not a directory'); } catch (e) {
    return { code: 2, report: { tool: 'agent-instructions', summary: { findings: 0, byRule: {}, filesScanned: 0, filesSkipped: [], void: `root unreadable: ${e.code || e.message}` }, findings: [] } };
  }
  const findings = [];
  const filesSkipped = [];
  const texts = new Map();
  let filesScanned = 0, selfCanary = 0;
  const cap = maxBytes();
  const rel = (p) => relative(root, p).split('\\').join('/');
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch (e) { filesSkipped.push({ path: rel(dir) || '.', reason: e.code || 'readdir-error' }); return; }
    for (const name of entries.sort()) {
      const p = join(dir, name);
      if (skipDir(rel(p))) continue;
      let st; try { st = statSync(p); } catch (e) { filesSkipped.push({ path: rel(p), reason: e.code || 'stat-error' }); continue; }
      if (st.isDirectory()) { walk(p); continue; }
      const r = rel(p);
      if (!isInstructionFile(r)) continue;
      if (selfScan && r.startsWith(SELF_CANARY_DIR)) { selfCanary++; continue; }
      if (st.size > cap) { filesSkipped.push({ path: r, reason: 'oversize', bytes: st.size }); continue; }
      let text;
      try { text = readFileSync(p, 'utf8'); } catch (e) { filesSkipped.push({ path: r, reason: e.code || 'unreadable' }); continue; }
      filesScanned++;
      texts.set(r, text);
      findings.push(...scanText(r, text));
    }
  };
  walk(root);
  findings.push(...crossFileFindings(texts));
  findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const summary = { findings: findings.length, byRule, filesScanned, filesSkipped };
  if (filesScanned === 0) summary.void = 'no instruction files found — a walk that examined nothing is not a clean result';
  if (selfCanary) summary.selfCanarySetAside = selfCanary;
  return { code: 0, report: { tool: 'agent-instructions', summary, findings } };
}

if (isMainModule(import.meta.url)) {
  const { code, report } = scanTree(process.argv[2]);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (code) process.stderr.write(`agent-instructions: ${report.summary.void}\n`);
  process.exit(code);
}
