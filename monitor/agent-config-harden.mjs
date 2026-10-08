#!/usr/bin/env node
// agent-config-harden.mjs — prepare (never apply) the three mechanical fixes for a target's agent
// configuration: pin every unpinned `npx` package to a version, replace an unbounded `Bash(*)`
// grant with the explicit commands the target has already been observed to allow, and add a
// `permissions.deny` block covering credential reads beside any Bash grant that has none. Emits a
// unified diff that `git apply --check` accepts. Never writes to the target, never pushes, forks
// or opens a PR — the same boundary workflow-harden.mjs holds. A run that would change nothing REFUSES.
//
//   node monitor/agent-config-harden.mjs [repoDir] [--json]    exit 0 diff on stdout · 2 refused
//   env, read at call time: CW_AGENT_CONFIG_ROOT
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { parseJsonc, npxPackage, isPinned, isLocalSpec, packageName, broadPermission, isBashGrant, denyCoversCredentials, CREDENTIAL_DENY } from '../bin/agent-config.mjs';

export const MCP_FILES = Object.freeze(['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json']);
export const SETTINGS_FILES = Object.freeze(['.claude/settings.json', '.claude/settings.local.json']);

const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const BROAD_BASH = /^Bash\((?:\*|:\*|\*\*|\*:\*)\)$/;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Pin every unpinned `npx` package in an MCP config's TEXT. A text transform, not a JSON round-trip,
 * so the diff touches one string literal per pin and the author's formatting survives. A resolver
 * returning null leaves the line unchanged — a guessed version is worse than an unpinned one.
 * @returns {{ text:string, pinned:Array<{server,package,version}>, skipped:Array<{server,package,reason}> }}
 */
export function pinNpx(text, resolveVersion) {
  const parsed = parseJsonc(text);
  if (parsed.error !== undefined || !isObj(parsed.value)) return { text, pinned: [], skipped: [{ server: '', package: '', reason: 'unparseable' }] };
  const pinned = [];
  const skipped = [];
  let out = text;
  for (const block of ['mcpServers', 'servers']) {
    if (!isObj(parsed.value[block])) continue;
    for (const [server, srv] of Object.entries(parsed.value[block])) {
      if (!isObj(srv) || basename(String(srv.command || '')).replace(/\.exe$/i, '') !== 'npx') continue;
      const spec = npxPackage(Array.isArray(srv.args) ? srv.args : []);
      if (!spec || isLocalSpec(spec) || isPinned(spec)) continue;
      const pkg = packageName(spec);
      const version = resolveVersion(pkg);
      if (typeof version !== 'string' || !VERSION_RE.test(version)) { skipped.push({ server, package: pkg, reason: 'unresolved' }); continue; }
      const literal = JSON.stringify(spec);
      const next = JSON.stringify(`${pkg}@${version}`);
      let replaced = false;
      out = out.replace(/("args"\s*:\s*\[)([^\]]*)(\])/g, (m, open, inner, close) => {
        if (replaced || !inner.includes(literal)) return m;
        replaced = true;
        return open + inner.replace(literal, next) + close;
      });
      if (replaced) pinned.push({ server, package: pkg, version });
      else skipped.push({ server, package: pkg, reason: 'literal not found in text' });
    }
  }
  return { text: out, pinned, skipped };
}

/**
 * Replace an unbounded `Bash(*)` in permissions.allow with the explicit `Bash(...)` entries in
 * `observed`, de-duplicated against what the file already allows. Refuses with a reason when there
 * is no broad grant, or nothing observed to derive a list from — a list invented here would be a
 * guess wearing an allowlist's clothes.
 * @returns {{ text:string, narrowed:boolean, reason?:string, removed?:string, added?:string[] }}
 */
