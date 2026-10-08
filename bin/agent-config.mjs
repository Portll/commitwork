#!/usr/bin/env node
// agent-config.mjs — the TARGET repo's agent configuration: MCP servers, hooks and the scripts they
// run, command prompts, permission grants and inline env secrets. Reports rule ids, paths, hosts,
// package names, variable names and KEY NAMES — never a configured value, because the value is the
// thing that must not travel. A config file's `include` list is followed inside the target tree and
// the result is reported as `effective`: source-attributed declarations plus every include that could
// not be resolved. Every read is bounded to the tree; nothing read is executed.
//
//   node bin/agent-config.mjs [rootDir]        exit 0 ran · 2 could not run
//   env, read at call time: CW_AGENT_CONFIG_ROOT (overrides rootDir), CW_AGENT_CONFIG_MAX_BYTES (per-file cap, default 1 MiB)
import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, relative, resolve, basename, isAbsolute, sep } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { resolveAgentConfig, redactRule, REDACTED } from '../lib/security-agent-effective-config.mjs';

// [rule, cwe, sev] rows rather than two keyed objects: a rule id containing "secret" beside a string
// literal reads as a hardcoded credential to bearer (javascript_lang_hardcoded_secret, sweep 2026-09-16)
const RULES = [
  ['mcp-remote-server', 'CWE-829', 'high'],
  ['mcp-command-shell', 'CWE-829', 'high'],
  ['hook-shell-out', 'CWE-829', 'high'],
  ['permissions-allow-broad', 'CWE-250', 'med'],
  ['env-secret-inline', 'CWE-798', 'crit'],
  ['mcp-host-from-env', 'CWE-829', 'med'],
  ['hook-script-content', 'CWE-829', 'high'],
  ['command-file-shell', 'CWE-829', 'high'],
  ['permissions-deny-missing', 'CWE-250', 'low'],
];
export const RULE_CWE = Object.freeze(Object.fromEntries(RULES.map(([rule, cwe]) => [rule, cwe])));
export const RULE_SEV = Object.freeze(Object.fromEntries(RULES.map(([rule, , sev]) => [rule, sev])));

export const CONFIG_FILES = Object.freeze([
  '.mcp.json', '.claude/settings.json', '.claude/settings.local.json', '.cursor/mcp.json', '.vscode/mcp.json',
]);
export const CONFIG_DIRS = Object.freeze(['.claude/hooks', '.claude/commands']);

const maxBytes = () => {
  const n = Number(process.env.CW_AGENT_CONFIG_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 1024 * 1024;
};

// ── JSON with comments and trailing commas (.vscode/mcp.json is JSONC) ───────────────────────────
function outsideStrings(text, fn) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[i + 1] ?? ''; i += 2; continue; }
      if (c === '"') inStr = false;
      i += 1; continue;
    }
    if (c === '"') { inStr = true; out += c; i += 1; continue; }
    const r = fn(text, i);
    if (r === null) { out += c; i += 1; } else i = r;
  }
  return out;
}

// Two passes, comments first: a trailing comma followed by a comment is only visible as trailing
// once the comment is gone.
function stripJsonc(text) {
  const noComments = outsideStrings(text, (t, i) => {
    if (t[i] === '/' && t[i + 1] === '/') { let j = i; while (j < t.length && t[j] !== '\n') j += 1; return j; }
    if (t[i] === '/' && t[i + 1] === '*') { const e = t.indexOf('*/', i + 2); return e < 0 ? t.length : e + 2; }
    return null;
  });
  return outsideStrings(noComments, (t, i) => {
    if (t[i] !== ',') return null;
    let j = i + 1;
    while (j < t.length && /\s/.test(t[j])) j += 1;
    return t[j] === '}' || t[j] === ']' ? i + 1 : null;
  });
}

/** Strict JSON first; JSONC (comments, trailing commas) second; `{error}` when neither parses. */
export function parseJsonc(text) {
  try { return { value: JSON.parse(text) }; } catch { /* try the lenient grammar */ }
  try { return { value: JSON.parse(stripJsonc(text)) }; } catch (e) { return { error: e.message }; }
}

// ── hosts ────────────────────────────────────────────────────────────────────────────────────────
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|::1|0:0:0:0:0:0:0:1)$/i;
const URL_RE = /\b(?:https?|wss?|ftp|ssh|git):\/\/[^\s"'`<>)\]]+/gi;

/** The host of a URL, lower-cased, with any userinfo and port stripped; '' for a non-URL. */
export function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(String(url || '').trim());
  return m ? m[1].replace(/^\[|\]$/g, '').toLowerCase() : '';
}
export const isLoopback = (host) => LOOPBACK.test(host);

const remoteHosts = (text) => {
  const hosts = new Set();
  for (const m of String(text || '').matchAll(URL_RE)) {
    const h = hostOf(m[0]);
    if (h && !isLoopback(h)) hosts.add(h);
  }
  return [...hosts].sort();
};

// ── MCP server commands ──────────────────────────────────────────────────────────────────────────
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'curl', 'wget']);
export const isLocalSpec = (s) => /^(?:\.|\/|~|file:|[A-Za-z]:\\)/.test(s);

/** The package an `npx` invocation runs: first non-flag argument, or the `-p/--package` value. */
export function npxPackage(args) {
  const a = (args || []).map(String);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '-p' || a[i] === '--package') return a[i + 1] || '';
    if (a[i].startsWith('-')) continue;
    return a[i];
  }
  return '';
}

/** `name@1.2.3` is pinned; `name`, `name@latest`, `name@next` are not (a dist-tag moves). */
export function isPinned(spec) {
  const m = /^(@[^/@]+\/[^@]+|[^@]+)@(.+)$/.exec(String(spec || ''));
  return !!m && /^v?\d/.test(m[2]);
}
export const packageName = (spec) => { const m = /^(@[^/@]+\/[^@]+|[^@]+)(?:@.*)?$/.exec(spec); return m ? m[1] : spec; };