export function narrowBashAllow(text, observed) {
  const parsed = parseJsonc(text);
  if (parsed.error !== undefined || !isObj(parsed.value)) return { text, narrowed: false, reason: 'unparseable' };
  const allow = isObj(parsed.value.permissions) ? parsed.value.permissions.allow : null;
  if (!Array.isArray(allow)) return { text, narrowed: false, reason: 'no permissions.allow' };
  const broad = allow.map(String).find((e) => BROAD_BASH.test(e));
  if (!broad) return { text, narrowed: false, reason: 'no unbounded Bash grant' };
  const list = [...new Set((observed || []).map(String).filter((e) => /^Bash\(.+\)$/.test(e) && !broadPermission(e)))].sort();
  if (!list.length) return { text, narrowed: false, reason: 'no observed Bash usage to derive an explicit list from' };
  const already = new Set(allow.map(String));
  const added = list.filter((e) => !already.has(e));
  const literal = JSON.stringify(broad);
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.includes(literal));
  if (i < 0) return { text, narrowed: false, reason: 'literal not found in text' };
  const line = lines[i];
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- literal and esc are regex-escaped before interpolation
  const alone = new RegExp(`^\\s*${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,?\\s*$`).test(line);
  if (alone) {
    const indent = /^\s*/.exec(line)[0];
    const trailingComma = /,\s*$/.test(line);
    if (added.length) {
      lines.splice(i, 1, ...added.map((e, k) => `${indent}${JSON.stringify(e)}${k < added.length - 1 || trailingComma ? ',' : ''}`));
    } else {
      lines.splice(i, 1);
      if (!trailingComma && i > 0 && /,\s*$/.test(lines[i - 1])) lines[i - 1] = lines[i - 1].replace(/,\s*$/, '');
    }
  } else if (added.length) {
    lines[i] = line.replace(literal, added.map((e) => JSON.stringify(e)).join(', '));
  } else {
    const esc = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- literal and esc are regex-escaped before interpolation
    lines[i] = line.replace(new RegExp(`${esc}\\s*,\\s*|\\s*,\\s*${esc}|${esc}`), '');
  }
  return { text: lines.join('\n'), narrowed: true, removed: broad, added };
}

// the closing bracket of the JSON array that opens on line `i`, counting brackets outside strings
function arrayClose(lines, i, fromCol = 0) {
  let depth = 0, inStr = false, started = false;
  for (let l = i; l < lines.length; l++) {
    const s = lines[l];
    for (let c = l === i ? fromCol : 0; c < s.length; c++) {
      const ch = s[c];
      if (inStr) { if (ch === '\\') c++; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '[') { depth++; started = true; }
      else if (ch === ']') { depth--; if (started && depth === 0) return { line: l, col: c }; }
    }
  }
  return null;
}

/**
 * Add a `permissions.deny` block covering credential reads (CREDENTIAL_DENY, shared with the
 * scanner) to a settings file that grants Bash and denies nothing of the kind. A text transform:
 * an existing deny array gains the entries at its head, an absent one is inserted after `allow`.
 * @returns {{ text:string, added:string[], reason?:string }}
 */