/** Why a server `command` is a shell-out, or '' when it is a plain program. */
export function commandShell(command, args) {
  const bin = basename(String(command || '')).toLowerCase().replace(/\.exe$/, '');
  const a = (args || []).map(String);
  if (SHELLS.has(bin)) return `command is ${bin}`;
  if ((bin === 'node' || bin === 'deno' || bin === 'bun') && a.some((x) => ['-e', '--eval', '-p', '--print'].includes(x))) return `${bin} evaluates inline code`;
  if (/^python\d*(?:\.\d+)?$/.test(bin) && a.includes('-c')) return `${bin} evaluates inline code`;
  if (bin === 'npx') {
    const pkg = npxPackage(a);
    if (pkg && !isLocalSpec(pkg) && !isPinned(pkg)) return `npx runs unpinned package ${packageName(pkg)}`;
  }
  return '';
}

// ── hook commands and hook scripts ───────────────────────────────────────────────────────────────
const FETCH_TOOL = /(?:^|[\s;&|(])(?:curl|wget|Invoke-WebRequest|iwr)(?:\s|$)/;
const INLINE_INTERP = [
  [/\b(?:node|deno|bun)\s+(?:-e|--eval|-p|--print)\b/, 'node evaluates inline code'],
  [/\bpython[\d.]*\s+-c\b/, 'python evaluates inline code'],
  [/\b(?:sh|bash|zsh|dash|ksh)\s+-c\b/, 'shell evaluates inline code'],
  [/\b(?:perl|ruby)\s+-e\b/, 'interpreter evaluates inline code'],
  [/\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh)\b/, 'output is piped into a shell'],
  [/(?:^|[\s;&|(])eval\s/, 'eval of a string'],
];

/** Every reason a hook command shells out, sorted; empty when it does not. */
export function hookShellOut(cmd) {
  const s = String(cmd || '');
  const why = new Set();
  const hosts = remoteHosts(s);
  for (const h of hosts) why.add(`network fetch to ${h}`);
  if (!hosts.length && FETCH_TOOL.test(s) && !/\b(?:https?|wss?):\/\//i.test(s)) why.add('fetch tool with a non-literal destination');
  for (const [re, label] of INLINE_INTERP) if (re.test(s)) why.add(label);
  return [...why].sort();
}

// ── permission grants ────────────────────────────────────────────────────────────────────────────
const BROAD_BARE = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task']);

/** Why a permissions.allow entry is broad, or '' when it is bounded. */
export function broadPermission(entry) {
  const m = /^([A-Za-z_][\w-]*)(?:\((.*)\))?$/.exec(String(entry || '').trim());
  if (!m) return '';
  const [, tool, inner] = m;
  if (inner === undefined) {
    if (BROAD_BARE.has(tool)) return `bare ${tool} grants every invocation`;
    if (tool.startsWith('mcp__') && tool.split('__').length === 2) return `bare ${tool} grants every tool of that server`;
    return '';
  }
  const v = inner.trim();
  if (/^(?:\*|:\*|\*\*|\*:\*)$/.test(v)) return `${tool}(${v}) is unbounded`;
  if (tool === 'Bash' && /^(?:curl|wget)\b/.test(v)) return 'network fetch is allowed without review';
  if ((tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') && /^(?:\/|~\/)[/*]*$/.test(v)) return `${tool} anywhere on disk`;
  return '';
}

export const isBashGrant = (entry) => /^Bash(?:\(.*\))?$/.test(String(entry || '').trim());

// one definition, shared with monitor/agent-config-harden.mjs, of what a deny list must cover
export const CREDENTIAL_DENY = Object.freeze([
  'Read(~/.ssh/**)', 'Read(~/.aws/**)', 'Read(~/.netrc)', 'Read(~/.npmrc)', 'Read(~/.git-credentials)',
  'Read(~/.docker/config.json)', 'Read(~/.kube/config)', 'Read(~/.gnupg/**)', 'Bash(cat ~/.ssh/*)', 'Bash(cat ~/.aws/*)',
]);
const CRED_GRANT = /\.ssh\b|\.aws\b|\.netrc\b|\.npmrc\b|\.git-credentials\b|\.docker\/config|\.kube\/config|\.gnupg\b|(?:^|[\s(/])\.env\b/;

/** Does a permissions.deny list bound at least one credential read? */
export function denyCoversCredentials(deny) {
  return Array.isArray(deny) && deny.some((e) => /^(?:Read|Bash)\(/.test(String(e)) && CRED_GRANT.test(String(e)));
}

// ── runtime-resolved hosts and binaries ──────────────────────────────────────────────────────────
const VAR_RE = /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)[^}]*\}|\$([A-Za-z_][A-Za-z0-9_]*)|%([A-Za-z_]\w*)%/g;
const LOCAL_PATH_VAR = /^(?:HOME|PWD|USER|USERPROFILE|TMPDIR|TEMP|TMP|CLAUDE_PROJECT_DIR|workspaceFolder|workspaceFolderBasename|userHome|XDG_[A-Z_]+)$/;
const HOSTISH_KEY = /(?:HOST|URL|URI|ENDPOINT|SERVER|ADDR|ADDRESS|BIN|BINARY|COMMAND|CMD)$/i;

const varsIn = (s) => [...String(s || '').matchAll(VAR_RE)].map((m) => ({ name: m[1] || m[2] || m[3], index: m.index })).filter((v) => !LOCAL_PATH_VAR.test(v.name));

// the host of a URL ends at the first `/` after the scheme; a variable before that point decides where the request goes
function varInHost(s) {
  const str = String(s || '');
  const m = /^[a-z][a-z0-9+.-]*:\/\//i.exec(str);
  const hostEnd = m ? (str.indexOf('/', m[0].length) < 0 ? str.length : str.indexOf('/', m[0].length)) : (str.indexOf('/') < 0 ? str.length : str.indexOf('/'));
  return varsIn(str).filter((v) => v.index < hostEnd && (m || v.index === 0)).map((v) => v.name);
}

/** Why a server resolves its host or binary at run time — `field from VAR` phrases, sorted; empty when it does not. */
export function envIndirection(srv) {
  const why = new Set();
  for (const v of varInHost(srv.url)) why.add(`url host from ${v}`);
  for (const v of varsIn(srv.command)) why.add(`command from ${v.name}`);
  const args = Array.isArray(srv.args) ? srv.args.map(String) : [];
  for (const a of args) {
    if (/:\/\//.test(a)) for (const v of varInHost(a)) why.add(`args URL host from ${v}`);
  }
  if (basename(String(srv.command || '')).replace(/\.exe$/i, '') === 'npx') {
    for (const v of varsIn(npxPackage(args))) why.add(`npx package from ${v.name}`);
  }
  if (isObj(srv.env)) {
    for (const [k, val] of Object.entries(srv.env)) if (HOSTISH_KEY.test(k)) for (const v of varsIn(val)) why.add(`env ${k} from ${v.name}`);
  }
  return [...why].sort();
}

// ── hook scripts ─────────────────────────────────────────────────────────────────────────────────
const INTERPRETER = new Set(['node', 'deno', 'bun', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'python', 'python3', 'perl', 'ruby', 'env', 'exec', 'nohup', 'timeout', 'nice']);
const SCRIPT_EXT = /\.(?:sh|bash|zsh|mjs|cjs|js|ts|py|rb|pl)$/i;

/** The script a hook command runs, as written (quotes and a `$CLAUDE_PROJECT_DIR/` prefix stripped), or '' when the command is not a script. */
export function hookScriptPath(cmd) {
  for (const raw of String(cmd || '').trim().split(/\s+/)) {
    const t = raw.replace(/^["']|["']$/g, '');
    if (!t || t.startsWith('-') || /^\d+$/.test(t) || /^[A-Za-z_]\w*=/.test(t)) continue;
    if (INTERPRETER.has(basename(t).toLowerCase()) && !SCRIPT_EXT.test(t)) continue;
    if (SCRIPT_EXT.test(t) || /(?:^|\/)\.claude\/hooks\//.test(t)) return t.replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\//, '');
    return '';
  }
  return '';
}

const CRED_FILE = /~\/\.ssh\b|\.ssh\/(?:id_|config|known)|\bid_(?:rsa|ed25519|ecdsa|dsa)\b|\.aws\/(?:credentials|config)\b|\.netrc\b|\.npmrc\b|\.pypirc\b|\.git-credentials\b|\.docker\/config\.json|\.kube\/config|\.gnupg\b|\/etc\/(?:shadow|passwd)\b|(?:^|[\s`'"(=])\.env(?:\.[A-Za-z]+)?\b/;
const READ_TOOL = /(?:^|[\s;&|(])(?:cat|head|tail|less|more|cp|scp|base64|xxd|od|strings|source|\.|grep|awk|sed|tar|zip|rsync|curl|wget)\s/;
const KEYCHAIN = /\bsecurity\s+find-(?:generic|internet)-password\b|\bsecret-tool\s+lookup\b/;

/** 'reads a credential path' when a line reads a key file, token file or keychain; '' otherwise. */
export function credentialRead(line) {
  const s = String(line || '').replace(/\.env\.(?:example|sample|template|dist)\b/g, '');
  if (/(?:^|\s)cp\s+\S*\.env(?:\.[A-Za-z]+)?\s+\S*\.env\b/.test(String(line || ''))) return '';
  return (READ_TOOL.test(s) && CRED_FILE.test(s)) || KEYCHAIN.test(s) ? 'reads a credential path' : '';
}

const shellReasons = (line) => {
  const why = hookShellOut(line);
  const c = credentialRead(line);
  if (c) why.push(c);
  return why;
};

/** Lines inside ```bash / ```sh / ```zsh / ```shell fences, a leading `$ ` prompt dropped. */
export function fencedShellLines(md) {
  const out = [];
  let fence = null, blocks = 0;
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trimEnd();
    const open = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(line);
    if (fence === null) {
      if (open && /^(?:bash|sh|zsh|shell)$/i.test(open[2])) { fence = open[1]; blocks++; }
      continue;
    }
    if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !open[2]) { fence = null; continue; }
    out.push(line.replace(/^\s*\$\s+/, ''));
  }
  return { blocks, lines: out };
}

// ── inline env secrets ───────────────────────────────────────────────────────────────────────────
// Mirrors gitleaks' default generic-api-key (manifests/gitleaks.toml extends the default set, so the
// rule is not spelled out there): a key-word in the NAME, a 10–150 char value from [0-9a-z\-_.=],
// Shannon entropy ≥ 3.5. Known credential prefixes fire on the value's shape alone.
const KEYISH = /key|api|token|secret|client|passwd|password|auth|access|credential|private|bearer/i;
const VALUE_SHAPE = /^[0-9A-Za-z\-_.=+/]{10,150}$/;
const KNOWN_PREFIX = /^(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|sk-|xox[bapors]-|AKIA|glpat-|npm_|AIza|ya29\.|hf_|dop_v1_|pypi-)/;
const REFERENCE = /^(?:\$\{?[A-Za-z_][\w:.-]*\}?|%[A-Za-z_]\w*%|\$\{(?:env|input|workspaceFolder|config|userHome)[^}]*\})$/;
const PLACEHOLDER = /^(?:<[^>]*>|your[-_ ]|changeme|change-me|replace|todo|xxx+|example|placeholder|dummy|none|null|undefined|true|false)/i;

export function shannon(s) {
  const n = s.length;
  if (!n) return 0;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const c of freq.values()) { const p = c / n; h -= p * Math.log2(p); }
  return h;
}

/** Does this env entry hold a literal credential-shaped value? Judges the key NAME and the shape. */
export function secretShaped(key, value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v || REFERENCE.test(v) || PLACEHOLDER.test(v)) return false;
  if (KNOWN_PREFIX.test(v) && v.length >= 10) return true;
  if (!KEYISH.test(String(key || ''))) return false;
  if (!VALUE_SHAPE.test(v)) return false;
  return shannon(v) >= 3.5;
}

// ── the walk ─────────────────────────────────────────────────────────────────────────────────────
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function serversOf(doc) {
  const out = [];
  for (const block of ['mcpServers', 'servers']) {
    if (!isObj(doc[block])) continue;
    for (const [name, srv] of Object.entries(doc[block])) if (isObj(srv)) out.push([name, srv]);
  }
  return out;
}

function hookCommandsOf(doc) {
  const out = [];
  if (!isObj(doc.hooks)) return out;
  for (const [event, entries] of Object.entries(doc.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isObj(entry)) continue;
      const key = entry.matcher ? `${event}:${entry.matcher}` : event;
      if (typeof entry.command === 'string') out.push([key, entry.command]);
      if (Array.isArray(entry.hooks)) for (const h of entry.hooks) if (isObj(h) && typeof h.command === 'string') out.push([key, h.command]);
    }
  }
  return out;
}

function envSecrets(env, prefix) {
  const out = [];
  if (!isObj(env)) return out;
  for (const [k, v] of Object.entries(env)) if (secretShaped(k, v)) out.push([k, prefix ? `${prefix} env key ${k}` : `env key ${k}`]);
  return out;
}

function findingsForJson(rel, doc, add) {
  for (const [name, srv] of serversOf(doc)) {
    const args = Array.isArray(srv.args) ? srv.args : [];
    const hosts = new Set(remoteHosts(srv.url));
    for (const a of args) for (const h of remoteHosts(a)) hosts.add(h);
    for (const h of [...hosts].sort()) add('mcp-remote-server', rel, name, `server ${name} reaches non-loopback host ${h}`);
    const why = commandShell(srv.command, args);
    if (why) add('mcp-command-shell', rel, name, `server ${name}: ${why}`);
    const indirect = envIndirection(srv);
    if (indirect.length) add('mcp-host-from-env', rel, name, `server ${name} resolves at run time: ${indirect.join('; ')}`);
    for (const [k, detail] of envSecrets(srv.env, `server ${name}`)) add('env-secret-inline', rel, k, `${detail} holds an inline credential-shaped value (value withheld)`);
  }
  for (const [key, cmd] of hookCommandsOf(doc)) {
    const why = hookShellOut(cmd);
    if (why.length) add('hook-shell-out', rel, key, `hook ${key}: ${why.join('; ')}`);
  }
  if (isObj(doc.permissions) && Array.isArray(doc.permissions.allow)) {
    for (const entry of doc.permissions.allow) {
      const why = broadPermission(entry);
      const shown = redactRule(String(entry)).text;
      if (why) add('permissions-allow-broad', rel, shown, `allow ${shown}: ${why}`);
    }
    const bash = doc.permissions.allow.filter(isBashGrant).length;
    if (bash && !denyCoversCredentials(doc.permissions.deny)) {
      add('permissions-deny-missing', rel, 'permissions.deny', `${bash} Bash grant(s) with no permissions.deny entry covering a credential read`);
    }
  }
  for (const [k, detail] of envSecrets(doc.env, '')) add('env-secret-inline', rel, k, `${detail} holds an inline credential-shaped value (value withheld)`);
}

const COMMENT_LINE = /^\s*(?:#|\/\/)/;

function findingsForScript(rel, text, add) {
  const md = /\.md$/i.test(rel);
  const why = new Set();
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (md) { if (!/^\s*!/.test(line)) continue; }
    else if (COMMENT_LINE.test(line)) continue;
    for (const w of hookShellOut(line)) why.add(w);
  }
  if (why.size) add('hook-shell-out', rel, '', `script: ${[...why].sort().join('; ')}`);
  if (md && /(?:^|\/)\.claude\/commands\//.test(rel)) {
    const fenced = fencedShellLines(text);
    const reasons = new Set();
    let hits = 0;
    for (const line of fenced.lines) {
      if (COMMENT_LINE.test(line)) continue;
      const r = shellReasons(line);
      if (r.length) { hits++; for (const w of r) reasons.add(w); }
    }
    if (reasons.size) add('command-file-shell', rel, '', `${fenced.blocks} fenced shell block(s), ${hits} line(s): ${[...reasons].sort().join('; ')}`);
  }
}

// a hook's script is read from the target tree only: `~`, an absolute path elsewhere, or a symlink out of the tree is outside-repo
function readHookScript(root, script, cap) {
  if (script.startsWith('~')) return { reason: 'outside-repo' };
  const abs = isAbsolute(script) ? script : join(root, script);
  let real, rootReal;
  try { rootReal = realpathSync(root); real = realpathSync(abs); } catch (e) { return { reason: e.code || 'EUNKNOWN' }; }
  if (real !== rootReal && !real.startsWith(rootReal + sep)) return { reason: 'outside-repo' };
  let st;
  try { st = statSync(real); } catch (e) { return { reason: e.code || 'EUNKNOWN' }; }
  if (!st.isFile()) return { reason: 'not-a-file' };
  if (st.size > cap) return { reason: 'oversize' };
  let text;
  try { text = readFileSync(real, 'utf8'); } catch (e) { return { reason: e.code || 'EUNKNOWN' }; }
  if (text.includes('\u0000')) return { reason: 'binary' };
  return { text, rel: relative(rootReal, real).split('\\').join('/') };
}

// a JS or Python hook script shells out only through an exec-family call, so a shell shape in a
// printed message string is data there; the call must sit within three lines above the shape
const EXEC_CALL = { js: /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(/, py: /\bsubprocess\.|\bos\.(?:system|popen)\s*\(/ };
const execFamily = (rel) => (/\.(?:mjs|cjs|js|ts)$/i.test(rel) ? EXEC_CALL.js : /\.py$/i.test(rel) ? EXEC_CALL.py : null);

/** Shell-out and credential-read reasons in a hook script's body; JS and Python lines count only within reach of an exec call. */
export function scriptReasons(rel, text) {
  const reasons = new Set();
  const call = execFamily(rel);
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (COMMENT_LINE.test(line)) return;
    if (call && !lines.slice(Math.max(0, i - 3), i + 1).some((l) => call.test(l))) return;
    for (const w of shellReasons(line)) reasons.add(w);
  });
  return [...reasons].sort();
}

function hookScriptFindings(root, rel, doc, cap, add, unreadable) {
  for (const [key, cmd] of hookCommandsOf(doc)) {
    const script = hookScriptPath(cmd);
    if (!script) continue;
    const r = readHookScript(root, script, cap);
    if (r.reason) { unreadable.push({ hook: `${rel} ${key}`, script, reason: r.reason }); continue; }
    const reasons = scriptReasons(r.rel, r.text);
    if (reasons.length) add('hook-script-content', rel, key, `hook ${key} runs ${r.rel}: ${reasons.join('; ')}`);
  }
}

// directories are walked; every other entry is listed and left to readInTree, which refuses links out of the tree
function listFiles(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return out; throw e; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

// -- reads bounded to the target tree -------------------------------------------------------------
const within = (rootReal, real) => real === rootReal || real.startsWith(rootReal + sep);

/** Read a '/'-separated path under root; {text}, or {reason} when absent, outside the tree (symlinks resolved), not a file or over cap. */
export function readInTree(root, rel, cap) {
  if (typeof root !== 'string' || root === '') throw new TypeError('readInTree: root must be a directory path');
  if (typeof cap !== 'number' || !(cap > 0)) throw new TypeError('readInTree: cap must be a positive byte count or Infinity');
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0') || isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.split(/[\\/]/).includes('..')) {
    return { reason: 'invalid-path' };
  }
  let rootReal, real;
  try { rootReal = realpathSync(root); real = realpathSync(join(rootReal, ...rel.split('/'))); } catch (e) { return { reason: e.code || 'EUNKNOWN' }; }
  if (!within(rootReal, real)) return { reason: 'outside-repo' };
  let st;
  try { st = statSync(real); } catch (e) { return { reason: e.code || 'EUNKNOWN' }; }
  if (!st.isFile()) return { reason: 'not-a-file' };
  if (st.size > cap) return { reason: 'oversize' };
  try { return { text: readFileSync(real, 'utf8') }; } catch (e) { return { reason: e.code || 'EUNKNOWN' }; }
}

// -- effective configuration: includes followed per agent, declarations attributed to their file --
export const MAX_INCLUDED_FILES = 256;

// Each agent reads its own files, so a server named in two agents' files is two servers, not a conflict.
export const AGENT_ROOTS = Object.freeze([
  ['claude', Object.freeze(['.mcp.json', '.claude/settings.json', '.claude/settings.local.json'])],
  ['cursor', Object.freeze(['.cursor/mcp.json'])],
  ['vscode', Object.freeze(['.vscode/mcp.json'])],
]);

const SETTINGS_FILE = /settings(?:\.local)?\.json$/;
const pointerPart = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * One parsed config file in the resolver's shape: {decl, pointers, issues}. pointers maps each resolver
 * pointer prefix ('/grants', '/hooks/3', '/servers/<name>') to the file's own JSON pointer; issues are
 * container shapes the resolver never sees.
 */
export function declarationsOf(doc) {
  const pointers = new Map();
  const issues = [];
  if (!isObj(doc)) return { decl: doc, pointers, issues };
  const decl = {};
  const bad = (pointer, reason) => issues.push({ kind: 'malformed', pointer, reason });
  if (Object.hasOwn(doc, 'include')) decl.include = doc.include;
  if (Object.hasOwn(doc, 'permissions')) {
    const p = doc.permissions;
    if (!isObj(p)) bad('/permissions', 'expected an object of permission lists');
    else {
      if (Object.hasOwn(p, 'allow')) { decl.grants = p.allow; pointers.set('/grants', '/permissions/allow'); }
      if (Object.hasOwn(p, 'deny')) { decl.denies = p.deny; pointers.set('/denies', '/permissions/deny'); }
    }
  }
  if (Object.hasOwn(doc, 'hooks')) {
    if (!isObj(doc.hooks)) bad('/hooks', 'expected an object of hook events');
    else {
      decl.hooks = [];
      const push = (hook, at) => { pointers.set(`/hooks/${decl.hooks.length}`, at); decl.hooks.push(hook); };
      for (const [event, entries] of Object.entries(doc.hooks)) {
        const at = `/hooks/${pointerPart(event)}`;
        if (!Array.isArray(entries)) { bad(at, 'expected an array of hook entries'); continue; }
        entries.forEach((entry, i) => {
          const ep = `${at}/${i}`;
          if (!isObj(entry)) { bad(ep, 'hook entry is not an object'); return; }
          if (entry.command === undefined && entry.hooks === undefined) { bad(ep, 'hook entry declares neither command nor hooks'); return; }
          const matcher = entry.matcher === undefined ? {} : { matcher: entry.matcher };
          if (entry.command !== undefined) { const { hooks: _nested, ...own } = entry; push({ ...own, event }, ep); }
          if (entry.hooks === undefined) return;
          if (!Array.isArray(entry.hooks)) { bad(`${ep}/hooks`, 'expected an array of hooks'); return; }
          entry.hooks.forEach((h, j) => push(isObj(h) ? { ...h, event, ...matcher } : h, `${ep}/hooks/${j}`));
        });
      }
    }
  }
  const servers = Object.create(null);
  let hasServers = false;
  for (const block of ['mcpServers', 'servers']) {
    if (!Object.hasOwn(doc, block)) continue;
    if (!isObj(doc[block])) { bad(`/${block}`, 'expected an object of named server declarations'); continue; }
    hasServers = true;
    for (const [name, srv] of Object.entries(doc[block])) {
      const at = `/${block}/${pointerPart(name)}`;
      if (Object.hasOwn(servers, name)) { bad(at, 'server name is also declared under mcpServers in this file'); continue; }
      servers[name] = srv;
      pointers.set(`/servers/${pointerPart(name)}`, at);
    }
  }
  if (hasServers) decl.servers = servers;
  return { decl, pointers, issues };
}

// a resolver pointer's prefix is its first one or two segments; anything unmapped is already the file's own
function remapPointer(pointers, p) {
  if (typeof p !== 'string' || p === '') return p;
  const seg = p.split('/');
  const two = seg.length > 2 ? pointers.get(`/${seg[1]}/${seg[2]}`) : undefined;
  if (two !== undefined) return [two, ...seg.slice(3)].join('/');
  const one = pointers.get(`/${seg[1]}`);
  return one !== undefined ? [one, ...seg.slice(2)].join('/') : p;
}

// -- what a report may carry from repository text ---------------------------------------------------
export const WITHHELD = '[withheld]';
const SAFE_NAME = /^[A-Za-z0-9_.:@/-]{1,64}$/;
const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
// a long run mixing letters and digits, or with the spread of characters of a random string, reads as a key
const opaque = (s) => (s.match(/[A-Za-z0-9]{20,}/g) || []).some((run) => (/\d/.test(run) && /[A-Za-z]/.test(run)) || shannon(run) >= 4.3);
// prose joined by hyphens or underscores is not a name: at most three separators and 32 characters,
// except an MCP tool id (mcp__server__tool), whose parts are held to three separators each
const separators = (s) => (s.match(/[-_.:/@]+/g) || []).length;
const MCP_ID = /^mcp__([A-Za-z0-9-]+)(?:__([A-Za-z0-9_-]+))?$/;
const nameShaped = (s) => {
  const mcp = MCP_ID.exec(s);
  if (mcp) return separators(mcp[1]) <= 3 && separators(mcp[2] || '') <= 3;
  return s.length <= 32 && separators(s) <= 3;
};

// names and paths repeat across thousands of records; the answer depends on the string alone
const memo = (fn) => {
  const seen = new Map();
  return (s) => {
    if (typeof s !== 'string') return fn(s);
    let v = seen.get(s);
    if (v === undefined) { if (seen.size > 50000) seen.clear(); v = fn(s); seen.set(s, v); }
    return v;
  };
};

/** A name from the repository as the report may show it: short, plain, not secret-shaped; else WITHHELD. */
const plainName = memo((s) => (typeof s === 'string' && SAFE_NAME.test(s) && nameShaped(s) && !opaque(s) && !redactRule(s).redacted ? s : WITHHELD));
export const shownName = (s) => (typeof s === 'string' && /^\d{1,9}$/.test(s) ? s : plainName(s));
// segments of digits or short letter-only words cannot carry a secret shape or prose
const PLAIN_POINTER = /^(?:\/(?:\d{1,9}|[A-Za-z]{1,19}))*$/;
const shownPointer = (p) => (typeof p !== 'string' || PLAIN_POINTER.test(p) ? p : p.split('/').map((seg, i) => (i === 0 ? seg : shownName(seg))).join('/'));
// a known credential prefix anywhere in a path segment, followed by enough characters to be a key
const PREFIXED_KEY = new RegExp(`(?:^|[^A-Za-z0-9])${KNOWN_PREFIX.source.slice(1)}[A-Za-z0-9_-]{8,}`);
const REMOTE_LOCATION = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)(?:[^@/?#]*@)?([^/?#]*)/;
const secretSegment = (seg) => opaque(seg) || PREFIXED_KEY.test(seg) || redactRule(seg).redacted;
// A remote location shows its scheme and host only. A path keeps its shape with secret-shaped segments
// redacted; whitespace or control characters mean prose, not a path.
const shownPath = memo((p) => {
  if (typeof p !== 'string') return p;
  const remote = REMOTE_LOCATION.exec(p);
  const t = remote
    ? remote[1] + (secretSegment(remote[2]) ? REDACTED : remote[2])
    : redactRule(p).text.split('/').map((seg) => (seg !== REDACTED && secretSegment(seg) ? REDACTED : seg)).join('/');
  return t.length <= 256 && !/[\s\x00-\x1f\x7f]/.test(t) ? t : WITHHELD;
});
const toolOf = (rule) => {
  const head = String(rule).split('(')[0].trim();
  return TOOL_NAME.test(head) ? shownName(head) : WITHHELD;
};

const READ_FAILURE = {
  ENOENT: ['missing', 'included file does not exist in the target tree'],
  ENOTDIR: ['missing', 'included file does not exist in the target tree'],
  'outside-repo': ['traversal', 'included path resolves outside the target tree through a symlink'],
  unparseable: ['unparseable', 'included file is not a JSON or JSONC object'],
  'file-limit': ['file-limit', `more than ${MAX_INCLUDED_FILES} included files; not read`],
};

// Any of these leaves part of the configuration unread, so zero findings beside one is not a clean result.
export const PARTIAL_KINDS = Object.freeze(['traversal', 'missing', 'unreadable', 'unparseable', 'file-limit', 'depth-limit', 'cycle', 'malformed']);

const declTable = (configs) => new Map([...configs].map(([p, c]) => [p, c.decl]));
const wantedTargets = (results) => results.flatMap(([, r]) => r.unresolved)
  .filter((u) => u.kind === 'missing' && u.source !== null && typeof u.target === 'string').map((u) => u.target);

// Re-resolves until no reached file names a target that has not been tried. env is empty: a static
// read knows no variable's value, so an include built from one is reported, never guessed.
function resolveAgents(root, groups, configs, tried, cap) {
  let reads = 0;
  for (;;) {
    const table = declTable(configs);
    const results = groups.map(([agent, roots]) => [agent, resolveAgentConfig({ files: table, env: {}, root: roots })]);
    const want = [...new Set(wantedTargets(results))].filter((t) => !configs.has(t) && !tried.has(t)).sort();
    if (!want.length) return results;
    for (const t of want) {
      if (reads >= MAX_INCLUDED_FILES) { tried.set(t, 'file-limit'); continue; }
      reads += 1;
      const r = readInTree(root, t, cap);
      if (r.reason) { tried.set(t, r.reason); continue; }
      const parsed = parseJsonc(r.text);
      if (parsed.error !== undefined || !isObj(parsed.value)) { tried.set(t, 'unparseable'); continue; }
      configs.set(t, { doc: parsed.value, ...declarationsOf(parsed.value) });
    }
  }
}

function reachedFrom(starts, edges) {
  const next = new Map();
  for (const e of edges) {
    if (e.state === 'depth-limit') continue;
    const list = next.get(e.source);
    if (list) list.push(e.target); else next.set(e.source, [e.target]);
  }
  const seen = new Set(starts);
  const queue = [...starts];
  for (let i = 0; i < queue.length; i++) for (const t of next.get(queue[i]) || []) if (!seen.has(t)) { seen.add(t); queue.push(t); }
  return seen;
}

function shownRecord(rec, owned = false) {
  const out = owned ? rec : { ...rec };
  if ('pointer' in out) out.pointer = shownPointer(out.pointer);
  if (typeof out.source === 'string') out.source = shownPath(out.source);
  if (typeof out.target === 'string') out.target = shownPath(out.target);
  if (typeof out.include === 'string') out.include = shownPath(out.include);
  if (out.chain) out.chain = out.chain.map(shownPath);
  if (out.sources) out.sources = out.sources.map(shownPath);
  if (typeof out.name === 'string') out.name = shownName(out.name);
  if (out.variables && out.variables.length) out.variables = out.variables.map(shownName);
  return out;
}

function agentReport(agent, r, configs, tried, rootFailures) {
  const at = (rec) => (rec.source && configs.has(rec.source) && 'pointer' in rec ? { ...rec, pointer: remapPointer(configs.get(rec.source).pointers, rec.pointer) } : { ...rec });
  const shown = (rec) => shownRecord(at(rec), true);
  const unresolved = [...rootFailures];
  const undetermined = [];
  for (const f of r.files) for (const i of configs.get(f.path).issues) unresolved.push({ kind: i.kind, source: f.path, pointer: i.pointer, reason: i.reason });
  for (const u of r.unresolved) {
    let rec = at(u);
    if (rec.kind === 'missing' && rec.source !== null && tried.has(rec.target)) {
      const code = tried.get(rec.target);
      const [kind, reason] = READ_FAILURE[code] || ['unreadable', 'included file could not be read'];
      rec = { ...rec, kind, reason, ...(kind === 'unreadable' ? { code } : {}) };
    }
    (rec.kind === 'unresolved-variable' && rec.effect === 'value-undetermined' ? undetermined : unresolved).push(shownRecord(rec, rec !== u));
  }
  const rule = (g) => {
    const s = shown(g);
    return { tool: toolOf(g.value), redacted: g.redacted, source: s.source, pointer: s.pointer, variables: s.variables, enforcement: g.enforcement };
  };
  return {
    agent,
    roots: r.roots,
    state: unresolved.length ? 'incomplete' : 'complete',
    files: r.files.map((f) => ({ path: shownPath(f.path), depth: f.depth, via: f.via.map(shownPath) })),
    includes: r.includes.map(shown),
    grants: r.grants.map(rule),
    denies: r.denies.map(rule),
    hooks: r.hooks.map((h) => {
      const s = shown(h);
      s.event = shownName(h.event);
      s.matcher = h.matcher === null ? null : shownName(h.matcher);
      s.type = shownName(h.type);
      return s;
    }),
    servers: r.servers.map((v) => {
      const s = shown(v);
      s.envKeys = v.envKeys.map(shownName);
      return s;
    }),
    variables: r.variables.map((v) => ({ ...v, name: shownName(v.name) })),
    unresolved,
    undetermined,
  };
}

function partialReasons(agents, unreadableCount, unreadableHookCount) {
  const why = new Set();
  for (const a of agents) {
    for (const u of a.unresolved) {
      if (PARTIAL_KINDS.includes(u.kind)) why.add(`unresolved ${u.kind}`);
      else if (u.kind === 'unresolved-variable' && u.effect === 'include-not-followed') why.add('include through an unset variable');
    }
  }
  if (unreadableCount) why.add('unreadable files');
  if (unreadableHookCount) why.add('unreadable hook scripts');
  return [...why].sort();
}

const ENFORCEMENT = Object.freeze({ state: 'unmeasured', reason: 'grants and denies are declarations; no enforcement adapter has measured their effect' });

/** Scan one target root. Pure over the filesystem; the output is byte-stable for the same tree. */
export function scanAgentConfig(root) {
  if (typeof root !== 'string' || root === '') throw new TypeError('scanAgentConfig: root must be a directory path');
  let rootStat;
  try { rootStat = statSync(root); } catch (e) { throw new Error(`cannot read ${root}: ${e.code || e.message}`); }
  if (!rootStat.isDirectory()) throw new Error(`${root} is not a directory`);
  const rootReal = realpathSync(root);
  const findings = [];
  const filesPresent = [];
  const unparseable = [];
  const unreadable = [];
  const skipped = [];
  const unreadableHookScripts = [];
  let filesScanned = 0;
  const cap = maxBytes();
  const add = (rule, path, key, detail) => findings.push({ rule, path, sev: RULE_SEV[rule], cwe: RULE_CWE[rule], key, detail });
  const relOf = (p) => relative(root, p).split('\\').join('/');

  const configs = new Map();
  const tried = new Map();
  const rootFailures = new Map();
  for (const f of CONFIG_FILES) {
    const r = readInTree(root, f, cap);
    if (r.reason === 'ENOENT') { tried.set(f, r.reason); continue; }
    filesPresent.push(f);
    let failure = null;
    if (r.reason) { unreadable.push({ path: f, code: r.reason }); failure = { kind: 'unreadable', code: r.reason }; }
    let parsed = null;
    if (!failure) {
      parsed = parseJsonc(r.text);
      if (parsed.error !== undefined || !isObj(parsed.value)) { unparseable.push(f); failure = { kind: 'unparseable' }; }
    }
    if (failure) {
      tried.set(f, failure.code || 'unparseable');
      rootFailures.set(f, { kind: failure.kind, source: null, pointer: null, target: f, reason: 'agent configuration file could not be read', ...(failure.code ? { code: failure.code } : {}) });
      continue;
    }
    filesScanned += 1;
    configs.set(f, { doc: parsed.value, ...declarationsOf(parsed.value) });
    findingsForJson(f, parsed.value, add);
  }

  const rootSet = new Set(configs.keys());
  const groups = AGENT_ROOTS.map(([agent, files]) => [agent, files.filter((f) => rootSet.has(f))]).filter(([, roots]) => roots.length);
  const results = resolveAgents(root, groups, configs, tried, cap);
  const reached = new Set(results.flatMap(([, r]) => r.files.map((f) => f.path)));
  const includedFiles = [...reached].filter((p) => !rootSet.has(p)).sort();
  const settingsReach = reachedFrom([...rootSet].filter((f) => SETTINGS_FILE.test(f)), results.flatMap(([, r]) => r.includes));
  for (const f of rootSet) if (settingsReach.has(f)) hookScriptFindings(root, f, configs.get(f).doc, cap, add, unreadableHookScripts);
  for (const p of includedFiles) {
    const { doc } = configs.get(p);
    filesPresent.push(p);
    filesScanned += 1;
    findingsForJson(p, doc, add);
    if (settingsReach.has(p)) hookScriptFindings(root, p, doc, cap, add, unreadableHookScripts);
  }
  const unreachedFiles = [...configs.keys()].filter((p) => !reached.has(p)).sort();
  filesPresent.push(...unreachedFiles);
  for (const [p, reason] of tried) {
    if (CONFIG_FILES.includes(p) || ['ENOENT', 'ENOTDIR', 'file-limit', 'invalid-path'].includes(reason)) continue;
    filesPresent.push(p);
    if (reason === 'unparseable') unparseable.push(p);
    else unreadable.push({ path: p, code: reason });
  }

  const agents = [];
  for (const [agent, files] of AGENT_ROOTS) {
    const failures = files.filter((f) => rootFailures.has(f)).map((f) => rootFailures.get(f));
    const hit = results.find(([a]) => a === agent);
    if (hit) agents.push(agentReport(agent, hit[1], configs, tried, failures));
    else if (failures.length) {
      agents.push({ agent, roots: [], state: 'incomplete', files: [], includes: [], grants: [], denies: [], hooks: [], servers: [], variables: [], unresolved: failures, undetermined: [] });
    }
  }
  const unresolvedAll = agents.flatMap((a) => a.unresolved);
  const effective = {
    schemaVersion: 1,
    state: !agents.length ? 'not-run' : unresolvedAll.length ? 'incomplete' : 'complete',
    enforcement: ENFORCEMENT,
    agents,
    unreachedFiles: unreachedFiles.map(shownPath),
  };

  for (const d of CONFIG_DIRS) {
    let dirReal;
    try { dirReal = realpathSync(join(root, d)); } catch (e) { if (e.code === 'ENOENT') continue; unreadable.push({ path: d, code: e.code || 'EUNKNOWN' }); continue; }
    if (!within(rootReal, dirReal)) { unreadable.push({ path: d, code: 'outside-repo' }); continue; }
    let files;
    try { files = listFiles(join(root, d), []); } catch (e) { unreadable.push({ path: d, code: e.code || 'EUNKNOWN' }); continue; }
    for (const p of files) {
      const rel = relOf(p);
      filesPresent.push(rel);
      const r = readInTree(root, rel, cap);
      if (r.reason === 'oversize') { skipped.push({ path: rel, why: `over ${cap} bytes` }); continue; }
      if (r.reason === 'not-a-file') { skipped.push({ path: rel, why: 'not a regular file' }); continue; }
      if (r.reason) { unreadable.push({ path: rel, code: r.reason }); continue; }
      if (r.text.includes('\u0000')) { skipped.push({ path: rel, why: 'binary' }); continue; }
      filesScanned += 1;
      findingsForScript(rel, r.text, add);
    }
  }

  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  findings.sort((a, b) => cmp(a.path, b.path) || cmp(a.rule, b.rule) || cmp(a.key, b.key) || cmp(a.detail, b.detail));
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const unresolvedByKind = {};
  for (const u of [...unresolvedAll].sort((a, b) => cmp(a.kind, b.kind))) unresolvedByKind[u.kind] = (unresolvedByKind[u.kind] || 0) + 1;
  const partial = partialReasons(agents, unreadable.length, unreadableHookScripts.length);
  const summary = {
    findings: findings.length,
    byRule,
    filesScanned,
    filesExamined: filesScanned + unparseable.length + unreadable.length + skipped.length,
    filesPresent: [...new Set(filesPresent)].sort(),
    unparseable: unparseable.length,
    unparseableFiles: unparseable.sort(),
    unreadable: unreadable.length,
    unreadableFiles: unreadable.sort((a, b) => cmp(a.path, b.path)),
    skipped: skipped.length,
    skippedFiles: skipped.sort((a, b) => cmp(a.path, b.path)),
    unreadableHookScripts: unreadableHookScripts.length,
    unreadableHookScriptFiles: unreadableHookScripts.sort((a, b) => cmp(a.hook, b.hook) || cmp(a.script, b.script)),
    includedFiles: includedFiles.map(shownPath),
    effectiveState: effective.state,
    unresolved: unresolvedAll.length,
    unresolvedByKind,
    variablesUndetermined: agents.reduce((n, a) => n + a.undetermined.length, 0),
    partial: partial.length > 0,
    partialReasons: partial,
    void: filesScanned === 0,
  };
  if (filesScanned === 0) {
    summary.voidReason = filesPresent.length
      ? 'agent configuration is present but none of it could be read — a stated void, not a clean tree'
      : 'no agent configuration in this tree — a stated void, not a clean tree';
  }
  return { tool: 'agent-config', summary, findings, effective };
}

// exitCode rather than process.exit: exit() can cut a large report off a pipe before it drains
function main() {
  const root = resolve(process.env.CW_AGENT_CONFIG_ROOT || process.argv[2] || '.');
  const fail = (msg) => { process.stderr.write(`agent-config: ${msg}\n`); process.exitCode = 2; };
  let st;
  try { st = statSync(root); } catch (e) { fail(`cannot read ${root}: ${e.code || e.message}`); return; }
  if (!st.isDirectory()) { fail(`${root} is not a directory`); return; }
  let out;
  try { out = scanAgentConfig(root); } catch (e) { fail(e.message); return; }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  process.exitCode = 0;
}

if (isMainModule(import.meta.url)) main();