export function addCredentialDeny(text) {
  const parsed = parseJsonc(text);
  if (parsed.error !== undefined || !isObj(parsed.value)) return { text, added: [], reason: 'unparseable' };
  const perms = parsed.value.permissions;
  if (!isObj(perms) || !Array.isArray(perms.allow)) return { text, added: [], reason: 'no permissions.allow' };
  if (!perms.allow.some(isBashGrant)) return { text, added: [], reason: 'no Bash grant to bound' };
  if (denyCoversCredentials(perms.deny)) return { text, added: [], reason: 'permissions.deny already covers credential reads' };
  const have = new Set(Array.isArray(perms.deny) ? perms.deny.map(String) : []);
  const added = CREDENTIAL_DENY.filter((e) => !have.has(e));
  const lines = text.split('\n');
  const q = (e) => JSON.stringify(e);
  if (Array.isArray(perms.deny)) {
    const i = lines.findIndex((l) => /"deny"\s*:\s*\[/.test(l));
    if (i < 0) return { text, added: [], reason: 'literal not found in text' };
    const close = arrayClose(lines, i, lines[i].search(/"deny"\s*:\s*\[/));
    if (!close) return { text, added: [], reason: 'literal not found in text' };
    if (close.line === i) {
      lines[i] = lines[i].replace(/("deny"\s*:\s*\[)\s*(\]?)/, (m, open, end) => `${open}${added.map(q).join(', ')}${end ? '' : ', '}${end}`);
    } else {
      const inner = (/^\s*/.exec(lines[i + 1] || '')[0]) || `${/^\s*/.exec(lines[i])[0]}  `;
      const empty = /^\s*\]/.test(lines[i + 1] || '');
      lines.splice(i + 1, 0, ...added.map((e, k) => `${inner}${q(e)}${k < added.length - 1 || !empty ? ',' : ''}`));
    }
    return { text: lines.join('\n'), added };
  }
  const i = lines.findIndex((l) => /"allow"\s*:\s*\[/.test(l));
  if (i < 0) return { text, added: [], reason: 'literal not found in text' };
  const close = arrayClose(lines, i, lines[i].search(/"allow"\s*:\s*\[/));
  if (!close) return { text, added: [], reason: 'literal not found in text' };
  const closing = lines[close.line];
  const after = closing.slice(close.col + 1);
  if (after.trim() && after.trim() !== ',') {
    lines[close.line] = `${closing.slice(0, close.col)}], "deny": [${added.map(q).join(', ')}]${after}`;
    return { text: lines.join('\n'), added };
  }
  const indent = /^\s*/.exec(lines[i])[0];
  const trailingComma = after.trim() === ',';
  if (!trailingComma) lines[close.line] = `${closing.slice(0, close.col + 1)},`;
  const block = [`${indent}"deny": [`, ...added.map((e, k) => `${indent}  ${q(e)}${k < added.length - 1 ? ',' : ''}`), `${indent}]${trailingComma ? ',' : ''}`];
  lines.splice(close.line + 1, 0, ...block);
  return { text: lines.join('\n'), added };
}

/** A whole-file unified diff in the form `git apply` reads. Line-level LCS; files here are small. */
export function unifiedDiff(path, before, after) {
  if (before === after) return '';
  const A = before.split('\n');
  const B = after.split('\n');
  const aNL = before.endsWith('\n');
  const bNL = after.endsWith('\n');
  if (aNL) A.pop();
  if (bNL) B.pop();
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = A[i] === B[j] && !(i === n - 1 && j === m - 1 && aNL !== bNL) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j] && L[i][j] === L[i + 1][j + 1] + 1) { ops.push([' ', A[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { ops.push(['-', A[i]]); i++; }
    else { ops.push(['+', B[j]]); j++; }
  }
  while (i < n) ops.push(['-', A[i++]]);
  while (j < m) ops.push(['+', B[j++]]);
  const body = [];
  const lastA = ops.map((o, k) => (o[0] !== '+' ? k : -1)).reduce((a, b) => Math.max(a, b), -1);
  const lastB = ops.map((o, k) => (o[0] !== '-' ? k : -1)).reduce((a, b) => Math.max(a, b), -1);
  ops.forEach(([t, l], k) => {
    body.push(t + l);
    if ((k === lastA && !aNL) || (k === lastB && !bNL)) body.push('\\ No newline at end of file');
  });
  const range = (start, len) => (len === 1 ? `${start}` : `${start},${len}`);
  return `--- a/${path}\n+++ b/${path}\n@@ -${range(n ? 1 : 0, n)} +${range(m ? 1 : 0, m)} @@\n${body.join('\n')}\n`;
}

// ── default seams, each refusing rather than guessing ────────────────────────────────────────────

/** Version resolver from the target's own package-lock.json; null when the lock does not pin it. */
export function lockfileResolver(repoDir) {
  return (pkg) => {
    let raw;
    try { raw = readFileSync(join(repoDir, 'package-lock.json'), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    let lock;
    try { lock = JSON.parse(raw); } catch { return null; }
    const v = (isObj(lock.packages) && isObj(lock.packages[`node_modules/${pkg}`]) && lock.packages[`node_modules/${pkg}`].version)
      || (isObj(lock.dependencies) && isObj(lock.dependencies[pkg]) && lock.dependencies[pkg].version);
    return typeof v === 'string' ? v : null;
  };
}

/** The bounded `Bash(...)` grants already recorded in the target's settings files — its observed usage. */
export function observedBashFromSettings(repoDir) {
  const out = new Set();
  for (const f of SETTINGS_FILES) {
    let text;
    try { text = readFileSync(join(repoDir, f), 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const parsed = parseJsonc(text);
    if (parsed.error !== undefined || !isObj(parsed.value) || !isObj(parsed.value.permissions)) continue;
    for (const e of Array.isArray(parsed.value.permissions.allow) ? parsed.value.permissions.allow : []) {
      const s = String(e);
      if (/^Bash\(.+\)$/.test(s) && !broadPermission(s)) out.add(s);
    }
  }
  return [...out].sort();
}

/**
 * Prepare the hardening of one target. Reads the target, never writes it. `resolveVersion` and
 * `observed` are seams; their defaults read the target's lockfile and settings files at call time.
 */
export function hardenAgentConfig({ repoDir, resolveVersion, observed } = {}) {
  if (!repoDir) return { ok: false, reason: 'no repoDir' };
  const resolver = resolveVersion || lockfileResolver(repoDir);
  const seen = observed || observedBashFromSettings(repoDir);
  const edits = [];
  const pinned = [];
  const narrowed = [];
  const denied = [];
  const skipped = [];
  const read = (f) => {
    try { return readFileSync(join(repoDir, f), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  };
  for (const f of MCP_FILES) {
    const text = read(f);
    if (text === null) continue;
    const r = pinNpx(text, resolver);
    pinned.push(...r.pinned.map((p) => ({ file: f, ...p })));
    skipped.push(...r.skipped.map((s) => ({ file: f, ...s })));
    if (r.text !== text) edits.push({ file: f, before: text, after: r.text });
  }
  for (const f of SETTINGS_FILES) {
    const text = read(f);
    if (text === null) continue;
    const r = narrowBashAllow(text, seen);
    if (r.narrowed) narrowed.push({ file: f, removed: r.removed, added: r.added });
    else skipped.push({ file: f, reason: r.reason });
    const d = addCredentialDeny(r.text);
    if (d.added.length) denied.push({ file: f, added: d.added });
    else skipped.push({ file: f, reason: d.reason });
    if (d.text !== text) edits.push({ file: f, before: text, after: d.text });
  }
  if (!edits.length) {
    const why = skipped.map((s) => `${s.file}${s.server ? ` (${s.server})` : ''}: ${s.reason}`).join('; ');
    return { ok: false, reason: `nothing to change — ${why || 'no agent configuration found'}`, pinned, narrowed, denied, skipped };
  }
  return {
    ok: true,
    applied: false,
    files: edits.map((e) => e.file),
    pinned,
    narrowed,
    denied,
    skipped,
    diff: edits.map((e) => unifiedDiff(e.file, e.before, e.after)).join(''),
    note: 'DRY RUN — nothing written. Review the diff, `git apply` it, and commit: applying stays a human act.',
  };
}

function main(argv) {
  const repoDir = process.env.CW_AGENT_CONFIG_ROOT || argv.find((a) => !a.startsWith('--')) || '.';
  let out;
  try { out = hardenAgentConfig({ repoDir }); } catch (e) { process.stderr.write(`agent-config-harden: ${e.message}\n`); process.exit(2); }
  if (!out.ok) { process.stderr.write(`agent-config-harden: refused — ${out.reason}\n`); process.exit(2); }
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  else process.stdout.write(out.diff);
  process.stderr.write(`pinned=${out.pinned.length} narrowed=${out.narrowed.length} denied=${out.denied.length} skipped=${out.skipped.length} (dry-run; nothing written)\n`);
  process.exit(0);
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
